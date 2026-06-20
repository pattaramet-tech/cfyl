'use client';

import { useEffect, useState, useCallback } from 'react';

interface Player {
  id: string;
  full_name: string;
  shirt_no?: number | null;
  team_id: string;
  team?: { name: string; short_name: string };
}

interface BulkRow {
  rowId: string;
  playerId: string;
  cardType: string;
  minute: string;
  note: string;
}

interface BulkAddCardFormProps {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  onSuccess?: () => void;
}

const CARD_OPTIONS = [
  { value: 'yellow', label: '🟨 ใบเหลือง (2pt)' },
  { value: 'second_yellow', label: '🟨🟥 เหลือง 2 (4pt)' },
  { value: 'red', label: '🟥 ใบแดง (6pt)' },
];

let rowCounter = 0;
const nextId = () => `bulkcard-${++rowCounter}`;
const emptyRow = (): BulkRow => ({ rowId: nextId(), playerId: '', cardType: 'yellow', minute: '', note: '' });

export function BulkAddCardForm({
  matchId,
  homeTeamId,
  awayTeamId,
  onSuccess,
}: BulkAddCardFormProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [rows, setRows] = useState<BulkRow[]>([emptyRow()]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [suspensionWarnings, setSuspensionWarnings] = useState<string[]>([]);

  const loadPlayers = useCallback(async () => {
    if (!homeTeamId || !awayTeamId) return;
    setPlayersLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(
        `/api/admin/players?teamIds=${encodeURIComponent(`${homeTeamId},${awayTeamId}`)}`,
        { headers: token ? { Authorization: `Bearer ${token}` } : {} }
      );
      if (!res.ok) return;
      const data: Player[] = await res.json();
      data.sort((a, b) => {
        if (a.team_id !== b.team_id) return a.team_id === homeTeamId ? -1 : 1;
        return (a.shirt_no ?? 999) - (b.shirt_no ?? 999);
      });
      setPlayers(data);
    } catch {
      // silent — user will see empty dropdown
    } finally {
      setPlayersLoading(false);
    }
  }, [homeTeamId, awayTeamId]);

  useEffect(() => { loadPlayers(); }, [loadPlayers]);

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const removeRow = (rowId: string) =>
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));

  const updateRow = (rowId: string, field: keyof BulkRow, value: string) =>
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r)));

  const clearAll = () => setRows([emptyRow()]);

  const handleSave = async () => {
    setError(null);
    setSuccessMsg(null);
    setSuspensionWarnings([]);

    const validRows = rows.filter((r) => r.playerId && r.cardType);
    if (validRows.length === 0) {
      setError('กรุณาเลือกผู้เล่นอย่างน้อย 1 แถว');
      return;
    }

    for (let i = 0; i < validRows.length; i++) {
      if (validRows[i].minute !== '') {
        const m = parseInt(validRows[i].minute, 10);
        if (isNaN(m) || m < 0 || m > 90) {
          setError(`แถวที่ ${i + 1}: นาทีต้องอยู่ระหว่าง 0–90`);
          return;
        }
      }
    }

    setIsSaving(true);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/cards/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          matchId,
          items: validRows.map((r) => ({
            playerId: r.playerId,
            cardType: r.cardType,
            minute: r.minute !== '' ? parseInt(r.minute, 10) : null,
            reason: r.note.trim() || null,
          })),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'เกิดข้อผิดพลาด');
        return;
      }

      setSuccessMsg(`✓ บันทึกสำเร็จ — ${data.created} ใบโทษ`);
      if (data.suspensionWarnings?.length) {
        setSuspensionWarnings(data.suspensionWarnings);
      }
      clearAll();
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setIsSaving(false);
    }
  };

  const homeTeamPlayers = players.filter((p) => p.team_id === homeTeamId);
  const awayTeamPlayers = players.filter((p) => p.team_id === awayTeamId);
  const homeTeamName = homeTeamPlayers[0]?.team?.name || 'ทีมเหย้า';
  const awayTeamName = awayTeamPlayers[0]?.team?.name || 'ทีมเยือน';
  const playerLabel = (p: Player) =>
    `#${p.shirt_no ?? '—'} ${p.full_name} — ${p.team?.name || p.team?.short_name || ''}`;

  const filledCount = rows.filter((r) => r.playerId).length;

  return (
    <div className="space-y-3">
      <h3 className="font-semibold text-gray-800 text-base">📋 เพิ่มหลายใบ (Bulk)</h3>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          ❌ {error}
        </div>
      )}
      {successMsg && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
          {successMsg}
        </div>
      )}
      {suspensionWarnings.length > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-800">
          <p className="font-semibold mb-1">⚠️ คำเตือน Suspension:</p>
          <ul className="space-y-0.5">
            {suspensionWarnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">Cards ถูกบันทึกแล้ว — ตรวจสถานะที่หน้า Suspensions</p>
        </div>
      )}

      {playersLoading ? (
        <p className="text-sm text-gray-500 py-2">กำลังโหลดผู้เล่น...</p>
      ) : (
        <>
          {/* Desktop column headers */}
          <div
            className="hidden lg:grid gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide px-1"
            style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.1fr) 90px minmax(0,1fr) 32px' }}
          >
            <span>ผู้เล่น</span>
            <span>ประเภท</span>
            <span className="text-center">นาที</span>
            <span>เหตุผล</span>
            <span />
          </div>

          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={row.rowId}
                className="bg-gray-50 lg:bg-transparent rounded-lg p-3 lg:p-0"
              >
                <div
                  className="flex flex-col gap-2 lg:grid lg:gap-2 lg:items-start"
                  style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1.1fr) 90px minmax(0,1fr) 32px' }}
                >
                  {/* Player */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1 lg:hidden">ผู้เล่น</label>
                    <select
                      value={row.playerId}
                      onChange={(e) => updateRow(row.rowId, 'playerId', e.target.value)}
                      disabled={isSaving}
                      className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100 bg-white"
                    >
                      <option value="">— เลือกผู้เล่น —</option>
                      {homeTeamPlayers.length > 0 && (
                        <optgroup label={`🏠 ${homeTeamName}`}>
                          {homeTeamPlayers.map((p) => (
                            <option key={p.id} value={p.id}>{playerLabel(p)}</option>
                          ))}
                        </optgroup>
                      )}
                      {awayTeamPlayers.length > 0 && (
                        <optgroup label={`✈️ ${awayTeamName}`}>
                          {awayTeamPlayers.map((p) => (
                            <option key={p.id} value={p.id}>{playerLabel(p)}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>

                  {/* Card type */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1 lg:hidden">ประเภท</label>
                    <select
                      value={row.cardType}
                      onChange={(e) => updateRow(row.rowId, 'cardType', e.target.value)}
                      disabled={isSaving}
                      className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100 bg-white"
                    >
                      {CARD_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Minute */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1 lg:hidden">นาที (ถ้ามี)</label>
                    <input
                      type="number"
                      min={0}
                      max={90}
                      value={row.minute}
                      onChange={(e) => updateRow(row.rowId, 'minute', e.target.value)}
                      disabled={isSaving}
                      placeholder="—"
                      className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
                    />
                  </div>

                  {/* Note */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1 lg:hidden">เหตุผล (ถ้ามี)</label>
                    <input
                      type="text"
                      value={row.note}
                      onChange={(e) => updateRow(row.rowId, 'note', e.target.value)}
                      disabled={isSaving}
                      placeholder="เหตุผล (ถ้ามี)"
                      className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
                    />
                  </div>

                  {/* Remove */}
                  <div className="flex lg:justify-center lg:pt-1.5">
                    <button
                      type="button"
                      onClick={() => removeRow(row.rowId)}
                      disabled={isSaving || rows.length === 1}
                      className="text-red-500 hover:text-red-700 disabled:text-gray-300 text-sm font-bold px-2 py-1 lg:px-0 rounded transition"
                      title="ลบแถว"
                    >
                      <span className="lg:hidden">✕ ลบ</span>
                      <span className="hidden lg:inline text-base">✕</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={addRow}
              disabled={isSaving}
              className="px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium transition"
            >
              + เพิ่มแถว
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={isSaving}
              className="px-3 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-500 rounded-lg text-sm transition"
            >
              🗑 ล้างทั้งหมด
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || filledCount === 0}
              className="flex-1 min-w-[160px] px-3 py-2 bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-300 text-white rounded-lg text-sm font-semibold transition"
            >
              {isSaving
                ? '⏳ กำลังบันทึก...'
                : `💾 บันทึกทั้งหมด (${filledCount} ใบ)`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
