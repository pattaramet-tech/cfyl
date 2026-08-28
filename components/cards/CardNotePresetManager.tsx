'use client';

import { useState } from 'react';
import type { CardNotePreset } from '@/lib/card-note-presets';

interface CardNotePresetManagerProps {
  presets: CardNotePreset[];
  onChanged: () => Promise<void> | void;
  compact?: boolean;
}

export function CardNotePresetManager({
  presets,
  onChanged,
  compact = false,
}: CardNotePresetManagerProps) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('admin_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const addPreset = async () => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch('/api/admin/settings/card-note-presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ note }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'เพิ่มหมายเหตุสำเร็จรูปไม่สำเร็จ');
      setNote('');
      setSuccess('เพิ่มหมายเหตุสำเร็จรูปแล้ว');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เพิ่มหมายเหตุสำเร็จรูปไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const removePreset = async (preset: CardNotePreset) => {
    if (!confirm(`ลบหมายเหตุสำเร็จรูป “${preset.note}”?\nข้อมูลใบเหลือง/แดงเก่าจะไม่ถูกแก้ไข`)) return;
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const response = await fetch('/api/admin/settings/card-note-presets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ id: preset.id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'ลบหมายเหตุสำเร็จรูปไม่สำเร็จ');
      setSuccess('ลบหมายเหตุสำเร็จรูปแล้ว');
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบหมายเหตุสำเร็จรูปไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <div>
        <h3 className={compact ? 'text-sm font-semibold text-slate-800' : 'font-semibold text-slate-800'}>
          📝 หมายเหตุใบเหลือง/ใบแดงสำเร็จรูป
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          เป็นเพียงตัวเลือกช่วยกรอก หมายเหตุของใบโทษยังปล่อยว่างหรือพิมพ์ข้อความอื่นได้เสมอ
        </p>
      </div>

      {error && <div className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">❌ {error}</div>}
      {success && <div className="rounded border border-green-200 bg-green-50 p-2 text-xs text-green-700">✅ {success}</div>}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={busy}
          maxLength={200}
          placeholder="เช่น เล่นอันตราย, ประท้วงคำตัดสิน"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
        />
        <button
          type="button"
          onClick={() => void addPreset()}
          disabled={busy || !note.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-blue-300"
        >
          + เพิ่มรายการ
        </button>
      </div>

      {presets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">
          ยังไม่มีหมายเหตุสำเร็จรูป
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <span
              key={preset.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 py-1 pl-3 pr-1 text-xs text-slate-700"
            >
              <span className="truncate" title={preset.note}>{preset.note}</span>
              <button
                type="button"
                onClick={() => void removePreset(preset)}
                disabled={busy}
                className="rounded-full px-1.5 py-0.5 font-bold text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                aria-label={`ลบ ${preset.note}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
