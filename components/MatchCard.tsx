import type { Match } from '@/types/db';

interface MatchCardProps {
  match: Match & {
    home_team?: { name: string; short_name?: string; logo_url?: string };
    away_team?: { name: string; short_name?: string; logo_url?: string };
    division?: { name: string };
  };
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

export function MatchCard({ match }: MatchCardProps) {
  const isFinished = match.status === 'finished';
  const homeTeam = match.home_team?.name || match.home_team?.short_name || 'ทีมเหย้า';
  const awayTeam = match.away_team?.name || match.away_team?.short_name || 'ทีมเยือน';
  const date = formatDate(match.match_date);

  return (
    <div className="cfyl-card p-4 hover:shadow-md transition">
      {/* Meta row */}
      <div className="flex items-center justify-between gap-2 mb-3 text-xs">
        <div className="flex items-center gap-2 text-slate-500 min-w-0">
          <span className="font-semibold text-blue-900 whitespace-nowrap">{match.matchday}</span>
          {match.division?.name && (
            <span className="truncate text-slate-400">· {match.division.name}</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-slate-500 whitespace-nowrap">
          {date && <span>{date}</span>}
          {match.match_time && <span>{String(match.match_time).substring(0, 5)}</span>}
        </div>
      </div>

      {/* Teams + score */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="text-sm font-semibold text-slate-800 text-right break-words">
          {homeTeam}
        </div>

        <div className="flex items-center justify-center min-w-[64px]">
          {isFinished ? (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-blue-50">
              <span className="text-xl font-bold text-blue-900">{match.home_score}</span>
              <span className="text-slate-400">-</span>
              <span className="text-xl font-bold text-blue-900">{match.away_score}</span>
            </div>
          ) : (
            <span className="text-slate-400 text-sm font-medium">VS</span>
          )}
        </div>

        <div className="text-sm font-semibold text-slate-800 break-words">{awayTeam}</div>
      </div>

      {/* Status */}
      <div className="mt-3 flex justify-center">
        <span
          className={`cfyl-badge ${
            isFinished ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700'
          }`}
        >
          {isFinished ? '✓ แข่งจบแล้ว' : '⏰ ยังไม่แข่ง'}
        </span>
      </div>
    </div>
  );
}
