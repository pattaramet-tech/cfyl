import { describe, expect, it } from 'vitest';
import { validateResultConsistency, type ResultScoreInput } from '../validateResultConsistency';

const HOME = 'team-home';
const AWAY = 'team-away';

function input(overrides: Partial<ResultScoreInput> = {}): ResultScoreInput {
  return {
    regulationHomeScore: 2,
    regulationAwayScore: 0,
    penaltyHomeScore: null,
    penaltyAwayScore: null,
    decidedBy: 'regulation',
    winnerTeamId: HOME,
    homeTeamId: HOME,
    awayTeamId: AWAY,
    ...overrides,
  };
}

describe('validateResultConsistency — D-09', () => {
  it('1. accepts a regulation home win', () => {
    const result = validateResultConsistency(input({ regulationHomeScore: 3, regulationAwayScore: 1, winnerTeamId: HOME }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.decidedBy).toBe('regulation');
      expect(result.value.winnerTeamId).toBe(HOME);
      expect(result.value.resultType).toBe('normal');
    }
  });

  it('2. accepts a regulation away win', () => {
    const result = validateResultConsistency(input({ regulationHomeScore: 0, regulationAwayScore: 2, winnerTeamId: AWAY }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.winnerTeamId).toBe(AWAY);
    }
  });

  it('3. rejects a regulation draw with no penalty scores and decided_by=regulation', () => {
    const result = validateResultConsistency(
      input({ regulationHomeScore: 1, regulationAwayScore: 1, decidedBy: 'regulation', winnerTeamId: HOME })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.code === 'PENALTY_DECIDED_REQUIRES_DECIDED_BY_PENALTY')).toBe(true);
    }
  });

  it('4. rejects tied penalty scores', () => {
    const result = validateResultConsistency(
      input({ regulationHomeScore: 1, regulationAwayScore: 1, decidedBy: 'penalty', penaltyHomeScore: 4, penaltyAwayScore: 4, winnerTeamId: HOME })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'PENALTY_SCORES_MUST_NOT_TIE')).toBe(true);
  });

  it('5. rejects a penalty winner mismatch', () => {
    const result = validateResultConsistency(
      input({ regulationHomeScore: 1, regulationAwayScore: 1, decidedBy: 'penalty', penaltyHomeScore: 5, penaltyAwayScore: 3, winnerTeamId: AWAY })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'PENALTY_DECIDED_WINNER_MISMATCH')).toBe(true);
  });

  it('6. rejects a regulation winner mismatch', () => {
    const result = validateResultConsistency(input({ regulationHomeScore: 3, regulationAwayScore: 1, winnerTeamId: AWAY }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'REGULATION_DECIDED_WINNER_MISMATCH')).toBe(true);
  });

  it('7. rejects penalty fields present on a regulation-decided match', () => {
    const result = validateResultConsistency(
      input({ regulationHomeScore: 2, regulationAwayScore: 0, penaltyHomeScore: 3, penaltyAwayScore: 2, winnerTeamId: HOME })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'REGULATION_DECIDED_FORBIDS_PENALTY_SCORES')).toBe(true);
  });

  it('8. accepts 0-0 regulation plus a valid penalty result', () => {
    const result = validateResultConsistency(
      input({ regulationHomeScore: 0, regulationAwayScore: 0, decidedBy: 'penalty', penaltyHomeScore: 4, penaltyAwayScore: 2, winnerTeamId: HOME })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.resultType).toBe('penalty_decided');
      expect(result.value.decidedBy).toBe('penalty');
    }
  });

  it('9. rejects a negative score', () => {
    const result = validateResultConsistency(input({ regulationHomeScore: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'REGULATION_HOME_SCORE_NEGATIVE')).toBe(true);
  });

  it('10. rejects a decimal score', () => {
    const result = validateResultConsistency(input({ regulationAwayScore: 1.5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'REGULATION_AWAY_SCORE_DECIMAL')).toBe(true);
  });

  it('11. rejects an empty score', () => {
    const result = validateResultConsistency(input({ regulationHomeScore: '' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'REGULATION_HOME_SCORE_EMPTY')).toBe(true);
  });

  it('rejects an invalid decided_by value', () => {
    const result = validateResultConsistency(input({ decidedBy: 'coin_toss' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'DECIDED_BY_INVALID')).toBe(true);
  });

  it('rejects a winner_team_id that is neither the home nor away team', () => {
    const result = validateResultConsistency(input({ winnerTeamId: 'some-other-team' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'WINNER_TEAM_INVALID')).toBe(true);
  });

  it('rejects a negative penalty score', () => {
    const result = validateResultConsistency(
      input({ regulationHomeScore: 1, regulationAwayScore: 1, decidedBy: 'penalty', penaltyHomeScore: -1, penaltyAwayScore: 2, winnerTeamId: AWAY })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.code === 'PENALTY_HOME_SCORE_NEGATIVE')).toBe(true);
  });

  it('is deterministic', () => {
    const params = input({ regulationHomeScore: 4, regulationAwayScore: 2, winnerTeamId: HOME });
    expect(validateResultConsistency(params)).toEqual(validateResultConsistency(params));
  });
});
