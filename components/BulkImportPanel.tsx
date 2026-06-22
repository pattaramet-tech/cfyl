'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';

export interface BulkColumn { key: string; label: string; placeholder?: string }

interface PreviewRow {
  row: number;
  status: 'valid' | 'warning' | 'error';
  messages: string[];
  cells: Record<string, string>;
}

interface Props {
  title: string;
  seasonId: string;
  ageGroupId: string;
  columns: BulkColumn[];
  previewUrl: string;
  saveUrl: string;
  templateUrl: string;
  templateFilename: string;
  hints?: string[];
  onSaved: () => void;
}

const authHeader = (): Record<string, string> => {
  const t = localStorage.getItem('admin_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
};
const emptyRow = (cols: BulkColumn[]) => Object.fromEntries(cols.map((c) => [c.key, c.key === 'active' ? 'true' : '']));

export function BulkImportPanel({ title, seasonId, ageGroupId, columns, previewUrl, saveUrl, templateUrl, templateFilename, hints = [], onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, string>[]>([emptyRow(columns), emptyRow(columns), emptyRow(columns)]);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [lastRows, setLastRows] = useState<Record<string, string>[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const setCell = (i: number, key: string, val: string) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));

  const runPreview = async (data: Record<string, string>[]) => {
    const nonEmpty = data.filter((r) => Object.entries(r).some(([k, v]) => k !== 'active' && String(v).trim()));
    if (nonEmpty.length === 0) { setError('ไม่มีข้อมูลแถวให้ตรวจสอบ'); return; }
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetch(previewUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ seasonId, ageGroupId, rows: nonEmpty }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'preview ไม่สำเร็จ');
      const d = await res.json();
      setPreview(d.results); setLastRows(nonEmpty);
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null); setPreview(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', raw: false });
      if (parsed.length === 0) { setError('ไฟล์ไม่มีข้อมูล'); return; }
      await runPreview(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'อ่านไฟล์ไม่สำเร็จ');
    } finally { e.target.value = ''; }
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(saveUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ seasonId, ageGroupId, rows: lastRows }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'บันทึกไม่สำเร็จ');
      const d = await res.json();
      setMsg(`✅ บันทึก ${d.saved} รายการ (ข้าม ${d.skipped})`);
      setPreview(null); setLastRows([]); setRows([emptyRow(columns), emptyRow(columns), emptyRow(columns)]);
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'error'); } finally { setBusy(false); }
  };

  const downloadTemplate = async () => {
    const res = await fetch(templateUrl, { headers: authHeader() });
    if (!res.ok) { setError('ดาวน์โหลด template ไม่สำเร็จ'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = templateFilename; a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = preview?.filter((r) => r.status !== 'error').length ?? 0;
  const errorCount = preview?.filter((r) => r.status === 'error').length ?? 0;
  const inp = 'w-full px-2 py-1 border border-slate-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="font-bold text-slate-800">📥 {title}</span>
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-4 border-t border-slate-100 space-y-3">
          {hints.length > 0 && (
            <ul className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg p-2 space-y-0.5">
              {hints.map((h, i) => <li key={i}>• {h}</li>)}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={downloadTemplate} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium">⬇️ Download Template</button>
            <label className="px-3 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-lg text-sm font-semibold cursor-pointer">
              📤 Import (.xlsx/.csv)
              <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
            </label>
            <button onClick={() => setRows((p) => [...p, emptyRow(columns)])} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm">+ เพิ่มแถว</button>
            <button onClick={() => setRows([emptyRow(columns)])} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm">ล้างทั้งหมด</button>
            <button onClick={() => runPreview(rows)} disabled={busy} className="ml-auto px-4 py-2 bg-indigo-700 hover:bg-indigo-800 disabled:bg-indigo-300 text-white rounded-lg text-sm font-semibold">Preview</button>
          </div>

          {msg && <div className="p-2 bg-green-50 border border-green-200 rounded text-green-700 text-sm">{msg}</div>}
          {error && <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">❌ {error}</div>}

          {/* Manual grid */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 pr-2 w-6">#</th>
                  {columns.map((c) => <th key={c.key} className="py-1 pr-2">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-1 pr-2 text-slate-400">{i + 1}</td>
                    {columns.map((c) => (
                      <td key={c.key} className="py-1 pr-2">
                        {c.key === 'active' ? (
                          <select value={r[c.key]} onChange={(e) => setCell(i, c.key, e.target.value)} className={inp}>
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        ) : (
                          <input value={r[c.key] ?? ''} onChange={(e) => setCell(i, c.key, e.target.value)} placeholder={c.placeholder} className={inp} />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Preview results */}
          {preview && (
            <div className="border-t border-slate-100 pt-3">
              <div className="flex items-center gap-3 mb-2 text-sm">
                <span className="text-green-700 font-semibold">✓ valid {validCount}</span>
                <span className="text-red-600 font-semibold">✕ error {errorCount}</span>
                <button onClick={save} disabled={busy || validCount === 0} className="ml-auto px-4 py-2 bg-green-700 hover:bg-green-800 disabled:bg-green-300 text-white rounded-lg text-sm font-semibold">
                  บันทึก {validCount} แถวที่ valid
                </button>
                <button onClick={() => setPreview(null)} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm">ปิด preview</button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-1 pr-2">#</th><th className="py-1 pr-2">สถานะ</th><th className="py-1 pr-2">ข้อมูล</th><th className="py-1">หมายเหตุ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((r) => (
                      <tr key={r.row} className={`border-b border-slate-100 ${r.status === 'error' ? 'bg-red-50' : r.status === 'warning' ? 'bg-amber-50' : ''}`}>
                        <td className="py-1 pr-2">{r.row}</td>
                        <td className="py-1 pr-2">{r.status === 'valid' ? <span className="text-green-700">✓</span> : r.status === 'warning' ? <span className="text-amber-600">⚠</span> : <span className="text-red-600">✕</span>}</td>
                        <td className="py-1 pr-2">{Object.values(r.cells).filter(Boolean).join(' · ')}</td>
                        <td className={`py-1 ${r.status === 'error' ? 'text-red-600' : 'text-amber-600'}`}>{r.messages.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
