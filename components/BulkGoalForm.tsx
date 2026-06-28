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
  goals: number;
  minute?: string;
}

interface BulkGoalFormProps {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  onSuccess?: () => void;
}

let rowCounter = 0;
const nextRowId = () => `row-${++rowCounter}`;

export function BulkGoalForm({ matchId, homeTeamId, awayTeamId, onSuccess }: BulkGoalFormProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [rows, setRows] = useState<BulkRow[]>([{ rowId: nextRowId(), playerId: '', goals: 1, minute: '' }]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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
      // Home team first, then sort by shirt_no within each team
      data.sort((a, b) => {
        if (a.team_id !== b.team_id) return a.team_id === homeTeamId ? -1 : 1;
        return (a.shirt_no ?? 999) - (b.shirt_no ?? 999);
      });
      setPlayers(data);
    } catch (err) {
      console.error('[BULK_GOAL_FORM] Load players error:', err);
    } finally {
      setPlayersLoading(false);
    }
  }, [homeTeamId, awayTeamId]);

  useEffect(() => { loadPlayers(); }, [loadPlayers]);

  const addRow = () => {
    setRows((prev) => [...prev, { rowId: nextRowId(), playerId: '', goals: 1, minute: '' }]);
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const updateRow = (rowId: string, field: 'playerId' | 'goals' | 'minute', value: string | number) => {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r))
    );
  };


  const handleSave = async () => {
    setError(null);
    setSuccessMsg(null);

    const validRows = rows.filter((r) => r.playerId);
    if (validRows.length === 0) {
      setError('กรุณาเพิ่มผู้เล่นอย่างน้อย 1 คน');
      return;
    }

    // Client-side validate minute 0-120
    for (const row of validRows) {
      // Validate minute if provided
      if (row.minute && row.minute.trim() !== '') {
        const m = Number(row.minute);
        if (isNaN(m) || !Number.isInteger(m) || m < 0 || m > 120) {
          setError('นาทีต้องเป็นตัวเลข 0-120 ต่อแถว');
          return;
        }
      }
    }

    setIsSaving(true);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/goals/bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          matchId,
          items: validRows.map((r) => ({
            playerId: r.playerId,
            goals: 1,
            minute: r.minute && r.minute.trim() !== '' ? Number(r.minute) : null,
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'เกิดข้อผิดพลาด');
        return;
      }

      setSuccessMsg(`✓ บันทึกสำเร็จ ${data.created || validRows.length} ประตู`);

      // Reset rows
      setRows([{ rowId: nextRowId(), playerId: '', goals: 1, minute: '' }]);

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
    <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
      <h3 className="font-semibold text-gray-800 mb-3">⚡ เพิ่มประตูหลายคน (Bulk)</h3>

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

      {playersLoading ? (
        <p className="text-sm text-gray-500">กำลังโหลดผู้เล่น...</p>
      ) : (
        <>
          <div className="space-y-2">
            {rows.map((row, idx) => (
              <div key={row.rowId} className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-5 text-right">{idx + 1}.</span>

                {/* Player select */}
                <select
                  value={row.playerId}
                  onChange={(e) => updateRow(row.rowId, 'playerId', e.target.value)}
                  disabled={isSaving}
                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-100"
                >
                  <option value="">— เลือกผู้เล่น —</option>
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

                {/* Minute input */}
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={row.minute ?? ''}
                  onChange={(e) => updateRow(row.rowId, 'minute', e.target.value)}
                  disabled={isSaving}
                  placeholder="นาที"
                  className="w-20 px-2 py-1.5 border border-gray-300 rounded text-sm text-center focus:outline-none focus:ring-2 focus:ring-green-400 disabled:bg-gray-100"
                />

                {/* Remove */}
                <button
                  type="button"
                  onClick={() => removeRow(row.rowId)}
                  disabled={isSaving || rows.length === 1}
                  className="px-2 py-1.5 text-red-500 hover:text-red-700 disabled:text-gray-300 text-sm"
                  title="ลบแถวนี้"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <p className="text-xs text-gray-500 mt-2">
            💡 ถ้านักเตะคนเดียวทำหลายประตู ให้เพิ่มหลายแถวแล้วเลือกคนเดิม พร้อมใส่นาทีแยกแต่ละลูก
          </p>

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
              className="flex-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:bg-green-300 text-white rounded text-sm font-medium"
            >
              {isSaving ? '⏳ กำลังบันทึก...' : `💾 บันทึกทั้งหมด (${rows.filter((r) => r.playerId).length} รายการ)`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
