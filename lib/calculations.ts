import { Match } from '@/types/db';

// Calculate standings from matches
export const calculateStandings = (matches: Match[], teamId: string) => {
  const finished = matches.filter(m => m.status === 'finished');

  let played = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;

  finished.forEach(match => {
    if (match.home_team_id === teamId || match.away_team_id === teamId) {
      played += 1;

      const isHome = match.home_team_id === teamId;
      const myScore = isHome ? match.home_score! : match.away_score!;
      const oppScore = isHome ? match.away_score! : match.home_score!;

      goalsFor += myScore;
      goalsAgainst += oppScore;

      if (myScore > oppScore) {
        wins += 1;
      } else if (myScore === oppScore) {
        draws += 1;
      } else {
        losses += 1;
      }
    }
  });

  const points = wins * 3 + draws * 1;
  const goalDiff = goalsFor - goalsAgainst;

  return {
    played,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalDiff,
    points,
  };
};

// Calculate discipline points from cards
// Rules:
// - 1 Yellow = 2 points
// - 2 Yellow in 1 match = Red = 4 points
// - Direct Red = 6 points
// - 1 Yellow + 1 Red in 1 match = 8 points
// - 6 points = 1 match ban
// - 12 points = 2 match bans
// - 18 points = 2 match bans
export const calculateDisciplinePoints = (
  yellows: number,
  reds: number,
  twoYellowsInOneMatch: boolean = false
) => {
  if (twoYellowsInOneMatch) {
    // 2 yellows in one match = red card
    return 4;
  }

  if (reds > 0 && yellows > 0) {
    // Yellow + Red in same match
    return 8;
  }

  if (reds > 0) {
    // Direct red
    return 6;
  }

  // Yellow cards
  return yellows * 2;
};

export const getDisciplineLevel = (totalPoints: number) => {
  if (totalPoints >= 18) return 2;
  if (totalPoints >= 12) return 2;
  if (totalPoints >= 6) return 1;
  return 0;
};

// Format time from HH:mm to Thai format "09:00 น."
export const formatTimeToThai = (time: string): string => {
  if (!time) return '';
  const [hours, minutes] = time.split(':');
  return `${hours}.${minutes} น.`;
};

// Parse Thai time "9.00 น." to "09:00"
export const parseTaiTime = (thaiTime: string): string => {
  if (!thaiTime) return '';
  // Remove "น." and replace . with :
  const cleaned = thaiTime.replace(/\s*น\.\s*$/, '').replace('.', ':');
  const [hours, minutes] = cleaned.split(':');
  const h = hours.padStart(2, '0');
  const m = (minutes || '00').padStart(2, '0');
  return `${h}:${m}`;
};

// Convert Excel serial date to ISO date string
export const excelDateToISO = (excelDate: number): string => {
  // Excel epoch: January 1, 1900 (with leap year bug)
  // JavaScript epoch: January 1, 1970
  const date = new Date((excelDate - 25569) * 86400 * 1000);
  return date.toISOString().split('T')[0];
};

// Extract division number from text like "ดิวิชั่น 1"
export const extractDivisionNumber = (divisionText: string): number => {
  const match = divisionText.match(/\d+/);
  return match ? parseInt(match[0], 10) : 1;
};

// Helper to parse matchday number
function parseMatchdayNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const match = String(value).match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

// Calculate team form from last 5 matches
export const calculateTeamForm = (matches: Match[], teamId: string, limit = 5): Array<'W' | 'D' | 'L'> => {
  const finishedMatches = matches
    .filter(
      (m) =>
        m.status === 'finished' &&
        m.home_score !== null &&
        m.away_score !== null &&
        (m.home_team_id === teamId || m.away_team_id === teamId)
    )
    .sort((a, b) => {
      const mdA = parseMatchdayNumber(a.matchday);
      const mdB = parseMatchdayNumber(b.matchday);
      if (mdA !== mdB) return mdA - mdB;

      const dateA = `${a.match_date || ''} ${a.match_time || ''}`;
      const dateB = `${b.match_date || ''} ${b.match_time || ''}`;
      if (dateA !== dateB) return dateA.localeCompare(dateB);

      return String(a.id).localeCompare(String(b.id));
    });

  return finishedMatches.slice(-limit).map((m) => {
    const homeScore = Number(m.home_score || 0);
    const awayScore = Number(m.away_score || 0);

    if (m.home_team_id === teamId) {
      if (homeScore > awayScore) return 'W';
      if (homeScore === awayScore) return 'D';
      return 'L';
    }

    if (awayScore > homeScore) return 'W';
    if (awayScore === homeScore) return 'D';
    return 'L';
  });
};
