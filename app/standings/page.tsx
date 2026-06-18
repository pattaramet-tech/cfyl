'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SeasonSelector } from '@/components/SeasonSelector';
import { StandingsTable } from '@/components/StandingsTable';
import type { Standing, Division } from '@/types/db';

export default function StandingsPage() {
  const searchParams = useSearchParams();
  const seasonId = searchParams.get('season');
  const ageGroupId = searchParams.get('ageGroup');

  const [standings, setStandings] = useState<Standing[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [selectedDivision, setSelectedDivision] = useState<string>('');
  const [filteredStandings, setFilteredStandings] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (seasonId && ageGroupId) {
      fetchDivisions();
    }
  }, [seasonId, ageGroupId]);

  useEffect(() => {
    if (selectedDivision) {
      fetchStandings(selectedDivision);
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
      console.error('[STANDINGS_PAGE] Failed to fetch divisions:', error);
    }
  };

  const fetchStandings = async (divisionId: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/public/standings?seasonId=${seasonId}&ageGroupId=${ageGroupId}&divisionId=${divisionId}`
      );
      const data = await res.json();
      setStandings(data);
    } catch (error) {
      console.error('[STANDINGS_PAGE] Failed to fetch standings:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">📊 ตารางคะแนน</h1>
        <SeasonSelector />
      </div>

      {!seasonId || !ageGroupId ? (
        <div className="text-center py-12 text-gray-500">
          <p>โปรดเลือกฤดูกาลและรุ่นอายุ</p>
        </div>
      ) : (
        <>
          {divisions.length > 0 && (
            <div className="bg-white rounded-lg shadow-md p-4 md:p-6">
              <h2 className="text-base md:text-lg font-semibold text-gray-800 mb-3 md:mb-4">เลือกดิวิชั่น</h2>
              <div className="flex flex-wrap gap-2">
                {divisions.map(div => (
                  <button
                    key={div.id}
                    onClick={() => setSelectedDivision(div.id)}
                    className={`px-3 md:px-4 py-2 text-sm md:text-base rounded-lg font-semibold transition ${
                      selectedDivision === div.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {div.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow-md p-4 md:p-6">
            {loading ? (
              <p className="text-center py-12 text-gray-500">กำลังโหลดข้อมูล...</p>
            ) : standings.length > 0 ? (
              <StandingsTable standings={standings} />
            ) : (
              <p className="text-center py-12 text-gray-500">ไม่พบข้อมูลตารางคะแนน</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
