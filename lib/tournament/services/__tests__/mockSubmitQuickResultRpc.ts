/**
 * Faithful JS re-implementation of tournament.submit_quick_result()
 * (scripts/tournament-v2/016-quick-result-atomic-submit.sql), mirroring its
 * exact contract: lock the Match first, check idempotency only after that
 * lock is (conceptually) held, authoritatively re-validate every piece of
 * eligibility state for a genuinely new write, then atomically claim the
 * Match version, insert the submission, insert the result-version audit-
 * history row, and insert the audit log — all four writes together, or none
 * of them.
 *
 * IMPORTANT: models real Postgres transaction semantics — every write is
 * staged on a deep-cloned copy of the affected tables first; the real `db`
 * argument is only mutated once, at the very end, after every step has
 * succeeded. If validation fails, the idempotency check finds a mismatch, or
 * an `injection.failAt` failure point is hit, the function returns an
 * `error` and `db` is left completely untouched — exactly like an unhandled
 * exception rolling back the whole Postgres transaction. `injection` is a
 * test-only hook (this file only — never wired into route.ts or any
 * production code path) that lets tests prove specific steps roll back
 * everything before them, the same way PR #7's mockSaveQualificationDrawAssignmentRpc.ts
 * does for its own RPC.
 */
type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

export interface SubmitQuickResultRpcArgs {
  p_tournament_id: string;
  p_match_id: string;
  p_venue_id: string | null;
  p_home_score: number;
  p_away_score: number;
  p_expected_version: number;
  p_idempotency_key: string;
  p_actor_id: string | null;
  p_actor_email: string | null;
  p_session_id: string | null;
  p_device_metadata: Record<string, unknown> | null;
}

export interface SubmitQuickResultRpcResult {
  submissionId: string;
  matchId: string;
  matchCode: string;
  homeScore: number;
  awayScore: number;
  previousMatchVersion: number;
  newMatchVersion: number;
  status: 'submitted';
  idempotent: boolean;
}

export interface RpcOutcome {
  data: SubmitQuickResultRpcResult | null;
  error: { message: string } | null;
}

export interface RpcFailureInjection {
  /** Simulates a failure at this step — nothing before it is ever committed to `db`. */
  failAt?: 'submission' | 'resultVersion' | 'audit';
}

const STAGE = 'quick_result';
const INCOMPATIBLE_STATUSES = new Set(['cancelled', 'abandoned', 'void', 'bye']);
let mockIdCounter = 0;
function mockId(prefix: string): string {
  mockIdCounter += 1;
  return `${prefix}-${mockIdCounter}`;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function mockSubmitQuickResultRpc(db: Db, args: SubmitQuickResultRpcArgs, injection: RpcFailureInjection = {}): RpcOutcome {
  const now = new Date().toISOString();

  // ---- 0. Cheap input-shape validation ----
  if (!args.p_idempotency_key || !args.p_idempotency_key.trim()) {
    return { data: null, error: { message: 'IDEMPOTENCY_KEY_REQUIRED: idempotencyKey is required' } };
  }
  if (args.p_home_score < 0) {
    return { data: null, error: { message: 'HOME_SCORE_NEGATIVE_SCORE: home score must be a non-negative integer' } };
  }
  if (args.p_away_score < 0) {
    return { data: null, error: { message: 'AWAY_SCORE_NEGATIVE_SCORE: away score must be a non-negative integer' } };
  }

  // ---- 1. "Lock" (find) the Match first ----
  const match = (db.tournament_matches || []).find((m) => m.id === args.p_match_id);
  if (!match) {
    return { data: null, error: { message: `MATCH_NOT_FOUND: match ${args.p_match_id} not found` } };
  }
  if (match.deleted_at) {
    return { data: null, error: { message: `MATCH_DELETED: match ${args.p_match_id} has been deleted` } };
  }
  if (match.tournament_id !== args.p_tournament_id) {
    return { data: null, error: { message: `TOURNAMENT_MISMATCH: match ${args.p_match_id} does not belong to tournament ${args.p_tournament_id}` } };
  }

  const tournament = (db.tournaments || []).find((t) => t.id === args.p_tournament_id);
  if (!tournament || tournament.deleted_at) {
    return { data: null, error: { message: `TOURNAMENT_MISMATCH: tournament ${args.p_tournament_id} not found or deleted` } };
  }

  // ---- 2. Idempotency check — only after the "lock" above ----
  const canonicalPayload = {
    home_score: args.p_home_score,
    away_score: args.p_away_score,
    venue_id: args.p_venue_id,
    match_version_before: args.p_expected_version,
    session_id: args.p_session_id,
    device_metadata: args.p_device_metadata ?? null,
  };

  const existing = (db.tournament_result_submissions || []).find(
    (s) => s.match_id === args.p_match_id && s.stage === STAGE && s.idempotency_key === args.p_idempotency_key
  );

  if (existing) {
    const storedPayload = existing.payload as Row;
    const { match_version_after: _omit, ...existingRequestPayload } = storedPayload;
    void _omit;

    if (!deepEqual(existingRequestPayload, canonicalPayload)) {
      return {
        data: null,
        error: { message: `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: idempotency key ${args.p_idempotency_key} was already used with a different request` },
      };
    }

    return {
      data: {
        submissionId: existing.id as string,
        matchId: args.p_match_id,
        matchCode: match.match_code as string,
        homeScore: storedPayload.home_score as number,
        awayScore: storedPayload.away_score as number,
        previousMatchVersion: storedPayload.match_version_before as number,
        newMatchVersion: storedPayload.match_version_after as number,
        status: 'submitted',
        idempotent: true,
      },
      error: null,
    };
  }

  // ---- 3. Genuinely new submission — full authoritative validation ----
  if (args.p_venue_id !== null && match.venue_id !== args.p_venue_id) {
    return { data: null, error: { message: `VENUE_MATCH_MISMATCH: match ${args.p_match_id} does not belong to venue ${args.p_venue_id}` } };
  }
  if (INCOMPATIBLE_STATUSES.has(match.status as string)) {
    return { data: null, error: { message: `MATCH_STATUS_INCOMPATIBLE: match status "${match.status}" is not eligible for Quick Result` } };
  }
  if (match.result_workflow_status === 'published') {
    return { data: null, error: { message: `RESULT_ALREADY_PUBLISHED: match ${args.p_match_id} already has an official published result` } };
  }
  if (!match.home_team_id) {
    return { data: null, error: { message: 'HOME_TEAM_UNRESOLVED: home team placeholder is not yet resolved' } };
  }
  if (!match.away_team_id) {
    return { data: null, error: { message: 'AWAY_TEAM_UNRESOLVED: away team placeholder is not yet resolved' } };
  }
  if (match.version !== args.p_expected_version) {
    return {
      data: null,
      error: { message: `QUICK_RESULT_VERSION_CONFLICT: match has changed since Preview (expected version ${args.p_expected_version}, current version ${match.version})` },
    };
  }

  // ---- Staging phase: nothing below this line touches `db` directly. ----
  const stagedMatches = clone(db.tournament_matches || []);
  const stagedSubmissions = clone(db.tournament_result_submissions || []);
  const stagedVersions = clone(db.tournament_result_versions || []);
  const stagedAuditLogs = clone(db.tournament_audit_logs || []);

  const newVersion = args.p_expected_version + 1;
  const stagedMatch = stagedMatches.find((m) => m.id === args.p_match_id) as Row;
  stagedMatch.version = newVersion;
  stagedMatch.updated_by = args.p_actor_id;
  stagedMatch.updated_at = now;

  if (injection.failAt === 'submission') {
    return { data: null, error: { message: 'SIMULATED_FAILURE: submission insert' } };
  }

  const submissionId = mockId('mock-submission');
  const storedPayload = { ...canonicalPayload, match_version_after: newVersion };
  stagedSubmissions.push({
    id: submissionId,
    match_id: args.p_match_id,
    stage: STAGE,
    payload: storedPayload,
    status: 'submitted',
    version: 1,
    idempotency_key: args.p_idempotency_key,
    submitted_by: args.p_actor_id,
    submitted_at: now,
  });

  if (injection.failAt === 'resultVersion') {
    return { data: null, error: { message: 'SIMULATED_FAILURE: result-version insert' } };
  }

  stagedVersions.push({
    id: mockId('mock-version'),
    submission_id: submissionId,
    version: 1,
    payload: storedPayload,
    changed_by: args.p_actor_id,
  });

  if (injection.failAt === 'audit') {
    return { data: null, error: { message: 'SIMULATED_FAILURE: audit insert' } };
  }

  stagedAuditLogs.push({
    id: mockId('mock-audit'),
    tournament_id: args.p_tournament_id,
    admin_id: args.p_actor_id,
    admin_email: args.p_actor_email,
    action: 'tournament.quick_result.submit',
    entity_type: 'tournament_match',
    entity_id: args.p_match_id,
    entity_label: match.match_code,
    new_data: {
      tournament_id: args.p_tournament_id,
      match_id: args.p_match_id,
      match_code: match.match_code,
      submission_id: submissionId,
      venue_id: args.p_venue_id,
      home_score: args.p_home_score,
      away_score: args.p_away_score,
      idempotency_key: args.p_idempotency_key,
      previous_match_version: args.p_expected_version,
      new_match_version: newVersion,
      actor_id: args.p_actor_id,
      actor_email: args.p_actor_email,
      session_id: args.p_session_id,
      device_metadata: args.p_device_metadata ?? null,
      provisional: true,
    },
    created_at: now,
  });

  // ---- Commit phase: every step above succeeded — write staged state back. ----
  db.tournament_matches = stagedMatches;
  db.tournament_result_submissions = stagedSubmissions;
  db.tournament_result_versions = stagedVersions;
  db.tournament_audit_logs = stagedAuditLogs;

  return {
    data: {
      submissionId,
      matchId: args.p_match_id,
      matchCode: match.match_code as string,
      homeScore: args.p_home_score,
      awayScore: args.p_away_score,
      previousMatchVersion: args.p_expected_version,
      newMatchVersion: newVersion,
      status: 'submitted',
      idempotent: false,
    },
    error: null,
  };
}
