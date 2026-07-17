import { getTournamentServiceClient } from '../db/supabase-tournament';
import { issuePreviewToken, verifyPreviewToken } from './previewToken';

// Tournament V2 Quick Result (Phase 5b, Stage A) — a provisional matchday
// operational score only. It NEVER sets tournament_matches.result_workflow_status
// (that column belongs exclusively to the Full Match Report workflow, Phase
// 5c, which is not implemented here). It does not touch schedule_status,
// standings, brackets, scorers, or discipline records. See
// TOURNAMENT_V2_IMPLEMENTATION_PHASES.md Phase 5b and
// tournament_result_submissions.stage='quick_result' (migration 010, no
// schema change needed).
//
// WRITE PATH: submitQuickResult() performs exactly one
// client.rpc('submit_quick_result', ...) call — migration 016
// (scripts/tournament-v2/016-quick-result-atomic-submit.sql). The idempotency
// decision, the tournament_matches.version claim (reusing the existing
// optimistic-lock column — no new column added), the
// tournament_result_submissions insert, the tournament_result_versions
// insert, and the audit log insert all run inside that single Postgres
// transaction. Preview Token verification stays here in TypeScript (its HMAC
// secret is application configuration, not database state) — see
// submitQuickResult() for how the token gate composes with the RPC's
// authoritative idempotency check.

const QUICK_RESULT_STAGE = 'quick_result';
const INCOMPATIBLE_MATCH_STATUSES = new Set(['cancelled', 'abandoned', 'void', 'bye']);

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

export interface ScoreValidationResult {
  ok: boolean;
  value?: number;
  error?: string;
}

/**
 * Accepts 0, rejects negative/decimal/NaN/empty. `0` is a legitimate score,
 * never treated as missing or falsy.
 */
export function validateScoreInput(raw: unknown): ScoreValidationResult {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, error: 'EMPTY_SCORE' };
  }
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(num)) {
    return { ok: false, error: 'INVALID_SCORE' };
  }
  if (!Number.isInteger(num)) {
    return { ok: false, error: 'DECIMAL_SCORE' };
  }
  if (num < 0) {
    return { ok: false, error: 'NEGATIVE_SCORE' };
  }
  return { ok: true, value: num };
}

interface MatchRow {
  id: string;
  tournament_id: string;
  category_id: string;
  venue_id: string | null;
  court_id: string | null;
  match_code: string;
  match_no: number | null;
  match_date: string | null;
  match_time: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  status: string;
  result_workflow_status: string;
  result_type: string;
  version: number;
  deleted_at: string | null;
}

interface TeamNameRow {
  id: string;
  name: string;
}

interface VenueCourtRow {
  id: string;
  name: string;
}

interface CategoryRow {
  id: string;
  code: string;
  name: string;
}

export interface QuickResultEligibilityError {
  code: string;
  message: string;
}

export interface QuickResultPreview {
  matchId: string;
  tournamentId: string;
  categoryCode: string;
  categoryName: string;
  venueId: string | null;
  venueName: string;
  courtName: string;
  matchCode: string;
  matchNo: number | null;
  matchDate: string | null;
  matchTime: string | null;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  currentVersion: number;
  previewToken: string;
  previewExpiresAt: string;
}

async function loadMatchContext(params: {
  client: TournamentClient;
  matchId: string;
  tournamentId: string;
}): Promise<{ match: MatchRow; homeTeamName: string; awayTeamName: string; venueName: string; courtName: string; category: CategoryRow | null }> {
  const { client, matchId, tournamentId } = params;

  const { data: matchData, error: matchError } = await client
    .from('tournament_matches')
    .select(
      'id, tournament_id, category_id, venue_id, court_id, match_code, match_no, match_date, match_time, home_team_id, away_team_id, status, result_workflow_status, result_type, version, deleted_at'
    )
    .eq('id', matchId)
    .maybeSingle();

  if (matchError) throw new Error(matchError.message);
  if (!matchData) throw new QuickResultError('MATCH_NOT_FOUND', 'Match not found');

  const match = matchData as MatchRow;
  if (match.deleted_at) throw new QuickResultError('MATCH_DELETED', 'Match has been deleted');
  if (match.tournament_id !== tournamentId) {
    throw new QuickResultError('TOURNAMENT_MISMATCH', 'Match does not belong to the specified tournament');
  }

  const [homeTeamResult, awayTeamResult, venueResult, courtResult, categoryResult] = await Promise.all([
    match.home_team_id
      ? client.from('tournament_teams').select('id, name').eq('id', match.home_team_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    match.away_team_id
      ? client.from('tournament_teams').select('id, name').eq('id', match.away_team_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    match.venue_id
      ? client.from('tournament_venues').select('id, name').eq('id', match.venue_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    match.court_id
      ? client.from('tournament_courts').select('id, name').eq('id', match.court_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    client.from('tournament_categories').select('id, code, name').eq('id', match.category_id).maybeSingle(),
  ]);

  return {
    match,
    homeTeamName: (homeTeamResult.data as TeamNameRow | null)?.name || 'TBD',
    awayTeamName: (awayTeamResult.data as TeamNameRow | null)?.name || 'TBD',
    venueName: (venueResult.data as VenueCourtRow | null)?.name || 'TBD',
    courtName: (courtResult.data as VenueCourtRow | null)?.name || 'TBD',
    category: (categoryResult.data as CategoryRow | null) || null,
  };
}

export class QuickResultError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

function assertEligible(params: { match: MatchRow; venueId: string | null }): void {
  const { match, venueId } = params;

  if (venueId !== null && match.venue_id !== venueId) {
    throw new QuickResultError('VENUE_MATCH_MISMATCH', 'This match does not belong to the selected venue');
  }
  if (INCOMPATIBLE_MATCH_STATUSES.has(match.status)) {
    throw new QuickResultError(
      'MATCH_STATUS_INCOMPATIBLE',
      `Match status "${match.status}" is not eligible for Quick Result (BYE matches and cancelled/abandoned/void matches are excluded)`
    );
  }
  if (match.result_workflow_status === 'published') {
    throw new QuickResultError(
      'RESULT_ALREADY_PUBLISHED',
      'This match already has an official published result — use the correction workflow instead'
    );
  }
  if (!match.home_team_id) {
    throw new QuickResultError('HOME_TEAM_UNRESOLVED', 'Home team placeholder is not yet resolved');
  }
  if (!match.away_team_id) {
    throw new QuickResultError('AWAY_TEAM_UNRESOLVED', 'Away team placeholder is not yet resolved');
  }
}

export interface PreviewQuickResultParams {
  client: TournamentClient;
  tournamentId: string;
  venueId: string | null;
  matchId: string;
  homeScore: unknown;
  awayScore: unknown;
  actorUserId: string | null;
}

/**
 * Read-only: validates and returns the preview payload, plus a signed
 * previewToken that Submit requires. Writes nothing to the database — the
 * token is the only "record" of this Preview having happened, and it is
 * entirely self-contained (no server-side storage).
 */
export async function previewQuickResult(params: PreviewQuickResultParams): Promise<QuickResultPreview> {
  const homeScoreResult = validateScoreInput(params.homeScore);
  if (!homeScoreResult.ok) throw new QuickResultError(`HOME_SCORE_${homeScoreResult.error}`, `Invalid home score: ${homeScoreResult.error}`);
  const awayScoreResult = validateScoreInput(params.awayScore);
  if (!awayScoreResult.ok) throw new QuickResultError(`AWAY_SCORE_${awayScoreResult.error}`, `Invalid away score: ${awayScoreResult.error}`);

  const { match, homeTeamName, awayTeamName, venueName, courtName, category } = await loadMatchContext({
    client: params.client,
    matchId: params.matchId,
    tournamentId: params.tournamentId,
  });

  assertEligible({ match, venueId: params.venueId });

  const homeScore = homeScoreResult.value as number;
  const awayScore = awayScoreResult.value as number;

  const issued = issuePreviewToken({
    tournamentId: match.tournament_id,
    matchId: match.id,
    venueId: params.venueId,
    homeScore,
    awayScore,
    matchVersion: match.version,
    actorUserId: params.actorUserId,
  });

  return {
    matchId: match.id,
    tournamentId: match.tournament_id,
    categoryCode: category?.code || '',
    categoryName: category?.name || '',
    venueId: match.venue_id,
    venueName,
    courtName,
    matchCode: match.match_code,
    matchNo: match.match_no,
    matchDate: match.match_date,
    matchTime: match.match_time,
    homeTeamName,
    awayTeamName,
    homeScore,
    awayScore,
    currentVersion: match.version,
    previewToken: issued.token,
    previewExpiresAt: issued.expiresAt,
  };
}

export interface SubmitQuickResultParams {
  client: TournamentClient;
  tournamentId: string;
  venueId: string | null;
  matchId: string;
  homeScore: unknown;
  awayScore: unknown;
  expectedVersion: number;
  idempotencyKey: string;
  previewToken: string;
  actorUserId: string | null;
  actorEmail: string | null;
  sessionId: string | null;
  deviceMetadata: Record<string, unknown> | null;
}

export interface SubmitQuickResultResult {
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

function toQuickResultError(message: string): QuickResultError | null {
  const match = message.match(/^([A-Z][A-Z_]*):\s*([\s\S]*)$/);
  if (!match) return null;
  return new QuickResultError(match[1], match[2] || message);
}

/**
 * The entire write path — the idempotency decision, the version claim, the
 * submission insert, the result-version insert, and the audit log — executes
 * inside tournament.submit_quick_result() (migration 016) as one Postgres
 * transaction. This function makes exactly one client.rpc(...) call for any
 * genuinely new write; there is no compensating-rollback logic here anymore
 * because there is nothing left to compensate for — a failure anywhere
 * inside the RPC rolls back the whole thing atomically.
 */
export async function submitQuickResult(params: SubmitQuickResultParams): Promise<SubmitQuickResultResult> {
  if (!params.idempotencyKey || !params.idempotencyKey.trim()) {
    throw new QuickResultError('IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey is required');
  }

  const homeScoreResult = validateScoreInput(params.homeScore);
  if (!homeScoreResult.ok) throw new QuickResultError(`HOME_SCORE_${homeScoreResult.error}`, `Invalid home score: ${homeScoreResult.error}`);
  const awayScoreResult = validateScoreInput(params.awayScore);
  if (!awayScoreResult.ok) throw new QuickResultError(`AWAY_SCORE_${awayScoreResult.error}`, `Invalid away score: ${awayScoreResult.error}`);
  const homeScore = homeScoreResult.value as number;
  const awayScore = awayScoreResult.value as number;

  // Fast, NON-authoritative pre-check: does a submission already exist for
  // this idempotency key? Used only to decide whether to demand and verify a
  // Preview Token before ever calling the RPC — the Preview Token's HMAC
  // secret is application configuration and must stay out of Postgres, so
  // only this service layer can enforce "a genuinely new write requires a
  // valid token." The RPC re-checks idempotency itself, under the Match row
  // lock, and is the sole authority on whether a given call is a replay or a
  // genuinely new write — this pre-check can only ever be stale in the
  // direction of under-trusting (a concurrent submit committing between this
  // read and the RPC call), which just means a token gets verified here that
  // the RPC then didn't strictly need (it still correctly returns idempotent
  // success). It can never let a token-less new write through, because a
  // positive "found" read here can only reflect a row that was genuinely
  // already committed.
  const { data: existingData, error: existingError } = await params.client
    .from('tournament_result_submissions')
    .select('id')
    .eq('match_id', params.matchId)
    .eq('stage', QUICK_RESULT_STAGE)
    .eq('idempotency_key', params.idempotencyKey)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const isLikelyReplay = !!existingData;

  if (!isLikelyReplay) {
    // Preview Token required for any call this pre-check doesn't already
    // recognize as a replay. Without this, a caller could send
    // expected_version + idempotency_key straight to Submit without ever
    // calling Preview.
    if (!params.previewToken || !params.previewToken.trim()) {
      throw new QuickResultError('QUICK_RESULT_PREVIEW_REQUIRED', 'A valid Quick Result preview is required before submission.');
    }

    const tokenVerification = verifyPreviewToken(params.previewToken);
    if (!tokenVerification.ok) {
      throw new QuickResultError(
        tokenVerification.code,
        tokenVerification.code === 'QUICK_RESULT_PREVIEW_EXPIRED'
          ? 'Quick Result preview has expired — request a new preview before submitting'
          : 'Quick Result preview token is invalid or was tampered with'
      );
    }

    const claims = tokenVerification.claims;
    const claimsMatchRequest =
      claims.tournamentId === params.tournamentId &&
      claims.matchId === params.matchId &&
      claims.venueId === params.venueId &&
      claims.homeScore === homeScore &&
      claims.awayScore === awayScore &&
      claims.matchVersion === params.expectedVersion &&
      claims.actorUserId === params.actorUserId;

    if (!claimsMatchRequest) {
      throw new QuickResultError(
        'QUICK_RESULT_PREVIEW_MISMATCH',
        'The submitted request no longer matches the previewed match, venue, score, version, or actor — preview again'
      );
    }
  }

  const { data, error } = await params.client.rpc('submit_quick_result', {
    p_tournament_id: params.tournamentId,
    p_match_id: params.matchId,
    p_venue_id: params.venueId,
    p_home_score: homeScore,
    p_away_score: awayScore,
    p_expected_version: params.expectedVersion,
    p_idempotency_key: params.idempotencyKey,
    p_actor_id: params.actorUserId,
    p_actor_email: params.actorEmail,
    p_session_id: params.sessionId,
    p_device_metadata: params.deviceMetadata,
  });

  if (error) {
    const parsed = toQuickResultError(error.message);
    throw parsed || new Error(error.message);
  }
  if (!data) {
    throw new Error('submit_quick_result returned no data');
  }

  const result = data as {
    submissionId: string;
    matchId: string;
    matchCode: string;
    homeScore: number;
    awayScore: number;
    previousMatchVersion: number;
    newMatchVersion: number;
    status: 'submitted';
    idempotent: boolean;
  };

  return {
    submissionId: result.submissionId,
    matchId: result.matchId,
    matchCode: result.matchCode,
    homeScore: result.homeScore,
    awayScore: result.awayScore,
    previousMatchVersion: result.previousMatchVersion,
    newMatchVersion: result.newMatchVersion,
    status: 'submitted',
    idempotent: result.idempotent,
  };
}

export interface MatchdayMatchSummary {
  matchId: string;
  matchCode: string;
  matchNo: number | null;
  matchDate: string | null;
  matchTime: string | null;
  categoryCode: string;
  homeTeamName: string;
  awayTeamName: string;
  status: string;
  hasQuickResult: boolean;
  eligible: boolean;
  ineligibleReason: string | null;
}

export async function listVenueMatchdayMatches(params: {
  client: TournamentClient;
  tournamentId: string;
  venueId: string;
  date: string;
}): Promise<MatchdayMatchSummary[]> {
  const { client, tournamentId, venueId, date } = params;

  const { data: matchesData, error: matchesError } = await client
    .from('tournament_matches')
    .select(
      'id, category_id, match_code, match_no, match_date, match_time, home_team_id, away_team_id, status, result_workflow_status, result_type, version'
    )
    .eq('tournament_id', tournamentId)
    .eq('venue_id', venueId)
    .eq('match_date', date)
    .is('deleted_at', null)
    .order('match_time', { ascending: true });

  if (matchesError) throw new Error(matchesError.message);
  const matches = (matchesData || []) as MatchRow[];
  if (matches.length === 0) return [];

  const categoryIds = Array.from(new Set(matches.map((m) => m.category_id)));
  const teamIds = Array.from(
    new Set(matches.flatMap((m) => [m.home_team_id, m.away_team_id]).filter((id): id is string => !!id))
  );
  const matchIds = matches.map((m) => m.id);

  const [categoriesResult, teamsResult, submissionsResult] = await Promise.all([
    client.from('tournament_categories').select('id, code, name').in('id', categoryIds),
    teamIds.length > 0
      ? client.from('tournament_teams').select('id, name').in('id', teamIds)
      : Promise.resolve({ data: [], error: null }),
    client
      .from('tournament_result_submissions')
      .select('match_id')
      .in('match_id', matchIds)
      .eq('stage', QUICK_RESULT_STAGE),
  ]);

  const categoriesById = new Map(((categoriesResult.data || []) as CategoryRow[]).map((c) => [c.id, c]));
  const teamsById = new Map(((teamsResult.data || []) as TeamNameRow[]).map((t) => [t.id, t]));
  const matchIdsWithSubmission = new Set(((submissionsResult.data || []) as { match_id: string }[]).map((s) => s.match_id));

  return matches.map((match) => {
    let ineligibleReason: string | null = null;
    if (INCOMPATIBLE_MATCH_STATUSES.has(match.status)) {
      ineligibleReason = `MATCH_STATUS_INCOMPATIBLE:${match.status}`;
    } else if (match.result_workflow_status === 'published') {
      ineligibleReason = 'RESULT_ALREADY_PUBLISHED';
    } else if (!match.home_team_id) {
      ineligibleReason = 'HOME_TEAM_UNRESOLVED';
    } else if (!match.away_team_id) {
      ineligibleReason = 'AWAY_TEAM_UNRESOLVED';
    }

    return {
      matchId: match.id,
      matchCode: match.match_code,
      matchNo: match.match_no,
      matchDate: match.match_date,
      matchTime: match.match_time,
      categoryCode: categoriesById.get(match.category_id)?.code || '',
      homeTeamName: match.home_team_id ? teamsById.get(match.home_team_id)?.name || 'TBD' : 'TBD',
      awayTeamName: match.away_team_id ? teamsById.get(match.away_team_id)?.name || 'TBD' : 'TBD',
      status: match.status,
      hasQuickResult: matchIdsWithSubmission.has(match.id),
      eligible: ineligibleReason === null,
      ineligibleReason,
    };
  });
}
