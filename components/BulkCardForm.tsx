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
          {/* Header */}
          <div className="hidden sm:grid grid-cols-[1fr_140px_60px_1fr_24px] gap-2 mb-1 px-1">
            <span className="text-xs text-gray-500 font-medium">ผู้เล่น</span>
            <span className="text-xs text-gray-500 font-medium">ประเภท</span>
            <span className="text-xs text-gray-500 font-medium">นาที</span>
            <span className="text-xs text-gray-500 font-medium">เหตุผล (ถ้ามี)</span>
            <span />
          </div>

          <div className="space-y-2">
            {rows.map((row, idx) => (
              <div key={row.rowId} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_60px_1fr_24px] gap-2 items-center">
                {/* Player */}
                <select
                  value={row.playerId}
                  onChange={(e) => updateRow(row.rowId, 'playerId', e.target.value)}
                  disabled={isSaving}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 disabled:bg-gray-100"
                  aria-label={`ผู้เล่นแถว ${idx + 1}`}
                >
                  <option value="">— ผู้เล่น —</option>
                  {homeTeamPlayers.length > 0 && (
                    <optgroup label={homeTeamName}>
                      {homeTeamPlayers.map((p) => (
                        <option key={p.id} value={p.id}>{playerOptionLabel(p)}</option>
                      ))}
                    </optgroup>
                  )}
                  {awayTeamPlayers.length > 0 && (
                    <optgroup label={awayTeamName}>
                      {awayTeamPlayers.map((p) => (
                        <option key={p.id} value={p.id}>{playerOptionLabel(p)}</option>
                      ))}
                    </optgroup>
                  )}
                </select>

                {/* Card type */}
                <select
                  value={row.cardType}
                  onChange={(e) => updateRow(row.rowId, 'cardType', e.target.value)}
                  disabled={isSaving}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 disabled:bg-gray-100"
                  aria-label={`ประเภทใบแถว ${idx + 1}`}
                >
                  {CARD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>

                {/* Minute */}
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={row.minute}
                  onChange={(e) => updateRow(row.rowId, 'minute', e.target.value)}
                  disabled={isSaving}
                  placeholder="—"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-yellow-400 disabled:bg-gray-100"
                  aria-label={`นาทีแถว ${idx + 1}`}
                />

                {/* Reason */}
                <input
                  type="text"
                  value={row.reason}
                  onChange={(e) => updateRow(row.rowId, 'reason', e.target.value)}
                  disabled={isSaving}
                  placeholder="เหตุผล (ถ้ามี)"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 disabled:bg-gray-100"
                  aria-label={`เหตุผลแถว ${idx + 1}`}
                />

                {/* Remove */}
                <button
                  type="button"
                  onClick={() => removeRow(row.rowId)}
                  disabled={isSaving || rows.length === 1}
                  className="text-red-400 hover:text-red-600 disabled:text-gray-300 text-sm font-bold justify-self-center"
                  title="ลบแถวนี้"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={addRow}
              disabled={isSaving}
              className="px-3 py-1.5 bg-white hover:bg-gray-50 disabled:bg-gray-100 border border-gray-300 text-gray-700 rounded text-sm"
            >
              + เพิ่มแถว
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || rows.every((r) => !r.playerId)}
              className="flex-1 px-3 py-1.5 bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-300 text-white rounded text-sm font-medium"
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
