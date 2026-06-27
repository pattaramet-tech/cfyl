'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TournamentSubNav } from '@/components/TournamentSubNav';

interface BMatch {
  id: string; round_id: string; bracket_position: number;
  home_team_id: string | null; away_team_id: string | null;
  home_source_ref: string | null; away_source_ref: string | null;
  round: { stage: string; name: string; sort_order: number } | null;
  home_team: { name: string; short_name?: string | null } | null;
  away_team: { name: string; short_name?: string | null } | null;
  match: { match_code: string; stage: string | null; match_date: string | null; match_time: string | null; venue: string | null; home_score: number | null; away_score: number | null; status: string; winner_team_id: string | null } | null;
}
interface Round { id: string; name: string; stage: string; sort_order: number }

const tlabel = (t: { name: string; short_name?: string | null } | null) => (t ? (t.short_name ? `${t.name} (${t.short_name})` : t.name) : null);

function winnerName(b: BMatch): string | null {
  const m = b.match;
  if (!m || m.status !== 'finished' || m.home_score == null || m.away_score == null) return null;
  if (m.home_score > m.away_score) return tlabel(b.home_team);
  if (m.away_score > m.home_score) return tlabel(b.away_team);
  if (m.winner_team_id === b.home_team_id) return tlabel(b.home_team);
  if (m.winner_team_id === b.away_team_id) return tlabel(b.away_team);
  return null;
}

export default function TournamentBracketPage() {
  const params = useParams();
  const slug = String(params.seasonSlug ?? '');
  const age = String(params.ageGroupCode ?? '');
  const [rounds, setRounds] = useState<Round[]>([]);
  const [bms, setBms] = useState<BMatch[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');

  useEffect(() => {
    setState('loading');
    fetch(`/api/public/tournaments/${slug}/${age}/bracket`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setRounds(d.rounds || []); setBms(d.bracketMatches || []); setState('ok'); } else setState('notfound'); })
      .catch(() => setState('notfound'));
  }, [slug, age]);

  const sideName = (b: BMatch, which: 'home' | 'away') => {
    const t = which === 'home' ? b.home_team : b.away_team;
    if (t) return tlabel(t);
    return which === 'home' ? (b.home_source_ref || 'TBD') : (b.away_source_ref || 'TBD');
  };

  return (
    <div className="space-y-6">
      <TournamentSubNav seasonSlug={slug} ageCode={age} active="bracket" />
      {state === 'loading' ? (
        <div className="cfyl-loading"><span className="cfyl-spinner w-5 h-5" />กำลังโหลดข้อมูล...</div>
      ) : state === 'notfound' ? (
        <div className="cfyl-section text-center space-y-3">
          <p className="text-slate-600">ไม่พบรายการ</p>
          <Link href="/tournaments" className="cfyl-btn-secondary">กลับหน้าทัวร์นาเมนต์</Link>
        </div>
      ) : rounds.length === 0 ? (
        <div className="cfyl-empty">ยังไม่มีสายแข่งขัน (Knockout)</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rounds.map((r) => (
            <div key={r.id} className="cfyl-section">
              <h2 className="cfyl-section-title mb-3">{r.name}</h2>
              <div className="space-y-3">
                {bms.filter((b) => b.round?.stage === r.stage).sort((a, b) => a.bracket_position - b.bracket_position).map((b) => {
                  const w = winnerName(b);
                  const hasScore = b.match && b.match.home_score != null && b.match.away_score != null;
                  return (
                    <div key={b.id} className="border border-slate-200 rounded-lg p-3 text-sm">
                      <div className="grid grid-cols-[1fr_auto] items-center gap-1">
                        <span className={`truncate ${w && w === tlabel(b.home_team) ? 'font-bold text-blue-900' : 'text-slate-700'}`}>{sideName(b, 'home')}</span>
                        <span className="font-bold text-blue-900">{hasScore ? b.match!.home_score : ''}</span>
                        <span className={`truncate ${w && w === tlabel(b.away_team) ? 'font-bold text-blue-900' : 'text-slate-700'}`}>{sideName(b, 'away')}</span>
                        <span className="font-bold text-blue-900">{hasScore ? b.match!.away_score : ''}</span>
                      </div>
                      {w && <div className="text-xs text-green-700 mt-1.5">🏆 {w}</div>}
                      <div className="text-[11px] text-slate-400 mt-1">
                        {b.match?.match_code || '—'}
                        {b.match?.match_date ? ` · ${new Date(b.match.match_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}` : ''}
                        {b.match?.match_time ? ` ${b.match.match_time}` : ''}
                        {b.match?.venue ? ` · ${b.match.venue}` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
