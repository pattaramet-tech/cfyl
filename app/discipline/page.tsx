'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SeasonSelector } from '@/components/SeasonSelector';
import { DisciplineTable } from '@/components/DisciplineTable';
import type { Division } from '@/types/db';

interface PointSource {
  match_id: string;
  points: number;
  reason: string;
}

interface Suspension {
  player_id: string;
  full_name: string;
  team_name: string;
  shirt_no?: number;
  total_points: number;
  ban_matches: number;
  point_sources: PointSource[];
  suspension_reason: string | null;
  suspension_details?: any | null;
}

export default function DisciplinePage() {
  const searchParams = useSearchParams();
  const seasonId = searchParams.get('season');
  const ageGroupId = searchParams.get('ageGroup');

  const [suspensions, setSuspensions] = useState<Suspension[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedDivision, setSelectedDivision] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (seasonId && ageGroupId) {
      fetchDivisions();
      fetchSuspensions();
    }
  }, [seasonId, ageGroupId]);

  useEffect(() => {
    if (selectedDivision) {
      // Suspensions are already fetched for season/age_group, just filter
    }
  }, [selectedDivision]);

  const fetchDivisions = async () => {
    try {
      const res = await fetch(
        `/api/public/divisions?seasonId=${seasonId}&ageGroupId=${ageGroupId}`
      );
      const data = await res.json();
      setDivisions(data);
      if (data.length > 0) {
        setSelectedDivision(data[0].id);
      }
    } catch (error) {
      console.error('[DISCIPLINE_PAGE] Failed to fetch divisions:', error);
    }
  };

  const fetchSuspensions = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/public/suspensions?seasonId=${seasonId}&ageGroupId=${ageGroupId}`
      );
      const data = await res.json();

      // Map suspension records to include team name and rich details
      const mapped = data.map((s: any) => ({
        player_id: s.player_id,
        full_name: s.player?.full_name || 'Unknown',
        team_name: s.team?.name || 'Unknown Team',
        shirt_no: s.player?.shirt_no,
        total_points: s.total_points,
        ban_matches: s.ban_matches,
        point_sources: s.point_sources || [],
        suspension_reason: s.suspension_reason,
        suspension_details: s.suspension_details || null,
      }));

      setSuspensions(mapped);
    } catch (error) {
      console.error('[DISCIPLINE_PAGE] Failed to fetch suspensions:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="cfyl-section">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-3">
          ⚠️ ใบเหลืองใบแดง / โทษแบน
        </h1>
        <p className="text-slate-500 text-xs sm:text-sm mb-4">
          ระบบคิดคะแนนโทษ CFYL: เหลือง 1 ใบ = 2 คะแนน | เหลือง 2 ใบ = 4 คะแนน | แดง =
          6 คะแนน | เหลือง 1 + แดง 1 = 8 คะแนน
        </p>
        <SeasonSelector />
      </div>

      {!seasonId || !ageGroupId ? (
        <div className="cfyl-empty">โปรดเลือกฤดูกาลและรุ่นอายุ</div>
      ) : (
        <>
          {divisions.length > 0 && (
            <div className="cfyl-section">
              <h2 className="cfyl-section-title mb-3">เลือกดิวิชั่น (ไม่จำเป็น - แสดงทั้งหมด)</h2>
              <div className="flex flex-wrap gap-2">
                {divisions.map((div) => (
                  <button
                    key={div.id}
                    onClick={() => setSelectedDivision(div.id)}
                    className={`cfyl-chip ${selectedDivision === div.id ? 'cfyl-chip-active' : ''}`}
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
            ) : suspensions.length > 0 ? (
              <DisciplineTable records={suspensions} />
            ) : (
              <p className="cfyl-empty">ไม่พบข้อมูลใบเหลืองใบแดง</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
