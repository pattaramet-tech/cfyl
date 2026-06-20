'use client';

import { useState } from 'react';
import { PlayerSelector } from '@/components/PlayerSelector';

interface QuickAddCardFormProps {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  onSuccess?: () => void;
}

const CARD_TYPES = [
  { value: 'yellow', emoji: '🟨', label: 'ใบเหลือง', pts: 2, activeClass: 'border-yellow-500 bg-yellow-50 text-yellow-800' },
  { value: 'second_yellow', emoji: '🟨🟥', label: 'เหลือง 2', pts: 4, activeClass: 'border-orange-500 bg-orange-50 text-orange-800' },
  { value: 'red', emoji: '🟥', label: 'ใบแดง', pts: 6, activeClass: 'border-red-500 bg-red-50 text-red-800' },
];

export function QuickAddCardForm({
  matchId,
  homeTeamId,
  awayTeamId,
  onSuccess,
}: QuickAddCardFormProps) {
  const [playerId, setPlayerId] = useState('');
  const [cardType, setCardType] = useState('yellow');
  const [minute, setMinute] = useState('');
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!playerId) {
      setError('กรุณาเลือกผู้เล่น');
      return;
    }

    const minuteValue = minute !== '' ? parseInt(minute, 10) : null;
    if (minuteValue !== null && (isNaN(minuteValue) || minuteValue < 0 || minuteValue > 90)) {
      setError('นาทีต้องอยู่ระหว่าง 0–90');
      return;
    }

    setIsSaving(true);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/cards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          matchId,
          playerId,
          cardType,
          minute: minuteValue,
          note: note.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'เกิดข้อผิดพลาด');
        return;
      }

      setSuccessMsg('✓ บันทึกใบโทษแล้ว');
      // Reset fields
      setPlayerId('');
      setCardType('yellow');
      setMinute('');
      setNote('');
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h3 className="font-semibold text-gray-800 text-base">⚡ เพิ่มใบโทษ (Quick Add)</h3>

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

      {/* Player selector */}
      <PlayerSelector
        matchId={matchId}
        homeTeamId={homeTeamId}
        awayTeamId={awayTeamId}
        value={playerId}
        onSelect={setPlayerId}
        disabled={isSaving}
      />

      {/* Card type toggle buttons */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">ประเภทใบ</label>
        <div className="grid grid-cols-3 gap-2">
          {CARD_TYPES.map(({ value, emoji, label, pts, activeClass }) => (
            <button
              key={value}
              type="button"
              onClick={() => setCardType(value)}
              disabled={isSaving}
              className={`py-2.5 px-1 rounded-lg border-2 text-sm font-semibold transition text-center disabled:opacity-50 ${
                cardType === value
                  ? activeClass
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className="text-xl">{emoji}</div>
              <div className="text-xs leading-tight mt-0.5">{label}</div>
              <div className="text-xs text-gray-400">{pts} pts</div>
            </button>
          ))}
        </div>
      </div>

      {/* Minute + Note */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            นาที <span className="text-gray-400 font-normal text-xs">(ถ้ามี)</span>
          </label>
          <input
            type="number"
            min={0}
            max={90}
            value={minute}
            onChange={(e) => setMinute(e.target.value)}
            disabled={isSaving}
            placeholder="—"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            เหตุผล <span className="text-gray-400 font-normal text-xs">(ถ้ามี)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isSaving}
            placeholder="เช่น เตะคู่แข่ง..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={isSaving || !playerId}
        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg font-semibold text-sm transition"
      >
        {isSaving ? '⏳ กำลังบันทึก...' : '💾 บันทึกใบโทษ'}
      </button>
    </form>
  );
}
