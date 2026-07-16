import { getTournamentServiceClient } from '../db/supabase-tournament';
import {
  hashFullReportPayload,
  issueFullReportPreviewToken,
  verifyFullReportPreviewToken,
} from './fullReportPreviewToken';
import { validateResultConsistency, type ResultScoreInput, type ValidatedResultScores } from '../fullMatchReport/validateResultConsistency';

// Tournament V2 Full Match Report + Official Result Publish (Phase 5c,
// first-time publish only — Correction is a separate, not-yet-implemented
// workflow/PR). Unlike PR #9's Quick Result and PR #10's Standings
// Override, Official Publish is NOT a set of independent best-effort
// writes — it calls the atomic tournament.publish_full_match_report()
// Postgres RPC (scripts/tournament-v2/014-full-result-publish-transaction.sql,
// a DRAFT migration, not applied anywhere). If that RPC is unavailable
// (migration not applied), this service fails closed with
// FULL_REPORT_PUBLISH_RPC_UNAVAILABLE — it never falls back to sequential
// writes.
//
// KNOWN GAP, NOT GUESSED: whether an own-goal's tournament_match_goals.team_id
// means "the team credited with conceding" or "the scoring player's own
// team" is undocumented anywhere in TOURNAMENT_V2_DATA_MODEL.md or the
// migration SQL comments. This service therefore does NOT attempt to
// reconcile/cross-check summed goal events against the official regulation
// score — doing so would require guessing that convention. See the PR's
// final report "Blockers" section.

const STAGE = 'full_report';
const INELIGIBLE_STATUSES = new Set(['cancelled', 'abandoned', 'void', 'bye']);
const VALID_CARD_TYPES = new Set(['yellow', 'second_yellow', 'red']);

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

export class FullMatchReportError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface GoalEventInput {
  teamId: string;
  playerId: string | null;
  minute: unknown;
  isOwnGoal: boolean;
  goals: unknown;
  note: string | null;
}

export interface CardEventInput {
  teamId: string;
  playerId: string;
  cardType: unknown;
  minute: unknown;
  note: string | null;
}

export interface FullMatchReportInput extends Omit<ResultScoreInput, 'homeTeamId' | 'awayTeamId'> {
  reportText: string | null;
  goals: GoalEventInput[];
  cards: CardEventInput[];
}

interface MatchRow {
  id: string;
  tournament_id: string;
  category_id: string;
  group_id: string | null;
  venue_id: string | null;
  court_id: string | null;
  stage: string;
  match_code: string;
  match_no: number | null;
  match_date: string | null;
  match_time: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  status: string;
  result_workflow_status: string;
  schedule_status: string;
  result_type: string;
  version: number;
  deleted_at: string | null;
}

interface TeamRow {
  id: string;
  tournament_id: string;
  category_id: string;
  name: string;
  deleted_at?: string | null;
}

interface PlayerRow {
  id: string;
  tournament_id: string;
  category_id: string;
  team_id: string;
  full_name: string;
  deleted_at: string | null;
}

interface QuickResultSubmissionRow {
  id: string;
  payload: { home_score: number; away_score: number };
  submitted_at: string | null;
}

async function loadMatch(client: TournamentClient, matchId: string): Promise<MatchRow> {
  const { data, error } = await client
    .from('tournament_matches')
    .select(
      'id, tournament_id, category_id, group_id, venue_id, court_id, stage, match_code, match_no, match_date, match_time, home_team_id, away_team_id, status, result_workflow_status, schedule_status, result_type, version, deleted_at'
    )
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new FullMatchReportError('FULL_REPORT_MATCH_NOT_FOUND', 'Match not found');
  return data as MatchRow;
}

function assertEligible(match: MatchRow, params: { tournamentId: string; venueId: string | null }): void {
  if (match.deleted_at) throw new FullMatchReportError('FULL_REPORT_MATCH_DELETED', 'Match has been deleted');
  if (match.tournament_id !== params.tournamentId) {
    throw new FullMatchReportError('FULL_REPORT_TOURNAMENT_MISMATCH', 'Match does not belong to the specified tournament');
  }
  if (params.venueId !== null && match.venue_id !== params.venueId) {
    throw new FullMatchReportError('FULL_REPORT_VENUE_MISMATCH', 'This match does not belong to the selected venue');
  }
  if (INELIGIBLE_STATUSES.has(match.status)) {
    throw new FullMatchReportError(
      'FULL_REPORT_MATCH_STATUS_INELIGIBLE',
      `Match status "${match.status}" is not eligible for official publication (cancelled/abandoned/void/BYE matches are excluded)`
    );
  }
  if (!match.home_team_id) throw new FullMatchReportError('FULL_REPORT_HOME_TEAM_UNRESOLVED', 'Home team placeholder is not yet resolved');
  if (!match.away_team_id) throw new FullMatchReportError('FULL_REPORT_AWAY_TEAM_UNRESOLVED', 'Away team placeholder is not yet resolved');
  if (match.result_workflow_status === 'published') {
    throw new FullMatchReportError(
      'FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION',
      'This match already has a published official result — the Correction workflow (not yet implemented) is required to change it'
    );
  }
  if (match.schedule_status !== 'published') {
    throw new FullMatchReportError('FULL_REPORT_SCHEDULE_NOT_PUBLISHED', 'Schedule is not in an eligible published state for this match');
  }
}

function assertNonNegativeInteger(raw: unknown, code: string, label: string): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (raw === null || raw === undefined || raw === '' || Number.isNaN(num) || !Number.isInteger(num) || num < 0) {
    throw new FullMatchReportError(code, `${label} must be a non-negative integer`);
  }
  return num;
}

interface ValidatedGoalEvent {
  teamId: string;
  playerId: string | null;
  minute: number | null;
  isOwnGoal: boolean;
  goals: number;
  note: string | null;
}

interface ValidatedCardEvent {
  teamId: string;
  playerId: string;
  cardType: 'yellow' | 'second_yellow' | 'red';
  minute: number | null;
  note: string | null;
}

async function validateGoalsAndCards(params: {
  client: TournamentClient;
  match: MatchRow;
  goals: GoalEventInput[];
  cards: CardEventInput[];
}): Promise<{ goals: ValidatedGoalEvent[]; cards: ValidatedCardEvent[] }> {
  const { client, match, goals, cards } = params;
  const matchTeamIds = new Set([match.home_team_id, match.away_team_id]);

  const allPlayerIds = Array.from(
    new Set(
      [...goals.map((g) => g.playerId), ...cards.map((c) => c.playerId)].filter((id): id is string => !!id && id.trim() !== '')
    )
  );

  let playersById = new Map<string, PlayerRow>();
  if (allPlayerIds.length > 0) {
    const { data, error } = await client
      .from('tournament_players')
      .select('id, tournament_id, category_id, team_id, full_name, deleted_at')
      .in('id', allPlayerIds);
    if (error) throw new Error(error.message);
    playersById = new Map(((data || []) as PlayerRow[]).map((p) => [p.id, p]));
  }

  function assertPlayerValid(playerId: string, teamId: string, entityLabel: 'goal' | 'card'): void {
    const player = playersById.get(playerId);
    if (!player) {
      throw new FullMatchReportError(`FULL_REPORT_${entityLabel.toUpperCase()}_PLAYER_NOT_FOUND`, `Player ${playerId} not found`);
    }
    if (player.deleted_at) {
      throw new FullMatchReportError(`FULL_REPORT_${entityLabel.toUpperCase()}_PLAYER_DELETED`, `Player ${player.full_name} has been deleted`);
    }
    if (player.tournament_id !== match.tournament_id) {
      throw new FullMatchReportError(
        `FULL_REPORT_${entityLabel.toUpperCase()}_PLAYER_TOURNAMENT_MISMATCH`,
        `Player ${player.full_name} does not belong to this tournament`
      );
    }
    if (player.category_id !== match.category_id) {
      throw new FullMatchReportError(
        `FULL_REPORT_${entityLabel.toUpperCase()}_PLAYER_CATEGORY_MISMATCH`,
        `Player ${player.full_name} does not belong to this category`
      );
    }
    if (player.team_id !== teamId) {
      throw new FullMatchReportError(
        `FULL_REPORT_${entityLabel.toUpperCase()}_PLAYER_TEAM_MISMATCH`,
        `Player ${player.full_name} does not belong to the selected team`
      );
    }
  }

  const validatedGoals: ValidatedGoalEvent[] = goals.map((goal) => {
    const teamId = String(goal.teamId || '').trim();
    if (!matchTeamIds.has(teamId)) {
      throw new FullMatchReportError('FULL_REPORT_GOAL_TEAM_INVALID', 'Goal team must be the home or away team of this match');
    }
    const playerId = goal.playerId ? String(goal.playerId).trim() : null;
    if (playerId) assertPlayerValid(playerId, teamId, 'goal');

    const minuteRaw = goal.minute;
    let minute: number | null = null;
    if (minuteRaw !== null && minuteRaw !== undefined && minuteRaw !== '') {
      minute = assertNonNegativeInteger(minuteRaw, 'FULL_REPORT_GOAL_MINUTE_INVALID', 'Goal minute');
    }

    const goalsCount = assertNonNegativeInteger(goal.goals ?? 1, 'FULL_REPORT_GOAL_COUNT_INVALID', 'Goal count');
    if (goalsCount < 1) {
      throw new FullMatchReportError('FULL_REPORT_GOAL_COUNT_INVALID', 'Goal count must be a positive integer');
    }

    return {
      teamId,
      playerId,
      minute,
      isOwnGoal: !!goal.isOwnGoal,
      goals: goalsCount,
      note: goal.note ? String(goal.note).trim() || null : null,
    };
  });

  const seenCardKeys = new Set<string>();
  const validatedCards: ValidatedCardEvent[] = cards.map((card) => {
    const teamId = String(card.teamId || '').trim();
    if (!matchTeamIds.has(teamId)) {
      throw new FullMatchReportError('FULL_REPORT_CARD_TEAM_INVALID', 'Card team must be the home or away team of this match');
    }
    const playerId = String(card.playerId || '').trim();
    if (!playerId) throw new FullMatchReportError('FULL_REPORT_CARD_PLAYER_REQUIRED', 'Card player is required');
    assertPlayerValid(playerId, teamId, 'card');

    const cardType = String(card.cardType || '').trim();
    if (!VALID_CARD_TYPES.has(cardType)) {
      throw new FullMatchReportError('FULL_REPORT_CARD_TYPE_INVALID', "card_type must be 'yellow', 'second_yellow', or 'red'");
    }

    // Defense-in-depth: mirrors the DB's unique(match_id, player_id,
    // card_type) constraint so a duplicate is rejected with a friendly,
    // specific error instead of a raw Postgres constraint-violation message.
    const key = `${playerId}|${cardType}`;
    if (seenCardKeys.has(key)) {
      throw new FullMatchReportError('FULL_REPORT_DUPLICATE_CARD', `Duplicate card: player already has a ${cardType} card recorded`);
    }
    seenCardKeys.add(key);

    let minute: number | null = null;
    if (card.minute !== null && card.minute !== undefined && card.minute !== '') {
      minute = assertNonNegativeInteger(card.minute, 'FULL_REPORT_CARD_MINUTE_INVALID', 'Card minute');
    }

    return {
      teamId,
      playerId,
      cardType: cardType as ValidatedCardEvent['cardType'],
      minute,
      note: card.note ? String(card.note).trim() || null : null,
    };
  });

  return { goals: validatedGoals, cards: validatedCards };
}

async function loadLatestQuickResult(client: TournamentClient, matchId: string): Promise<QuickResultSubmissionRow | null> {
  const { data, error } = await client
    .from('tournament_result_submissions')
    .select('id, payload, submitted_at')
    .eq('match_id', matchId)
    .eq('stage', 'quick_result')
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as QuickResultSubmissionRow | null) || null;
}

export interface QuickResultComparison {
  hasQuickResult: boolean;
  quickResultHomeScore: number | null;
  quickResultAwayScore: number | null;
  fullReportHomeScore: number;
  fullReportAwayScore: number;
  matches: boolean;
}

function compareQuickResult(
  quickResult: QuickResultSubmissionRow | null,
  fullReportHomeScore: number,
  fullReportAwayScore: number
): QuickResultComparison {
  if (!quickResult) {
    return {
      hasQuickResult: false,
      quickResultHomeScore: null,
      quickResultAwayScore: null,
      fullReportHomeScore,
      fullReportAwayScore,
      matches: true,
    };
  }
  const qrHome = quickResult.payload.home_score;
  const qrAway = quickResult.payload.away_score;
  return {
    hasQuickResult: true,
    quickResultHomeScore: qrHome,
    quickResultAwayScore: qrAway,
    fullReportHomeScore,
    fullReportAwayScore,
    matches: qrHome === fullReportHomeScore && qrAway === fullReportAwayScore,
  };
}

function sortKey(goalOrCard: { teamId: string; playerId: string | null; minute: number | null }, index: number): string {
  return `${goalOrCard.teamId}|${goalOrCard.playerId || ''}|${goalOrCard.minute ?? -1}|${index}`;
}

/** Builds the canonical, stably-ordered Full Report payload used for both
 * the Preview Token's payload hash and the RPC's idempotency comparison
 * value. Deterministic — the same logical input always produces the same
 * JSON regardless of the order goals/cards were added in the UI. */
export function buildCanonicalFullReportPayload(params: {
  matchId: string;
  tournamentId: string;
  scores: ValidatedResultScores;
  goals: ValidatedGoalEvent[];
  cards: ValidatedCardEvent[];
  reportText: string | null;
}) {
  const sortedGoals = [...params.goals]
    .map((g, i) => ({ ...g, __k: sortKey(g, i) }))
    .sort((a, b) => (a.__k < b.__k ? -1 : a.__k > b.__k ? 1 : 0))
    .map(({ __k, ...rest }) => {
      void __k;
      return rest;
    });
  const sortedCards = [...params.cards]
    .map((c, i) => ({ ...c, __k: sortKey(c, i) }))
    .sort((a, b) => (a.__k < b.__k ? -1 : a.__k > b.__k ? 1 : 0))
    .map(({ __k, ...rest }) => {
      void __k;
      return rest;
    });

  return {
    matchId: params.matchId,
    tournamentId: params.tournamentId,
    regulationHomeScore: params.scores.regulationHomeScore,
    regulationAwayScore: params.scores.regulationAwayScore,
    penaltyHomeScore: params.scores.penaltyHomeScore,
    penaltyAwayScore: params.scores.penaltyAwayScore,
    decidedBy: params.scores.decidedBy,
    winnerTeamId: params.scores.winnerTeamId,
    resultType: params.scores.resultType,
    goals: sortedGoals,
    cards: sortedCards,
    reportText: params.reportText || null,
  };
}

export interface PreviewFullMatchReportParams {
  client: TournamentClient;
  tournamentId: string;
  venueId: string | null;
  matchId: string;
  actorUserId: string | null;
  input: FullMatchReportInput;
}

export interface FullMatchReportPreview {
  matchId: string;
  matchCode: string;
  currentVersion: number;
  scores: ValidatedResultScores;
  goals: ValidatedGoalEvent[];
  cards: ValidatedCardEvent[];
  reportText: string | null;
  quickResultComparison: QuickResultComparison;
  previewToken: string;
  previewExpiresAt: string;
  canonicalPayload: ReturnType<typeof buildCanonicalFullReportPayload>;
}

export async function previewFullMatchReport(params: PreviewFullMatchReportParams): Promise<FullMatchReportPreview> {
  const match = await loadMatch(params.client, params.matchId);
  assertEligible(match, { tournamentId: params.tournamentId, venueId: params.venueId });

  const scoreValidation = validateResultConsistency({
    ...params.input,
    homeTeamId: match.home_team_id as string,
    awayTeamId: match.away_team_id as string,
  });
  if (!scoreValidation.ok) {
    throw new FullMatchReportError(scoreValidation.errors[0].code, scoreValidation.errors[0].message);
  }

  const { goals, cards } = await validateGoalsAndCards({
    client: params.client,
    match,
    goals: params.input.goals,
    cards: params.input.cards,
  });

  const quickResult = await loadLatestQuickResult(params.client, params.matchId);
  const comparison = compareQuickResult(quickResult, scoreValidation.value.regulationHomeScore, scoreValidation.value.regulationAwayScore);

  const canonicalPayload = buildCanonicalFullReportPayload({
    matchId: params.matchId,
    tournamentId: params.tournamentId,
    scores: scoreValidation.value,
    goals,
    cards,
    reportText: params.input.reportText,
  });
  const payloadHash = hashFullReportPayload(JSON.stringify(canonicalPayload));
  const quickResultComparisonHash = quickResult ? hashFullReportPayload(JSON.stringify({ id: quickResult.id, payload: quickResult.payload })) : null;

  const issued = issueFullReportPreviewToken({
    tournamentId: params.tournamentId,
    matchId: params.matchId,
    venueId: params.venueId,
    actorUserId: params.actorUserId,
    expectedMatchVersion: match.version,
    payloadHash,
    quickResultComparisonHash,
  });

  return {
    matchId: match.id,
    matchCode: match.match_code,
    currentVersion: match.version,
    scores: scoreValidation.value,
    goals,
    cards,
    reportText: params.input.reportText,
    quickResultComparison: comparison,
    previewToken: issued.token,
    previewExpiresAt: issued.expiresAt,
    canonicalPayload,
  };
}

export interface PublishFullMatchReportParams {
  client: TournamentClient;
  tournamentId: string;
  venueId: string | null;
  matchId: string;
  expectedVersion: number;
  idempotencyKey: string;
  previewToken: string;
  actorUserId: string | null;
  actorEmail: string | null;
  input: FullMatchReportInput;
}

export interface PublishFullMatchReportResult {
  submissionId: string;
  matchId: string;
  matchCode: string;
  newMatchVersion: number;
  publishedAt: string;
  idempotent: boolean;
}

function parseRpcErrorCode(message: string): { code: string; detail: string } {
  const separatorIndex = message.indexOf(':');
  if (separatorIndex > 0 && /^[A-Z0-9_]+$/.test(message.slice(0, separatorIndex).trim())) {
    return { code: message.slice(0, separatorIndex).trim(), detail: message.slice(separatorIndex + 1).trim() };
  }
  return { code: 'FULL_REPORT_PUBLISH_FAILED', detail: message };
}

function isRpcUnavailableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202') return true;
  const message = (error.message || '').toLowerCase();
  return message.includes('could not find the function') || message.includes('function') && message.includes('does not exist');
}


export async function publishFullMatchReport(params: PublishFullMatchReportParams): Promise<PublishFullMatchReportResult> {
  if (!params.idempotencyKey || !params.idempotencyKey.trim()) {
    throw new FullMatchReportError('FULL_REPORT_IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey is required');
  }

  // Load the match BEFORE asserting eligibility (deliberately — see the
  // idempotency fast-path check right below). validateResultConsistency/
  // validateGoalsAndCards only need the match's team/tournament/category
  // identifiers, not its eligibility status.
  const match = await loadMatch(params.client, params.matchId);

  const scoreValidation = validateResultConsistency({
    ...params.input,
    homeTeamId: match.home_team_id as string,
    awayTeamId: match.away_team_id as string,
  });
  if (!scoreValidation.ok) {
    throw new FullMatchReportError(scoreValidation.errors[0].code, scoreValidation.errors[0].message);
  }

  const { goals, cards } = await validateGoalsAndCards({
    client: params.client,
    match,
    goals: params.input.goals,
    cards: params.input.cards,
  });

  // App-layer fast-path idempotency lookup (UX only — the RPC is the
  // authoritative, concurrency-safe enforcement, and re-checks this itself
  // AFTER locking the match row; see Migration 014's ordering rationale).
  // This lookup only decides whether to treat the request as a PRESUMED
  // retry — it deliberately does NOT compare payloads itself (a byte-level
  // JS comparison against a value that round-tripped through Postgres jsonb
  // is not reliable), and it must run BEFORE assertEligible()/the Preview
  // Token requirement: a retry of an idempotency key that just succeeded
  // will see a match that is now result_workflow_status=published (by the
  // retry's own earlier success) and would otherwise be incorrectly
  // rejected as "already published", or incorrectly demand a fresh Preview
  // Token for a request that isn't creating any new mutation. The RPC
  // authoritatively decides idempotent-success vs. payload-mismatch.
  const { data: existingData, error: existingError } = await params.client
    .from('tournament_result_submissions')
    .select('id')
    .eq('match_id', params.matchId)
    .eq('stage', STAGE)
    .eq('idempotency_key', params.idempotencyKey)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const isPresumedRetry = !!existingData;

  let quickResult: QuickResultSubmissionRow | null = null;

  if (!isPresumedRetry) {
    assertEligible(match, { tournamentId: params.tournamentId, venueId: params.venueId });

    if (!params.previewToken || !params.previewToken.trim()) {
      throw new FullMatchReportError('FULL_REPORT_PREVIEW_REQUIRED', 'A valid Full Match Report preview is required before publishing.');
    }
    const tokenVerification = verifyFullReportPreviewToken(params.previewToken);
    if (!tokenVerification.ok) {
      throw new FullMatchReportError(
        tokenVerification.code,
        tokenVerification.code === 'FULL_REPORT_PREVIEW_EXPIRED'
          ? 'Full Match Report preview has expired — request a new preview before publishing'
          : 'Full Match Report preview token is invalid or was tampered with'
      );
    }

    const claims = tokenVerification.claims;
    quickResult = await loadLatestQuickResult(params.client, params.matchId);
    const quickResultComparisonHash = quickResult ? hashFullReportPayload(JSON.stringify({ id: quickResult.id, payload: quickResult.payload })) : null;
    const canonicalPayload = buildCanonicalFullReportPayload({
      matchId: params.matchId,
      tournamentId: params.tournamentId,
      scores: scoreValidation.value,
      goals,
      cards,
      reportText: params.input.reportText,
    });
    const payloadHash = hashFullReportPayload(JSON.stringify(canonicalPayload));

    const claimsMatchRequest =
      claims.tournamentId === params.tournamentId &&
      claims.matchId === params.matchId &&
      claims.venueId === params.venueId &&
      claims.actorUserId === params.actorUserId &&
      claims.expectedMatchVersion === params.expectedVersion &&
      claims.payloadHash === payloadHash &&
      claims.quickResultComparisonHash === quickResultComparisonHash;

    if (!claimsMatchRequest) {
      throw new FullMatchReportError(
        'FULL_REPORT_PREVIEW_MISMATCH',
        'The submitted report no longer matches what was previewed (tournament, match, venue, actor, version, scores, goals, cards, report text, or the Quick Result comparison changed) — preview again'
      );
    }

    if (match.version !== params.expectedVersion) {
      throw new FullMatchReportError('FULL_REPORT_VERSION_CONFLICT', `Match has changed since Preview (expected version ${params.expectedVersion}, current version ${match.version})`);
    }
  } else {
    // Presumed retry: skip eligibility/token/version checks entirely (the
    // match may legitimately already be published, from this same request
    // succeeding earlier) and let the RPC's own idempotency check decide.
    quickResult = await loadLatestQuickResult(params.client, params.matchId);
  }

  const comparison = compareQuickResult(quickResult, scoreValidation.value.regulationHomeScore, scoreValidation.value.regulationAwayScore);

  // No p_payload parameter — Migration 014 builds its own canonical payload
  // from these validated scalar/array parameters and never trusts a
  // caller-supplied JSON blob as authoritative (see the migration's own
  // header comment for the rationale).
  const { data: rpcData, error: rpcError } = await params.client.rpc('publish_full_match_report', {
    p_match_id: params.matchId,
    p_tournament_id: params.tournamentId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actorUserId,
    p_actor_email: params.actorEmail,
    p_idempotency_key: params.idempotencyKey,
    p_regulation_home_score: scoreValidation.value.regulationHomeScore,
    p_regulation_away_score: scoreValidation.value.regulationAwayScore,
    p_penalty_home_score: scoreValidation.value.penaltyHomeScore,
    p_penalty_away_score: scoreValidation.value.penaltyAwayScore,
    p_decided_by: scoreValidation.value.decidedBy,
    p_winner_team_id: scoreValidation.value.winnerTeamId,
    p_result_type: scoreValidation.value.resultType,
    p_goals: goals.map((g) => ({ team_id: g.teamId, player_id: g.playerId, minute: g.minute, is_own_goal: g.isOwnGoal, goals: g.goals, note: g.note })),
    p_cards: cards.map((c) => ({ team_id: c.teamId, player_id: c.playerId, card_type: c.cardType, minute: c.minute, note: c.note })),
    p_report_text: params.input.reportText,
    p_quick_result_comparison: comparison,
  });

  if (rpcError) {
    if (isRpcUnavailableError(rpcError)) {
      throw new FullMatchReportError(
        'FULL_REPORT_PUBLISH_RPC_UNAVAILABLE',
        'The official publish transaction (Migration 014) is not available in this environment. Publication cannot proceed — there is no non-transactional fallback for Official Publish.'
      );
    }
    const { code, detail } = parseRpcErrorCode(rpcError.message);
    throw new FullMatchReportError(code, detail);
  }

  const result = rpcData as { submission_id: string; new_match_version: number; published_at: string; idempotent: boolean };

  return {
    submissionId: result.submission_id,
    matchId: params.matchId,
    matchCode: match.match_code,
    newMatchVersion: result.new_match_version,
    publishedAt: result.published_at,
    idempotent: result.idempotent,
  };
}

export interface FullMatchReportContextPlayer {
  id: string;
  fullName: string;
  shirtNo: number | null;
}

export interface FullMatchReportContext {
  matchId: string;
  matchCode: string;
  matchNo: number | null;
  matchDate: string | null;
  matchTime: string | null;
  stage: string;
  categoryCode: string;
  categoryName: string;
  groupCode: string | null;
  venueName: string;
  courtName: string;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  homeTeamPlayers: FullMatchReportContextPlayer[];
  awayTeamPlayers: FullMatchReportContextPlayer[];
  currentVersion: number;
  resultWorkflowStatus: string;
  alreadyPublished: boolean;
}

/** Read-only context for the Full Match Report form: match identity, team
 * rosters (for the Player pickers), and current publication status. No
 * eligibility assertion here — the form itself surfaces
 * FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION (etc.) as a read-only notice
 * rather than failing to load entirely. */
export async function loadFullMatchReportContext(params: {
  client: TournamentClient;
  tournamentId: string;
  matchId: string;
}): Promise<FullMatchReportContext> {
  const match = await loadMatch(params.client, params.matchId);
  if (match.tournament_id !== params.tournamentId) {
    throw new FullMatchReportError('FULL_REPORT_TOURNAMENT_MISMATCH', 'Match does not belong to the specified tournament');
  }

  const [categoryResult, groupResult, venueResult, courtResult, homeTeamResult, awayTeamResult, homePlayersResult, awayPlayersResult] = await Promise.all([
    params.client.from('tournament_categories').select('id, code, name').eq('id', match.category_id).maybeSingle(),
    match.group_id ? params.client.from('tournament_groups').select('code').eq('id', match.group_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    match.venue_id ? params.client.from('tournament_venues').select('id, name').eq('id', match.venue_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    match.court_id ? params.client.from('tournament_courts').select('id, name').eq('id', match.court_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    match.home_team_id ? params.client.from('tournament_teams').select('id, name').eq('id', match.home_team_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    match.away_team_id ? params.client.from('tournament_teams').select('id, name').eq('id', match.away_team_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    match.home_team_id
      ? params.client.from('tournament_players').select('id, full_name, shirt_no').eq('team_id', match.home_team_id).is('deleted_at', null)
      : Promise.resolve({ data: [], error: null }),
    match.away_team_id
      ? params.client.from('tournament_players').select('id, full_name, shirt_no').eq('team_id', match.away_team_id).is('deleted_at', null)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const groupCode = (groupResult.data as { code: string } | null)?.code || null;
  const category = categoryResult.data as { id: string; code: string; name: string } | null;
  const venue = venueResult.data as { id: string; name: string } | null;
  const court = courtResult.data as { id: string; name: string } | null;
  const homeTeam = homeTeamResult.data as TeamRow | null;
  const awayTeam = awayTeamResult.data as TeamRow | null;

  const toPlayerList = (rows: unknown): FullMatchReportContextPlayer[] =>
    ((rows || []) as { id: string; full_name: string; shirt_no: number | null }[]).map((p) => ({ id: p.id, fullName: p.full_name, shirtNo: p.shirt_no }));

  return {
    matchId: match.id,
    matchCode: match.match_code,
    matchNo: match.match_no,
    matchDate: match.match_date,
    matchTime: match.match_time,
    stage: match.stage,
    categoryCode: category?.code || '',
    categoryName: category?.name || '',
    groupCode,
    venueName: venue?.name || 'TBD',
    courtName: court?.name || 'TBD',
    homeTeamId: match.home_team_id || '',
    homeTeamName: homeTeam?.name || 'TBD',
    awayTeamId: match.away_team_id || '',
    awayTeamName: awayTeam?.name || 'TBD',
    homeTeamPlayers: toPlayerList(homePlayersResult.data),
    awayTeamPlayers: toPlayerList(awayPlayersResult.data),
    currentVersion: match.version,
    resultWorkflowStatus: match.result_workflow_status,
    alreadyPublished: match.result_workflow_status === 'published',
  };
}
