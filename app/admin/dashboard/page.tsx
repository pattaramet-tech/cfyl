'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

interface MatchRow {
  id: string;
  matchday: string;
  matchdayNum: number;
  ageGroup: string;
  division: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  date: string | null;
  time: string | null;
  status: string;
}
interface Scorer { rank: number; player_id: string; full_name: string; shirt_no: number | null; team_name: string; total_goals: number }
interface MatchdayStat { matchday: number; total: number; finished: number; pending: number; goals: number; cards: number }
interface SuspensionRow {
  player_id: string; full_name: string; shirt_no: number | null; team_name: string; ageGroup: string;
  total_points: number; ban_matches: number; statusKey: string; statusLabel: string; statusColor: string; suspendedMatch: string | null;
}
interface Summary {
  season: { id: string; name: string; year: number; status: string; ageGroups: string[]; divisions: string[] } | null;
  activeSeasonCount: number;
  stats: { teams: number; players: number; matches: number; finishedMatches: number; pendingMatches: number; goals: number; cards: number; activeSuspensions: number };
  recentMatches: MatchRow[];
  upcomingMatches: MatchRow[];
  matchdays: MatchdayStat[];
  topScorers: { U14: Scorer[]; U17: Scorer[] };
  activeSuspensions: SuspensionRow[];
}

const QUICK_ACTIONS = [
  { href: '/admin/matches', label: 'บันทึกผลแข่ง', emoji: '🎮' },
  { href: '/admin/matches/manage', label: 'จัดการแมตช์', emoji: '⚙️' },
  { href: '/admin/goals', label: 'เพิ่มประตู', emoji: '⚽' },
  { href: '/admin/cards', label: 'เพิ่มใบเหลือง/แดง', emoji: '🟨' },
  { href: '/admin/suspensions', label: 'โทษแบน + Discord', emoji: '🚨' },
  { href: '/admin/exports', label: 'Copy Standings (Canva)', emoji: '📋' },
  { href: '/admin/backup', label: 'Backup / Export', emoji: '💾' },
  { href: '/admin/audit-logs', label: 'Audit Logs', emoji: '🧾' },
  { href: '/admin/settings', label: 'Settings', emoji: '⚙️' },
];

function StatCard({ label, value, accent, sub }: { label: string; value: number | string; accent: string; sub?: string }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm border-l-4 ${accent} p-4`}>
      <p className="text-slate-500 text-xs font-semibold">{label}</p>
      <p className="text-2xl font-bold text-slate-800 mt-1">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function MatchLine({ m, mode }: { m: MatchRow; mode: 'recent' | 'upcoming' }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0 text-sm">
      <span className="text-xs font-semibold text-blue-900 w-12 shrink-0">MD{m.matchdayNum}</span>
      <span className="text-[11px] text-slate-400 w-10 shrink-0">{m.ageGroup}</span>
      <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className="text-right truncate text-slate-700">{m.homeTeam}</span>
        {mode === 'recent' ? (
          <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-900 font-bold text-xs whitespace-nowrap">{m.homeScore} - {m.awayScore}</span>
        ) : (
          <span className="text-slate-400 text-xs">vs</span>
        )}
        <span className="truncate text-slate-700">{m.awayTeam}</span>
      </div>
      <span className="text-[11px] text-slate-400 w-24 shrink-0 text-right">
        {m.date ? new Date(m.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '—'}{m.time ? ` ${m.time}` : ''}
      </span>
    </div>
  );
}

export default function AdminDashboardPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMd, setSelectedMd] = useState<number | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      window.location.href = '/admin/login';
      return;
    }
    fetch('/api/admin/dashboard/summary', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'โหลดข้อมูลไม่สำเร็จ');
        return r.json();
      })
      .then((d: Summary) => {
        setData(d);
        if (d.matchdays.length) setSelectedMd(d.matchdays[d.matchdays.length - 1].matchday);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'error'))
      .finally(() => setLoading(false));
  }, []);

  const mdStat = useMemo(
    () => data?.matchdays.find((m) => m.matchday === selectedMd) || null,
    [data, selectedMd]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <p className="ml-3 text-slate-600">กำลังโหลด Dashboard...</p>
      </div>
    );
  }
  if (error || !data) {
    return <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">❌ {error || 'ไม่มีข้อมูล'}</div>;
  }

  const s = data.stats;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800">📊 ศูนย์ควบคุมวันแข่ง</h1>
          <p className="text-slate-600 mt-1 text-sm">ภาพรวมการแข่งขัน CFYL</p>
        </div>
      </div>

      {data.activeSeasonCount > 1 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
          ⚠️ มี active season มากกว่า 1 รายการ ({data.activeSeasonCount}) — ควรตั้งให้มีเพียงรายการเดียว
        </div>
      )}

      {/* 1. Overview stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="ทีมทั้งหมด" value={s.teams} accent="border-purple-500" />
        <StatCard label="นักกีฬา" value={s.players} accent="border-indigo-500" />
        <StatCard label="แมตช์ทั้งหมด" value={s.matches} accent="border-blue-500" sub={`แข่งแล้ว ${s.finishedMatches} · รอแข่ง ${s.pendingMatches}`} />
        <StatCard label="แข่งแล้ว" value={s.finishedMatches} accent="border-green-500" />
        <StatCard label="รอแข่ง" value={s.pendingMatches} accent="border-slate-400" />
        <StatCard label="ประตูรวม" value={s.goals} accent="border-orange-500" />
        <StatCard label="ใบเหลือง/แดงรวม" value={s.cards} accent="border-red-500" />
        <StatCard label="ติดโทษแบน (active)" value={s.activeSuspensions} accent="border-rose-600" />
      </div>

      {/* 2. Active season */}
      {data.season && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-xs text-slate-500">ฤดูกาลปัจจุบัน</p>
            <p className="text-lg font-bold text-blue-900">{data.season.name}</p>
          </div>
          <div><p className="text-xs text-slate-500">สถานะ</p><p className="font-semibold text-slate-700">{data.season.status}</p></div>
          <div><p className="text-xs text-slate-500">รุ่นอายุ</p><p className="font-semibold text-slate-700">{data.season.ageGroups.join(' / ') || '—'}</p></div>
          <div><p className="text-xs text-slate-500">ดิวิชั่น</p><p className="font-semibold text-slate-700">{data.season.divisions.join(' / ') || '—'}</p></div>
        </div>
      )}

      {/* 3 + 4. Recent / Upcoming */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-slate-800">🆕 แมตช์ล่าสุด</h2>
            <Link href="/admin/matches" className="text-xs text-blue-700 hover:underline">จัดการ →</Link>
          </div>
          {data.recentMatches.length ? data.recentMatches.map((m) => <MatchLine key={m.id} m={m} mode="recent" />) : <p className="text-slate-400 text-sm py-6 text-center">ยังไม่มีผลการแข่งขัน</p>}
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-bold text-slate-800">⏭️ แมตช์ถัดไป</h2>
            <Link href="/admin/matches" className="text-xs text-blue-700 hover:underline">แก้สกอร์ →</Link>
          </div>
          {data.upcomingMatches.length ? data.upcomingMatches.map((m) => <MatchLine key={m.id} m={m} mode="upcoming" />) : <p className="text-slate-400 text-sm py-6 text-center">ไม่มีแมตช์ที่รอแข่ง</p>}
        </div>
      </div>

      {/* 5. MatchDay summary */}
      {data.matchdays.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <h2 className="font-bold text-slate-800">📅 สรุป MatchDay</h2>
            <div className="flex flex-wrap gap-1.5">
              {data.matchdays.map((m) => (
                <button
                  key={m.matchday}
                  onClick={() => setSelectedMd(m.matchday)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${selectedMd === m.matchday ? 'bg-blue-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                >
                  MD{m.matchday}
                </button>
              ))}
            </div>
          </div>
          {mdStat && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <StatCard label="แมตช์" value={mdStat.total} accent="border-blue-500" />
              <StatCard label="แข่งแล้ว" value={mdStat.finished} accent="border-green-500" />
              <StatCard label="รอแข่ง" value={mdStat.pending} accent="border-slate-400" />
              <StatCard label="ประตู" value={mdStat.goals} accent="border-orange-500" />
              <StatCard label="ใบเหลือง/แดง" value={mdStat.cards} accent="border-red-500" />
            </div>
          )}
        </div>
      )}

      {/* 6. Top scorers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(['U14', 'U17'] as const).map((code) => (
          <div key={code} className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-slate-800">🏆 ดาวซัลโว {code}</h2>
              <Link href="/admin/goals" className="text-xs text-blue-700 hover:underline">เพิ่มประตู →</Link>
            </div>
            {data.topScorers[code].length ? (
              <ul className="divide-y divide-slate-100">
                {data.topScorers[code].map((sc) => (
                  <li key={sc.player_id} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-6 text-center font-bold text-blue-900">{sc.rank}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800 truncate">{sc.full_name}{sc.shirt_no ? <span className="text-xs text-slate-400 font-normal"> #{sc.shirt_no}</span> : null}</p>
                      <p className="text-xs text-slate-500 truncate">{sc.team_name}</p>
                    </div>
                    <span className="font-bold text-orange-600">{sc.total_goals}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-slate-400 text-sm py-6 text-center">ยังไม่มีข้อมูล</p>}
          </div>
        ))}
      </div>

      {/* 7. Active suspensions */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-slate-800">🚨 ผู้ติดโทษแบน (active)</h2>
          <Link href="/admin/suspensions" className="text-xs text-blue-700 hover:underline">ไปหน้าโทษแบน / ส่ง Discord →</Link>
        </div>
        {data.activeSuspensions.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3">ผู้เล่น</th><th className="py-2 pr-3">ทีม</th><th className="py-2 pr-3">รุ่น</th>
                  <th className="py-2 pr-3 text-center">คะแนน</th><th className="py-2 pr-3">สถานะ</th><th className="py-2">นัดที่แบน</th>
                </tr>
              </thead>
              <tbody>
                {data.activeSuspensions.map((r) => (
                  <tr key={r.player_id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-semibold text-slate-800">{r.full_name}{r.shirt_no ? <span className="text-xs text-slate-400 font-normal"> #{r.shirt_no}</span> : null}</td>
                    <td className="py-2 pr-3 text-slate-600 text-xs">{r.team_name}</td>
                    <td className="py-2 pr-3 text-slate-600">{r.ageGroup}</td>
                    <td className="py-2 pr-3 text-center font-bold text-rose-600">{r.total_points}</td>
                    <td className="py-2 pr-3"><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${r.statusColor}`}>{r.statusLabel}</span></td>
                    <td className="py-2 text-xs text-slate-600">{r.suspendedMatch || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-slate-400 text-sm py-6 text-center">ไม่มีผู้ติดโทษแบนในขณะนี้</p>}
      </div>

      {/* 8. Quick actions */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
        <h2 className="font-bold text-slate-800 mb-3">🚀 ทางลัด</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {QUICK_ACTIONS.map((a) => (
            <Link key={a.href} href={a.href} className="flex items-center gap-2 px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 transition text-sm font-medium text-slate-700">
              <span className="text-lg">{a.emoji}</span>
              <span>{a.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
