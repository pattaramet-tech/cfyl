import { Match } from '@/types/db';

export function isByeResult(match: Match | null | undefined): boolean {
  if (!match) return false;
  return match.result_type === 'home_win_by_bye' || match.result_type === 'away_win_by_bye';
}

export function getByeLabelForTeam(match: Match | null | undefined, teamId: string | undefined): string | null {
  if (!match || !teamId) return null;

  if (match.result_type === 'home_win_by_bye' && match.home_team_id === teamId) {
    return 'ชนะบาย';
  }
  if (match.result_type === 'home_win_by_bye' && match.away_team_id === teamId) {
    return 'แพ้บาย';
  }
  if (match.result_type === 'away_win_by_bye' && match.away_team_id === teamId) {
    return 'ชนะบาย';
  }
  if (match.result_type === 'away_win_by_bye' && match.home_team_id === teamId) {
    return 'แพ้บาย';
  }

  return null;
}
