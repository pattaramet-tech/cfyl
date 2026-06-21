'use client';

import { useCallback, useEffect, useState } from 'react';
import { StandingsTable } from '@/components/StandingsTable';
import { buildStandingsPath, divisionToCode } from '@/lib/public-slugs';
import type { Standing, Division } from '@/types/db';

interface StandingsViewProps {
  seasonId: string;
  ageGroupId: string;
  /** Preselect a single division (clean URL .../d1). */
  divisionId?: string | null;
  /** Render every division stacked (clean URL without divisionCode). */
  allDivisions?: boolean;
  /** Slug parts — enable the Copy Link button when present. */
  seasonYear?: number | string;
  ageGroupCode?: string;
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
    <button
      onClick={onCopy}
      className="cfyl-chip text-xs"
      title={path}
    >
      {copied ? '✓ คัดลอกแล้ว' : '🔗 คัดลอกลิงก์'}
    </button>
  );
}

export function StandingsView({
  seasonId,
  ageGroupId,
  divisionId,
  allDivisions = false,
  seasonYear,
  ageGroupCode,
}: StandingsViewProps) {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [standings, setStandings] = useState<Standing[]>([]);
  const [allStandings, setAllStandings] = useState<Record<string, Standing[]>>({});
  const [loading, setLoading] = useState(true);

  // Load divisions for this season/age group
  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/public/divisions?seasonId=${seasonId}&ageGroupId=${ageGroupId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Division[]) => {
        if (!active) return;
        const sorted = sortDivisions(data);
        setDivisions(sorted);
        if (!allDivisions) {
          const initial =
            (divisionId && sorted.find((d) => d.id === divisionId)?.id) ||
            sorted[0]?.id ||
            '';
          setSelected(initial);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [seasonId, ageGroupId, divisionId, allDivisions]);

  // Single-division mode: load selected division standings
  useEffect(() => {
    if (allDivisions || !selected) return;
    let active = true;
    setLoading(true);
    fetchStandings(seasonId, ageGroupId, selected)
      .then((data) => active && setStandings(data))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [seasonId, ageGroupId, selected, allDivisions]);

  // All-divisions mode: load standings for every division
  useEffect(() => {
    if (!allDivisions || divisions.length === 0) return;
    let active = true;
    setLoading(true);
    Promise.all(
      divisions.map((d) =>
        fetchStandings(seasonId, ageGroupId, d.id).then((s) => [d.id, s] as const)
      )
    )
      .then((pairs) => {
        if (!active) return;
        setAllStandings(Object.fromEntries(pairs));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [seasonId, ageGroupId, allDivisions, divisions]);

  const topDivisionId = divisions[0]?.id;
  const canCopy = seasonYear != null && !!ageGroupCode;

  // ─── All-divisions (stacked) ──────────────────────────────────────────────
  if (allDivisions) {
    if (loading && Object.keys(allStandings).length === 0) {
      return (
        <div className="cfyl-loading">
          <span className="cfyl-spinner w-5 h-5" />
          กำลังโหลดข้อมูล...
        </div>
      );
    }
    if (divisions.length === 0) {
      return <div className="cfyl-empty">ไม่พบดิวิชั่นของรุ่นอายุนี้</div>;
    }
    return (
      <div className="space-y-6">
        {divisions.map((div) => {
          const rows = allStandings[div.id] || [];
          return (
            <div key={div.id} className="cfyl-section">
              <div className="flex items-center justify-between gap-2 mb-3">
                <h2 className="cfyl-section-title">{div.name}</h2>
                {canCopy && (
                  <CopyLinkButton
                    path={buildStandingsPath(
                      seasonYear!,
                      ageGroupCode!,
                      divisionToCode(divisions, div.id) || undefined
                    )}
                  />
                )}
              </div>
              {rows.length > 0 ? (
                <StandingsTable standings={rows} showProvinceRep={div.id === topDivisionId} />
              ) : (
                <p className="cfyl-empty">ไม่พบข้อมูลตารางคะแนน</p>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ─── Single division (chips + table) ──────────────────────────────────────
  return (
    <>
      {divisions.length > 0 && (
        <div className="cfyl-section">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <h2 className="cfyl-section-title">เลือกดิวิชั่น</h2>
            {canCopy && selected && (
              <CopyLinkButton
                path={buildStandingsPath(
                  seasonYear!,
                  ageGroupCode!,
                  divisionToCode(divisions, selected) || undefined
                )}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {divisions.map((div) => (
              <button
                key={div.id}
                onClick={() => setSelected(div.id)}
                className={`cfyl-chip ${selected === div.id ? 'cfyl-chip-active' : ''}`}
              >
                {div.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="cfyl-section">
        {loading ? (
          <div className="cfyl-loading">
            <span className="cfyl-spinner w-5 h-5" />
            กำลังโหลดข้อมูล...
          </div>
        ) : standings.length > 0 ? (
          <StandingsTable standings={standings} showProvinceRep={selected === topDivisionId} />
        ) : (
          <p className="cfyl-empty">ไม่พบข้อมูลตารางคะแนน</p>
        )}
      </div>
    </>
  );
}
