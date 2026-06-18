import type { Match } from '@/types/db';

interface MatchCardProps {
  match: Match & {
    home_team?: { name: string; short_name?: string; logo_url?: string };
    away_team?: { name: string; short_name?: string; logo_url?: string };
    division?: { name: string };
  };
}

export function MatchCard({ match }: MatchCardProps) {
  const isFinished = match.status === 'finished';
  const homeTeam = match.home_team?.short_name || match.home_team?.name || 'Team A';
  const awayTeam = match.away_team?.short_name || match.away_team?.name || 'Team B';

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white hover:shadow-lg transition">
      <div className="text-sm text-gray-500 mb-2">
        {match.matchday} · {match.match_time}
      </div>

      <div className="text-xs text-gray-400 mb-3 font-medium">{match.division?.name}</div>

      <div className="flex items-center justify-between mb-3">
        <div className="flex-1">
          <div className="font-semibold text-sm text-gray-800">{homeTeam}</div>
        </div>

        <div className="mx-4 flex items-center gap-2">
          {isFinished ? (
            <>
              <span className="text-2xl font-bold text-blue-600">{match.home_score}</span>
              <span className="text-gray-400">-</span>
              <span className="text-2xl font-bold text-blue-600">{match.away_score}</span>
            </>
          ) : (
            <span className="text-gray-400 text-sm">vs</span>
          )}
        </div>

        <div className="flex-1 text-right">
          <div className="font-semibold text-sm text-gray-800">{awayTeam}</div>
        </div>
      </div>

      <div className="text-xs text-center text-gray-500">
        {isFinished ? '✓ แข่งจบแล้ว' : '⏰ ยังไม่แข่ง'}
      </div>
    </div>
  );
}
