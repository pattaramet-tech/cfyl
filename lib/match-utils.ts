import { Match } from '@/types/db';

type MatchLike = {
  result_type?: string | null;
  home_team_id?: string | null;
  away_team_id?: string | null;
};

export function isByeResult(match: MatchLike | null | undefined): boolean {
  if (!match) return false;
  return match.result_type === 'home_win_by_bye' || match.result_type === 'away_win_by_bye';
}

export function getByeLabelForTeam(
  match: MatchLike | null | undefined,
  teamSideOrId: 'home' | 'away' | string | null | undefined
): 'ชนะบาย' | 'แพ้บาย' | null {
  if (!match || !isByeResult(match)) return null;
  if (!teamSideOrId) return null;

  let side: 'home' | 'away' | null = null;

  if (teamSideOrId === 'home' || teamSideOrId === 'away') {
    side = teamSideOrId;
  } else if (teamSideOrId === match.home_team_id) {
    side = 'home';
  } else if (teamSideOrId === match.away_team_id) {
    side = 'away';
  }

  if (!side) return null;

  if (match.result_type === 'home_win_by_bye') {
    return side === 'home' ? 'ชนะบาย' : 'แพ้บาย';
  }

  if (match.result_type === 'away_win_by_bye') {
    return side === 'away' ? 'ชนะบาย' : 'แพ้บาย';
  }

  return null;
}
