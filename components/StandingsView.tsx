'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { StandingsTable } from '@/components/StandingsTable';
import { buildStandingsPath, divisionToCode } from '@/lib/public-slugs';
import type { Standing, Division, Season, AgeGroup } from '@/types/db';

interface StandingsViewProps {
  seasonId: string;
  ageGroupId: string;
  /** Preselect a single division (clean URL .../d1). */
  divisionId?: string | null;
  /** Render every division stacked (clean URL without divisionCode). */
  allDivisions?: boolean;
}

function sortDivisions(divisions: Division[]): Division[] {
  return [...divisions].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)
  );
}

async function fetchStandings(
  seasonId: string,
  ageGroupId: string,
  divisionId: string
): Promise<Standing[]> {
  const res = await fetch(
    `/api/public/standings?seasonId=${seasonId}&ageGroupId=${ageGroupId}&divisionId=${divisionId}`
  );
  if (!res.ok) return [];
  return res.json();
}

function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const url = typeof window !== 'undefined' ? window.location.origin + path : path;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — ignore */
    }
  };
  return (
    <button onClick={onCopy} className="cfyl-chip text-xs" title={path}>
      {copied ? '✓ คัดลอกแล้ว' : '🔗 คัดลอกลิงก์'}
    </button>
  );
}

export function StandingsView({
  seasonId,
  ageGroupId,
  divisionId,
  allDivisions = false,
}: StandingsViewProps) {
  const router = useRouter();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [allStandings, setAllStandings] = useState<Record<string, Standing[]>>({});
  const [loading, setLoading] = useState(true);

  // Seasons (for the season dropdown + year lookup)
  useEffect(() => {
    fetch('/api/public/seasons')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Season[]) => setSeasons(data))
      .catch(() => setSeasons([]));
  }, []);

  // Age groups of this season (for the U14/U17 chips + code lookup)
  useEffect(() => {
    fetch(`/api/public/age-groups?seasonId=${seasonId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AgeGroup[]) =>
        setAgeGroups([...data].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
      )
      .catch(() => setAgeGroups([]));
  }, [seasonId]);

  // Divisions of this season+age group
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

  const season = seasons.find((s) => s.id === seasonId);
  const ageGroup = ageGroups.find((a) => a.id === ageGroupId);
  const year = season?.year;
  const code = ageGroup?.code;
  const canNav = year != null && !!code;
  const topDivisionId = divisions[0]?.id;
  const currentDivisionId = !allDivisions
    ? (divisionId && divisions.find((d) => d.id === divisionId)?.id) || divisions[0]?.id
    : undefined;

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
      divisions.map((d) =>
        fetchStandings(seasonId, ageGroupId, d.id).then((s) => [d.id, s] as const)
      )
    )
      .then((pairs) => active && setAllStandings(Object.fromEntries(pairs)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [seasonId, ageGroupId, allDivisions, divisions]);

  // ─── Navigation (always pushes clean URLs) ────────────────────────────────
  const goSeason = (s: Season) => {
    if (code) router.push(buildStandingsPath(s.year, code));
  };
  const goAge = (ag: AgeGroup) => {
    if (year != null) router.push(buildStandingsPath(year, ag.code));
  };
  const goAll = () => {
    if (canNav) router.push(buildStandingsPath(year!, code!));
  };
  const goDiv = (d: Division) => {
    if (canNav)
      router.push(
        buildStandingsPath(year!, code!, divisionToCode(divisions, d.id) || undefined)
      );
  };

  const copyPath = canNav
    ? allDivisions
      ? buildStandingsPath(year!, code!)
      : buildStandingsPath(
          year!,
          code!,
          (currentDivisionId && divisionToCode(divisions, currentDivisionId)) || undefined
        )
    : null;

  const ageChipClass = (active: boolean, c: string): string => {
    if (!active) return 'cfyl-chip';
    const up = c.toUpperCase();
    if (up.includes('14')) return 'cfyl-chip bg-amber-500 text-white hover:bg-amber-500';
    if (up.includes('17')) return 'cfyl-chip bg-blue-700 text-white hover:bg-blue-700';
    return 'cfyl-chip cfyl-chip-active';
  };

  return (
    <div className="space-y-6">
      {/* Selectors — all push clean URLs */}
      <div className="cfyl-section space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="cfyl-section-title">เลือกตารางคะแนน</h2>
          {copyPath && <CopyLinkButton path={copyPath} />}
        </div>

        {seasons.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-600 whitespace-nowrap">ฤดูกาล</span>
            <select
              value={seasonId}
              onChange={(e) => {
                const s = seasons.find((x) => x.id === e.target.value);
                if (s) goSeason(s);
              }}
              className="cfyl-select"
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {ageGroups.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-600 whitespace-nowrap">รุ่นอายุ</span>
            {ageGroups.map((ag) => (
              <button key={ag.id} onClick={() => goAge(ag)} className={ageChipClass(ag.id === ageGroupId, ag.code)}>
                {ag.code}
              </button>
            ))}
          </div>
        )}

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
      </div>

      {/* Content */}
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
