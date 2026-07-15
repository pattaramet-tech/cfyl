'use client';

import { useCallback, useEffect, useState } from 'react';
import fallbackData from '@/data/tournament-meeting-fallback.json';

interface DBAssignment {
  id: string;
  group_id: string;
  slot_code: string;
  team_id: string;
  tournament_teams: {
    name: string;
    team_code: string;
  };
}

interface SlotState {
  team_name: string;
  team_code: string;
  db_id?: string;
}

export default function MeetingDrawBoardPage() {
  const [auth, setAuth] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('b-u12');
  const [slots, setSlots] = useState<Record<string, SlotState>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const token = typeof window !== 'undefined' ? localStorage.getItem('admin_token') : null;

  useEffect(() => {
    const checkAuth = async () => {
      if (!token) {
        window.location.href = '/admin/login';
        return;
      }

      try {
        const res = await fetch('/api/tournament/admin/tournaments', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 403) {
          alert('ไม่มีสิทธิ์เข้าถึง');
          window.location.href = '/admin';
          return;
        }

        setAuth(res.ok);
      } catch (err) {
        console.error('Auth check failed:', err);
      }
    };

    checkAuth();
  }, [token]);

  const loadAssignments = useCallback(
    async (categorySlug: string) => {
      if (!token) return;

      const category = fallbackData.categories.find((c) => c.slug === categorySlug);
      if (!category) {
        console.error('Category not found', { categorySlug });
        return;
      }

      setLoading(true);
      try {
        const params = new URLSearchParams({
          tournament_slug: fallbackData.tournament.slug,
          category_code: category.code,
        });

        const response = await fetch(
          `/api/tournament/admin/draw-assignments?${params.toString()}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
        );

        if (response.ok) {
          const { data } = await response.json();
          const slots: Record<string, SlotState> = {};

          data.forEach((assignment: DBAssignment) => {
            const key = `${categorySlug}-${assignment.slot_code}`;
            slots[key] = {
              team_name: assignment.tournament_teams.name,
              team_code: assignment.tournament_teams.team_code,
              db_id: assignment.id,
            };
          });

          setSlots(slots);
        } else {
          const errorBody = await response.json().catch(() => null);
          console.error('Failed to load assignments', {
            status: response.status,
            error: errorBody,
            categoryCode: category.code,
          });
        }
      } catch (err) {
        console.error('Load assignments failed:', err);
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (auth) {
      // Loading data on category/auth change is the correct pattern here
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadAssignments(selectedCategory);
    }
  }, [auth, selectedCategory, loadAssignments]);

  if (!auth) return <div className="p-4">Loading...</div>;

  const category = fallbackData.categories.find((c) => c.slug === selectedCategory);
  if (!category) return <div className="p-4">Category not found</div>;

  const groups = fallbackData.groups[selectedCategory as keyof typeof fallbackData.groups] || [];

  const handleSlotChange = (slotCode: string, field: 'team_name' | 'team_code', value: string) => {
    const key = `${selectedCategory}-${slotCode}`;
    setSlots((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || { team_name: '', team_code: '' }),
        [field]: value,
      },
    }));
  };

  const handleSaveSlot = async (group: string, slotIndex: number) => {
    const slotCode = `${group}-S${slotIndex + 1}`;
    const key = `${selectedCategory}-${slotCode}`;
    const slot = slots[key];

    if (!slot?.team_name || !slot?.team_code) {
      setMessage('กรุณาใส่ชื่อทีมและรหัสทีม');
      setTimeout(() => setMessage(''), 4000);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/tournament/admin/draw-assignments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          tournament_slug: fallbackData.tournament.slug,
          category_code: category.code,
          group_code: group,
          slot_code: slotCode,
          team_name: slot.team_name,
          team_code: slot.team_code,
        }),
      });

      if (res.ok) {
        const { data } = await res.json();
        setSlots((prev) => ({
          ...prev,
          [key]: {
            ...prev[key],
            db_id: data.id,
          },
        }));
        setMessage(`✓ บันทึก ${slotCode} สำเร็จ`);
        setTimeout(() => setMessage(''), 3500);
      } else {
        const error = await res.json();
        setMessage(`❌ ${error.error || 'บันทึกล้มเหลว'}`);
        setTimeout(() => setMessage(''), 4000);
      }
    } catch (err) {
      setMessage(`❌ ${err instanceof Error ? err.message : 'Error'}`);
      setTimeout(() => setMessage(''), 4000);
    } finally {
      setSaving(false);
    }
  };

  const handleClearSlot = async (group: string, slotIndex: number) => {
    if (!window.confirm('ยืนยันการล้าง Slot นี้?')) return;

    const slotCode = `${group}-S${slotIndex + 1}`;
    const key = `${selectedCategory}-${slotCode}`;
    const assignment = slots[key];

    if (!assignment?.db_id) {
      setMessage('ไม่มีข้อมูลที่จะลบ');
      setTimeout(() => setMessage(''), 4000);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/tournament/admin/draw-assignments/${assignment.db_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setSlots((prev) => {
          const updated = { ...prev };
          delete updated[key];
          return updated;
        });
        setMessage(`✓ ล้าง ${slotCode} สำเร็จ`);
        setTimeout(() => setMessage(''), 3500);
      } else {
        setMessage('❌ ล้มเหลว');
        setTimeout(() => setMessage(''), 4000);
      }
    } catch (err) {
      setMessage(`❌ ${err instanceof Error ? err.message : 'Error'}`);
      setTimeout(() => setMessage(''), 4000);
    } finally {
      setSaving(false);
    }
  };

  const escapeCsvCell = (value: unknown): string => {
    const text = String(value ?? '');
    const escaped = text.replace(/"/g, '""');
    return /[",\r\n]/.test(text) ? `"${escaped}"` : escaped;
  };

  const handleExportCSV = () => {
    const venue = fallbackData.venues.find((v) => v.id === category?.venue_id);
    const rows: (string | number)[][] = [
      ['Category', 'Venue', 'Group', 'Slot', 'Team', 'Code'],
    ];

    groups.forEach((group) => {
      const groupSizes = category?.group_sizes || [];
      const slotCount = groupSizes[groups.indexOf(group)] || 3;

      for (let i = 0; i < slotCount; i++) {
        const slotCode = `${group}-S${i + 1}`;
        const key = `${selectedCategory}-${slotCode}`;
        const slot = slots[key];

        rows.push([
          category?.code || '',
          venue?.code || '',
          group,
          slotCode,
          slot?.team_name || '',
          slot?.team_code || '',
        ]);
      }
    });

    const csvContent = rows
      .map((row) => row.map(escapeCsvCell).join(','))
      .join('\r\n');

    const blob = new Blob(['﻿', csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `draw-${selectedCategory}-${new Date().toISOString().slice(0, 10)}.csv`);
    link.click();
  };

  const handleExportJSON = () => {
    const data = {
      category: selectedCategory,
      exported_at: new Date().toISOString(),
      assignments: Object.entries(slots).map(([key, slot]) => ({
        slot_code: key.split('-').slice(1).join('-'),
        team_name: slot.team_name,
        team_code: slot.team_code,
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `draw-${selectedCategory}-${new Date().toISOString().slice(0, 10)}.json`);
    link.click();
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <h1 className="text-3xl font-bold text-gray-900">Admin Draw Board</h1>

        {message && (
          <div
            className={`mt-4 rounded px-4 py-3 transition-opacity ${
              message.startsWith('✓') ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {message}
          </div>
        )}

        <div className="mt-6 flex gap-2 flex-wrap">
          {fallbackData.categories.map((cat) => (
            <button
              key={cat.slug}
              onClick={() => setSelectedCategory(cat.slug)}
              className={`rounded px-4 py-2 font-semibold transition-colors ${
                selectedCategory === cat.slug
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50'
              }`}
            >
              {cat.code}
            </button>
          ))}
        </div>

        {category && (
          <div className="mt-6">
            <h2 className="text-2xl font-bold text-gray-900">
              {category.name} ({category.teams_count} ทีม)
            </h2>
            <p className="mt-1 text-gray-600">
              {category.groups_count} กลุ่ม | สนาม: {fallbackData.venues.find((v) => v.id === category.venue_id)?.name}
            </p>
          </div>
        )}

        {loading ? (
          <div className="mt-8 text-center text-gray-600">กำลังโหลดข้อมูล...</div>
        ) : (
          <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {groups.map((group) => {
              const groupSizes = category?.group_sizes || [];
              const slotCount = groupSizes[groups.indexOf(group)] || 3;

              return (
                <div key={group} className="rounded-lg bg-white p-6 shadow">
                  <h3 className="text-xl font-bold text-gray-900">Group {group}</h3>
                  <p className="text-sm text-gray-500">Slots: {slotCount}</p>

                  <div className="mt-4 space-y-3">
                    {Array.from({ length: slotCount }).map((_, i) => {
                      const slotCode = `${group}-S${i + 1}`;
                      const key = `${selectedCategory}-${slotCode}`;
                      const slot = slots[key];

                      return (
                        <div key={i} className="border border-gray-200 rounded p-3 bg-gray-50">
                          <label className="block text-sm font-semibold text-gray-700">
                            {slotCode}
                            {slot?.db_id && <span className="ml-2 text-xs text-green-600">✓ บันทึก</span>}
                          </label>

                          <input
                            type="text"
                            placeholder="ชื่อทีม"
                            value={slot?.team_name || ''}
                            onChange={(e) => handleSlotChange(slotCode, 'team_name', e.target.value)}
                            className="mt-2 block w-full rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />

                          <input
                            type="text"
                            placeholder="รหัสทีม"
                            value={slot?.team_code || ''}
                            onChange={(e) => handleSlotChange(slotCode, 'team_code', e.target.value)}
                            className="mt-2 block w-full rounded border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />

                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={() => handleSaveSlot(group, i)}
                              disabled={saving || !slot?.team_name}
                              className="flex-1 rounded bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                            >
                              บันทึก
                            </button>
                            <button
                              onClick={() => handleClearSlot(group, i)}
                              disabled={saving || !slot?.db_id}
                              className="flex-1 rounded bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                            >
                              ล้าง
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-8 flex gap-4 flex-wrap">
          <a
            href="/tournament/meeting-draw"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-purple-600 px-6 py-3 font-semibold text-white hover:bg-purple-700 transition-colors"
          >
            เปิด Projector Display
          </a>
          <button
            onClick={handleExportCSV}
            className="rounded bg-green-600 px-6 py-3 font-semibold text-white hover:bg-green-700 transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={handleExportJSON}
            className="rounded bg-green-600 px-6 py-3 font-semibold text-white hover:bg-green-700 transition-colors"
          >
            Export JSON
          </button>
        </div>
      </div>
    </div>
  );
}
