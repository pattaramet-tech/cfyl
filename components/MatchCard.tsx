import Link from 'next/link';
import type { Match } from '@/types/db';
import { TeamLogo } from './TeamLogo';
import { getByeLabelForTeam } from '@/lib/match-utils';

interface MatchCardProps {
  match: Match & {
    home_team?: { name: string; short_name?: string; logo_url?: string };
    away_team?: { name: string; short_name?: string; logo_url?: string };
    division?: { name: string };
  };
  variant?: 'highlight' | 'future' | 'finished' | 'inactive';
  badgeText?: string;
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
}

export function MatchCard({ match, variant, badgeText }: MatchCardProps) {
  const isFinished = match.status === 'finished';
  const isInactive = match.status === 'postponed' || match.status === 'cancelled';
  const effectiveVariant = variant ?? (isInactive ? 'inactive' : isFinished ? 'finished' : 'future');

  const homeTeam = match.home_team?.name || match.home_team?.short_name || 'ทีมเหย้า';
  const awayTeam = match.away_team?.name || match.away_team?.short_name || 'ทีมเยือน';
  const date = formatDate(match.match_date);

  const cardClass = effectiveVariant === 'highlight'
    ? 'border-l-4 border-blue-600 bg-blue-50/30'
    : effectiveVariant === 'finished'
    ? 'opacity-75'
    : effectiveVariant === 'inactive'
    ? 'border border-amber-200 bg-amber-50/30'
    : '';

  const getBadgeClass = () => {
    if (effectiveVariant === 'highlight') return 'bg-blue-100 text-blue-700';
    if (effectiveVariant === 'finished') return 'bg-slate-100 text-slate-600';
    if (effectiveVariant === 'inactive') return 'bg-amber-100 text-amber-700';
    return 'bg-blue-50 text-blue-700';
  };

  const getDefaultBadgeText = () => {
    if (effectiveVariant === 'inactive') {
      return match.status === 'postponed' ? '⚠️ เลื่อนการแข่งขัน' : '✕ ยกเลิก';
    }
    if (effectiveVariant === 'finished') return '✓ แข่งจบแล้ว';
    if (effectiveVariant === 'highlight') return isFinished ? '✓ แข่งจบแล้ว' : '🔥 โปรแกรมวันนี้';
    return '⏰ ยังไม่แข่ง';
  };

  function ByeBadge({ label }: { label: 'ชนะบาย' | 'แพ้บาย' | null }) {
    if (!label) return null;
    return (
      <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
        {label}
      </span>
    );
  }

  const homeByeLabel = getByeLabelForTeam(match, 'home');
  const awayByeLabel = getByeLabelForTeam(match, 'away');

  return (
    <div className={`cfyl-card p-4 hover:shadow-md transition ${cardClass}`}>
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
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
        {/* Home */}
        <div className="flex min-w-0 flex-col items-end gap-1">
          <div className="flex min-w-0 items-center justify-end gap-2">
            <div className="min-w-0 text-right text-sm font-semibold text-slate-800 break-words">
              {homeTeam}
            </div>
            <TeamLogo
              logoUrl={match.home_team?.logo_url}
              name={match.home_team?.name}
              shortName={match.home_team?.short_name}
              size="sm"
            />
          </div>
          <ByeBadge label={homeByeLabel} />
        </div>

        {/* Score */}
        <div className="flex items-center justify-center min-w-[56px] sm:min-w-[64px]">
          {isFinished ? (
            <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-lg font-bold text-blue-900">
              <span>{match.home_score ?? 0}</span>
              <span className="text-slate-400">-</span>
              <span>{match.away_score ?? 0}</span>
            </div>
          ) : (
            <span className="text-xs font-medium text-slate-400 sm:text-sm">vs</span>
          )}
        </div>

        {/* Away */}
        <div className="flex min-w-0 flex-col items-start gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <TeamLogo
              logoUrl={match.away_team?.logo_url}
              name={match.away_team?.name}
              shortName={match.away_team?.short_name}
              size="sm"
            />
            <div className="min-w-0 text-sm font-semibold text-slate-800 break-words">
              {awayTeam}
            </div>
          </div>
          <ByeBadge label={awayByeLabel} />
        </div>
      </div>

      {/* Status */}
      <div className="mt-3 space-y-2">
        <div className="flex justify-center">
          <span className={`cfyl-badge ${getBadgeClass()}`}>{badgeText || getDefaultBadgeText()}</span>
        </div>
        <Link
          href={`/matches/${match.id}`}
          className="block text-center text-xs text-blue-600 hover:text-blue-700 hover:underline font-semibold transition"
        >
          ดูรายละเอียด →
        </Link>
      </div>
    </div>
  );
}
