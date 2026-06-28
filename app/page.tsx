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
      console.error('[HOME_PAGE] Failed to fetch data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hero */}
      <section className="rounded-2xl bg-blue-900 text-white px-6 py-8 sm:px-10 sm:py-12 shadow-sm">
        <p className="text-blue-200 text-sm font-medium">Season 2026</p>
        <h1 className="mt-1 text-2xl sm:text-4xl font-bold leading-tight">
          Chonburi Futsal Youth League
        </h1>
        <p className="mt-2 text-blue-100 text-sm sm:text-base">
          ลีกฟุตซอลเยาวชนจังหวัดชลบุรี — โปรแกรมแข่งขัน ตารางคะแนน และสถิติทั้งหมด
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href="/fixtures" className="cfyl-btn-secondary">📅 โปรแกรมแข่งขัน</a>
          <a href="/standings" className="cfyl-btn-secondary">📊 ตารางคะแนน</a>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <a href="/teams" className="text-blue-200 hover:text-white transition">👥 ค้นหาทีมของคุณ →</a>
          <a href="/top-scorers" className="text-blue-200 hover:text-white transition">🏆 ดาวซัลโว →</a>
          <a href="/discipline" className="text-blue-200 hover:text-white transition">⚠️ ระเบียบวินัย →</a>
        </div>
      </section>

      <div className="cfyl-section">
        <h2 className="cfyl-section-title mb-3">เลือกฤดูกาลและรุ่นอายุ</h2>
        <SeasonSelector />
      </div>

      {!seasonId || !ageGroupId ? (
        <div className="cfyl-empty">โปรดเลือกฤดูกาลและรุ่นอายุเพื่อดูข้อมูล</div>
      ) : loading ? (
        <div className="cfyl-loading">
          <span className="cfyl-spinner w-5 h-5" />
          กำลังโหลดข้อมูล...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
            <div className="md:col-span-2 cfyl-section">
              <h3 className="cfyl-section-title mb-4">📅 โปรแกรมแข่งขันล่าสุด</h3>
              <div className="space-y-3">
                {matches.length > 0 ? (
                  <>
                    {matches.map(match => (
                      <MatchCard key={match.id} match={match} />
                    ))}
                    <a href="/fixtures" className="block text-center text-blue-800 hover:text-blue-900 font-semibold mt-4">
                      ดูโปรแกรมทั้งหมด →
                    </a>
                  </>
                ) : (
                  <p className="cfyl-empty">ไม่มีข้อมูลแมตช์</p>
                )}
              </div>
            </div>

            <div className="cfyl-section">
              <h3 className="cfyl-section-title mb-4">🏆 ดาวซัลโว TOP 5</h3>
              {topScorers.length > 0 ? (
                <div>
                  <ul className="divide-y divide-slate-100">
                    {topScorers.map((scorer, idx) => (
                      <li key={scorer.player_id} className="flex justify-between items-center gap-3 py-2.5">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-800 truncate">{idx + 1}. {scorer.full_name}</p>
                          <p className="text-xs text-slate-500 truncate">{scorer.team_name}</p>
                        </div>
                        <span className="font-bold text-blue-900 text-lg shrink-0">{scorer.total_goals}</span>
                      </li>
                    ))}
                  </ul>
                  <a href="/top-scorers" className="block text-center text-blue-800 hover:text-blue-900 font-semibold mt-4">
                    ดูทั้งหมด →
                  </a>
                </div>
              ) : (
                <p className="cfyl-empty">ไม่มีข้อมูล</p>
              )}
            </div>
          </div>

          <div className="cfyl-section">
            <h3 className="cfyl-section-title mb-4">📊 ตารางคะแนน Top 4</h3>
            {standings.length > 0 ? (
              <>
                <StandingsTable standings={standings} showProvinceRep={false} />
                <a href="/standings" className="block text-center text-blue-800 hover:text-blue-900 font-semibold mt-4">
                  ดูตารางคะแนนทั้งหมด →
                </a>
              </>
            ) : (
              <p className="cfyl-empty">ไม่มีข้อมูล</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
