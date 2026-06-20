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

      // Extract unique matchdays (from freshly-fetched data, not stale state)
      const days = Array.from(
        new Set((data as Match[]).map((m) => String(m.matchday)).filter(Boolean))
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
      <div className="cfyl-section">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-4">📅 โปรแกรมแข่งขัน</h1>
        <SeasonSelector />
      </div>

      {!seasonId || !ageGroupId ? (
        <div className="cfyl-empty">โปรดเลือกฤดูกาลและรุ่นอายุ</div>
      ) : loading ? (
        <div className="cfyl-loading">
          <span className="cfyl-spinner w-5 h-5" />
          กำลังโหลดข้อมูล...
        </div>
      ) : (
        <>
          {matchdays.length > 0 && (
            <div className="cfyl-section">
              <h2 className="cfyl-section-title mb-3">เลือก MatchDay</h2>
              <div className="flex flex-wrap gap-2">
                {matchdays.map(day => (
                  <button
                    key={day}
                    onClick={() => setSelectedMatchday(day)}
                    className={`cfyl-chip ${selectedMatchday === day ? 'cfyl-chip-active' : ''}`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="cfyl-section">
            {filteredMatches.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {filteredMatches.map(match => (
                  <MatchCard key={match.id} match={match} />
                ))}
              </div>
            ) : (
              <p className="cfyl-empty">ไม่พบข้อมูลแมตช์</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
