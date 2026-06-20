'use client';

import { useEffect, useState, useCallback } from 'react';

interface Player {
  id: string;
  full_name: string;
  shirt_no?: number | null;
  team_id: string;
  team?: { name: string; short_name: string };
}

interface BulkCardRow {
  rowId: string;
  playerId: string;
  cardType: string;
  minute: string;
  reason: string;
}

interface BulkCardFormProps {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  onSuccess?: () => void;
}

const CARD_OPTIONS = [
  { value: 'yellow', label: '🟡 ใบเหลือง (2 pts)' },
  { value: 'second_yellow', label: '🟨🟨 ใบเหลือง 2 ใบ (4 pts)' },
  { value: 'red', label: '🔴 ใบแดง (6 pts)' },
];

let bulkCardRowCounter = 0;
const nextRowId = () => `bcard-${++bulkCardRowCounter}`;

export function BulkCardForm({ matchId, homeTeamId, awayTeamId, onSuccess }: BulkCardFormProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [rows, setRows] = useState<BulkCardRow[]>([
    { rowId: nextRowId(), playerId: '', cardType: 'yellow', minute: '', reason: '' },
  ]);
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
      if (!res.ok) throw new Error('Failed to load players');
      const data: Player[] = await res.json();
      data.sort((a, b) => {
        if (a.team_id !== b.team_id) return a.team_id === homeTeamId ? -1 : 1;
        return (a.shirt_no ?? 999) - (b.shirt_no ?? 999);
      });
      setPlayers(data);
    } catch (err) {
      console.error('[BULK_CARD_FORM] Load players error:', err);
    } finally {
      setPlayersLoading(false);
    }
  }, [homeTeamId, awayTeamId]);

  useEffect(() => { loadPlayers(); }, [loadPlayers]);

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { rowId: nextRowId(), playerId: '', cardType: 'yellow', minute: '', reason: '' },
    ]);
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const updateRow = (rowId: string, field: keyof BulkCardRow, value: string) => {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r))
    );
  };

  const handleSave = async () => {
    setError(null);
    setSuccessMsg(null);
    setSuspensionWarnings([]);

    const validRows = rows.filter((r) => r.playerId && r.cardType);
    if (validRows.length === 0) {
      setError('กรุณาเพิ่มผู้เล่นและประเภทใบโทษอย่างน้อย 1 รายการ');
      return;
    }

    // Validate minutes
    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      if (row.minute !== '') {
        const min = parseInt(row.minute, 10);
        if (isNaN(min) || min < 0 || min > 90) {
          setError(`แถวที่ ${i + 1}: minute ต้องอยู่ระหว่าง 0–90`);
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
            reason: r.reason || null,
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'เกิดข้อผิดพลาด');
        return;
      }

      setSuccessMsg(`บันทึกสำเร็จ — ${data.created} ใบโทษ`);

      if (data.suspensionWarnings && data.suspensionWarnings.length > 0) {
        setSuspensionWarnings(data.suspensionWarnings);
      }

      // Reset rows
      setRows([{ rowId: nextRowId(), playerId: '', cardType: 'yellow', minute: '', reason: '' }]);

      if (onSuccess) onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setIsSaving(false);
    }
  };

  const playerOptionLabel = (p: Player) =>
    `#${p.shirt_no ?? '—'} ${p.full_name} — ${p.team?.name || p.team?.short_name || ''}`;

  const homeTeamPlayers = players.filter((p) => p.team_id === homeTeamId);
  const awayTeamPlayers = players.filter((p) => p.team_id === awayTeamId);
  const homeTeamName = homeTeamPlayers[0]?.team?.name || 'ทีมเหย้า';
  const awayTeamName = awayTeamPlayers[0]?.team?.name || 'ทีมเยือน';

  return (
    <div className="mt-6 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
      <h3 className="font-semibold text-gray-800 mb-3">⚡ เพิ่มใบโทษหลายคน (Bulk)</h3>

      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="mb-3 p-3 bg-green-100 border border-green-300 rounded text-sm text-green-800">
          ✓ {successMsg}
        </div>
      )}
      {suspensionWarnings.length > 0 && (
        <div className="mb-3 p-3 bg-amber-50 border border-amber-300 rounded text-sm text-amber-800">
          <p className="font-semibold mb-1">⚠️ คำเตือน Suspension Calculation:</p>
          <ul className="space-y-0.5">
            {suspensionWarnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs">Cards ถูกบันทึกแล้ว แต่ suspension อาจต้องคำนวณใหม่ที่หน้า Suspensions</p>
        </div>
      )}

      {playersLoading ? (
        <p className="text-sm text-gray-500">กำลังโหลดผู้เล่น...</p>
      ) : (
        <>
          {/* Desktop header — hidden on mobile */}
          <div className="hidden lg:grid gap-3 mb-2 px-1" style={{ gridTemplateColumns: 'minmax(280px, 2fr) 160px 120px minmax(220px, 1fr) 48px' }}>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ผู้เล่น</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ประเภทใบ</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">นาที</span>
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">เหตุผล (ถ้ามี)</span>
            <span />
          </div>

          <div className="space-y-3">
            {rows.map((row, idx) => (
              <div key={row.rowId} className="bg-white border border-gray-200 rounded-lg p-3 lg:p-0 lg:border-0 lg:bg-transparent lg:rounded-none">
                {/* Mobile: card vertical layout / Desktop: single row grid */}
                <div className="flex flex-col gap-2 lg:grid lg:gap-3 lg:items-center" style={{ gridTemplateColumns: 'minmax(280px, 2fr) 160px 120px minmax(220px, 1fr) 48px' }}>

                  {/* Player */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1 lg:hidden">ผู้เล่น</label>
                    <select
                      value={row.playerId}
                      onChange={(e) => updateRow(row.rowId, 'playerId', e.target.value)}
                      disabled={isSaving}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 disabled:bg-gray-100 bg-white"
                      aria-label={`ผู้เล่นแถว ${idx + 1}`}
                    >
                      <option value="">— เลือกผู้เล่น —</option>
                      {homeTeamPlayers.length > 0 && (
                        <optgroup label={`🏠 ${homeTeamName}`}>
                          {homeTeamPlayers.map((p) => (
                            <option key={p.id} value={p.id}>{playerOptionLabel(p)}</option>
                          ))}
                        </optgroup>
                      )}
                      {awayTeamPlayers.length > 0 && (
                        <optgroup label={`✈️ ${awayTeamName}`}>
                          {awayTeamPlayers.map((p) => (
                            <option key={p.id} value={p.id}>{playerOptionLabel(p)}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>

                  {/* Card type */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1 lg:hidden">ประเภทใบ</label>
                    <select
                      value={row.cardType}
                      onChange={(e) => updateRow(row.rowId, 'cardType', e.target.value)}
                      disabled={isSaving}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 disabled:bg-gray-100 bg-white"
                      aria-label={`ประเภทใบแถว ${idx + 1}`}
                    >
                      {CARD_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Minute */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1 lg:hidden">นาที (ถ้ามี)</label>
                    <input
                      type="number"
                      min={0}
                      max={90}
                      value={row.minute}
                      onChange={(e) => updateRow(row.rowId, 'minute', e.target.value)}
                      disabled={isSaving}
                      placeholder="—"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-yellow-400 disabled:bg-gray-100"
                      aria-label={`นาทีแถว ${idx + 1}`}
                    />
                  </div>

                  {/* Reason */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1 lg:hidden">เหตุผล (ถ้ามี)</label>
                    <input
                      type="text"
                      value={row.reason}
                      onChange={(e) => updateRow(row.rowId, 'reason', e.target.value)}
                      disabled={isSaving}
                      placeholder="เหตุผล (ถ้ามี)"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 disabled:bg-gray-100"
                      aria-label={`เหตุผลแถว ${idx + 1}`}
                    />
                  </div>

                  {/* Remove */}
                  <div className="flex lg:justify-center">
                    <button
                      type="button"
                      onClick={() => removeRow(row.rowId)}
                      disabled={isSaving || rows.length === 1}
                      className="px-3 py-2 lg:px-0 lg:py-0 text-red-500 hover:text-red-700 disabled:text-gray-300 text-sm font-semibold transition lg:w-10 lg:h-10 lg:flex lg:items-center lg:justify-center lg:rounded-full lg:hover:bg-red-50"
                      title="ลบแถวนี้"
                    >
                      <span className="lg:hidden">✕ ลบแถวนี้</span>
                      <span className="hidden lg:inline text-base">✕</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mt-4">
            <button
              type="button"
              onClick={addRow}
              disabled={isSaving}
              className="px-4 py-2.5 bg-white hover:bg-gray-50 disabled:bg-gray-100 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium transition"
            >
              + เพิ่มแถว
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || rows.every((r) => !r.playerId)}
              className="flex-1 px-4 py-2.5 bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-300 text-white rounded-lg text-sm font-semibold transition"
            >
              {isSaving
                ? '⏳ กำลังบันทึก...'
                : `💾 บันทึกทั้งหมด (${rows.filter((r) => r.playerId).length} ใบ)`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
