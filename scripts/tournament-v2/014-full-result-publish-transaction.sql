-- Tournament V2 — Migration 014: Atomic Official Full Match Report Publish
-- Source of truth: TOURNAMENT_V2_DECISION_CHECKLIST.md D-09 (result rules),
-- D-16 (single-step, mandatory Preview). Reuses existing tables only — no
-- new table is created by this migration.
--
-- STATUS: DRAFT. Reviewed statically only. NOT applied to any environment
-- (Staging or Production) as part of this correction pass. See
-- scripts/tournament-v2/README.md for the required run order and the
-- Staging-first policy, and for the current, accurate application status of
-- migrations 012/013 (applied to CFYL-Tournament-Staging) versus 014 (not
-- applied anywhere).
--
-- WHY THIS EXISTS: PR #9 (Quick Result) and PR #10 (Standings Override) both
-- had to accept non-atomic, best-effort sequential writes with compensating
-- rollback, because no approved RPC/transaction mechanism existed yet for
-- Tournament V2. Official Full Match Report publication touches far more
-- rows (submission, result version, N goal rows, N card rows, report row,
-- the match row itself, and the audit log) — a best-effort rollback across
-- that many independent writes is not an acceptable safety margin for the
-- one-time, irreversible-without-Correction act of Publish. This migration
-- introduces the first real Postgres transaction boundary for Tournament V2:
-- every step below happens inside ONE PL/pgSQL function invocation, so a
-- failure at any step rolls back everything before it — there is no
-- intermediate state where the match is "half published".
--
-- REVISION NOTE (this correction pass): a prior draft of this function
-- checked the idempotency key BEFORE locking the match row. Under real
-- concurrency, two simultaneous same-key calls could both observe "no
-- existing submission", let one proceed to publish while the other blocked
-- on the row lock, and then have the second caller re-evaluate against the
-- now-published match WITHOUT re-checking idempotency first — receiving
-- FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION instead of the stored
-- idempotent success it should get for retrying its own request. Fixed by
-- moving the lock first, then the idempotency check, per the required flow
-- in this revision. This migration also now builds the canonical stored
-- payload itself from validated parameters (never trusting a
-- caller-supplied JSON blob as authoritative — see "no p_payload parameter"
-- below) and validates goal/card team and player scope inside the
-- transaction as defense-in-depth, not just in the application layer.
--
-- Idempotent — safe to re-run after a partial failure (uses `create or
-- replace function`, and revoke/grant statements are unconditional).

-- ============================================================================
-- 14.1 tournament.publish_full_match_report — atomic publish RPC
-- ============================================================================
create or replace function tournament.publish_full_match_report(
  p_match_id uuid,
  p_tournament_id uuid,
  p_expected_version int,
  p_actor_user_id uuid,
  p_actor_email text,
  p_idempotency_key text,
  p_regulation_home_score int,
  p_regulation_away_score int,
  p_penalty_home_score int,
  p_penalty_away_score int,
  p_decided_by text,
  p_winner_team_id uuid,
  p_result_type text,
  p_goals jsonb,                  -- array of {team_id, player_id, minute, is_own_goal, goals, note}
  p_cards jsonb,                  -- array of {team_id, player_id, card_type, minute, note}
  p_report_text text,
  p_quick_result_comparison jsonb -- Quick Result vs Full Report comparison, audit-only,
                                   -- never written to any Match/result field
  -- NOTE: there is deliberately no p_payload parameter. A prior draft
  -- accepted a pre-built canonical payload from the application layer and
  -- stored it verbatim — that let caller-supplied JSON become authoritative
  -- without this function ever validating it matched the scalar
  -- score/goal/card parameters it was actually about to write. This
  -- function now builds its own canonical payload (v_canonical_payload
  -- below) from the validated parameters and uses THAT for
  -- tournament_result_submissions.payload, tournament_result_versions.payload,
  -- the idempotency comparison, and the audit log's new_data — the
  -- application layer's own canonical payload (lib/tournament/services/
  -- fullMatchReport.ts buildCanonicalFullReportPayload) is used only for the
  -- Preview Token's payload hash, a separate app-layer concern.
)
returns jsonb
language plpgsql
-- SECURITY DEFINER + an explicit search_path: this function must resolve
-- every unqualified identifier to `tournament` (never to a schema an
-- attacker could inject via a manipulated session search_path) and must run
-- with the privileges needed to write tournament_matches/tournament_match_*
-- /tournament_result_*/tournament_audit_logs regardless of which role
-- ultimately calls it — but see the REVOKE/GRANT block below: only
-- service_role is actually allowed to call it, which already bypasses RLS
-- in Supabase, so SECURITY DEFINER here is primarily about the safe
-- search_path guarantee, not privilege escalation for anon/authenticated.
security definer
set search_path = tournament, pg_temp
as $$
declare
  v_match tournament.tournament_matches%rowtype;
  v_existing_submission tournament.tournament_result_submissions%rowtype;
  v_submission_id uuid;
  v_new_version int;
  v_now timestamptz := now();
  v_goal jsonb;
  v_card jsonb;
  v_player tournament.tournament_players%rowtype;
  v_goal_team_id uuid;
  v_goal_player_id uuid;
  v_goal_minute int;
  v_goal_count int;
  v_goal_is_own boolean;
  v_card_team_id uuid;
  v_card_player_id uuid;
  v_card_type text;
  v_card_minute int;
  v_seen_card_keys text[] := '{}';
  v_dup_key text;
  v_expected_winner uuid;
  v_canonical_payload jsonb;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'FULL_REPORT_IDEMPOTENCY_KEY_REQUIRED: idempotency_key is required'
      using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------------
  -- Step 1: lock (conditionally claim) the match row BEFORE checking
  -- idempotency. `FOR UPDATE` takes a row lock for the rest of this
  -- transaction — a second concurrent publish_full_match_report() call for
  -- the SAME match blocks here until this transaction commits or rolls
  -- back, then re-evaluates against the now-committed state. Locking FIRST
  -- (rather than checking idempotency first, then locking) is what
  -- guarantees a same-key retry correctly sees the first call's own
  -- committed submission row once it acquires the lock, instead of racing
  -- past a stale "no existing submission" read.
  -- ------------------------------------------------------------------------
  select * into v_match
    from tournament.tournament_matches
    where id = p_match_id
    for update;

  if not found then
    raise exception 'FULL_REPORT_MATCH_NOT_FOUND: match not found' using errcode = 'P0001';
  end if;

  -- ------------------------------------------------------------------------
  -- Step 3 (of the required flow): idempotency, checked AFTER the lock and
  -- authoritatively inside this transaction (the app layer's own pre-check
  -- in lib/tournament/services/fullMatchReport.ts is a UX fast-path only).
  -- The canonical payload compared here is built from the raw, AS-RECEIVED
  -- parameters — deliberately BEFORE any eligibility or player/team scope
  -- validation below, so that a genuine idempotent retry (same key, same
  -- payload) returns the stored success even though the match is now
  -- published from the original call, and never re-runs player/team
  -- validation that a retry doesn't need. A different payload under the
  -- same key is rejected outright; an unrelated request using a DIFFERENT
  -- key against an already-published match falls through to the normal
  -- eligibility check further below and is correctly rejected there with
  -- FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION.
  -- ------------------------------------------------------------------------
  v_canonical_payload := jsonb_build_object(
    'matchId', p_match_id,
    'tournamentId', p_tournament_id,
    'regulationHomeScore', p_regulation_home_score,
    'regulationAwayScore', p_regulation_away_score,
    'penaltyHomeScore', p_penalty_home_score,
    'penaltyAwayScore', p_penalty_away_score,
    'decidedBy', p_decided_by,
    'winnerTeamId', p_winner_team_id,
    'resultType', p_result_type,
    'goals', coalesce(p_goals, '[]'::jsonb),
    'cards', coalesce(p_cards, '[]'::jsonb),
    'reportText', p_report_text
  );

  select * into v_existing_submission
    from tournament.tournament_result_submissions
    where match_id = p_match_id and stage = 'full_report' and idempotency_key = p_idempotency_key;

  if found then
    if v_existing_submission.payload is distinct from v_canonical_payload then
      raise exception 'FULL_REPORT_IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency_key already used with a different payload'
        using errcode = 'P0001';
    end if;

    -- Identical key + identical payload: return the stored successful
    -- result. No new submission, result version, goal/card/report row,
    -- Match version increment, or Audit Log entry — this IS the original
    -- publication being retried, not a new mutation.
    return jsonb_build_object(
      'submission_id', v_existing_submission.id,
      'match_id', p_match_id,
      'new_match_version', v_match.version,
      'published_at', v_existing_submission.submitted_at,
      'idempotent', true
    );
  end if;

  -- ------------------------------------------------------------------------
  -- No existing submission for this idempotency key — this is a genuinely
  -- new publish attempt. Continue eligibility/version/result validation and
  -- publication (steps 4 onward).
  -- ------------------------------------------------------------------------

  -- Eligibility.
  if v_match.deleted_at is not null then
    raise exception 'FULL_REPORT_MATCH_DELETED: match has been deleted' using errcode = 'P0001';
  end if;
  if v_match.tournament_id <> p_tournament_id then
    raise exception 'FULL_REPORT_TOURNAMENT_MISMATCH: match does not belong to the specified tournament'
      using errcode = 'P0001';
  end if;
  if v_match.status in ('cancelled', 'abandoned', 'void', 'bye') then
    raise exception 'FULL_REPORT_MATCH_STATUS_INELIGIBLE: match status is not eligible for official publication'
      using errcode = 'P0001';
  end if;
  if v_match.home_team_id is null or v_match.away_team_id is null then
    raise exception 'FULL_REPORT_TEAM_UNRESOLVED: home or away team is not yet resolved' using errcode = 'P0001';
  end if;
  if v_match.schedule_status <> 'published' then
    raise exception 'FULL_REPORT_SCHEDULE_NOT_PUBLISHED: schedule is not in an eligible published state'
      using errcode = 'P0001';
  end if;

  -- Confirm not already published — Publish can never overwrite a published
  -- result through this function; Correction is a separate, not-yet-
  -- implemented workflow/PR. A genuinely new (different-key) publish
  -- request against an already-published match is correctly rejected here.
  if v_match.result_workflow_status = 'published' then
    raise exception 'FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION: this match already has a published official result — use the Correction workflow'
      using errcode = 'P0001';
  end if;

  if v_match.version <> p_expected_version then
    raise exception 'FULL_REPORT_VERSION_CONFLICT: match has changed since Preview' using errcode = 'P0001';
  end if;

  -- --------------------------------------------------------------------
  -- D-09 result-consistency re-check (defense-in-depth — the app layer
  -- already validated this before Preview and before calling this RPC).
  -- Now also validates result_type explicitly, not just decided_by/
  -- winner/penalty-field presence, per this correction pass.
  -- --------------------------------------------------------------------
  if p_winner_team_id is null or p_winner_team_id not in (v_match.home_team_id, v_match.away_team_id) then
    raise exception 'FULL_REPORT_WINNER_TEAM_INVALID: winner_team_id must be the home or away team'
      using errcode = 'P0001';
  end if;
  if p_regulation_home_score is null or p_regulation_away_score is null
     or p_regulation_home_score < 0 or p_regulation_away_score < 0 then
    raise exception 'FULL_REPORT_SCORE_INVALID: regulation scores must be non-negative integers'
      using errcode = 'P0001';
  end if;

  if p_regulation_home_score <> p_regulation_away_score then
    -- Regulation-decided.
    if p_decided_by <> 'regulation' or p_penalty_home_score is not null or p_penalty_away_score is not null then
      raise exception 'FULL_REPORT_RESULT_INCONSISTENT: a regulation-decided match must not carry penalty fields'
        using errcode = 'P0001';
    end if;
    if p_result_type <> 'normal' then
      raise exception 'FULL_REPORT_RESULT_TYPE_INCONSISTENT: a regulation-decided match must have result_type=normal'
        using errcode = 'P0001';
    end if;
    v_expected_winner := case when p_regulation_home_score > p_regulation_away_score
      then v_match.home_team_id else v_match.away_team_id end;
    if p_winner_team_id <> v_expected_winner then
      raise exception 'FULL_REPORT_RESULT_INCONSISTENT: winner_team_id does not match the higher regulation score'
        using errcode = 'P0001';
    end if;
  else
    -- Penalty-decided.
    if p_decided_by <> 'penalty' or p_penalty_home_score is null or p_penalty_away_score is null then
      raise exception 'FULL_REPORT_RESULT_INCONSISTENT: a tied-regulation match requires a valid penalty decision'
        using errcode = 'P0001';
    end if;
    if p_penalty_home_score < 0 or p_penalty_away_score < 0 then
      raise exception 'FULL_REPORT_SCORE_INVALID: penalty scores must be non-negative integers'
        using errcode = 'P0001';
    end if;
    if p_penalty_home_score = p_penalty_away_score then
      raise exception 'FULL_REPORT_RESULT_INCONSISTENT: penalty shootout scores must not be tied'
        using errcode = 'P0001';
    end if;
    if p_result_type <> 'penalty_decided' then
      raise exception 'FULL_REPORT_RESULT_TYPE_INCONSISTENT: a penalty-decided match must have result_type=penalty_decided'
        using errcode = 'P0001';
    end if;
    v_expected_winner := case when p_penalty_home_score > p_penalty_away_score
      then v_match.home_team_id else v_match.away_team_id end;
    if p_winner_team_id <> v_expected_winner then
      raise exception 'FULL_REPORT_RESULT_INCONSISTENT: winner_team_id does not match the penalty shootout winner'
        using errcode = 'P0001';
    end if;
  end if;

  -- --------------------------------------------------------------------
  -- Goal event scope validation + insert. Defense-in-depth: the
  -- application service (lib/tournament/services/fullMatchReport.ts
  -- validateGoalsAndCards) already validates this, but the transaction
  -- must not rely solely on foreign keys or on the app layer never being
  -- bypassed. Penalty-shootout kicks must never appear in p_goals — the
  -- app layer only ever builds this array from regulation-play goal
  -- events.
  --
  -- OWN-GOAL AMBIGUITY (documented, unresolved — do not guess): whether
  -- tournament_match_goals.team_id for an own goal means "the team
  -- credited with the goal" or "the scoring player's own team" is not
  -- decided anywhere in TOURNAMENT_V2_DATA_MODEL.md. For an own-goal event
  -- (is_own_goal=true), this function therefore validates the player's
  -- tournament/category and not-deleted status, but deliberately SKIPS the
  -- player-belongs-to-submitted-team check, since enforcing team_id
  -- equality could reject a legitimate own goal under either convention.
  -- Non-own-goal events keep the full team-match check — this ambiguity
  -- must never weaken validation for ordinary goals. No goal-total-to-
  -- score reconciliation is performed anywhere in this function, for the
  -- same reason.
  -- --------------------------------------------------------------------
  if p_goals is not null then
    for v_goal in select * from jsonb_array_elements(p_goals)
    loop
      v_goal_team_id := nullif(v_goal->>'team_id', '')::uuid;
      v_goal_player_id := nullif(v_goal->>'player_id', '')::uuid;
      v_goal_is_own := coalesce((v_goal->>'is_own_goal')::boolean, false);
      v_goal_minute := nullif(v_goal->>'minute', '')::int;
      v_goal_count := coalesce(nullif(v_goal->>'goals', '')::int, 1);

      if v_goal_team_id is null or v_goal_team_id not in (v_match.home_team_id, v_match.away_team_id) then
        raise exception 'FULL_REPORT_GOAL_TEAM_INVALID: goal team must be the home or away team of this match'
          using errcode = 'P0001';
      end if;
      if v_goal_count < 1 then
        raise exception 'FULL_REPORT_GOAL_COUNT_INVALID: goal count must be a positive integer' using errcode = 'P0001';
      end if;
      if v_goal_minute is not null and v_goal_minute < 0 then
        raise exception 'FULL_REPORT_GOAL_MINUTE_INVALID: goal minute must be non-negative' using errcode = 'P0001';
      end if;

      if v_goal_player_id is not null then
        select * into v_player from tournament.tournament_players where id = v_goal_player_id;
        if not found then
          raise exception 'FULL_REPORT_GOAL_PLAYER_NOT_FOUND: goal player not found' using errcode = 'P0001';
        end if;
        if v_player.deleted_at is not null then
          raise exception 'FULL_REPORT_GOAL_PLAYER_DELETED: goal player has been deleted' using errcode = 'P0001';
        end if;
        if v_player.tournament_id <> p_tournament_id then
          raise exception 'FULL_REPORT_GOAL_PLAYER_TOURNAMENT_MISMATCH: goal player does not belong to this tournament'
            using errcode = 'P0001';
        end if;
        if v_player.category_id <> v_match.category_id then
          raise exception 'FULL_REPORT_GOAL_PLAYER_CATEGORY_MISMATCH: goal player does not belong to this category'
            using errcode = 'P0001';
        end if;
        if not v_goal_is_own and v_player.team_id <> v_goal_team_id then
          raise exception 'FULL_REPORT_GOAL_PLAYER_TEAM_MISMATCH: goal player does not belong to the selected team'
            using errcode = 'P0001';
        end if;
      end if;

      insert into tournament.tournament_match_goals
        (match_id, player_id, team_id, minute, is_own_goal, goals, note)
      values (
        p_match_id,
        v_goal_player_id,
        v_goal_team_id,
        v_goal_minute,
        v_goal_is_own,
        v_goal_count,
        nullif(v_goal->>'note', '')
      );
    end loop;
  end if;

  -- --------------------------------------------------------------------
  -- Card event scope validation + insert. Same defense-in-depth rationale
  -- as goals above — card player_id is always required (never nullable).
  -- --------------------------------------------------------------------
  if p_cards is not null then
    for v_card in select * from jsonb_array_elements(p_cards)
    loop
      v_card_team_id := nullif(v_card->>'team_id', '')::uuid;
      v_card_player_id := nullif(v_card->>'player_id', '')::uuid;
      v_card_type := v_card->>'card_type';
      v_card_minute := nullif(v_card->>'minute', '')::int;

      if v_card_team_id is null or v_card_team_id not in (v_match.home_team_id, v_match.away_team_id) then
        raise exception 'FULL_REPORT_CARD_TEAM_INVALID: card team must be the home or away team of this match'
          using errcode = 'P0001';
      end if;
      if v_card_player_id is null then
        raise exception 'FULL_REPORT_CARD_PLAYER_REQUIRED: card player is required' using errcode = 'P0001';
      end if;
      if v_card_type is null or v_card_type not in ('yellow', 'second_yellow', 'red') then
        raise exception 'FULL_REPORT_CARD_TYPE_INVALID: card_type must be yellow, second_yellow, or red'
          using errcode = 'P0001';
      end if;
      if v_card_minute is not null and v_card_minute < 0 then
        raise exception 'FULL_REPORT_CARD_MINUTE_INVALID: card minute must be non-negative' using errcode = 'P0001';
      end if;

      select * into v_player from tournament.tournament_players where id = v_card_player_id;
      if not found then
        raise exception 'FULL_REPORT_CARD_PLAYER_NOT_FOUND: card player not found' using errcode = 'P0001';
      end if;
      if v_player.deleted_at is not null then
        raise exception 'FULL_REPORT_CARD_PLAYER_DELETED: card player has been deleted' using errcode = 'P0001';
      end if;
      if v_player.tournament_id <> p_tournament_id then
        raise exception 'FULL_REPORT_CARD_PLAYER_TOURNAMENT_MISMATCH: card player does not belong to this tournament'
          using errcode = 'P0001';
      end if;
      if v_player.category_id <> v_match.category_id then
        raise exception 'FULL_REPORT_CARD_PLAYER_CATEGORY_MISMATCH: card player does not belong to this category'
          using errcode = 'P0001';
      end if;
      if v_player.team_id <> v_card_team_id then
        raise exception 'FULL_REPORT_CARD_PLAYER_TEAM_MISMATCH: card player does not belong to the selected team'
          using errcode = 'P0001';
      end if;

      -- Defense-in-depth duplicate check, ahead of the DB's own
      -- unique(match_id, player_id, card_type) constraint, so a duplicate
      -- fails with a specific, friendly code inside this same transaction.
      v_dup_key := v_card_player_id::text || '|' || v_card_type;
      if v_dup_key = any(v_seen_card_keys) then
        raise exception 'FULL_REPORT_DUPLICATE_CARD: duplicate card for the same player and card_type'
          using errcode = 'P0001';
      end if;
      v_seen_card_keys := array_append(v_seen_card_keys, v_dup_key);

      insert into tournament.tournament_match_cards
        (match_id, player_id, team_id, card_type, minute, note)
      values (
        p_match_id,
        v_card_player_id,
        v_card_team_id,
        v_card_type,
        v_card_minute,
        nullif(v_card->>'note', '')
      );
    end loop;
  end if;

  -- Submission + result version — first-time publish only (see migration
  -- header). Stores v_canonical_payload (server-built, validated), never a
  -- caller-supplied blob.
  insert into tournament.tournament_result_submissions
    (match_id, stage, payload, status, version, idempotency_key, submitted_by, submitted_at)
  values
    (p_match_id, 'full_report', v_canonical_payload, 'published', 1, p_idempotency_key, p_actor_user_id, v_now)
  returning id into v_submission_id;

  insert into tournament.tournament_result_versions (submission_id, version, payload, changed_by)
  values (v_submission_id, 1, v_canonical_payload, p_actor_user_id);

  -- Match report text (optional — only inserted when non-empty).
  if p_report_text is not null and length(trim(p_report_text)) > 0 then
    insert into tournament.tournament_match_reports (match_id, report, submitted_by, submitted_at)
    values (p_match_id, p_report_text, p_actor_user_id, v_now);
  end if;

  -- Official match fields + version bump. The row is already locked above
  -- (FOR UPDATE), so this UPDATE cannot race with another publish attempt
  -- for the same match.
  update tournament.tournament_matches
  set regulation_home_score = p_regulation_home_score,
      regulation_away_score = p_regulation_away_score,
      penalty_home_score = p_penalty_home_score,
      penalty_away_score = p_penalty_away_score,
      decided_by = p_decided_by,
      winner_team_id = p_winner_team_id,
      result_type = p_result_type,
      status = 'finished',
      result_workflow_status = 'published',
      version = version + 1,
      updated_by = p_actor_user_id,
      updated_at = v_now
  where id = p_match_id
  returning version into v_new_version;

  -- Audit log. The Quick Result comparison (never authoritative, never
  -- written to any Match/result field) is recorded here for audit
  -- visibility only. Exactly one row, in this same transaction.
  insert into tournament.tournament_audit_logs
    (tournament_id, admin_id, admin_email, action, entity_type, entity_id, entity_label, old_data, new_data)
  values (
    p_tournament_id,
    p_actor_user_id,
    p_actor_email,
    'tournament.full_match_report.publish',
    'tournament_match',
    p_match_id,
    v_match.match_code,
    jsonb_build_object('quick_result_comparison', p_quick_result_comparison),
    v_canonical_payload
  );

  -- Return the publication result. Downstream resolution (match_winner/
  -- match_loser/group_rank/best_ranked placeholder resolution, Knockout
  -- Advancement, Standings row writes, Suspension calculation) is
  -- intentionally NOT performed here — none of those systems are
  -- implemented yet, and this function must not invent a queue/event
  -- mechanism that doesn't exist. Standings (PR #10) computes dynamically
  -- from published tournament_matches fields, so it requires no direct
  -- write from this function at all.
  return jsonb_build_object(
    'submission_id', v_submission_id,
    'match_id', p_match_id,
    'new_match_version', v_new_version,
    'published_at', v_now,
    'idempotent', false,
    'downstream_resolution_pending', true
  );
end;
$$;

comment on function tournament.publish_full_match_report(
  uuid, uuid, int, uuid, text, text, int, int, int, int, text, uuid, text, jsonb, jsonb, text, jsonb
) is
  'Atomic Official Full Match Report publish. First-time publish only — '
  'rejects if result_workflow_status is already published (see Correction '
  'workflow, a separate future PR). service_role only; see REVOKE/GRANT '
  'below. Locks the Match row before checking idempotency, so a same-key '
  'retry correctly observes the prior committed submission rather than '
  'racing past a stale read. Builds its own canonical payload from '
  'validated parameters — never trusts a caller-supplied payload blob. '
  'Validates goal/card team and player (tournament/category/team/'
  'not-deleted) scope inside the transaction as defense-in-depth. All '
  'writes (submission, result version, goals, cards, report, official '
  'match fields, audit log) happen in this single function invocation — a '
  'failure at any step rolls back every prior step in this call.';

-- ============================================================================
-- 14.2 RPC security — server/service-role only
-- ============================================================================
-- Supabase's `service_role` Postgres role already bypasses RLS entirely, so
-- SECURITY DEFINER above is not being used to grant privilege escalation to
-- a lesser role — it exists solely to pin a safe, explicit search_path.
-- Nonetheless we explicitly and unconditionally lock the callable roles
-- down here, in case this function is ever inspected without that context:
-- anon and authenticated (ordinary Supabase Auth users, including any
-- future Tournament public-facing account) must NEVER be able to invoke
-- this function directly, even by discovering its name — only the
-- server-side Tournament client (lib/tournament/db/supabase-tournament.ts
-- getTournamentServiceClient(), which uses the service-role key and is
-- never exposed to the browser) may call it.
--
-- RUNTIME VERIFICATION NOTE: the tests in this repository (see
-- lib/tournament/services/__tests__/fullReportMigrationStatic.test.ts) can
-- only prove these REVOKE/GRANT statements exist in this SQL source text —
-- they cannot prove Postgres actually enforces them, since that requires
-- applying this migration to a real database and attempting to call the
-- function as anon/authenticated. That runtime check remains outstanding
-- and must happen as part of Migration 014's Staging application, not
-- before.
revoke all on function tournament.publish_full_match_report(
  uuid, uuid, int, uuid, text, text, int, int, int, int, text, uuid, text, jsonb, jsonb, text, jsonb
) from public;

revoke all on function tournament.publish_full_match_report(
  uuid, uuid, int, uuid, text, text, int, int, int, int, text, uuid, text, jsonb, jsonb, text, jsonb
) from anon;

revoke all on function tournament.publish_full_match_report(
  uuid, uuid, int, uuid, text, text, int, int, int, int, text, uuid, text, jsonb, jsonb, text, jsonb
) from authenticated;

grant execute on function tournament.publish_full_match_report(
  uuid, uuid, int, uuid, text, text, int, int, int, int, text, uuid, text, jsonb, jsonb, text, jsonb
) to service_role;

-- This function performs no dynamic SQL (no EXECUTE/format() building a
-- query string from input) and returns only the small jsonb summary object
-- above — it never returns full row contents, service-role secrets, or any
-- column not explicitly listed in the RETURNS jsonb construction, so there
-- is nothing here that widens the existing RLS/public-view exposure surface
-- documented in 011-scheduling-import-and-views.sql.
