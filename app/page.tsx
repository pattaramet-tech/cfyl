'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SeasonSelector } from '@/components/SeasonSelector';
import { MatchCard } from '@/components/MatchCard';
import { StandingsTable } from '@/components/StandingsTable';
import { TopScorersTable } from '@/components/TopScorersTable';
import type { Match, Standing } from '@/types/db';

interface TopScorer {
  player_id: string;
  full_name: string;
  team_name: string;
  total_goals: number;
}

export default function Home() {
  const searchParams = useSearchParams();
  const seasonId = searchParams.get('season');
  const ageGroupId = searchParams.get('ageGroup');

  const [matches, setMatches] = useState<Match[]>([]);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [topScorers, setTopScorers] = useState<TopScorer[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (seasonId && ageGroupId) {
      fetchData();
    }
  }, [seasonId, ageGroupId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Get divisions first
      const divRes = await fetch(`/api/public/divisions?seasonId=${seasonId}&ageGroupId=${ageGroupId}`);
      const divisions = await divRes.json();

      if (divisions.length > 0) {
        const divisionId = divisions[0].id;

        // Fetch matches
        const matchRes = await fetch(
          `/api/public/matches?seasonId=${seasonId}&ageGroupId=${ageGroupId}&divisionId=${divisionId}`
        );
        const matchData = await matchRes.json();
        setMatches(matchData.slice(0, 5));

        // Fetch standings
        const standRes = await fetch(
          `/api/public/standings?seasonId=${seasonId}&ageGroupId=${ageGroupId}&divisionId=${divisionId}`
        );
        const standData = await standRes.json();
        setStandings(standData.slice(0, 4));

        // Fetch top scorers
        const scorerRes = await fetch(
          `/api/public/top-scorers?seasonId=${seasonId}&ageGroupId=${ageGroupId}&divisionId=${divisionId}&limit=5`
        );
        const scorerData = await scorerRes.json();
        setTopScorers(scorerData);
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">⚽ เลือกฤดูกาลและรุ่นอายุ</h2>
        <SeasonSelector />
      </div>

      {!seasonId || !ageGroupId ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">โปรดเลือกฤดูกาลและรุ่นอายุ</p>
        </div>
      ) : loading ? (
        <div className="text-center py-12">
          <p className="text-gray-500">กำลังโหลดข้อมูล...</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">📅 โปรแกรมแข่งขันล่าสุด</h3>
              <div className="space-y-3">
                {matches.length > 0 ? (
                  <>
                    {matches.map(match => (
                      <MatchCard key={match.id} match={match} />
                    ))}
                    <a href="/fixtures" className="block text-center text-blue-600 hover:text-blue-800 font-semibold mt-4">
                      ดูโปรแกรมทั้งหมด →
                    </a>
                  </>
                ) : (
                  <p className="text-gray-500 text-center py-6">ไม่มีข้อมูลแมตช์</p>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4">🏆 ดาวซัลโว TOP 5</h3>
              {topScorers.length > 0 ? (
                <div className="space-y-2">
                  {topScorers.map((scorer, idx) => (
                    <div key={scorer.player_id} className="flex justify-between items-center pb-2 border-b border-gray-200">
                      <div>
                        <p className="font-semibold text-sm text-gray-800">{idx + 1}. {scorer.full_name}</p>
                        <p className="text-xs text-gray-500">{scorer.team_name}</p>
                      </div>
                      <span className="font-bold text-orange-600 text-lg">{scorer.total_goals}</span>
                    </div>
                  ))}
                  <a href="/top-scorers" className="block text-center text-blue-600 hover:text-blue-800 font-semibold mt-4">
                    ดูทั้งหมด →
                  </a>
                </div>
              ) : (
                <p className="text-gray-500 text-center py-6">ไม่มีข้อมูล</p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-bold text-gray-800 mb-4">📊 ตารางคะแนน Top 4</h3>
            {standings.length > 0 ? (
              <>
                <StandingsTable standings={standings} />
                <a href="/standings" className="block text-center text-blue-600 hover:text-blue-800 font-semibold mt-4">
                  ดูตารางคะแนนทั้งหมด →
                </a>
              </>
            ) : (
              <p className="text-gray-500 text-center py-6">ไม่มีข้อมูล</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
