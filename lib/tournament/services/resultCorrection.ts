import { getTournamentServiceClient } from '../db/supabase-tournament';
import {
  hashResultCorrectionValue,
  issueResultCorrectionPreviewToken,
  verifyResultCorrectionPreviewToken,
} from './resultCorrectionPreviewToken';
import { validateResultConsistency, type ResultScoreInput, type ValidatedResultScores } from '../fullMatchReport/validateResultConsistency';

// Tournament V2 Published Result Correction — SCORE ONLY (MVP). Corrects an
// already-published official Full Match Report result (Migration 014) via a
// single atomic step: Preview (this service, zero writes) -> Publish (calls
// tournament.correct_published_match_result(), Migration 018). There is no
// correction-request queue or second approver in this PR.
//
// EXPLICITLY OUT OF SCOPE, ON PURPOSE: goal-event editing, card-event
// editing, player data, team staff, attendance, match report text editing,
// attachments, suspension recalculation, discipline workflow, knockout
// advancement, automatic placeholder resolution, correcting Quick Result
// submissions. This service has no parameter, field, or code path capable of
// writing tournament_match_goals, tournament_match_cards,
// tournament_match_reports, or any tournament_result_submissions row with
// stage='quick_result' — Migration 018's RPC accepts no such parameters
// either, so none of this can be bypassed by calling the RPC directly.

const STAGE = 'correction';
const INELIGIBLE_STATUSES = new Set(['cancelled', 'abandoned', 'void', 'bye']);

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

export class ResultCorrectionError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CorrectedResultInput extends Omit<ResultScoreInput, 'homeTeamId' | 'awayTeamId'> {
  correctionReason: string;
}

interface MatchRow {
  id: string;
  tournament_id: string;
  category_id: string;
  match_code: string;
  home_team_id: string | null;
  away_team_id: string | null;
  status: string;
  result_workflow_status: string;
  schedule_status: string;
  regulation_home_score: number | null;
  regulation_away_score: number | null;
  penalty_home_score: number | null;
  penalty_away_score: number | null;
  decided_by: string | null;
  winner_team_id: string | null;
  result_type: string;
  version: number;
  deleted_at: string | null;
}

async function loadMatch(client: TournamentClient, matchId: string): Promise<MatchRow> {
  const { data, error } = await client
    .from('tournament_matches')
    .select(
      'id, tournament_id, category_id, match_code, home_team_id, away_team_id, status, result_workflow_status, schedule_status, regulation_home_score, regulation_away_score, penalty_home_score, penalty_away_score, decided_by, winner_team_id, result_type, version, deleted_at'
    )
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ResultCorrectionError('RESULT_CORRECTION_MATCH_NOT_FOUND', 'Match not found');
  return data as MatchRow;
}

function assertCorrectable(match: MatchRow, tournamentId: string): void {
  if (match.deleted_at) throw new ResultCorrectionError('RESULT_CORRECTION_MATCH_DELETED', 'Match has been deleted');
  if (match.tournament_id !== tournamentId) {
    throw new ResultCorrectionError('RESULT_CORRECTION_TOURNAMENT_MISMATCH', 'Match does not belong to the specified tournament');
  }
  if (INELIGIBLE_STATUSES.has(match.status)) {
    throw new ResultCorrectionError(
      'RESULT_CORRECTION_MATCH_STATUS_INELIGIBLE',
      `Match status "${match.status}" is not eligible for result correction`
    );
  }
  if (!match.home_team_id) throw new ResultCorrectionError('RESULT_CORRECTION_HOME_TEAM_UNRESOLVED', 'Home team placeholder is not yet resolved');
  if (!match.away_team_id) throw new ResultCorrectionError('RESULT_CORRECTION_AWAY_TEAM_UNRESOLVED', 'Away team placeholder is not yet resolved');
  if (match.schedule_status !== 'published') {
    throw new ResultCorrectionError('RESULT_CORRECTION_SCHEDULE_NOT_PUBLISHED', 'Schedule is not in an eligible published state for this match');
  }
  if (match.result_workflow_status !== 'published') {
    throw new ResultCorrectionError(
      'RESULT_CORRECTION_NOT_PUBLISHED',
      'This match does not yet have a published official result — use the Full Match Report workflow to publish one first'
    );
  }
}

/** True when the proposed corrected result is identical to the match's
 * current official result — a correction that changes nothing is rejected,
 * both here (fast UX feedback) and, authoritatively, inside the RPC. */
function isNoChange(match: MatchRow, corrected: ValidatedResultScores): boolean {
  return (
    match.regulation_home_score === corrected.regulationHomeScore &&
    match.regulation_away_score === corrected.regulationAwayScore &&
    (match.penalty_home_score ?? null) === corrected.penaltyHomeScore &&
    (match.penalty_away_score ?? null) === corrected.penaltyAwayScore &&
    match.decided_by === corrected.decidedBy &&
    match.winner_team_id === corrected.winnerTeamId &&
    match.result_type === corrected.resultType
  );
}

export interface OfficialResultSnapshot {
  regulationHomeScore: number | null;
  regulationAwayScore: number | null;
  penaltyHomeScore: number | null;
  penaltyAwayScore: number | null;
  decidedBy: string | null;
  winnerTeamId: string | null;
  resultType: string;
}

function currentResultSnapshot(match: MatchRow): OfficialResultSnapshot {
  return {
    regulationHomeScore: match.regulation_home_score,
    regulationAwayScore: match.regulation_away_score,
    penaltyHomeScore: match.penalty_home_score,
    penaltyAwayScore: match.penalty_away_score,
    decidedBy: match.decided_by,
    winnerTeamId: match.winner_team_id,
    resultType: match.result_type,
  };
}

function correctedResultSnapshot(corrected: ValidatedResultScores): OfficialResultSnapshot {
  return {
    regulationHomeScore: corrected.regulationHomeScore,
    regulationAwayScore: corrected.regulationAwayScore,
    penaltyHomeScore: corrected.penaltyHomeScore,
    penaltyAwayScore: corrected.penaltyAwayScore,
    decidedBy: corrected.decidedBy,
    winnerTeamId: corrected.winnerTeamId,
    resultType: corrected.resultType,
  };
}

/** Deterministic JSON string for hashing — plain key order, no dependence on
 * object construction order (both callers build these objects with the same
 * literal key order, so JSON.stringify is already stable here). */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

export interface PreviewResultCorrectionParams {
  client: TournamentClient;
  tournamentId: string;
  matchId: string;
  actorUserId: string | null;
  input: CorrectedResultInput;
}

export interface ResultCorrectionPreview {
  matchId: string;
  matchCode: string;
  currentVersion: number;
  beforeResult: OfficialResultSnapshot;
  afterResult: OfficialResultSnapshot;
  correctionReason: string;
  previewToken: string;
  previewExpiresAt: string;
}

export async function previewResultCorrection(params: PreviewResultCorrectionParams): Promise<ResultCorrectionPreview> {
  const match = await loadMatch(params.client, params.matchId);
  assertCorrectable(match, params.tournamentId);

  const reason = (params.input.correctionReason || '').trim();
  if (!reason) {
    throw new ResultCorrectionError('RESULT_CORRECTION_REASON_REQUIRED', 'A correction reason is required');
  }

  const scoreValidation = validateResultConsistency({
    ...params.input,
    homeTeamId: match.home_team_id as string,
    awayTeamId: match.away_team_id as string,
  });
  if (!scoreValidation.ok) {
    throw new ResultCorrectionError(scoreValidation.errors[0].code, scoreValidation.errors[0].message);
  }

  if (isNoChange(match, scoreValidation.value)) {
    throw new ResultCorrectionError('RESULT_CORRECTION_NO_CHANGES', 'Corrected result is identical to the current official result');
  }

  const beforeResult = currentResultSnapshot(match);
  const afterResult = correctedResultSnapshot(scoreValidation.value);

  const issued = issueResultCorrectionPreviewToken({
    tournamentId: params.tournamentId,
    matchId: params.matchId,
    actorUserId: params.actorUserId,
    expectedMatchVersion: match.version,
    beforeResultHash: hashResultCorrectionValue(canonicalJson(beforeResult)),
    afterResultHash: hashResultCorrectionValue(canonicalJson(afterResult)),
    correctionReasonHash: hashResultCorrectionValue(reason),
  });

  return {
    matchId: match.id,
    matchCode: match.match_code,
    currentVersion: match.version,
    beforeResult,
    afterResult,
    correctionReason: reason,
    previewToken: issued.token,
    previewExpiresAt: issued.expiresAt,
  };
}

export interface PublishResultCorrectionParams {
  client: TournamentClient;
  tournamentId: string;
  matchId: string;
  expectedVersion: number;
  idempotencyKey: string;
  previewToken: string;
  actorUserId: string | null;
  actorEmail: string | null;
  input: CorrectedResultInput;
}

export interface PublishResultCorrectionResult {
  submissionId: string;
  matchId: string;
  matchCode: string;
  newMatchVersion: number;
  correctedAt: string;
  idempotent: boolean;
}

function parseRpcErrorCode(message: string): { code: string; detail: string } {
  const separatorIndex = message.indexOf(':');
  if (separatorIndex > 0 && /^[A-Z0-9_]+$/.test(message.slice(0, separatorIndex).trim())) {
    return { code: message.slice(0, separatorIndex).trim(), detail: message.slice(separatorIndex + 1).trim() };
  }
  return { code: 'RESULT_CORRECTION_FAILED', detail: message };
}

function isRpcUnavailableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202') return true;
  const message = (error.message || '').toLowerCase();
  return message.includes('could not find the function') || (message.includes('function') && message.includes('does not exist'));
}

export async function publishResultCorrection(params: PublishResultCorrectionParams): Promise<PublishResultCorrectionResult> {
  if (!params.idempotencyKey || !params.idempotencyKey.trim()) {
    throw new ResultCorrectionError('RESULT_CORRECTION_IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey is required');
  }

  const match = await loadMatch(params.client, params.matchId);

  const reason = (params.input.correctionReason || '').trim();

  const scoreValidation = validateResultConsistency({
    ...params.input,
    homeTeamId: match.home_team_id as string,
    awayTeamId: match.away_team_id as string,
  });
  if (!scoreValidation.ok) {
    throw new ResultCorrectionError(scoreValidation.errors[0].code, scoreValidation.errors[0].message);
  }

  // App-layer fast-path idempotency lookup (UX only — the RPC is the
  // authoritative, concurrency-safe enforcement; see Migration 018's
  // ordering rationale). Must run BEFORE assertCorrectable()/the Preview
  // Token requirement, mirroring fullMatchReport.ts's publish flow: a retry
  // of a key that just succeeded must not be rejected as "no changes" or
  // demand a fresh Preview Token.
  const { data: existingData, error: existingError } = await params.client
    .from('tournament_result_submissions')
    .select('id')
    .eq('match_id', params.matchId)
    .eq('stage', STAGE)
    .eq('idempotency_key', params.idempotencyKey)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  const isPresumedRetry = !!existingData;

  if (!isPresumedRetry) {
    assertCorrectable(match, params.tournamentId);

    if (!reason) {
      throw new ResultCorrectionError('RESULT_CORRECTION_REASON_REQUIRED', 'A correction reason is required');
    }

    if (isNoChange(match, scoreValidation.value)) {
      throw new ResultCorrectionError('RESULT_CORRECTION_NO_CHANGES', 'Corrected result is identical to the current official result');
    }

    if (!params.previewToken || !params.previewToken.trim()) {
      throw new ResultCorrectionError('RESULT_CORRECTION_PREVIEW_REQUIRED', 'A valid Result Correction preview is required before publishing.');
    }
    const tokenVerification = verifyResultCorrectionPreviewToken(params.previewToken);
    if (!tokenVerification.ok) {
      throw new ResultCorrectionError(
        tokenVerification.code,
        tokenVerification.code === 'RESULT_CORRECTION_PREVIEW_EXPIRED'
          ? 'Result Correction preview has expired — request a new preview before publishing'
          : 'Result Correction preview token is invalid or was tampered with'
      );
    }

    const claims = tokenVerification.claims;
    const beforeResult = currentResultSnapshot(match);
    const afterResult = correctedResultSnapshot(scoreValidation.value);
    const beforeResultHash = hashResultCorrectionValue(canonicalJson(beforeResult));
    const afterResultHash = hashResultCorrectionValue(canonicalJson(afterResult));
    const correctionReasonHash = hashResultCorrectionValue(reason);

    const claimsMatchRequest =
      claims.tournamentId === params.tournamentId &&
      claims.matchId === params.matchId &&
      claims.actorUserId === params.actorUserId &&
      claims.expectedMatchVersion === params.expectedVersion &&
      claims.beforeResultHash === beforeResultHash &&
      claims.afterResultHash === afterResultHash &&
      claims.correctionReasonHash === correctionReasonHash;

    if (!claimsMatchRequest) {
      throw new ResultCorrectionError(
        'RESULT_CORRECTION_PREVIEW_MISMATCH',
        'The submitted correction no longer matches what was previewed (tournament, match, actor, version, before/after result, or reason changed) — preview again'
      );
    }

    if (match.version !== params.expectedVersion) {
      throw new ResultCorrectionError(
        'RESULT_CORRECTION_VERSION_CONFLICT',
        `Match has changed since Preview (expected version ${params.expectedVersion}, current version ${match.version})`
      );
    }
  }

  // No p_payload/old_data/new_data parameter — Migration 018 builds its own
  // canonical before/after payloads from the locked Match row and these
  // validated scalar parameters, never trusting a caller-supplied blob.
  const { data: rpcData, error: rpcError } = await params.client.rpc('correct_published_match_result', {
    p_match_id: params.matchId,
    p_tournament_id: params.tournamentId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actorUserId,
    p_actor_email: params.actorEmail,
    p_idempotency_key: params.idempotencyKey,
    p_correction_reason: reason,
    p_regulation_home_score: scoreValidation.value.regulationHomeScore,
    p_regulation_away_score: scoreValidation.value.regulationAwayScore,
    p_penalty_home_score: scoreValidation.value.penaltyHomeScore,
    p_penalty_away_score: scoreValidation.value.penaltyAwayScore,
    p_decided_by: scoreValidation.value.decidedBy,
    p_winner_team_id: scoreValidation.value.winnerTeamId,
    p_result_type: scoreValidation.value.resultType,
  });

  if (rpcError) {
    if (isRpcUnavailableError(rpcError)) {
      throw new ResultCorrectionError(
        'RESULT_CORRECTION_RPC_UNAVAILABLE',
        'The result correction transaction (Migration 018) is not available in this environment. Correction cannot proceed — there is no non-transactional fallback.'
      );
    }
    const { code, detail } = parseRpcErrorCode(rpcError.message);
    throw new ResultCorrectionError(code, detail);
  }

  const result = rpcData as { submission_id: string; new_match_version: number; corrected_at: string; idempotent: boolean };

  return {
    submissionId: result.submission_id,
    matchId: params.matchId,
    matchCode: match.match_code,
    newMatchVersion: result.new_match_version,
    correctedAt: result.corrected_at,
    idempotent: result.idempotent,
  };
}

export interface ResultCorrectionContext {
  matchId: string;
  matchCode: string;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  currentResult: OfficialResultSnapshot;
  currentVersion: number;
  resultWorkflowStatus: string;
  canCorrect: boolean;
}

/** Read-only context for the Result Correction form: match identity, team
 * names, and the current official result. No eligibility assertion here —
 * the form surfaces RESULT_CORRECTION_NOT_PUBLISHED as a read-only notice
 * rather than failing to load entirely. */
export async function loadResultCorrectionContext(params: {
  client: TournamentClient;
  tournamentId: string;
  matchId: string;
}): Promise<ResultCorrectionContext> {
  const match = await loadMatch(params.client, params.matchId);
  if (match.tournament_id !== params.tournamentId) {
    throw new ResultCorrectionError('RESULT_CORRECTION_TOURNAMENT_MISMATCH', 'Match does not belong to the specified tournament');
  }

  const [homeTeamResult, awayTeamResult] = await Promise.all([
    match.home_team_id ? params.client.from('tournament_teams').select('id, name').eq('id', match.home_team_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    match.away_team_id ? params.client.from('tournament_teams').select('id, name').eq('id', match.away_team_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);

  const homeTeam = homeTeamResult.data as { id: string; name: string } | null;
  const awayTeam = awayTeamResult.data as { id: string; name: string } | null;

  let canCorrect = true;
  try {
    assertCorrectable(match, params.tournamentId);
  } catch {
    canCorrect = false;
  }

  return {
    matchId: match.id,
    matchCode: match.match_code,
    homeTeamId: match.home_team_id || '',
    homeTeamName: homeTeam?.name || 'TBD',
    awayTeamId: match.away_team_id || '',
    awayTeamName: awayTeam?.name || 'TBD',
    currentResult: currentResultSnapshot(match),
    currentVersion: match.version,
    resultWorkflowStatus: match.result_workflow_status,
    canCorrect,
  };
}
