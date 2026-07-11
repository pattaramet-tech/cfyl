'use client';

import { useEffect, useState } from 'react';
import { DisciplineTable } from '@/components/DisciplineTable';
import { PublicSeasonNav } from '@/components/PublicSeasonNav';
import { usePublicNav } from '@/lib/use-public-nav';
import { buildDisciplinePath } from '@/lib/public-slugs';
import type { PointSource, SuspensionDetails } from '@/lib/suspension-calc';
import type { Suspension } from '@/components/DisciplineTable';

interface DisciplineViewProps {
  seasonId: string;
  ageGroupId: string;
}

interface ApiSuspensionRecord {
  id: string;
  player_id: string;
  player?: { full_name?: string; shirt_no?: number };
  team?: { name?: string };
  total_points: number;
  ban_matches: number;
  point_sources?: PointSource[];
  suspension_reason?: string | null;
  suspension_details?: SuspensionDetails | null;
  card_details?: Array<{
    id: string;
    card_type: string;
    minute?: number | null;
    note?: string | null;
    match_id: string;
    match?: {
      matchday: string | number;
      match_date?: string | null;
      match_time?: string | null;
    } | null;
  }>;
}

export function DisciplineView({ seasonId, ageGroupId }: DisciplineViewProps) {
  const [records, setRecords] = useState<Suspension[]>([]);
  const [loading, setLoading] = useState(true);

  const { seasons, ageGroups, seg, code, onSeasonChange, onAgeChange } = usePublicNav(
    'discipline',
    seasonId,
    ageGroupId
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/public/suspensions?seasonId=${seasonId}&ageGroupId=${ageGroupId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: ApiSuspensionRecord[]) => {
        if (!active) return;
        setRecords(
          (data || []).map((s) => ({
            id: s.id,
            player_id: s.player_id,
            full_name: s.player?.full_name || 'Unknown',
            team_name: s.team?.name || 'Unknown Team',
            shirt_no: s.player?.shirt_no,
            total_points: s.total_points,
            ban_matches: s.ban_matches,
            point_sources: s.point_sources || [],
            suspension_reason: s.suspension_reason ?? null,
            suspension_details: s.suspension_details || null,
            card_details: s.card_details || [],
          }))
        );
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [seasonId, ageGroupId]);

  const copyPath = seg && code ? buildDisciplinePath(seg, code) : null;

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
      />

      <div className="cfyl-section">
        <p className="text-slate-500 text-xs sm:text-sm mb-4">
          ระบบคิดคะแนนโทษ CFYL: เหลือง 1 ใบ = 2 คะแนน | เหลือง 2 ใบ = 4 คะแนน | แดง = 6 คะแนน | เหลือง 1 + แดง 1 = 8 คะแนน
        </p>
        {loading ? (
          <div className="cfyl-loading">
            <span className="cfyl-spinner w-5 h-5" />
            กำลังโหลดข้อมูล...
          </div>
        ) : records.length > 0 ? (
          <DisciplineTable records={records} />
        ) : (
          <p className="cfyl-empty">ไม่พบข้อมูลใบเหลืองใบแดง</p>
        )}
      </div>
    </div>
  );
}
