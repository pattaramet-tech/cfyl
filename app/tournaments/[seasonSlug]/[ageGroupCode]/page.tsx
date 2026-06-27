'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TournamentSubNav } from '@/components/TournamentSubNav';

interface MatchRow {
  id: string; match_code: string; stage: string | null; match_date: string | null; match_time: string | null;
  venue: string | null; home_score: number | null; away_score: number | null; status: string;
  home_team: { name: string; short_name?: string | null } | null;
  away_team: { name: string; short_name?: string | null } | null;
  group: { name: string } | null;
}
interface Overview {
  season: { name: string; year: number }; ageGroup: { code: string; name: string };
  counts: { teams: number; groups: number; matches: number; finished: number };
  recent: MatchRow[]; upcoming: MatchRow[];
}

const tname = (t: { name: string; short_name?: string | null } | null) => (t ? t.name : 'TBD');

function MatchLine({ m, showScore }: { m: MatchRow; showScore: boolean }) {
  return (
    <div className="flex items-center gap-2 py-2 border-b border-slate-100 last:border-0 text-sm">
      <span className="text-[11px] text-slate-400 w-16 shrink-0">{m.group?.name || m.stage || ''}</span>
      <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <span className="text-right truncate text-slate-700">{tname(m.home_team)}</span>
        {showScore && m.home_score != null && m.away_score != null
          ? <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-900 font-bold text-xs whitespace-nowrap">{m.home_score} - {m.away_score}</span>
          : <span className="text-slate-400 text-xs">vs</span>}
        <span className="truncate text-slate-700">{tname(m.away_team)}</span>
      </div>
      <span className="text-[11px] text-slate-400 w-20 shrink-0 text-right">
        {m.match_date ? new Date(m.match_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : '—'}
      </span>
    </div>
  );
}

export default function TournamentOverviewPage() {
  const params = useParams();
  const slug = String(params.seasonSlug ?? '');
  const age = String(params.ageGroupCode ?? '');
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');

  useEffect(() => {
    setState('loading');
    fetch(`/api/public/tournaments/${slug}/${age}/overview`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setData(d); setState('ok'); } else setState('notfound'); })
      .catch(() => setState('notfound'));
  }, [slug, age]);

  return (
    <div className="space-y-6">
      <TournamentSubNav seasonSlug={slug} ageCode={age} active="overview" />
      {state === 'loading' ? (
        <div className="cfyl-loading"><span className="cfyl-spinner w-5 h-5" />กำลังโหลดข้อมูล...</div>
      ) : state === 'notfound' || !data ? (
        <div className="cfyl-section text-center space-y-3">
          <p className="text-slate-600">ไม่พบรายการ ({slug}/{age})</p>
          <Link href="/tournaments" className="cfyl-btn-secondary">กลับหน้าทัวร์นาเมนต์</Link>
        </div>
      ) : (
        <>
          <div className="cfyl-section">
            <h1 className="text-2xl font-bold text-slate-800">{data.season.name}</h1>
            <p className="text-sm text-slate-500">รุ่น {data.ageGroup.code} · {data.ageGroup.name}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <Stat label="ทีม" value={data.counts.teams} />
              <Stat label="กลุ่ม" value={data.counts.groups} />
              <Stat label="แมตช์" value={data.counts.matches} />
              <Stat label="แข่งแล้ว" value={data.counts.finished} />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="cfyl-section">
              <h2 className="cfyl-section-title mb-2">นัดล่าสุด</h2>
              {data.recent.length ? data.recent.map((m) => <MatchLine key={m.id} m={m} showScore />) : <p className="cfyl-empty">ยังไม่มีผลการแข่งขัน</p>}
            </div>
            <div className="cfyl-section">
              <h2 className="cfyl-section-title mb-2">นัดถัดไป</h2>
              {data.upcoming.length ? data.upcoming.map((m) => <MatchLine key={m.id} m={m} showScore={false} />) : <p className="cfyl-empty">ไม่มีนัดที่รอแข่ง</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
      <p className="text-2xl font-bold text-blue-900">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
