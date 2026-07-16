// Pure D-09 result-consistency validation for the Full Match Report — no DB
// access, no Next.js. Mirrors the same locked rules the Standings Engine
// (lib/tournament/standings) already assumes about published results:
// every finished match has a winner, no draws, and penalty-shootout scores
// never contribute to goal differential.

export interface ResultScoreInput {
  regulationHomeScore: unknown;
  regulationAwayScore: unknown;
  penaltyHomeScore: unknown;
  penaltyAwayScore: unknown;
  decidedBy: unknown;
  winnerTeamId: unknown;
  homeTeamId: string;
  awayTeamId: string;
}

export type ResultValidationErrorCode =
  | 'REGULATION_HOME_SCORE_EMPTY'
  | 'REGULATION_HOME_SCORE_INVALID'
  | 'REGULATION_HOME_SCORE_DECIMAL'
  | 'REGULATION_HOME_SCORE_NEGATIVE'
  | 'REGULATION_AWAY_SCORE_EMPTY'
  | 'REGULATION_AWAY_SCORE_INVALID'
  | 'REGULATION_AWAY_SCORE_DECIMAL'
  | 'REGULATION_AWAY_SCORE_NEGATIVE'
  | 'PENALTY_HOME_SCORE_INVALID'
  | 'PENALTY_HOME_SCORE_DECIMAL'
  | 'PENALTY_HOME_SCORE_NEGATIVE'
  | 'PENALTY_AWAY_SCORE_INVALID'
  | 'PENALTY_AWAY_SCORE_DECIMAL'
  | 'PENALTY_AWAY_SCORE_NEGATIVE'
  | 'DECIDED_BY_INVALID'
  | 'WINNER_TEAM_INVALID'
  | 'REGULATION_DECIDED_REQUIRES_DECIDED_BY_REGULATION'
  | 'REGULATION_DECIDED_WINNER_MISMATCH'
  | 'REGULATION_DECIDED_FORBIDS_PENALTY_SCORES'
  | 'PENALTY_DECIDED_REQUIRES_DECIDED_BY_PENALTY'
  | 'PENALTY_DECIDED_REQUIRES_PENALTY_SCORES'
  | 'PENALTY_SCORES_MUST_NOT_TIE'
  | 'PENALTY_DECIDED_WINNER_MISMATCH';

export interface ResultValidationError {
  code: ResultValidationErrorCode;
  message: string;
}

export interface ValidatedResultScores {
  regulationHomeScore: number;
  regulationAwayScore: number;
  penaltyHomeScore: number | null;
  penaltyAwayScore: number | null;
  decidedBy: 'regulation' | 'penalty';
  winnerTeamId: string;
  resultType: 'normal' | 'penalty_decided';
}

export type ResultValidationResult =
  | { ok: true; value: ValidatedResultScores }
  | { ok: false; errors: ResultValidationError[] };

function validateNonNegativeInteger(
  raw: unknown,
  fieldPrefix: string
): { ok: true; value: number } | { ok: false; code: ResultValidationErrorCode } {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: false, code: `${fieldPrefix}_EMPTY` as ResultValidationErrorCode };
  }
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(num)) {
    return { ok: false, code: `${fieldPrefix}_INVALID` as ResultValidationErrorCode };
  }
  if (!Number.isInteger(num)) {
    return { ok: false, code: `${fieldPrefix}_DECIMAL` as ResultValidationErrorCode };
  }
  if (num < 0) {
    return { ok: false, code: `${fieldPrefix}_NEGATIVE` as ResultValidationErrorCode };
  }
  return { ok: true, value: num };
}

function validateOptionalNonNegativeInteger(
  raw: unknown,
  fieldPrefix: string
): { ok: true; value: number | null } | { ok: false; code: ResultValidationErrorCode } {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null };
  }
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(num)) {
    return { ok: false, code: `${fieldPrefix}_INVALID` as ResultValidationErrorCode };
  }
  if (!Number.isInteger(num)) {
    return { ok: false, code: `${fieldPrefix}_DECIMAL` as ResultValidationErrorCode };
  }
  if (num < 0) {
    return { ok: false, code: `${fieldPrefix}_NEGATIVE` as ResultValidationErrorCode };
  }
  return { ok: true, value: num };
}

/**
 * Validates the D-09 regulation/penalty result-consistency rules. Pure —
 * takes and returns plain values, no DB access. This is the single source
 * of truth for what an official Full Match Report result must look like;
 * both the app-layer preview/publish path and (redundantly, for
 * defense-in-depth) the Postgres publish RPC enforce these invariants.
 */
export function validateResultConsistency(input: ResultScoreInput): ResultValidationResult {
  const errors: ResultValidationError[] = [];

  const regulationHome = validateNonNegativeInteger(input.regulationHomeScore, 'REGULATION_HOME_SCORE');
  if (!regulationHome.ok) errors.push({ code: regulationHome.code, message: `Invalid regulation home score: ${regulationHome.code}` });

  const regulationAway = validateNonNegativeInteger(input.regulationAwayScore, 'REGULATION_AWAY_SCORE');
  if (!regulationAway.ok) errors.push({ code: regulationAway.code, message: `Invalid regulation away score: ${regulationAway.code}` });

  const penaltyHome = validateOptionalNonNegativeInteger(input.penaltyHomeScore, 'PENALTY_HOME_SCORE');
  if (!penaltyHome.ok) errors.push({ code: penaltyHome.code, message: `Invalid penalty home score: ${penaltyHome.code}` });

  const penaltyAway = validateOptionalNonNegativeInteger(input.penaltyAwayScore, 'PENALTY_AWAY_SCORE');
  if (!penaltyAway.ok) errors.push({ code: penaltyAway.code, message: `Invalid penalty away score: ${penaltyAway.code}` });

  const decidedBy = input.decidedBy;
  if (decidedBy !== 'regulation' && decidedBy !== 'penalty') {
    errors.push({ code: 'DECIDED_BY_INVALID', message: "decided_by must be 'regulation' or 'penalty'" });
  }

  const winnerTeamId = typeof input.winnerTeamId === 'string' ? input.winnerTeamId.trim() : '';
  if (winnerTeamId !== input.homeTeamId && winnerTeamId !== input.awayTeamId) {
    errors.push({ code: 'WINNER_TEAM_INVALID', message: 'winner_team_id must be the home or away team of this match' });
  }

  if (errors.length > 0) return { ok: false, errors };

  const regHome = (regulationHome as { ok: true; value: number }).value;
  const regAway = (regulationAway as { ok: true; value: number }).value;
  const penHome = (penaltyHome as { ok: true; value: number | null }).value;
  const penAway = (penaltyAway as { ok: true; value: number | null }).value;

  if (regHome !== regAway) {
    // Regulation-decided match.
    if (decidedBy !== 'regulation') {
      errors.push({ code: 'REGULATION_DECIDED_REQUIRES_DECIDED_BY_REGULATION', message: 'A regulation-decided match must have decided_by=regulation' });
    }
    if (penHome !== null || penAway !== null) {
      errors.push({ code: 'REGULATION_DECIDED_FORBIDS_PENALTY_SCORES', message: 'A regulation-decided match must not have penalty scores' });
    }
    const expectedWinner = regHome > regAway ? input.homeTeamId : input.awayTeamId;
    if (winnerTeamId !== expectedWinner) {
      errors.push({ code: 'REGULATION_DECIDED_WINNER_MISMATCH', message: 'winner_team_id does not match the higher regulation score' });
    }
    if (errors.length > 0) return { ok: false, errors };
    return {
      ok: true,
      value: {
        regulationHomeScore: regHome,
        regulationAwayScore: regAway,
        penaltyHomeScore: null,
        penaltyAwayScore: null,
        decidedBy: 'regulation',
        winnerTeamId: expectedWinner,
        resultType: 'normal',
      },
    };
  }

  // Regulation scores tied — must be a penalty-decided match.
  if (decidedBy !== 'penalty') {
    errors.push({ code: 'PENALTY_DECIDED_REQUIRES_DECIDED_BY_PENALTY', message: 'A tied-regulation match must have decided_by=penalty' });
  }
  if (penHome === null || penAway === null) {
    errors.push({ code: 'PENALTY_DECIDED_REQUIRES_PENALTY_SCORES', message: 'A tied-regulation match requires both penalty scores' });
  } else if (penHome === penAway) {
    errors.push({ code: 'PENALTY_SCORES_MUST_NOT_TIE', message: 'Penalty shootout scores must not be tied' });
  }
  if (errors.length > 0) return { ok: false, errors };

  const expectedPenaltyWinner = (penHome as number) > (penAway as number) ? input.homeTeamId : input.awayTeamId;
  if (winnerTeamId !== expectedPenaltyWinner) {
    errors.push({ code: 'PENALTY_DECIDED_WINNER_MISMATCH', message: 'winner_team_id does not match the penalty shootout winner' });
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      regulationHomeScore: regHome,
      regulationAwayScore: regAway,
      penaltyHomeScore: penHome,
      penaltyAwayScore: penAway,
      decidedBy: 'penalty',
      winnerTeamId: expectedPenaltyWinner,
      resultType: 'penalty_decided',
    },
  };
}
