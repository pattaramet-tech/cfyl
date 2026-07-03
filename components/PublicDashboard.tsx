'use client';

import { useEffect, useState } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: string;
  highlight?: boolean;
}

function StatCard({ label, value, icon, highlight = false }: StatCardProps) {
  return (
    <div className={`rounded-lg p-4 text-center ${highlight ? 'bg-blue-100 border border-blue-300' : 'bg-slate-50 border border-slate-200'}`}>
      <p className="text-2xl mb-1">{icon}</p>
      <p className={`font-semibold ${highlight ? 'text-blue-900' : 'text-slate-700'}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-1">{label}</p>
    </div>
  );
}

interface PublicDashboardProps {
  seasonId?: string;
  ageGroupId?: string;
  divisionId?: string;
}

export function PublicDashboard({ seasonId, ageGroupId, divisionId }: PublicDashboardProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (seasonId && ageGroupId) {
      fetchDashboard();
    }
  }, [seasonId, ageGroupId, divisionId]);

  const fetchDashboard = async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (seasonId) params.append('seasonId', seasonId);
      if (ageGroupId) params.append('ageGroupId', ageGroupId);
      if (divisionId) params.append('divisionId', divisionId);

      const res = await fetch(`/api/public/dashboard?${params}`);
      if (!res.ok) throw new Error('Failed to fetch dashboard');

      const dashData = await res.json();
      setData(dashData);
    } catch (err) {
      console.error('[PUBLIC_DASHBOARD] Error:', err);
      setError('ไม่สามารถโหลดข้อมูล Dashboard');
    } finally {
      setLoading(false);
    }
  };

  if (!seasonId || !ageGroupId) {
    return null;
  }

  if (loading) {
    return (
      <div className="cfyl-loading">
        <span className="cfyl-spinner w-5 h-5" />
        กำลังโหลด Dashboard...
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  return (
    <div className="cfyl-section space-y-6">
      <h2 className="cfyl-section-title">📊 ภาพรวมการแข่งขัน</h2>

      {/* Stat Cards Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="ประตูรวม" value={data.totals.goals} icon="⚽" highlight />
        <StatCard label="ใบเหลือง" value={data.totals.yellow_cards} icon="🟨" />
        <StatCard label="ใบแดง" value={data.totals.red_cards} icon="🟥" />
        <StatCard label="แข่งจบแล้ว" value={`${data.totals.finished_matches}/${data.totals.matches}`} icon="🏁" />
      </div>

      {/* Stat Cards Row 2 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="ทีมทั้งหมด" value={data.totals.teams} icon="👥" />
        <StatCard label="นักกีฬา" value={data.totals.players} icon="⚙️" />
        <StatCard label="ค่าเฉลี่ยประตู/แมตช์" value={data.derived.goals_per_finished_match.toFixed(1)} icon="📈" />
        <StatCard label="ความก้าวหน้า" value={`${data.derived.completion_percent}%`} icon="✅" />
      </div>

      {/* Additional Insights */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard label="Own Goal" value={data.totals.own_goals} icon="🔄" />
        <StatCard label="วินัยเจ้าหน้าที่" value={data.totals.staff_discipline_events} icon="⚠️" />
        <StatCard label="แมตช์เหลือ" value={data.totals.scheduled_matches} icon="⏳" />
      </div>

      {/* Highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Top Scorer */}
        <div className="bg-gradient-to-br from-yellow-50 to-amber-50 rounded-lg p-4 border border-yellow-200">
          <p className="text-2xl mb-2">🏆</p>
          <p className="text-xs text-yellow-600 font-semibold mb-1">ดาวซัลโวอันดับ 1</p>
          {data.leaders.top_scorer ? (
            <div>
              <p className="font-bold text-sm text-yellow-900">{data.leaders.top_scorer.full_name}</p>
              <p className="text-xs text-yellow-700">{data.leaders.top_scorer.team_name}</p>
              <p className="text-lg font-bold text-yellow-900 mt-2">{data.leaders.top_scorer.goals} ประตู</p>
            </div>
          ) : (
            <p className="text-sm text-yellow-700">ยังไม่มีข้อมูล</p>
          )}
        </div>

        {/* Top Scoring Team */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
          <p className="text-2xl mb-2">⚽</p>
          <p className="text-xs text-green-600 font-semibold mb-1">ทีมยิงเยอะสุด</p>
          {data.leaders.top_scoring_team ? (
            <div>
              <p className="font-bold text-sm text-green-900">{data.leaders.top_scoring_team.team_name}</p>
              <p className="text-lg font-bold text-green-900 mt-2">{data.leaders.top_scoring_team.goals} ประตู</p>
            </div>
          ) : (
            <p className="text-sm text-green-700">ยังไม่มีข้อมูล</p>
          )}
        </div>

        {/* Highest Scoring Match */}
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-4 border border-purple-200">
          <p className="text-2xl mb-2">💥</p>
          <p className="text-xs text-purple-600 font-semibold mb-1">คู่ยิงรวมสูงสุด</p>
          {data.leaders.highest_scoring_match ? (
            <div>
              <p className="font-semibold text-xs text-purple-900">
                {data.leaders.highest_scoring_match.home_team_name} vs{' '}
                {data.leaders.highest_scoring_match.away_team_name}
              </p>
              <p className="text-lg font-bold text-purple-900 mt-2">
                {data.leaders.highest_scoring_match.home_score}-{data.leaders.highest_scoring_match.away_score}
              </p>
              <p className="text-xs text-purple-700 mt-1">รวม {data.leaders.highest_scoring_match.total_goals} ประตู</p>
            </div>
          ) : (
            <p className="text-sm text-purple-700">ยังไม่มีข้อมูล</p>
          )}
        </div>
      </div>

      {/* Match Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Latest Finished Match */}
        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
          <p className="text-sm font-semibold text-slate-700 mb-3">📅 แมตช์ล่าสุดที่จบ</p>
          {data.latest_finished_match ? (
            <div>
              <p className="text-xs text-slate-500 mb-1">
                {data.latest_finished_match.match_date
                  ? new Date(data.latest_finished_match.match_date).toLocaleDateString('th-TH', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'ไม่ระบุวันที่'}
              </p>
              <p className="font-semibold text-slate-800 text-sm mb-2">
                {data.latest_finished_match.home_team_name} vs{' '}
                {data.latest_finished_match.away_team_name}
              </p>
              <p className="text-2xl font-bold text-slate-900">
                {data.latest_finished_match.home_score} - {data.latest_finished_match.away_score}
              </p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">ยังไม่มีแมตช์ที่จบ</p>
          )}
        </div>

        {/* Next Match */}
        <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
          <p className="text-sm font-semibold text-blue-700 mb-3">⏳ แมตช์ถัดไป</p>
          {data.next_match ? (
            <div>
              <p className="text-xs text-blue-600 mb-1">
                {data.next_match.match_date
                  ? new Date(data.next_match.match_date).toLocaleDateString('th-TH', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })
                  : 'ไม่ระบุวันที่'}
                {data.next_match.match_time && ` • ${data.next_match.match_time}`}
              </p>
              <p className="font-semibold text-blue-900 text-sm mb-2">
                {data.next_match.home_team_name} vs {data.next_match.away_team_name}
              </p>
            </div>
          ) : (
            <p className="text-sm text-blue-600">ไม่มีแมตช์ที่กำลังจะแข่งขัน</p>
          )}
        </div>
      </div>
    </div>
  );
}
