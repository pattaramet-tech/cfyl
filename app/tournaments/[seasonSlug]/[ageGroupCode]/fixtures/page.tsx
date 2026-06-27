'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TournamentSubNav } from '@/components/TournamentSubNav';

interface MatchRow {
  id: string; match_code: string; matchday: string | null; stage: string | null;
  match_date: string | null; match_time: string | null; venue: string | null;
  home_score: number | null; away_score: number | null; status: string; tournament_group_id: string | null;
  home_team: { name: string; short_name?: string | null } | null;
  away_team: { name: string; short_name?: string | null } | null;
  group: { name: string } | null;
}

const tname = (t: { name: string } | null) => (t ? t.name : 'TBD');
const isKnockout = (s: string | null) => !!s && s !== 'group';

export default function TournamentFixturesPage() {
  const params = useParams();
  const slug = String(params.seasonSlug ?? '');
  const age = String(params.ageGroupCode ?? '');
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    setState('loading');
    fetch(`/api/public/tournaments/${slug}/${age}/fixtures`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setMatches(d.matches || []); setState('ok'); } else setState('notfound'); })
      .catch(() => setState('notfound'));
  }, [slug, age]);

  const groupNames = useMemo(() => {
    const m = new Map<string, string>();
    matches.forEach((x) => { if (x.tournament_group_id && x.group?.name) m.set(x.tournament_group_id, x.group.name); });
    return Array.from(m.entries());
  }, [matches]);

  const filtered = matches.filter((m) => {
    if (filter === 'all') return true;
    if (filter === 'knockout') return isKnockout(m.stage);
    return m.tournament_group_id === filter;
  });

  return (
    <div className="space-y-6">
      <TournamentSubNav seasonSlug={slug} ageCode={age} active="fixtures" />
      {state === 'loading' ? (
        <div className="cfyl-loading"><span className="cfyl-spinner w-5 h-5" />กำลังโหลดข้อมูล...</div>
      ) : state === 'notfound' ? (
        <div className="cfyl-section text-center space-y-3">
          <p className="text-slate-600">ไม่พบรายการ</p>
          <Link href="/tournaments" className="cfyl-btn-secondary">กลับหน้าทัวร์นาเมนต์</Link>
        </div>
      ) : (
        <div className="cfyl-section">
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button onClick={() => setFilter('all')} className={`cfyl-chip ${filter === 'all' ? 'cfyl-chip-active' : ''}`}>ทั้งหมด</button>
            {groupNames.map(([id, name]) => (
              <button key={id} onClick={() => setFilter(id)} className={`cfyl-chip ${filter === id ? 'cfyl-chip-active' : ''}`}>{name}</button>
            ))}
            <button onClick={() => setFilter('knockout')} className={`cfyl-chip ${filter === 'knockout' ? 'cfyl-chip-active' : ''}`}>น็อกเอาท์</button>
          </div>

          {filtered.length === 0 ? (
            <p className="cfyl-empty">ไม่พบโปรแกรมแข่งขัน</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((m) => (
                <div key={m.id} className="border border-slate-100 rounded-lg p-3">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                    <span>{m.group?.name || m.stage || ''} · {m.matchday || ''}</span>
                    <span>{m.match_date ? new Date(m.match_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) : 'TBD'}{m.match_time ? ` ${m.match_time}` : ''}{m.venue ? ` · ${m.venue}` : ''}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
                    <span className="text-right font-semibold text-slate-800 truncate">{tname(m.home_team)}</span>
                    {m.home_score != null && m.away_score != null
                      ? <span className="px-2.5 py-0.5 rounded bg-blue-900 text-white font-bold text-sm whitespace-nowrap">{m.home_score} - {m.away_score}</span>
                      : <span className="text-slate-400 text-xs px-2">vs</span>}
                    <span className="font-semibold text-slate-800 truncate">{tname(m.away_team)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
