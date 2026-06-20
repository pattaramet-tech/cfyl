'use client';

interface Match {
  id: string;
  match_code?: string;
  matchday: number | string;
  match_date?: string;
  match_time?: string;
  home_team_id: string;
  away_team_id: string;
  home_score?: number | null;
  away_score?: number | null;
  status?: string;
  home_team?: { name: string; short_name: string };
  away_team?: { name: string; short_name: string };
  division?: { name: string };
}

interface Card {
  id: string;
  card_type: string;
}

interface MatchSummaryCardProps {
  match: Match;
  cards: Card[];
}

export function MatchSummaryCard({ match, cards }: MatchSummaryCardProps) {
  const homeTeam = match.home_team?.name || match.home_team?.short_name || 'ทีมเหย้า';
  const awayTeam = match.away_team?.name || match.away_team?.short_name || 'ทีมเยือน';

  const yellowCount = cards.filter((c) => c.card_type === 'yellow').length;
  const secondYellowCount = cards.filter((c) => c.card_type === 'second_yellow').length;
  const redCount = cards.filter((c) => c.card_type === 'red').length;

  const hasScore =
    match.home_score != null && match.away_score != null;

  const formattedDate = match.match_date
    ? new Date(match.match_date).toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const formattedTime = match.match_time
    ? match.match_time.substring(0, 5)
    : null;

  return (
    <div className="bg-white rounded-lg shadow border-l-4 border-blue-500 p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Left: match context */}
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
              {match.match_code || match.id.substring(0, 8)}
            </span>
            {match.division?.name && (
              <span className="text-xs text-gray-500">{match.division.name}</span>
            )}
            <span className="text-xs text-gray-500">MatchDay {match.matchday}</span>
            {formattedDate && (
              <span className="text-xs text-gray-500">{formattedDate}</span>
            )}
            {formattedTime && (
              <span className="text-xs text-gray-500">{formattedTime}</span>
            )}
          </div>

          <p className="font-bold text-gray-900 text-base sm:text-lg truncate">
            {homeTeam}
            {hasScore ? (
              <span className="text-blue-600 mx-2 font-bold">
                {match.home_score} – {match.away_score}
              </span>
            ) : (
              <span className="text-gray-400 mx-2">vs</span>
            )}
            {awayTeam}
          </p>
        </div>

        {/* Right: card summary badges */}
        <div className="flex gap-2 shrink-0 flex-wrap">
          {yellowCount > 0 && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-yellow-50 border border-yellow-200 rounded-full text-sm font-bold text-yellow-800">
              🟨 {yellowCount}
            </span>
          )}
          {secondYellowCount > 0 && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-orange-50 border border-orange-200 rounded-full text-sm font-bold text-orange-800">
              🟨🟥 {secondYellowCount}
            </span>
          )}
          {redCount > 0 && (
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-red-50 border border-red-200 rounded-full text-sm font-bold text-red-800">
              🟥 {redCount}
            </span>
          )}
          {cards.length === 0 && (
            <span className="text-gray-400 text-sm italic self-center">ยังไม่มีใบ</span>
          )}
        </div>
      </div>
    </div>
  );
}
