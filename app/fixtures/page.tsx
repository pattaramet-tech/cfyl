'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SeasonSelector } from '@/components/SeasonSelector';
import { MatchCard } from '@/components/MatchCard';
import type { Match } from '@/types/db';

export default function FixturesPage() {
  const searchParams = useSearchParams();
  const seasonId = searchParams.get('season');
  const ageGroupId = searchParams.get('ageGroup');

  const [matches, setMatches] = useState<Match[]>([]);
  const [filteredMatches, setFilteredMatches] = useState<Match[]>([]);
  const [matchdays, setMatchdays] = useState<string[]>([]);
  const [selectedMatchday, setSelectedMatchday] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (seasonId && ageGroupId) {
      fetchMatches();
    }
  }, [seasonId, ageGroupId]);

  useEffect(() => {
    filterMatches();
  }, [selectedMatchday, matches]);

  const fetchMatches = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/public/matches?seasonId=${seasonId}&ageGroupId=${ageGroupId}`
      );
      const data = await res.json();
      setMatches(data);

      // Extract unique matchdays
      const days = Array.from(
        new Set(matches.map((m) => String(m.matchday)).filter(Boolean))
      );

      setMatchdays(days);

      if (days.length > 0) {
        setSelectedMatchday(days[0]);
      }
    } catch (error) {
      console.error('[FIXTURES_PAGE] Failed to fetch matches:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterMatches = () => {
    if (selectedMatchday) {
      setFilteredMatches(matches.filter(m => m.matchday === selectedMatchday));
    } else {
      setFilteredMatches(matches);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-4">📅 โปรแกรมแข่งขัน</h1>
        <SeasonSelector />
      </div>

      {!seasonId || !ageGroupId ? (
        <div className="text-center py-12 text-gray-500">
          <p>โปรดเลือกฤดูกาลและรุ่นอายุ</p>
        </div>
      ) : loading ? (
        <div className="text-center py-12 text-gray-500">
          <p>กำลังโหลดข้อมูล...</p>
        </div>
      ) : (
        <>
          {matchdays.length > 0 && (
            <div className="bg-white rounded-lg shadow-md p-4 md:p-6">
              <h2 className="text-base md:text-lg font-semibold text-gray-800 mb-3 md:mb-4">เลือก MatchDay</h2>
              <div className="flex flex-wrap gap-2">
                {matchdays.map(day => (
                  <button
                    key={day}
                    onClick={() => setSelectedMatchday(day)}
                    className={`px-3 md:px-4 py-2 text-sm md:text-base rounded-lg font-semibold transition ${
                      selectedMatchday === day
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow-md p-4 md:p-6">
            {filteredMatches.length > 0 ? (
              <div className="space-y-4">
                {filteredMatches.map(match => (
                  <MatchCard key={match.id} match={match} />
                ))}
              </div>
            ) : (
              <p className="text-center py-12 text-gray-500">ไม่พบข้อมูลแมตช์</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
