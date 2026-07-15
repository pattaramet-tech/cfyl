import { getTournamentServiceClient } from '../db/supabase-tournament';

// Tournament V2 Quick Result (Phase 5b, Stage A) — a provisional matchday
// operational score only. It NEVER sets tournament_matches.result_workflow_status
// (that column belongs exclusively to the Full Match Report workflow, Phase
// 5c, which is not implemented here). It does not touch schedule_status,
// standings, brackets, scorers, or discipline records. See
// TOURNAMENT_V2_IMPLEMENTATION_PHASES.md Phase 5b and
// tournament_result_submissions.stage='quick_result' (migration 010, no
// schema change needed).
//
// Optimistic locking reuses the existing tournament_matches.version column
// (already used by the schedule-import optimistic lock in PR #6) — a Quick
// Result submission atomically bumps it via a conditional UPDATE, which also
// doubles as the "only one concurrent writer succeeds" guarantee. No new
// column or table was added for this feature.

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
}

/** Read-only: validates and returns the preview payload. Writes nothing. */
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
    homeScore: homeScoreResult.value as number,
    awayScore: awayScoreResult.value as number,
    currentVersion: match.version,
  };
}

interface ExistingSubmissionRow {
  id: string;
  payload: { home_score: number; away_score: number };
  version: number;
  status: string;
  submitted_at: string | null;
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

  // Idempotency check first — a retried request with the same key must never
  // re-validate against a database state that may have moved on (e.g. the
  // match version already bumped by the original successful attempt).
  const { data: existingData, error: existingError } = await params.client
    .from('tournament_result_submissions')
    .select('id, payload, version, status, submitted_at')
    .eq('match_id', params.matchId)
    .eq('stage', QUICK_RESULT_STAGE)
    .eq('idempotency_key', params.idempotencyKey)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);

  if (existingData) {
    const existing = existingData as ExistingSubmissionRow;
    const samePayload = existing.payload.home_score === homeScore && existing.payload.away_score === awayScore;
    if (!samePayload) {
      throw new QuickResultError(
        'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH',
        'This idempotency key was already used with a different score payload'
      );
    }
    return {
      submissionId: existing.id,
      matchId: params.matchId,
      matchCode: '',
      homeScore,
      awayScore,
      previousMatchVersion: params.expectedVersion,
      newMatchVersion: params.expectedVersion,
      status: 'submitted',
      idempotent: true,
    };
  }

  const { match } = await loadMatchContext({
    client: params.client,
    matchId: params.matchId,
    tournamentId: params.tournamentId,
  });
  assertEligible({ match, venueId: params.venueId });

  if (match.version !== params.expectedVersion) {
    throw new QuickResultError(
      'QUICK_RESULT_VERSION_CONFLICT',
      `Match has changed since Preview (expected version ${params.expectedVersion}, current version ${match.version})`
    );
  }

  const now = new Date().toISOString();

  // Atomic conditional claim: only one concurrent submitter can win this
  // UPDATE (WHERE version = expectedVersion). This is the single-writer
  // guarantee for concurrent submissions, reusing the existing
  // tournament_matches.version optimistic-lock column — no new column added.
  const { data: claimedMatch, error: claimError } = await params.client
    .from('tournament_matches')
    .update({ version: match.version + 1, updated_by: params.actorUserId, updated_at: now })
    .eq('id', params.matchId)
    .eq('version', params.expectedVersion)
    .select('id, version')
    .maybeSingle();

  if (claimError) throw new Error(claimError.message);
  if (!claimedMatch) {
    throw new QuickResultError(
      'QUICK_RESULT_VERSION_CONFLICT',
      'Match was modified by another request between Preview and Submit'
    );
  }

  const newVersion = (claimedMatch as { id: string; version: number }).version;
  const payload = {
    home_score: homeScore,
    away_score: awayScore,
    venue_id: params.venueId,
    match_version_before: params.expectedVersion,
    match_version_after: newVersion,
    session_id: params.sessionId,
    device_metadata: params.deviceMetadata,
  };

  const { data: submissionData, error: submissionError } = await params.client
    .from('tournament_result_submissions')
    .insert({
      match_id: params.matchId,
      stage: QUICK_RESULT_STAGE,
      payload,
      status: 'submitted',
      version: 1,
      idempotency_key: params.idempotencyKey,
      submitted_by: params.actorUserId,
      submitted_at: now,
    })
    .select('id')
    .single();

  if (submissionError || !submissionData) {
    throw new Error(submissionError?.message || 'Failed to create quick result submission');
  }

  const submissionId = (submissionData as { id: string }).id;

  await params.client.from('tournament_result_versions').insert({
    submission_id: submissionId,
    version: 1,
    payload,
    changed_by: params.actorUserId,
  });

  return {
    submissionId,
    matchId: params.matchId,
    matchCode: match.match_code,
    homeScore,
    awayScore,
    previousMatchVersion: params.expectedVersion,
    newMatchVersion: newVersion,
    status: 'submitted',
    idempotent: false,
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
