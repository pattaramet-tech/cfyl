'use client';

import { useEffect, useState } from 'react';

interface Opt { id: string; name: string; code?: string }

const TYPES: Array<{ key: string; label: string }> = [
  { key: 'teams', label: '👥 Teams' },
  { key: 'players', label: '👤 Players' },
  { key: 'matches', label: '🎮 Matches' },
  { key: 'goals', label: '⚽ Goals' },
  { key: 'cards', label: '🟨 Cards' },
  { key: 'suspensions', label: '🚨 Suspensions' },
  { key: 'standings', label: '📊 Standings' },
  { key: 'tournament-groups', label: '🏆 Tournament Groups' },
  { key: 'bracket', label: '🏐 Knockout Bracket' },
];

export default function BackupPage() {
  const [seasons, setSeasons] = useState<Opt[]>([]);
  const [ageGroups, setAgeGroups] = useState<Opt[]>([]);
  const [divisions, setDivisions] = useState<Opt[]>([]);
  const [seasonId, setSeasonId] = useState('');
  const [ageGroupId, setAgeGroupId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/public/seasons')
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Opt[]) => {
        setSeasons(list);
        if (list.length) setSeasonId(list[0].id);
      });
  }, []);

  useEffect(() => {
    if (!seasonId) return;
    setAgeGroupId('');
    setDivisions([]);
    setDivisionId('');
    fetch(`/api/public/age-groups?seasonId=${seasonId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Opt[]) => setAgeGroups(list));
  }, [seasonId]);

  useEffect(() => {
    setDivisionId('');
    if (!seasonId || !ageGroupId) {
      setDivisions([]);
      return;
    }
    fetch(`/api/public/divisions?seasonId=${seasonId}&ageGroupId=${ageGroupId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Opt[]) => setDivisions(list));
  }, [seasonId, ageGroupId]);

  const download = async (type: string) => {
    if (!seasonId) {
      setError('กรุณาเลือก Season ก่อน');
      return;
    }
    setBusy(type);
    setError(null);
    try {
      const token = localStorage.getItem('admin_token');
      const params = new URLSearchParams({ seasonId, type });
      if (ageGroupId) params.set('ageGroupId', ageGroupId);
      if (divisionId) params.set('divisionId', divisionId);
      if (format === 'xlsx') params.set('format', 'xlsx');

      const res = await fetch(`/api/admin/backup/export?${params.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || 'Export ไม่สำเร็จ');
      }
      const blob = await res.blob();
      const ext = type === 'all' || format === 'xlsx' ? 'xlsx' : 'csv';
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cfyl_${type}_${stamp}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally {
      setBusy(null);
    }
  };

  const exportAll = () => {
    if (!seasonId) {
      setError('กรุณาเลือก Season ก่อน');
      return;
    }
    if (confirm('ยืนยัน Export ข้อมูลทั้งหมด (ทุกชนิด) เป็นไฟล์ Excel?')) {
      download('all');
    }
  };

  const selectClass =
    'px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800">💾 Backup / Export Center</h1>
        <p className="text-slate-600 mt-1 text-sm">สำรองข้อมูลสำคัญเป็น CSV / Excel</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Season</label>
            <select value={seasonId} onChange={(e) => setSeasonId(e.target.value)} className={selectClass}>
              <option value="">เลือก Season...</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Age Group (ไม่บังคับ)</label>
            <select value={ageGroupId} onChange={(e) => setAgeGroupId(e.target.value)} className={selectClass} disabled={!seasonId}>
              <option value="">ทุกรุ่น</option>
              {ageGroups.map((a) => <option key={a.id} value={a.id}>{a.code || a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Division (ไม่บังคับ)</label>
            <select value={divisionId} onChange={(e) => setDivisionId(e.target.value)} className={selectClass} disabled={!ageGroupId}>
              <option value="">ทุกดิวิชั่น</option>
              {divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <span className="text-sm font-semibold text-slate-600">รูปแบบไฟล์</span>
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            {(['csv', 'xlsx'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${format === f ? 'bg-white shadow text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {f === 'csv' ? 'CSV' : 'Excel'}
              </button>
            ))}
          </div>
          <span className="text-xs text-slate-400">CSV เปิดใน Excel ภาษาไทยไม่เพี้ยน (มี BOM)</span>
        </div>
      </div>

      {error && <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">❌ {error}</div>}

      {/* Export buttons */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <h2 className="font-semibold text-slate-800 mb-3">เลือกข้อมูลที่จะ Export</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {TYPES.map((t) => (
            <button
              key={t.key}
              onClick={() => download(t.key)}
              disabled={!seasonId || busy !== null}
              className="px-4 py-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-blue-50 hover:border-blue-200 text-slate-700 text-sm font-medium transition disabled:opacity-40 text-left"
            >
              {busy === t.key ? '⏳ กำลังสร้าง...' : t.label}
            </button>
          ))}
        </div>

        <div className="mt-4 pt-4 border-t border-slate-100">
          <button
            onClick={exportAll}
            disabled={!seasonId || busy !== null}
            className="px-5 py-2.5 rounded-lg bg-blue-900 hover:bg-blue-800 text-white text-sm font-semibold transition disabled:opacity-40"
          >
            {busy === 'all' ? '⏳ กำลังสร้างไฟล์...' : '📦 Export All (Excel)'}
          </button>
          <span className="text-xs text-slate-400 ml-2">รวมทุกชนิดเป็นไฟล์ Excel หลายชีต (มี confirm ก่อนโหลด)</span>
        </div>
      </div>
    </div>
  );
}
