'use client';

import { useCallback, useEffect, useState } from 'react';

interface Opt { id: string; name: string; code?: string }
interface Group { id: string; name: string }
interface TeamOpt { id: string; name: string; short_name?: string | null }
interface BracketMatch {
  id: string; bracket_position: number; status: string;
  home_team_id: string | null; away_team_id: string | null;
  home_source_ref: string | null; away_source_ref: string | null;
  round: { stage: string; name: string; sort_order: number } | null;
  home_team: { name: string; short_name?: string | null } | null;
  away_team: { name: string; short_name?: string | null } | null;
  match: { match_code: string; home_score: number | null; away_score: number | null; status: string; winner_team_id: string | null } | null;
}
interface PreviewSide { label: string; teamName: string | null; warning: string | null }
interface PreviewMatch { key: string; stage: string; position: number; home: PreviewSide; away: PreviewSide }

const authHeader = (): Record<string, string> => {
  const t = localStorage.getItem('admin_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};
const teamLabel = (t: { name: string; short_name?: string | null } | null) => (t ? (t.short_name ? `${t.name} (${t.short_name})` : t.name) : '');

export default function TournamentBracketPage() {
  const [seasons, setSeasons] = useState<Opt[]>([]);
  const [ageGroups, setAgeGroups] = useState<Opt[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [ageGroupId, setAgeGroupId] = useState('');

  const [rounds, setRounds] = useState<{ id: string; name: string; stage: string; sort_order: number }[]>([]);
  const [bms, setBms] = useState<BracketMatch[]>([]);

  const [size, setSize] = useState(4);
  const [mapping, setMapping] = useState<{ type: string; group: string; rank: string; teamId: string }[]>([]);
  const [preview, setPreview] = useState<PreviewMatch[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/public/seasons').then((r) => (r.ok ? r.json() : [])).then((l: Opt[]) => { setSeasons(l); if (l.length) setSeasonId(l[0].id); });
  }, []);
  useEffect(() => {
    if (!seasonId) return;
    setAgeGroupId('');
    fetch(`/api/public/age-groups?seasonId=${seasonId}`).then((r) => (r.ok ? r.json() : [])).then((l: Opt[]) => { setAgeGroups(l); if (l.length) setAgeGroupId(l[0].id); });
  }, [seasonId]);

  const loadBracket = useCallback(() => {
    if (!seasonId || !ageGroupId) return;
    fetch(`/api/admin/tournament-bracket?seasonId=${seasonId}&ageGroupId=${ageGroupId}`, { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : { rounds: [], bracketMatches: [] }))
      .then((d) => { setRounds(d.rounds); setBms(d.bracketMatches); });
  }, [seasonId, ageGroupId]);

  useEffect(() => {
    if (!seasonId || !ageGroupId) return;
    fetch(`/api/admin/tournament-groups?seasonId=${seasonId}&ageGroupId=${ageGroupId}`, { headers: authHeader() }).then((r) => (r.ok ? r.json() : [])).then(setGroups);
    fetch(`/api/public/teams?seasonId=${seasonId}&ageGroupId=${ageGroupId}`).then((r) => (r.ok ? r.json() : [])).then(setTeams);
  }, [seasonId, ageGroupId]);
  useEffect(() => { setPreview(null); loadBracket(); }, [loadBracket]);

  // reset mapping when size changes
  useEffect(() => {
    setMapping(Array.from({ length: size }, () => ({ type: 'group_rank', group: '', rank: '1', teamId: '' })));
    setPreview(null);
  }, [size]);

  const setMap = (i: number, patch: Partial<{ type: string; group: string; rank: string; teamId: string }>) =>
    setMapping((prev) => prev.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));

  const buildMappingPayload = () =>
    mapping.map((m) => m.type === 'direct_team'
      ? { type: 'direct_team', ref: m.teamId }
      : { type: 'group_rank', ref: `${m.group}:${m.rank}` });

  const runPreview = async () => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetch('/api/admin/tournament-bracket/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ seasonId, ageGroupId, size, mapping: buildMappingPayload() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'preview ไม่สำเร็จ');
      const d = await res.json();
      setPreview(d.matches); setWarnings(d.warnings || []);
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };

  const generate = async (force = false) => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetch('/api/admin/tournament-bracket/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ seasonId, ageGroupId, size, mapping: buildMappingPayload(), force }),
      });
      const d = await res.json();
      if (res.status === 409 && d.needsConfirm) {
        if (confirm(d.error)) return generate(true);
        return;
      }
      if (!res.ok) throw new Error(d.error || 'generate ไม่สำเร็จ');
      setMsg(`✅ สร้าง bracket: ${d.bracketMatches} แมตช์ (สร้างคู่จริง ${d.createdMatches})`);
      setPreview(null); loadBracket();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };

  const recalc = async () => {
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetch('/api/admin/tournament-bracket/recalculate-advancement', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ seasonId, ageGroupId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'recalc ไม่สำเร็จ');
      const d = await res.json();
      setMsg(`✅ เลื่อนสาย: อัปเดต ${d.advanced} ช่อง, สร้างแมตช์ใหม่ ${d.createdMatches}${d.warnings?.length ? ` · ⚠️ ${d.warnings.length} คำเตือน` : ''}`);
      setWarnings(d.warnings || []);
      loadBracket();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };

  const sel = 'px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
  const winnerName = (b: BracketMatch): string | null => {
    const m = b.match; if (!m || m.status !== 'finished' || m.home_score == null || m.away_score == null) return null;
    if (m.home_score > m.away_score) return teamLabel(b.home_team);
    if (m.away_score > m.home_score) return teamLabel(b.away_team);
    if (m.winner_team_id === b.home_team_id) return teamLabel(b.home_team);
    if (m.winner_team_id === b.away_team_id) return teamLabel(b.away_team);
    return null;
  };
  const side = (b: BracketMatch, which: 'home' | 'away') => {
    const t = which === 'home' ? b.home_team : b.away_team;
    if (t) return teamLabel(t);
    const ref = which === 'home' ? b.home_source_ref : b.away_source_ref;
    return <span className="text-slate-400">{ref || 'รอผล'}</span>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800">🏐 Tournament Bracket</h1>
        <p className="text-slate-600 mt-1 text-sm">สร้างรอบ Knockout จากอันดับรอบแบ่งกลุ่ม + เลื่อนสายผู้ชนะ</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Season</label>
          <select value={seasonId} onChange={(e) => setSeasonId(e.target.value)} className={sel}>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Age Group</label>
          <select value={ageGroupId} onChange={(e) => setAgeGroupId(e.target.value)} className={sel}>
            {ageGroups.map((a) => <option key={a.id} value={a.id}>{a.code || a.name}</option>)}
          </select>
        </div>
        {rounds.length > 0 && (
          <button onClick={recalc} disabled={busy} className="ml-auto px-4 py-2 bg-indigo-700 hover:bg-indigo-800 disabled:bg-indigo-300 text-white rounded-lg text-sm font-semibold">
            🔄 Recalculate Advancement
          </button>
        )}
      </div>

      {msg && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{msg}</div>}
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">❌ {error}</div>}
      {warnings.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
          {warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
        </div>
      )}

      {/* Current bracket */}
      {rounds.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {rounds.map((r) => (
            <div key={r.id} className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
              <h3 className="font-bold text-blue-900 mb-2">{r.name}</h3>
              <div className="space-y-2">
                {bms.filter((b) => b.round?.stage === r.stage).sort((a, b) => a.bracket_position - b.bracket_position).map((b) => (
                  <div key={b.id} className="border border-slate-100 rounded-lg p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span>{side(b, 'home')}</span>
                      <span className="font-bold text-blue-900 px-2">{b.match && b.match.home_score != null && b.match.away_score != null ? `${b.match.home_score}-${b.match.away_score}` : 'vs'}</span>
                      <span className="text-right">{side(b, 'away')}</span>
                    </div>
                    {winnerName(b) && <div className="text-xs text-green-700 mt-1">🏆 {winnerName(b)}</div>}
                    {b.match?.match_code && <div className="text-[11px] text-slate-400 mt-0.5">{b.match.match_code}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Setup / generate */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
        <h2 className="font-bold text-slate-800 mb-1">{rounds.length > 0 ? 'สร้าง Bracket ใหม่ (ทับของเดิม)' : 'สร้าง Bracket'}</h2>
        <p className="text-xs text-slate-500 mb-3">เลือกขนาด แล้วระบุแหล่งที่มาของแต่ละช่องในรอบแรก (อันดับกลุ่ม หรือ ทีมตรง)</p>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-semibold text-slate-600">ขนาด</span>
          {[4, 8, 16].map((n) => (
            <button key={n} onClick={() => setSize(n)} className={`px-3 py-1 rounded-full text-sm font-semibold ${size === n ? 'bg-blue-900 text-white' : 'bg-slate-100 text-slate-600'}`}>{n} ทีม</button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {mapping.map((m, i) => {
            const pair = Math.floor(i / 2) + 1;
            const isHome = i % 2 === 0;
            return (
              <div key={i} className="flex items-center gap-2 text-sm border border-slate-100 rounded-lg p-2">
                <span className="text-xs text-slate-500 w-20 shrink-0">คู่ {pair} {isHome ? 'เหย้า' : 'เยือน'}</span>
                <select value={m.type} onChange={(e) => setMap(i, { type: e.target.value })} className={`${sel} py-1`}>
                  <option value="group_rank">อันดับกลุ่ม</option>
                  <option value="direct_team">ทีมตรง</option>
                </select>
                {m.type === 'group_rank' ? (
                  <>
                    <select value={m.group} onChange={(e) => setMap(i, { group: e.target.value })} className={`${sel} py-1 flex-1`}>
                      <option value="">เลือกกลุ่ม...</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                    <select value={m.rank} onChange={(e) => setMap(i, { rank: e.target.value })} className={`${sel} py-1 w-20`}>
                      {[1, 2, 3, 4].map((n) => <option key={n} value={n}>อันดับ {n}</option>)}
                    </select>
                  </>
                ) : (
                  <select value={m.teamId} onChange={(e) => setMap(i, { teamId: e.target.value })} className={`${sel} py-1 flex-1`}>
                    <option value="">เลือกทีม...</option>
                    {teams.map((t) => <option key={t.id} value={t.id}>{teamLabel(t)}</option>)}
                  </select>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button onClick={runPreview} disabled={busy} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-semibold">Preview</button>
          <button onClick={() => generate(false)} disabled={busy} className="px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-green-300 text-white rounded-lg text-sm font-semibold">Generate Bracket</button>
        </div>

        {preview && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <h3 className="font-semibold text-slate-700 mb-2 text-sm">Preview</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {preview.map((p) => (
                <div key={p.key} className="border border-slate-100 rounded-lg p-2 text-sm">
                  <div className="text-xs text-blue-900 font-semibold mb-1">{p.key} · {p.stage}</div>
                  <div>{p.home.teamName || <span className="text-slate-400">{p.home.label}</span>}{p.home.warning && <span className="text-amber-600 text-[11px]"> ⚠️</span>}</div>
                  <div className="text-slate-400 text-xs">vs</div>
                  <div>{p.away.teamName || <span className="text-slate-400">{p.away.label}</span>}{p.away.warning && <span className="text-amber-600 text-[11px]"> ⚠️</span>}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
