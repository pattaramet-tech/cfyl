'use client';

import { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';

interface Opt { id: string; name: string; code?: string }
interface Group { id: string; name: string; code: string | null }
interface TeamOpt { id: string; name: string }
interface Fixture {
  id: string; match_code: string; matchday: string | null; stage: string | null;
  match_date: string | null; match_time: string | null; venue: string | null; status: string;
  home_score: number | null; away_score: number | null;
  home_team: { name: string } | null; away_team: { name: string } | null; group: { name: string } | null;
}
interface PreviewRow {
  row: number; status: 'valid' | 'error'; messages: string[];
  match_code: string; group: string; stage: string; datetime: string; venue: string; home: string; away: string;
}

const STAGES = ['group', 'round_of_16', 'quarter_final', 'semi_final', 'final', 'third_place'];
const TEMPLATE_HEADERS = ['season_slug', 'age_group', 'group', 'stage', 'match_code', 'matchday', 'date', 'time', 'venue', 'home_team_code', 'home_team', 'away_team_code', 'away_team'];

const authHeader = (): Record<string, string> => {
  const t = localStorage.getItem('admin_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};

const EMPTY_MANUAL = {
  groupId: '', stage: 'group', match_code: '', matchday: '', date: '', time: '', venue: '', home_team_id: '', away_team_id: '',
};

export default function TournamentFixturesPage() {
  const [seasons, setSeasons] = useState<Opt[]>([]);
  const [ageGroups, setAgeGroups] = useState<Opt[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [teams, setTeams] = useState<TeamOpt[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [ageGroupId, setAgeGroupId] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [stageFilter, setStageFilter] = useState('');

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [manual, setManual] = useState(EMPTY_MANUAL);
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // import
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    fetch('/api/public/seasons').then((r) => (r.ok ? r.json() : [])).then((l: Opt[]) => {
      setSeasons(l); if (l.length) setSeasonId(l[0].id);
    });
  }, []);

  useEffect(() => {
    if (!seasonId) return;
    setAgeGroupId('');
    fetch(`/api/public/age-groups?seasonId=${seasonId}`).then((r) => (r.ok ? r.json() : [])).then((l: Opt[]) => {
      setAgeGroups(l); if (l.length) setAgeGroupId(l[0].id);
    });
  }, [seasonId]);

  const loadFixtures = useCallback(() => {
    if (!seasonId || !ageGroupId) return;
    let url = `/api/admin/tournament-fixtures?seasonId=${seasonId}&ageGroupId=${ageGroupId}`;
    if (groupFilter) url += `&groupId=${groupFilter}`;
    if (stageFilter) url += `&stage=${stageFilter}`;
    fetch(url, { headers: authHeader() }).then((r) => (r.ok ? r.json() : [])).then(setFixtures);
  }, [seasonId, ageGroupId, groupFilter, stageFilter]);

  useEffect(() => {
    if (!seasonId || !ageGroupId) return;
    fetch(`/api/admin/tournament-groups?seasonId=${seasonId}&ageGroupId=${ageGroupId}`, { headers: authHeader() })
      .then((r) => (r.ok ? r.json() : [])).then(setGroups);
    fetch(`/api/public/teams?seasonId=${seasonId}&ageGroupId=${ageGroupId}`)
      .then((r) => (r.ok ? r.json() : [])).then(setTeams);
  }, [seasonId, ageGroupId]);

  useEffect(() => { loadFixtures(); }, [loadFixtures]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000); };

  const addManual = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/admin/tournament-fixtures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ seasonId, ageGroupId, ...manual }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'สร้างแมตช์ไม่สำเร็จ');
      flash('✅ สร้างแมตช์สำเร็จ');
      setManual({ ...EMPTY_MANUAL, stage: manual.stage, groupId: manual.groupId });
      loadFixtures();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };

  const deleteFixture = async (f: Fixture) => {
    if (!confirm(`ลบแมตช์ "${f.match_code}"?`)) return;
    setError(null);
    const res = await fetch(`/api/admin/tournament-fixtures/${f.id}`, { method: 'DELETE', headers: authHeader() });
    if (!res.ok) { setError((await res.json()).error || 'ลบไม่สำเร็จ'); return; }
    loadFixtures();
  };

  const downloadTemplate = async () => {
    const res = await fetch('/api/admin/tournament-fixtures/template', { headers: authHeader() });
    if (!res.ok) { setError('ดาวน์โหลด template ไม่สำเร็จ'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'tournament_matches_template.xlsx'; a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setPreview(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', raw: false });
      if (rows.length === 0) { setError('ไฟล์ไม่มีข้อมูล'); return; }
      setImportRows(rows);
      setImporting(true);
      const res = await fetch('/api/admin/tournament-fixtures/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ seasonId, ageGroupId, rows }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'preview ไม่สำเร็จ');
      const data = await res.json();
      setPreview(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อ่านไฟล์ไม่สำเร็จ');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };

  const saveImport = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/admin/tournament-fixtures/import/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ seasonId, ageGroupId, rows: importRows }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'บันทึกไม่สำเร็จ');
      const data = await res.json();
      flash(`✅ บันทึก ${data.saved} แมตช์ (ข้าม ${data.skipped})`);
      setPreview(null); setImportRows([]);
      loadFixtures();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };

  const sel = 'px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
  const validCount = preview?.filter((r) => r.status === 'valid').length ?? 0;
  const errorCount = preview?.filter((r) => r.status === 'error').length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800">📅 Tournament Fixtures</h1>
        <p className="text-slate-600 mt-1 text-sm">จัดโปรแกรมแข่งทัวร์นาเมนต์ — เพิ่มเอง หรือ import จาก Excel</p>
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
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Group</label>
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} className={sel}>
            <option value="">ทุกกลุ่ม</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Stage</label>
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className={sel}>
            <option value="">ทุก stage</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <button onClick={() => setShowManual((v) => !v)} className="px-4 py-2 bg-green-700 hover:bg-green-800 text-white rounded-lg text-sm font-semibold">
          ➕ เพิ่มแมตช์เอง
        </button>
      </div>

      {msg && <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{msg}</div>}
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">❌ {error}</div>}

      {/* Manual add */}
      {showManual && (
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
          <h2 className="font-bold text-slate-800 mb-3">เพิ่มแมตช์เอง</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Group (optional)</label>
              <select value={manual.groupId} onChange={(e) => setManual({ ...manual, groupId: e.target.value })} className={`${sel} w-full`}>
                <option value="">— ไม่ระบุ —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Stage</label>
              <select value={manual.stage} onChange={(e) => setManual({ ...manual, stage: e.target.value })} className={`${sel} w-full`}>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Match Code *</label>
              <input value={manual.match_code} onChange={(e) => setManual({ ...manual, match_code: e.target.value })} className={`${sel} w-full`} placeholder="CPAO-U14-GA-001" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">MatchDay</label>
              <input value={manual.matchday} onChange={(e) => setManual({ ...manual, matchday: e.target.value })} className={`${sel} w-full`} placeholder="Group A MD1" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Date</label>
              <input type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} className={`${sel} w-full`} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Time</label>
              <input type="time" value={manual.time} onChange={(e) => setManual({ ...manual, time: e.target.value })} className={`${sel} w-full`} />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Venue</label>
              <input value={manual.venue} onChange={(e) => setManual({ ...manual, venue: e.target.value })} className={`${sel} w-full`} placeholder="สนาม 1" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Home Team *</label>
              <select value={manual.home_team_id} onChange={(e) => setManual({ ...manual, home_team_id: e.target.value })} className={`${sel} w-full`}>
                <option value="">เลือกทีม...</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Away Team *</label>
              <select value={manual.away_team_id} onChange={(e) => setManual({ ...manual, away_team_id: e.target.value })} className={`${sel} w-full`}>
                <option value="">เลือกทีม...</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <button onClick={addManual} disabled={busy || !manual.match_code || !manual.home_team_id || !manual.away_team_id}
              className="px-4 py-2 bg-blue-700 hover:bg-blue-800 disabled:bg-blue-300 text-white rounded-lg text-sm font-semibold">
              บันทึกแมตช์
            </button>
          </div>
        </div>
      )}

      {/* Import */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h2 className="font-bold text-slate-800">นำเข้าจาก Excel / CSV</h2>
          <div className="flex items-center gap-2">
            <button onClick={downloadTemplate} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium">⬇️ Download Template</button>
            <label className="px-3 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-semibold cursor-pointer">
              📤 เลือกไฟล์ (.xlsx/.csv)
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
            </label>
          </div>
        </div>
        {importing && <p className="text-slate-500 text-sm">กำลังตรวจสอบไฟล์...</p>}
        {preview && (
          <>
            <div className="flex items-center gap-3 mb-2 text-sm">
              <span className="text-green-700 font-semibold">✓ valid {validCount}</span>
              <span className="text-red-600 font-semibold">✕ error {errorCount}</span>
              <button onClick={saveImport} disabled={busy || validCount === 0}
                className="ml-auto px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-green-300 text-white rounded-lg text-sm font-semibold">
                บันทึก {validCount} แถวที่ valid
              </button>
              <button onClick={() => { setPreview(null); setImportRows([]); }} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm">ยกเลิก</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-2">#</th><th className="py-2 pr-2">สถานะ</th><th className="py-2 pr-2">match_code</th>
                    <th className="py-2 pr-2">group</th><th className="py-2 pr-2">stage</th><th className="py-2 pr-2">วันเวลา</th>
                    <th className="py-2 pr-2">venue</th><th className="py-2 pr-2">คู่แข่ง</th><th className="py-2">หมายเหตุ</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.row} className={`border-b border-slate-100 ${r.status === 'error' ? 'bg-red-50' : ''}`}>
                      <td className="py-1.5 pr-2">{r.row}</td>
                      <td className="py-1.5 pr-2">{r.status === 'valid' ? <span className="text-green-700">✓</span> : <span className="text-red-600">✕</span>}</td>
                      <td className="py-1.5 pr-2 font-mono">{r.match_code}</td>
                      <td className="py-1.5 pr-2">{r.group}</td>
                      <td className="py-1.5 pr-2">{r.stage}</td>
                      <td className="py-1.5 pr-2">{r.datetime}</td>
                      <td className="py-1.5 pr-2">{r.venue}</td>
                      <td className="py-1.5 pr-2">{r.home} <span className="text-slate-400">vs</span> {r.away}</td>
                      <td className="py-1.5 text-red-600">{r.messages.join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Fixtures list */}
      <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4">
        <h2 className="font-bold text-slate-800 mb-3">แมตช์ ({fixtures.length})</h2>
        {fixtures.length === 0 ? (
          <p className="text-slate-400 text-sm py-6 text-center">ยังไม่มีแมตช์</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-2">match_code</th><th className="py-2 pr-2">MD</th><th className="py-2 pr-2">stage</th>
                  <th className="py-2 pr-2">group</th><th className="py-2 pr-2">วันเวลา</th><th className="py-2 pr-2">venue</th>
                  <th className="py-2 pr-2">คู่แข่ง</th><th className="py-2 pr-2">สกอร์</th><th className="py-2 pr-2">สถานะ</th><th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {fixtures.map((f) => (
                  <tr key={f.id} className="border-b border-slate-100">
                    <td className="py-2 pr-2 font-mono text-xs">{f.match_code}</td>
                    <td className="py-2 pr-2 text-xs">{f.matchday || '—'}</td>
                    <td className="py-2 pr-2 text-xs">{f.stage || '—'}</td>
                    <td className="py-2 pr-2 text-xs">{f.group?.name || <span className="text-slate-400">Group Stage</span>}</td>
                    <td className="py-2 pr-2 text-xs">{[f.match_date, f.match_time].filter(Boolean).join(' ') || 'TBD'}</td>
                    <td className="py-2 pr-2 text-xs">{f.venue || '—'}</td>
                    <td className="py-2 pr-2">{f.home_team?.name} <span className="text-slate-400">vs</span> {f.away_team?.name}</td>
                    <td className="py-2 pr-2 font-bold">{f.home_score != null && f.away_score != null ? `${f.home_score}-${f.away_score}` : '—'}</td>
                    <td className="py-2 pr-2 text-xs">{f.status}</td>
                    <td className="py-2 text-right"><button onClick={() => deleteFixture(f)} className="text-xs text-red-600 hover:underline">ลบ</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
