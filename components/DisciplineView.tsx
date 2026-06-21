'use client';

import { useEffect, useState } from 'react';
import { DisciplineTable } from '@/components/DisciplineTable';
import { PublicSeasonNav } from '@/components/PublicSeasonNav';
import { usePublicNav } from '@/lib/use-public-nav';
import { buildDisciplinePath } from '@/lib/public-slugs';

interface DisciplineViewProps {
  seasonId: string;
  ageGroupId: string;
}

export function DisciplineView({ seasonId, ageGroupId }: DisciplineViewProps) {
  const [records, setRecords] = useState<any[]>([]);
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
      .then((data: any[]) => {
        if (!active) return;
        setRecords(
          (data || []).map((s) => ({
            player_id: s.player_id,
            full_name: s.player?.full_name || 'Unknown',
            team_name: s.team?.name || 'Unknown Team',
            shirt_no: s.player?.shirt_no,
            total_points: s.total_points,
            ban_matches: s.ban_matches,
            point_sources: s.point_sources || [],
            suspension_reason: s.suspension_reason,
            suspension_details: s.suspension_details || null,
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
