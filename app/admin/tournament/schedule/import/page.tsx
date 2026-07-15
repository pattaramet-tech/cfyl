'use client';

import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';

interface TournamentOption {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface ImportMessage {
  severity: 'warning' | 'error';
  code: string;
  message: string;
}

interface ImportDiff {
  field: string;
  before: string | number | null;
  after: string | number | null;
}

interface PreviewRow {
  row: number;
  status: 'valid' | 'warning' | 'error';
  action: 'create' | 'update' | 'skip';
  match_code: string;
  normalized: {
    category_code: string;
    stage: string;
    venue_code: string;
    court_code: string;
    match_date: string;
    start_time: string;
    home_source_ref: string;
    away_source_ref: string;
  };
  messages: ImportMessage[];
  diff: ImportDiff[];
}

interface PreviewData {
  batchId: string;
  fileName: string;
  summary: {
    total: number;
    valid: number;
    warning: number;
    error: number;
    creatable: number;
  };
  results: PreviewRow[];
}

interface SaveData {
  batchId: string;
  status: string;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  failures: Array<{ row: number; match_code: string | null; error: string }>;
}

type SheetRow = Record<string, unknown>;

function getToken(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem('admin_token');
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function TournamentScheduleImportPage() {
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [tournamentId, setTournamentId] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [saveResult, setSaveResult] = useState<SaveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) {
      window.location.href = '/admin/login';
      return;
    }

    fetch('/api/tournament/admin/tournaments', {
      headers: authHeaders(),
      cache: 'no-store',
    })
      .then(async (response) => {
        if (response.status === 403) {
          throw new Error('ไม่มีสิทธิ์ใช้งาน Tournament V2');
        }
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || 'โหลด Tournament ไม่สำเร็จ');
        }
        return response.json();
      })
      .then((payload) => {
        const options = (payload.data || []) as TournamentOption[];
        setTournaments(options);
        if (options.length > 0) setTournamentId(options[0].id);
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'โหลด Tournament ไม่สำเร็จ');
      })
      .finally(() => setLoading(false));
  }, []);

  const downloadTemplate = async () => {
    setError('');
    const response = await fetch('/api/tournament/admin/schedule/template', {
      headers: authHeaders(),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      setError(payload?.error || 'ดาวน์โหลด Template ไม่สำเร็จ');
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tournament_v2_schedule_template.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  };

  const readFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError('');
    setPreview(null);
    setSaveResult(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) throw new Error('ไม่พบ Worksheet ในไฟล์');
      const worksheet = workbook.Sheets[firstSheetName];
      const parsedRows = XLSX.utils.sheet_to_json<SheetRow>(worksheet, {
        defval: '',
        raw: false,
      });
      if (parsedRows.length === 0) throw new Error('ไฟล์ไม่มีข้อมูลตารางแข่งขัน');
      setRows(parsedRows);
      setFileName(file.name);
    } catch (reason) {
      setRows([]);
      setFileName('');
      setError(reason instanceof Error ? reason.message : 'อ่านไฟล์ไม่สำเร็จ');
    }
  };

  const runPreview = async () => {
    if (!tournamentId || rows.length === 0) return;
    setBusy(true);
    setError('');
    setPreview(null);
    setSaveResult(null);

    try {
      const response = await fetch('/api/tournament/admin/schedule/import/preview', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tournamentId, fileName, rows }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Preview ไม่สำเร็จ');
      setPreview(payload.data as PreviewData);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Preview ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const saveImport = async () => {
    if (!preview || preview.summary.creatable === 0) return;
    if (!window.confirm(`ยืนยันบันทึก ${preview.summary.creatable} แถวที่ผ่านการตรวจสอบ?`)) return;

    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/tournament/admin/schedule/import/save', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ batchId: preview.batchId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'บันทึก Import ไม่สำเร็จ');
      setSaveResult(payload.data as SaveData);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'บันทึก Import ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="rounded-xl bg-white p-8 shadow-sm">กำลังโหลด Tournament V2...</div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">
            TOURNAMENT V2
          </span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
            Preview ก่อนบันทึก
          </span>
        </div>
        <h1 className="mt-3 text-3xl font-bold text-slate-900">Import ตารางแข่งขัน</h1>
        <p className="mt-2 text-slate-600">
          นำเข้า XLSX/CSV ด้วยรหัส Category, Venue, Court และ Placeholder โดยไม่ต้องทราบชื่อทีมจริงล่วงหน้า
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      {saveResult && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
          <h2 className="font-bold">บันทึกตารางแข่งขันเรียบร้อย</h2>
          <p className="mt-1 text-sm">
            สร้างใหม่ {saveResult.created} นัด · อัปเดต {saveResult.updated} นัด · ข้าม {saveResult.skipped} แถว
            {saveResult.failed > 0 ? ` · ล้มเหลว ${saveResult.failed} แถว` : ''}
          </p>
          <a
            href="/tournament/schedule"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            เปิดหน้าตารางแข่งขัน Public
          </a>
        </div>
      )}

      <section className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="grid gap-5 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Tournament</span>
            <select
              value={tournamentId}
              onChange={(event) => {
                setTournamentId(event.target.value);
                setPreview(null);
                setSaveResult(null);
              }}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {tournaments.length === 0 && <option value="">ยังไม่มี Tournament V2</option>}
              {tournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>
                  {tournament.name} ({tournament.status})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">ไฟล์ตารางแข่งขัน</span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={readFile}
              className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:font-semibold"
            />
          </label>

          <button
            type="button"
            onClick={downloadTemplate}
            className="rounded-lg border border-blue-600 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            ดาวน์โหลด Template
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5">
          <div className="text-sm text-slate-600">
            {fileName ? (
              <>
                <span className="font-semibold text-slate-900">{fileName}</span> · {rows.length} แถว
              </>
            ) : (
              'ยังไม่ได้เลือกไฟล์'
            )}
          </div>
          <button
            type="button"
            onClick={runPreview}
            disabled={busy || !tournamentId || rows.length === 0}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            {busy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบและ Preview'}
          </button>
        </div>
      </section>

      {preview && (
        <section className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              ['ทั้งหมด', preview.summary.total, 'bg-slate-100 text-slate-800'],
              ['ผ่าน', preview.summary.valid, 'bg-emerald-100 text-emerald-800'],
              ['คำเตือน', preview.summary.warning, 'bg-amber-100 text-amber-900'],
              ['ผิดพลาด', preview.summary.error, 'bg-red-100 text-red-800'],
              ['บันทึกได้', preview.summary.creatable, 'bg-blue-100 text-blue-800'],
            ].map(([label, value, className]) => (
              <div key={String(label)} className={`rounded-xl p-4 ${className}`}>
                <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
                <p className="mt-1 text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-bold text-slate-900">ผล Preview รายแถว</h2>
                <p className="text-sm text-slate-500">Error จะถูกข้าม ส่วน Warning บันทึกได้หลังยืนยัน</p>
              </div>
              <button
                type="button"
                onClick={saveImport}
                disabled={busy || preview.summary.creatable === 0 || !!saveResult}
                className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
              >
                {busy ? 'กำลังบันทึก...' : `ยืนยันบันทึก ${preview.summary.creatable} แถว`}
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-4 py-3">แถว</th>
                    <th className="px-4 py-3">สถานะ</th>
                    <th className="px-4 py-3">Match</th>
                    <th className="px-4 py-3">วัน/เวลา</th>
                    <th className="px-4 py-3">สนาม</th>
                    <th className="px-4 py-3">คู่แข่งขัน / Placeholder</th>
                    <th className="px-4 py-3">รายละเอียด</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.results.map((row) => (
                    <tr key={`${row.row}-${row.match_code}`} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{row.row}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                            row.status === 'valid'
                              ? 'bg-emerald-100 text-emerald-800'
                              : row.status === 'warning'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {row.status.toUpperCase()} · {row.action}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="font-semibold text-slate-900">{row.match_code || '—'}</div>
                        <div className="text-xs text-slate-500">
                          {row.normalized.category_code} · {row.normalized.stage}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {row.normalized.match_date || '—'}
                        <div className="text-xs text-slate-500">{row.normalized.start_time || '—'}</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {row.normalized.venue_code || '—'}
                        <div className="text-xs text-slate-500">{row.normalized.court_code || 'ไม่ระบุ Court'}</div>
                      </td>
                      <td className="min-w-52 px-4 py-3 text-slate-700">
                        <div>{row.normalized.home_source_ref || 'TBD'}</div>
                        <div className="my-0.5 text-xs text-slate-400">vs</div>
                        <div>{row.normalized.away_source_ref || 'TBD'}</div>
                      </td>
                      <td className="min-w-80 px-4 py-3">
                        {row.messages.length === 0 && row.diff.length === 0 && (
                          <span className="text-emerald-700">พร้อมบันทึก</span>
                        )}
                        {row.messages.map((message) => (
                          <div
                            key={`${message.code}-${message.message}`}
                            className={message.severity === 'error' ? 'text-red-700' : 'text-amber-800'}
                          >
                            {message.code}: {message.message}
                          </div>
                        ))}
                        {row.diff.length > 0 && (
                          <details className="mt-2 text-xs text-blue-700">
                            <summary className="cursor-pointer font-semibold">ดูค่าที่เปลี่ยน {row.diff.length} จุด</summary>
                            <div className="mt-1 space-y-1 text-slate-600">
                              {row.diff.map((item) => (
                                <div key={item.field}>
                                  {item.field}: {String(item.before ?? '—')} → {String(item.after ?? '—')}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
