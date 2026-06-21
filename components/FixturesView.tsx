'use client';

import { useEffect, useMemo, useState } from 'react';
import { MatchCard } from '@/components/MatchCard';
import { PublicSeasonNav } from '@/components/PublicSeasonNav';
import { usePublicNav } from '@/lib/use-public-nav';
import { buildFixturesPath, matchdayNumber } from '@/lib/public-slugs';
import type { Match } from '@/types/db';

interface FixturesViewProps {
  seasonId: string;
  ageGroupId: string;
  /** Matchday slug e.g. "md2" — null = all matchdays. */
  matchdayCode?: string | null;
}

export function FixturesView({ seasonId, ageGroupId, matchdayCode }: FixturesViewProps) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  const selectedMd = matchdayCode ? matchdayNumber(matchdayCode) : null;

  const { router, seasons, ageGroups, seg, code, onSeasonChange, onAgeChange } = usePublicNav(
    'fixtures',
    seasonId,
    ageGroupId,
    selectedMd != null ? { kind: 'md', code: `md${selectedMd}` } : undefined
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/public/matches?seasonId=${seasonId}&ageGroupId=${ageGroupId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Match[]) => active && setMatches(data))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [seasonId, ageGroupId]);

  // Unique matchday numbers (sorted)
  const matchdays = useMemo(() => {
    const nums = Array.from(new Set(matches.map((m) => matchdayNumber(m.matchday)).filter((n) => n > 0)));
    return nums.sort((a, b) => a - b);
  }, [matches]);

  const filtered = selectedMd != null
    ? matches.filter((m) => matchdayNumber(m.matchday) === selectedMd)
    : matches;

  const canNav = !!seg && !!code;
  const goAll = () => canNav && router.push(buildFixturesPath(seg!, code!));
  const goMd = (n: number) => canNav && router.push(buildFixturesPath(seg!, code!, `md${n}`));

  const copyPath = canNav
    ? selectedMd != null
      ? buildFixturesPath(seg!, code!, `md${selectedMd}`)
      : buildFixturesPath(seg!, code!)
    : null;

  return (
    <div className="space-y-6">
      <PublicSeasonNav
        seasons={seasons}
        ageGroups={ageGroups}
        seasonId={seasonId}
        ageGroupId={ageGroupId}
        onSeasonChange={onSeasonChange}
        onAgeChange={onAgeChange}
        copyPath={copyPath}
      >
        {matchdays.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-600 whitespace-nowrap">MatchDay</span>
            <button onClick={goAll} className={`cfyl-chip ${selectedMd == null ? 'cfyl-chip-active' : ''}`}>
              ทั้งหมด
            </button>
            {matchdays.map((n) => (
              <button
                key={n}
                onClick={() => goMd(n)}
                className={`cfyl-chip ${selectedMd === n ? 'cfyl-chip-active' : ''}`}
              >
                MD{n}
              </button>
            ))}
          </div>
        )}
      </PublicSeasonNav>

      <div className="cfyl-section">
        {loading ? (
          <div className="cfyl-loading">
            <span className="cfyl-spinner w-5 h-5" />
            กำลังโหลดข้อมูล...
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            {filtered.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        ) : (
          <p className="cfyl-empty">ไม่พบข้อมูลแมตช์</p>
        )}
      </div>
    </div>
  );
}
