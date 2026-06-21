'use client';

import { useEffect, useState } from 'react';
import { TopScorersTable } from '@/components/TopScorersTable';
import { PublicSeasonNav } from '@/components/PublicSeasonNav';
import { usePublicNav } from '@/lib/use-public-nav';
import { buildTopScorersPath } from '@/lib/public-slugs';
import type { Division } from '@/types/db';

interface TopScorer {
  player_id: string;
  player_code: string;
  full_name: string;
  team_name: string;
  total_goals: number;
  shirt_no?: number;
}

interface TopScorersViewProps {
  seasonId: string;
  ageGroupId: string;
}

function sortDivisions(divisions: Division[]): Division[] {
  return [...divisions].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)
  );
}

export function TopScorersView({ seasonId, ageGroupId }: TopScorersViewProps) {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [scorers, setScorers] = useState<TopScorer[]>([]);
  const [loading, setLoading] = useState(true);

  const { seasons, ageGroups, seg, code, onSeasonChange, onAgeChange } = usePublicNav(
    'top-scorers',
    seasonId,
    ageGroupId
  );

  // Divisions (local filter — not part of the URL)
  useEffect(() => {
    let active = true;
    fetch(`/api/public/divisions?seasonId=${seasonId}&ageGroupId=${ageGroupId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Division[]) => {
        if (!active) return;
        const sorted = sortDivisions(data);
        setDivisions(sorted);
        setSelected(sorted[0]?.id || '');
      });
    return () => {
      active = false;
    };
  }, [seasonId, ageGroupId]);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    setLoading(true);
    fetch(
      `/api/public/top-scorers?seasonId=${seasonId}&ageGroupId=${ageGroupId}&divisionId=${selected}&limit=100`
    )
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TopScorer[]) => active && setScorers(data))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [seasonId, ageGroupId, selected]);

  const copyPath = seg && code ? buildTopScorersPath(seg, code) : null;

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
            {divisions.map((d) => (
              <button
                key={d.id}
                onClick={() => setSelected(d.id)}
                className={`cfyl-chip ${selected === d.id ? 'cfyl-chip-active' : ''}`}
              >
                {d.name}
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
        ) : scorers.length > 0 ? (
          <TopScorersTable scorers={scorers} />
        ) : (
          <p className="cfyl-empty">ไม่พบข้อมูลดาวซัลโว</p>
        )}
      </div>
    </div>
  );
}
