'use client';

import { useCallback, useEffect, useState } from 'react';
import fallbackData from '@/data/tournament-meeting-fallback.json';

// CSS Variables for consistent theming
const cssVariables = `
  :root {
    --color-primary: #1e40af;
    --color-primary-dark: #1e3a8a;
    --color-primary-light: #3b82f6;
    --color-success: #16a34a;
    --color-success-dark: #15803d;
    --color-warning: #dc2626;
    --color-neutral-light: #f3f4f6;
    --color-neutral-border: #d1d5db;
    --color-text-primary: #111827;
    --color-text-secondary: #4b5563;
    --spacing-xs: 4px;
    --spacing-sm: 8px;
    --spacing-md: 12px;
    --spacing-lg: 16px;
    --spacing-xl: 24px;
    --spacing-2xl: 32px;
    --radius-sm: 6px;
    --radius-md: 8px;
    --radius-lg: 12px;
  }
`;

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

  if (!auth) return <div className="flex items-center justify-center min-h-screen">Loading...</div>;

  return (
    <div className="min-h-screen bg-slate-50" style={{ all: 'revert' }}>
      <style>{cssVariables}</style>

      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900 sm:text-4xl">
            ประชุมและจับฉลากแบ่งสาย
          </h1>
          <p className="mt-2 text-slate-600">
            เลือกรุ่นอายุและประเภทการแข่งขัน จากนั้นจัดเรียงทีมเข้ากลุ่มต่าง ๆ
          </p>
        </div>

        {/* Message Alert */}
        {message && (
          <div
            className={`mb-6 rounded-lg border-l-4 px-4 py-3 transition-all ${
              message.startsWith('✓')
                ? 'border-green-500 bg-green-50 text-green-800'
                : 'border-red-500 bg-red-50 text-red-800'
            }`}
            role="alert"
          >
            {message}
          </div>
        )}

        {/* Competition Selector Section */}
        <div className="mb-8 rounded-lg bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="grid gap-6 md:grid-cols-2">
            {/* Age Group Selector */}
            <div>
              <label className="mb-3 block text-sm font-semibold text-slate-700">
                เลือกรุ่นอายุ
              </label>
              <div className="flex flex-wrap gap-2">
                {fallbackData.categories.map((cat) => (
                  <button
                    key={cat.slug}
                    onClick={() => setSelectedCategory(cat.slug)}
                    aria-pressed={selectedCategory === cat.slug}
                    className={`rounded-md px-4 py-2.5 text-sm font-semibold transition-all duration-150 ${
                      selectedCategory === cat.slug
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                    } min-w-20 text-center`}
                  >
                    {cat.code}
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Competition Info */}
            {category && (
              <div className="rounded-lg bg-blue-50 p-4 ring-1 ring-blue-200">
                <h3 className="text-sm font-semibold text-slate-700">เลือกแล้ว</h3>
                <div className="mt-2 space-y-1">
                  <p className="text-base font-semibold text-slate-900">{category.name}</p>
                  <p className="text-sm text-slate-600">
                    <span className="font-medium">{category.teams_count}</span> ทีม •{' '}
                    <span className="font-medium">{category.groups_count}</span> กลุ่ม
                  </p>
                  <p className="text-sm text-slate-600">
                    สนาม:{' '}
                    <span className="font-medium">
                      {fallbackData.venues.find((v) => v.id === category.venue_id)?.name}
                    </span>
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center rounded-lg bg-white p-12 ring-1 ring-slate-200">
            <div className="flex flex-col items-center gap-2">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600"></div>
              <p className="text-slate-600">กำลังโหลดข้อมูล...</p>
            </div>
          </div>
        )}

        {/* Draw Board Section */}
        {!loading && (
          <>
            {/* Groups Grid */}
            <div className="mb-8 grid gap-6 sm:grid-cols-1 lg:grid-cols-2">
              {groups.map((group) => {
                const groupSizes = category?.group_sizes || [];
                const slotCount = groupSizes[groups.indexOf(group)] || 3;

                return (
                  <div
                    key={group}
                    className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200"
                  >
                    {/* Group Header */}
                    <div className="border-b border-slate-200 bg-slate-50 px-6 py-4">
                      <h3 className="text-lg font-bold text-slate-900">Group {group}</h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {slotCount} slot{slotCount !== 1 ? 's' : ''}
                      </p>
                    </div>

                    {/* Slots Container */}
                    <div className="space-y-3 p-6">
                      {Array.from({ length: slotCount }).map((_, i) => {
                        const slotCode = `${group}-S${i + 1}`;
                        const key = `${selectedCategory}-${slotCode}`;
                        const slot = slots[key];
                        const isAssigned = !!slot?.db_id;

                        return (
                          <div
                            key={i}
                            className={`rounded-md border-2 p-4 transition-all ${
                              isAssigned
                                ? 'border-green-300 bg-green-50'
                                : 'border-slate-200 bg-white'
                            }`}
                          >
                            {/* Slot Label */}
                            <div className="mb-3 flex items-center justify-between">
                              <label className="text-sm font-semibold text-slate-700">
                                {slotCode}
                              </label>
                              {isAssigned && (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-green-600"></span>
                                  บันทึก
                                </span>
                              )}
                            </div>

                            {/* Input Fields */}
                            <input
                              type="text"
                              placeholder="ชื่อทีม"
                              value={slot?.team_name || ''}
                              onChange={(e) =>
                                handleSlotChange(slotCode, 'team_name', e.target.value)
                              }
                              className="mb-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors"
                            />

                            <input
                              type="text"
                              placeholder="รหัสทีม"
                              value={slot?.team_code || ''}
                              onChange={(e) =>
                                handleSlotChange(slotCode, 'team_code', e.target.value)
                              }
                              className="mb-3 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors"
                            />

                            {/* Action Buttons */}
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleSaveSlot(group, i)}
                                disabled={saving || !slot?.team_name}
                                className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors duration-150"
                              >
                                บันทึก
                              </button>
                              <button
                                onClick={() => handleClearSlot(group, i)}
                                disabled={saving || !slot?.db_id}
                                className="flex-1 rounded-md bg-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-300 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors duration-150"
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

            {/* Action Bar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
              <a
                href="/tournament/meeting-draw"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors duration-150 text-center"
              >
                📊 เปิด Projector Display
              </a>
              <button
                onClick={handleExportCSV}
                className="rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors duration-150"
              >
                📥 Export CSV
              </button>
              <button
                onClick={handleExportJSON}
                className="rounded-md bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors duration-150"
              >
                📦 Export JSON
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
