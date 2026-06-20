'use client';

import { useState } from 'react';

interface Card {
  id: string;
  player_id: string;
  card_type: string;
  minute: number | null;
  note: string | null;
  player?: {
    id: string;
    full_name: string;
    shirt_no?: number | null;
    team?: { name: string; short_name: string };
  };
}

interface CardsInMatchPanelProps {
  cards: Card[];
  isLoading?: boolean;
  onCardsChanged?: () => void;
}

const CARD_CONFIG: Record<string, { emoji: string; label: string; pts: number; badgeClass: string }> = {
  yellow: {
    emoji: '🟨',
    label: 'ใบเหลือง',
    pts: 2,
    badgeClass: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  },
  second_yellow: {
    emoji: '🟨🟥',
    label: 'เหลือง 2',
    pts: 4,
    badgeClass: 'bg-orange-100 text-orange-800 border-orange-200',
  },
  red: {
    emoji: '🟥',
    label: 'ใบแดง',
    pts: 6,
    badgeClass: 'bg-red-100 text-red-800 border-red-200',
  },
};

const CARD_EDIT_OPTIONS = [
  { value: 'yellow', label: '🟨 ใบเหลือง (2pt)' },
  { value: 'second_yellow', label: '🟨🟥 เหลือง 2 (4pt)' },
  { value: 'red', label: '🟥 ใบแดง (6pt)' },
];

export function CardsInMatchPanel({
  cards,
  isLoading = false,
  onCardsChanged,
}: CardsInMatchPanelProps) {
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [editCardType, setEditCardType] = useState('');
  const [editMinute, setEditMinute] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isEditSaving, setIsEditSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const openEdit = (card: Card) => {
    setEditingCard(card);
    setEditCardType(card.card_type);
    setEditMinute(card.minute != null ? String(card.minute) : '');
    setEditNote(card.note ?? '');
    setEditError(null);
  };

  const closeEdit = () => {
    setEditingCard(null);
    setEditError(null);
  };

  const handleEditSave = async () => {
    if (!editingCard) return;
    setEditError(null);

    const minuteVal = editMinute !== '' ? parseInt(editMinute, 10) : null;
    if (minuteVal !== null && (isNaN(minuteVal) || minuteVal < 0 || minuteVal > 90)) {
      setEditError('นาทีต้องอยู่ระหว่าง 0–90');
      return;
    }

    setIsEditSaving(true);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/cards/${editingCard.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          cardType: editCardType,
          minute: minuteVal,
          note: editNote.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setEditError(data.error || 'เกิดข้อผิดพลาด');
        return;
      }

      closeEdit();
      onCardsChanged?.();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setIsEditSaving(false);
    }
  };

  const handleDelete = async (card: Card) => {
    const cfg = CARD_CONFIG[card.card_type];
    if (!confirm(`ลบ${cfg?.label || 'ใบโทษ'} ของ ${card.player?.full_name || 'ผู้เล่น'}?`)) return;

    setDeletingId(card.id);
    setListError(null);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/cards/${card.id}`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const data = await res.json();
        setListError(data.error || 'ลบไม่สำเร็จ');
        return;
      }
      onCardsChanged?.();
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'ลบไม่สำเร็จ');
    } finally {
      setDeletingId(null);
    }
  };

  // Sort: null minutes last
  const sorted = [...cards].sort((a, b) => {
    if (a.minute == null && b.minute == null) return 0;
    if (a.minute == null) return 1;
    if (b.minute == null) return -1;
    return a.minute - b.minute;
  });

  return (
    <div>
      <h3 className="font-semibold text-gray-800 text-base mb-3">
        🟨 ใบโทษในแมตช์{' '}
        <span className="font-normal text-gray-500 text-sm">({cards.length})</span>
      </h3>

      {listError && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          ❌ {listError}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-gray-500 text-sm">
          <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
          กำลังโหลด...
        </div>
      ) : cards.length === 0 ? (
        <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-gray-200 rounded-lg">
          ยังไม่มีใบโทษในแมตช์นี้
        </div>
      ) : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm" style={{ minWidth: '540px' }}>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 w-14">นาที</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">ผู้เล่น</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">ทีม</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 w-28">ประเภท</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500">เหตุผล</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-gray-500 w-24">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((card) => {
                const cfg = CARD_CONFIG[card.card_type];
                return (
                  <tr key={card.id} className="hover:bg-gray-50 transition">
                    <td className="px-3 py-2.5 text-center font-mono text-gray-700 font-semibold">
                      {card.minute != null ? `${card.minute}'` : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-gray-800">
                        {card.player?.full_name || '—'}
                      </span>
                      {card.player?.shirt_no != null && (
                        <span className="text-gray-400 ml-1 text-xs">
                          #{card.player.shirt_no}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs">
                      {card.player?.team?.name ||
                        card.player?.team?.short_name ||
                        '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      {cfg ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.badgeClass}`}
                        >
                          {cfg.emoji} {cfg.label}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">{card.card_type}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs max-w-[120px]">
                      <span className="block truncate" title={card.note ?? undefined}>
                        {card.note || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => openEdit(card)}
                          disabled={!!deletingId}
                          className="px-2 py-1 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-200 text-white rounded text-xs font-medium transition"
                        >
                          แก้ไข
                        </button>
                        <button
                          onClick={() => handleDelete(card)}
                          disabled={deletingId !== null}
                          className="px-2 py-1 bg-red-500 hover:bg-red-600 disabled:bg-gray-200 text-white rounded text-xs font-medium transition"
                        >
                          {deletingId === card.id ? '...' : 'ลบ'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit Modal */}
      {editingCard && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-gray-800">แก้ไขใบโทษ</h3>
              <button
                onClick={closeEdit}
                disabled={isEditSaving}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            {/* Player (read-only) */}
            <div className="p-3 bg-gray-50 rounded-lg text-sm">
              <p className="text-gray-400 text-xs mb-0.5">ผู้เล่น (ไม่สามารถเปลี่ยนได้)</p>
              <p className="font-semibold text-gray-800">
                {editingCard.player?.shirt_no != null ? `#${editingCard.player.shirt_no} ` : ''}
                {editingCard.player?.full_name || '—'}
              </p>
              {editingCard.player?.team?.name && (
                <p className="text-gray-500 text-xs">{editingCard.player.team.name}</p>
              )}
            </div>

            {/* Card type */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">ประเภทใบ</label>
              <div className="grid grid-cols-3 gap-2">
                {CARD_EDIT_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setEditCardType(value)}
                    disabled={isEditSaving}
                    className={`py-2 rounded-lg border-2 text-xs font-semibold transition text-center ${
                      editCardType === value
                        ? 'border-blue-500 bg-blue-50 text-blue-800'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    } disabled:opacity-50`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Minute */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                นาที <span className="text-gray-400 font-normal text-xs">(ถ้ามี)</span>
              </label>
              <input
                type="number"
                min={0}
                max={90}
                value={editMinute}
                onChange={(e) => setEditMinute(e.target.value)}
                disabled={isEditSaving}
                placeholder="—"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>

            {/* Note */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                เหตุผล <span className="text-gray-400 font-normal text-xs">(ถ้ามี)</span>
              </label>
              <input
                type="text"
                value={editNote}
                onChange={(e) => setEditNote(e.target.value)}
                disabled={isEditSaving}
                placeholder="เช่น เตะคู่แข่ง..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
            </div>

            {editError && (
              <div className="p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                ❌ {editError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={closeEdit}
                disabled={isEditSaving}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-700 rounded-lg text-sm font-medium transition"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleEditSave}
                disabled={isEditSaving}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg text-sm font-semibold transition"
              >
                {isEditSaving ? '⏳...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
