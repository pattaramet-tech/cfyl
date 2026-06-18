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

      // Map suspension records to include team name (format for display)
      const mapped = data.map((s: any) => ({
        player_id: s.player_id,
        full_name: s.player?.full_name || 'Unknown',
        team_name: s.team?.name || 'Unknown Team',
        shirt_no: s.player?.shirt_no,
        total_points: s.total_points,
        ban_matches: s.ban_matches,
        point_sources: s.point_sources || [],
        suspension_reason: s.suspension_reason,
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
      <div className="bg-white rounded-lg shadow-md p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">
          ⚠️ ใบเหลืองใบแดง / โทษแบน
        </h1>
        <p className="text-gray-600 text-sm">
          ระบบคิดคะแนนโทษ CFYL: เหลือง 1 ใบ = 2 คะแนน | เหลือง 2 ใบ = 4 คะแนน | แดง =
          6 คะแนน | เหลือง 1 + แดง 1 = 8 คะแนน
        </p>
        <SeasonSelector />
      </div>

      {!seasonId || !ageGroupId ? (
        <div className="text-center py-12 text-gray-500">
          <p>โปรดเลือกฤดูกาลและรุ่นอายุ</p>
        </div>
      ) : (
        <>
          {divisions.length > 0 && (
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">
                เลือกดิวิชั่น (ไม่จำเป็น - แสดงทั้งหมด)
              </h2>
              <div className="flex flex-wrap gap-2">
                {divisions.map((div) => (
                  <button
                    key={div.id}
                    onClick={() => setSelectedDivision(div.id)}
                    className={`px-4 py-2 rounded-lg font-semibold transition ${
                      selectedDivision === div.id
                        ? 'bg-red-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {div.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow-md p-6">
            {loading ? (
              <p className="text-center py-12 text-gray-500">กำลังโหลดข้อมูล...</p>
            ) : suspensions.length > 0 ? (
              <DisciplineTable records={suspensions} />
            ) : (
              <p className="text-center py-12 text-gray-500">
                ไม่พบข้อมูลใบเหลืองใบแดง
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
