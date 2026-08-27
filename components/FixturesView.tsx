'use client';

import { useEffect, useMemo, useState } from 'react';
import { MatchCard } from '@/components/MatchCard';
import { PublicSeasonNav } from '@/components/PublicSeasonNav';
import { usePublicNav } from '@/lib/use-public-nav';
import { buildFixturesPath, matchdayNumber, resolveSeasonSwitchPath } from '@/lib/public-slugs';
import {
  filterMatchesByFixturePhase,
  getAvailableFixturePhaseOptions,
  normalizeFixturePhaseFilter,
  withFixturePhase,
  type FixturePhaseFilter,
} from '@/lib/fixture-phase';
import { getBangkokToday } from '@/lib/suspension-status';
import type { AgeGroup, Match, Season } from '@/types/db';

function getDateKey(match: Match): string {
  return match.match_date?.slice(0, 10) || '';
}

function isFinished(match: Match): boolean {
  return match.status === 'finished';
}

function isInactive(match: Match): boolean {
  return match.status === 'postponed' || match.status === 'cancelled';
}

function getHighlightDateKey(matches: Match[]): string {
  const today = getBangkokToday();
  if (matches.some((m) => getDateKey(m) === today)) {
    return today;
  }
  const futureMatches = matches
    .filter((m) => !isFinished(m) && !isInactive(m))
    .sort((a, b) => (getDateKey(a) || '').localeCompare(getDateKey(b) || ''));
  return futureMatches[0] ? getDateKey(futureMatches[0]) : '';
}

interface FixturesViewProps {
  seasonId: string;
  ageGroupId: string;
  /** Matchday slug e.g. "md2" — null = all matchdays. */
  matchdayCode?: string | null;
}

export function FixturesView({ seasonId, ageGroupId, matchdayCode }: FixturesViewProps) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPhase, setSelectedPhase] = useState<FixturePhaseFilter>('all');

  const selectedMd = matchdayCode ? matchdayNumber(matchdayCode) : null;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncPhaseFromUrl = () => {
      const phase = new URLSearchParams(window.location.search).get('phase');
      setSelectedPhase(normalizeFixturePhaseFilter(phase));
    };
    syncPhaseFromUrl();
    window.addEventListener('popstate', syncPhaseFromUrl);
    return () => window.removeEventListener('popstate', syncPhaseFromUrl);
  }, [seasonId, ageGroupId, matchdayCode]);

  const { router, seasons, ageGroups, seg, code } = usePublicNav(
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

  const phaseOptions = useMemo(() => getAvailableFixturePhaseOptions(matches), [matches]);
  const showPhaseFilter = phaseOptions.some(
    (option) => option.value !== 'all' && option.value !== 'regular'
  );
  const phaseMatches = useMemo(
    () => filterMatchesByFixturePhase(matches, selectedPhase),
    [matches, selectedPhase]
  );

  // Unique matchday numbers (sorted) within the selected competition phase.
  const matchdays = useMemo(() => {
    const nums = Array.from(
      new Set(phaseMatches.map((m) => matchdayNumber(m.matchday)).filter((n) => n > 0))
    );
    return nums.sort((a, b) => a - b);
  }, [phaseMatches]);

  const filtered =
    selectedMd != null
      ? phaseMatches.filter((m) => matchdayNumber(m.matchday) === selectedMd)
      : phaseMatches;

  const groupedMatches = useMemo(() => {
    const today = getBangkokToday();
    const highlightDateKey = getHighlightDateKey(filtered);
    const isTodayHighlight = highlightDateKey === today;

    const highlight = filtered.filter(
      (m) => getDateKey(m) === highlightDateKey && !isFinished(m) && !isInactive(m)
    );
    const future = filtered.filter(
      (m) => getDateKey(m) !== highlightDateKey && !isFinished(m) && !isInactive(m)
    );
    const finished = filtered.filter((m) => isFinished(m));
    const inactive = filtered.filter((m) => isInactive(m));
    return { highlight, future, finished, inactive, highlightDateKey, isTodayHighlight, today };
  }, [filtered]);

  const canNav = !!seg && !!code;
  const onFixtureSeasonChange = async (season: Season) => {
    const desiredAge = code || ageGroups[0]?.code || '';
    const path = await resolveSeasonSwitchPath(
      'fixtures',
      season,
      desiredAge,
      selectedMd != null ? { kind: 'md', code: `md${selectedMd}` } : undefined
    );
    router.push(withFixturePhase(path, selectedPhase));
  };
  const onFixtureAgeChange = (ageGroup: AgeGroup) => {
    if (!seg) return;
    router.push(withFixturePhase(buildFixturesPath(seg, ageGroup.code), selectedPhase));
  };
  const goPhase = (phase: FixturePhaseFilter) => {
    if (!canNav) return;
    setSelectedPhase(phase);
    router.push(withFixturePhase(buildFixturesPath(seg!, code!), phase));
  };
  const goAll = () => {
    if (!canNav) return;
    router.push(withFixturePhase(buildFixturesPath(seg!, code!), selectedPhase));
  };
  const goMd = (n: number) => {
    if (!canNav) return;
    router.push(withFixturePhase(buildFixturesPath(seg!, code!, `md${n}`), selectedPhase));
  };

  const baseCopyPath = canNav
    ? selectedMd != null
      ? buildFixturesPath(seg!, code!, `md${selectedMd}`)
      : buildFixturesPath(seg!, code!)
    : null;
  const copyPath = baseCopyPath ? withFixturePhase(baseCopyPath, selectedPhase) : null;

  return (
    <div className="space-y-6">
      <PublicSeasonNav
        seasons={seasons}
        ageGroups={ageGroups}
        seasonId={seasonId}
        ageGroupId={ageGroupId}
        onSeasonChange={onFixtureSeasonChange}
        onAgeChange={onFixtureAgeChange}
        copyPath={copyPath}
      >
        {showPhaseFilter && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-600 whitespace-nowrap">รอบการแข่งขัน</span>
            {phaseOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => goPhase(option.value)}
                className={`cfyl-chip ${selectedPhase === option.value ? 'cfyl-chip-active' : ''}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

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
                {selectedPhase === 'champion_league' ? `CL${n}` : `MD${n}`}
              </button>
            ))}
          </div>
        )}
      </PublicSeasonNav>

      <div className="space-y-6">
        {loading ? (
          <div className="cfyl-section">
            <div className="cfyl-loading">
              <span className="cfyl-spinner w-5 h-5" />
              กำลังโหลดข้อมูล...
            </div>
          </div>
        ) : filtered.length > 0 ? (
          <>
            {groupedMatches.highlight.length > 0 && (
              <div className="cfyl-section border-l-4 border-blue-600 bg-linear-to-r from-blue-50 to-transparent">
                <h3 className="cfyl-section-title mb-3">
                  {groupedMatches.isTodayHighlight ? '🔥 โปรแกรมวันนี้' : '⏰ โปรแกรมที่กำลังจะมาถึง'}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {groupedMatches.highlight.map((match) => {
                    const badgeText = groupedMatches.isTodayHighlight ? '🔥 โปรแกรมวันนี้' : '⏰ โปรแกรมที่กำลังจะมาถึง';
                    return (
                      <MatchCard
                        key={match.id}
                        match={match}
                        variant="highlight"
                        badgeText={badgeText}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {groupedMatches.future.length > 0 && (
              <div className="cfyl-section">
                <h3 className="cfyl-section-title mb-3">📅 โปรแกรมถัดไป</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {groupedMatches.future.map((match) => (
                    <MatchCard key={match.id} match={match} variant="future" />
                  ))}
                </div>
              </div>
            )}

            {groupedMatches.finished.length > 0 && (
              <div className="cfyl-section">
                <h3 className="cfyl-section-title mb-3">✅ แข่งจบแล้ว</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {groupedMatches.finished.map((match) => (
                    <MatchCard key={match.id} match={match} variant="finished" />
                  ))}
                </div>
              </div>
            )}

            {groupedMatches.inactive.length > 0 && (
              <div className="cfyl-section">
                <h3 className="cfyl-section-title mb-3">⚠️ เลื่อน/ยกเลิก</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  {groupedMatches.inactive.map((match) => (
                    <MatchCard key={match.id} match={match} variant="inactive" />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="cfyl-section">
            <p className="cfyl-empty">ไม่พบข้อมูลแมตช์</p>
          </div>
        )}
      </div>
    </div>
  );
}
