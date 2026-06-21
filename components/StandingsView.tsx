'use client';

import { useEffect, useState } from 'react';
import { StandingsTable } from '@/components/StandingsTable';
import { PublicSeasonNav } from '@/components/PublicSeasonNav';
import { usePublicNav } from '@/lib/use-public-nav';
import { buildStandingsPath, divisionToCode } from '@/lib/public-slugs';
import type { Standing, Division } from '@/types/db';

interface StandingsViewProps {
  seasonId: string;
  ageGroupId: string;
  divisionId?: string | null;
  allDivisions?: boolean;
}

function sortDivisions(divisions: Division[]): Division[] {
  return [...divisions].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)
  );
}

async function fetchStandings(seasonId: string, ageGroupId: string, divisionId: string): Promise<Standing[]> {
  const res = await fetch(
    `/api/public/standings?seasonId=${seasonId}&ageGroupId=${ageGroupId}&divisionId=${divisionId}`
  );
  if (!res.ok) return [];
  return res.json();
}

export function StandingsView({ seasonId, ageGroupId, divisionId, allDivisions = false }: StandingsViewProps) {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [allStandings, setAllStandings] = useState<Record<string, Standing[]>>({});
  const [loading, setLoading] = useState(true);

  // Divisions of this season + age group
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/public/divisions?seasonId=${seasonId}&ageGroupId=${ageGroupId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Division[]) => active && setDivisions(sortDivisions(data)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [seasonId, ageGroupId]);

  const topDivisionId = divisions[0]?.id;
  const currentDivisionId = !allDivisions
    ? (divisionId && divisions.find((d) => d.id === divisionId)?.id) || divisions[0]?.id
    : undefined;
  const currentDivCode = currentDivisionId ? divisionToCode(divisions, currentDivisionId) : null;

  const { router, seasons, ageGroups, seg, code, onSeasonChange, onAgeChange } = usePublicNav(
    'standings',
    seasonId,
    ageGroupId,
    currentDivCode ? { kind: 'div', code: currentDivCode } : undefined
  );

  // Single-division standings
  useEffect(() => {
    if (allDivisions || !currentDivisionId) return;
    let active = true;
    setLoading(true);
    fetchStandings(seasonId, ageGroupId, currentDivisionId)
      .then((data) => active && setStandings(data))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [seasonId, ageGroupId, currentDivisionId, allDivisions]);

  // All-divisions standings
  useEffect(() => {
    if (!allDivisions || divisions.length === 0) return;
    let active = true;
    setLoading(true);
    Promise.all(
      divisions.map((d) => fetchStandings(seasonId, ageGroupId, d.id).then((s) => [d.id, s] as const))
    )
      .then((pairs) => active && setAllStandings(Object.fromEntries(pairs)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [seasonId, ageGroupId, allDivisions, divisions]);

  const canNav = !!seg && !!code;
  const goAll = () => canNav && router.push(buildStandingsPath(seg!, code!));
  const goDiv = (d: Division) =>
    canNav && router.push(buildStandingsPath(seg!, code!, divisionToCode(divisions, d.id) || undefined));

  const copyPath = canNav
    ? allDivisions
      ? buildStandingsPath(seg!, code!)
      : buildStandingsPath(seg!, code!, currentDivCode || undefined)
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
        {divisions.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-600 whitespace-nowrap">ดิวิชั่น</span>
            <button onClick={goAll} className={`cfyl-chip ${allDivisions ? 'cfyl-chip-active' : ''}`}>
              ทุกดิวิชั่น
            </button>
            {divisions.map((d) => (
              <button
                key={d.id}
                onClick={() => goDiv(d)}
                className={`cfyl-chip ${!allDivisions && currentDivisionId === d.id ? 'cfyl-chip-active' : ''}`}
              >
                {d.name}
              </button>
            ))}
          </div>
        )}
      </PublicSeasonNav>

      {allDivisions ? (
        loading && Object.keys(allStandings).length === 0 ? (
          <div className="cfyl-loading">
            <span className="cfyl-spinner w-5 h-5" />
            กำลังโหลดข้อมูล...
          </div>
        ) : divisions.length === 0 ? (
          <div className="cfyl-empty">ไม่พบดิวิชั่นของรุ่นอายุนี้</div>
        ) : (
          <div className="space-y-6">
            {divisions.map((div) => {
              const rows = allStandings[div.id] || [];
              return (
                <div key={div.id} className="cfyl-section">
                  <h2 className="cfyl-section-title mb-3">{div.name}</h2>
                  {rows.length > 0 ? (
                    <StandingsTable standings={rows} showProvinceRep={div.id === topDivisionId} />
                  ) : (
                    <p className="cfyl-empty">ไม่พบข้อมูลตารางคะแนน</p>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="cfyl-section">
          {loading ? (
            <div className="cfyl-loading">
              <span className="cfyl-spinner w-5 h-5" />
              กำลังโหลดข้อมูล...
            </div>
          ) : standings.length > 0 ? (
            <StandingsTable standings={standings} showProvinceRep={currentDivisionId === topDivisionId} />
          ) : (
            <p className="cfyl-empty">ไม่พบข้อมูลตารางคะแนน</p>
          )}
        </div>
      )}
    </div>
  );
}
