'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SeasonSelector } from '@/components/SeasonSelector';
import { TopScorersTable } from '@/components/TopScorersTable';
import type { Division } from '@/types/db';

interface TopScorer {
  player_id: string;
  player_code: string;
  full_name: string;
  team_name: string;
  total_goals: number;
  shirt_no?: number;
}

export default function TopScorersPage() {
  const searchParams = useSearchParams();
  const seasonId = searchParams.get('season');
  const ageGroupId = searchParams.get('ageGroup');

  const [scorers, setScorers] = useState<TopScorer[]>([]);
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
      fetchScorers(selectedDivision);
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
      console.error('[TOP_SCORERS_PAGE] Failed to fetch divisions:', error);
    }
  };

  const fetchScorers = async (divisionId: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/public/top-scorers?seasonId=${seasonId}&ageGroupId=${ageGroupId}&divisionId=${divisionId}&limit=100`
      );
      const data = await res.json();
      setScorers(data);
    } catch (error) {
      console.error('[TOP_SCORERS_PAGE] Failed to fetch top scorers:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="cfyl-section">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-4">🏆 ดาวซัลโว</h1>
        <SeasonSelector />
      </div>

      {!seasonId || !ageGroupId ? (
        <div className="cfyl-empty">โปรดเลือกฤดูกาลและรุ่นอายุ</div>
      ) : (
        <>
          {divisions.length > 0 && (
            <div className="cfyl-section">
              <h2 className="cfyl-section-title mb-3">เลือกดิวิชั่น</h2>
              <div className="flex flex-wrap gap-2">
                {divisions.map(div => (
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
            ) : scorers.length > 0 ? (
              <TopScorersTable scorers={scorers} />
            ) : (
              <p className="cfyl-empty">ไม่พบข้อมูลดาวซัลโว</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
