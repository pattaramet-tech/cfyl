'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SeasonSelector } from '@/components/SeasonSelector';
import { DisciplineTable } from '@/components/DisciplineTable';
import type { Division } from '@/types/db';

interface DisciplineRecord {
  player_id: string;
  full_name: string;
  team_name: string;
  shirt_no?: number;
  yellow_cards: number;
  red_cards: number;
  total_cards: number;
  matches_banned: number;
}

export default function DisciplinePage() {
  const searchParams = useSearchParams();
  const seasonId = searchParams.get('season');
  const ageGroupId = searchParams.get('ageGroup');

  const [records, setRecords] = useState<DisciplineRecord[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedDivision, setSelectedDivision] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (seasonId && ageGroupId) {
      fetchDivisions();
    }
  }, [seasonId, ageGroupId]);

  useEffect(() => {
    if (selectedDivision) {
      fetchDiscipline(selectedDivision);
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
      console.error('Failed to fetch divisions:', error);
    }
  };

  const fetchDiscipline = async (divisionId: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/public/discipline?seasonId=${seasonId}&ageGroupId=${ageGroupId}&divisionId=${divisionId}`
      );
      const data = await res.json();
      setRecords(data);
    } catch (error) {
      console.error('Failed to fetch discipline records:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">⚠️ ใบเหลืองใบแดง / โทษแบน</h1>
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
              <h2 className="text-lg font-semibold text-gray-800 mb-4">เลือกดิวิชั่น</h2>
              <div className="flex flex-wrap gap-2">
                {divisions.map(div => (
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
            ) : records.length > 0 ? (
              <DisciplineTable records={records} />
            ) : (
              <p className="text-center py-12 text-gray-500">ไม่พบข้อมูลใบเหลืองใบแดง</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
