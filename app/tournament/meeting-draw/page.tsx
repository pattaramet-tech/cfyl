'use client';

import { useEffect, useState } from 'react';
import fallbackData from '@/data/tournament-meeting-fallback.json';

interface DBAssignment {
  id: string;
  group_id: string;
  slot_code: string;
  tournament_teams: {
    name: string;
    team_code: string;
  };
}

interface SlotData {
  team_name: string;
  team_code: string;
}

export default function MeetingDrawDisplayPage() {
  const [selectedCategory, setSelectedCategory] = useState('b-u12');
  const [assignments, setAssignments] = useState<Record<string, SlotData>>({});
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const loadAssignments = async () => {
      const category = fallbackData.categories.find((c) => c.slug === selectedCategory);
      if (!category) {
        console.error('Category not found', { selectedCategory });
        return;
      }

      try {
        const params = new URLSearchParams({
          tournament_slug: fallbackData.tournament.slug,
          category_code: category.code,
        });

        const res = await fetch(`/api/tournament/public/draw-assignments?${params.toString()}`);
        if (res.ok) {
          const { data } = await res.json();
          const slots: Record<string, SlotData> = {};

          data.forEach((assignment: DBAssignment) => {
            const key = `${selectedCategory}-${assignment.slot_code}`;
            slots[key] = {
              team_name: assignment.tournament_teams.name,
              team_code: assignment.tournament_teams.team_code,
            };
          });

          setAssignments(slots);
        }
      } catch (err) {
        console.error('Failed to load assignments:', err);
      } finally {
        setLoading(false);
      }

      setLastUpdated(new Date().toLocaleTimeString('th-TH'));
    };

    loadAssignments();
    const interval = setInterval(loadAssignments, 4000);
    return () => clearInterval(interval);
  }, [selectedCategory]);

  const category = fallbackData.categories.find((c) => c.slug === selectedCategory);
  if (!category) return <div className="p-4 text-center text-white">Category not found</div>;

  const venue = fallbackData.venues.find((v) => v.id === category.venue_id);
  const groups = fallbackData.groups[selectedCategory as keyof typeof fallbackData.groups] || [];

  const handleRefresh = async () => {
    const cat = fallbackData.categories.find((c) => c.slug === selectedCategory);
    if (!cat) return;

    setLoading(true);
    const params = new URLSearchParams({
      tournament_slug: fallbackData.tournament.slug,
      category_code: cat.code,
    });

    try {
      const res = await fetch(`/api/tournament/public/draw-assignments?${params.toString()}`);
      if (res.ok) {
        const { data } = await res.json();
        const slots: Record<string, SlotData> = {};

        data.forEach((assignment: DBAssignment) => {
          const key = `${selectedCategory}-${assignment.slot_code}`;
          slots[key] = {
            team_name: assignment.tournament_teams.name,
            team_code: assignment.tournament_teams.team_code,
          };
        });

        setAssignments(slots);
      }
    } finally {
      setLastUpdated(new Date().toLocaleTimeString('th-TH'));
      setLoading(false);
    }
  };

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      document.documentElement.requestFullscreen?.().catch(() => {
        setIsFullscreen(true);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {
        setIsFullscreen(false);
      });
      setIsFullscreen(false);
    }
  };

  return (
    <div className={`min-h-screen bg-slate-50 text-slate-900 ${isFullscreen ? 'p-3' : 'p-4'}`}>
      <div className="mx-auto w-full" style={{ maxWidth: '100%', paddingLeft: isFullscreen ? '12px' : '16px', paddingRight: isFullscreen ? '12px' : '16px' }}>
        {/* Compact Header */}
        <div className={`mb-4 rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 ${isFullscreen ? 'mb-3 p-3' : ''}`}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className={`font-bold text-slate-900 ${isFullscreen ? 'text-2xl' : 'text-3xl'}`}>
                {category.name}
              </h1>
              <p className={`mt-1 text-slate-600 ${isFullscreen ? 'text-xs' : 'text-sm'}`}>
                {venue?.name} • {category.teams_count} ทีม • {category.groups_count} กลุ่ม
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className={`text-right text-slate-500 ${isFullscreen ? 'text-xs' : 'text-sm'}`}>
                อัปเดต: {lastUpdated || '—'}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={loading}
                  aria-label="รีเฟรชข้อมูล"
                  className={`rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                    isFullscreen ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
                  }`}
                >
                  {loading ? '⟳' : '🔄'}
                </button>
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label={isFullscreen ? 'ออกจากโหมดเต็มหน้าจอ' : 'เต็มหน้าจอ'}
                  className={`rounded bg-slate-600 text-white font-semibold hover:bg-slate-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 ${
                    isFullscreen ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'
                  }`}
                >
                  {isFullscreen ? '⛶' : '⛶'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Grid of Groups */}
        <div
          className={`grid gap-4 ${isFullscreen ? 'gap-3' : ''}`}
          style={{
            gridTemplateColumns: isFullscreen
              ? 'repeat(auto-fit, minmax(240px, 1fr))'
              : 'repeat(auto-fit, minmax(260px, 1fr))',
          }}
        >
          {groups.map((group) => {
            const groupSizes = category?.group_sizes || [];
            const slotCount = groupSizes[groups.indexOf(group)] || 3;

            return (
              <div key={group} className="overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
                {/* Group Header */}
                <div className={`border-b border-slate-200 bg-gradient-to-r from-blue-600 to-blue-700 text-white ${isFullscreen ? 'px-3 py-2' : 'px-4 py-3'}`}>
                  <h2 className={`font-bold text-center ${isFullscreen ? 'text-lg' : 'text-xl'}`}>
                    กลุ่ม {group}
                  </h2>
                  <p className={`text-center text-blue-100 ${isFullscreen ? 'text-xs mt-0.5' : 'text-xs mt-1'}`}>
                    {slotCount} ทีม
                  </p>
                </div>

                {/* Slots */}
                <div className={`space-y-1.5 ${isFullscreen ? 'p-2 space-y-1' : 'p-3'}`}>
                  {Array.from({ length: slotCount }).map((_, i) => {
                    const slotCode = `${group}-S${i + 1}`;
                    const key = `${selectedCategory}-${slotCode}`;
                    const assignment = assignments[key];
                    const hasTeam = !!assignment?.team_name;

                    return (
                      <div
                        key={i}
                        className={`rounded border-l-4 transition-colors ${
                          hasTeam
                            ? 'border-l-emerald-500 bg-emerald-50'
                            : 'border-l-slate-300 bg-slate-50'
                        } ${isFullscreen ? 'p-2' : 'p-2.5'}`}
                      >
                        <div className={`${isFullscreen ? 'text-xs' : 'text-xs'} font-medium ${hasTeam ? 'text-emerald-700' : 'text-slate-500'}`}>
                          {slotCode}
                        </div>
                        <div
                          className={`font-semibold text-slate-900 ${isFullscreen ? 'text-sm mt-0.5 line-clamp-2' : 'text-sm mt-1 line-clamp-2'}`}
                        >
                          {assignment?.team_name || 'รอจับฉลาก'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Category Navigation */}
        <div className={`flex items-center justify-center gap-2 ${isFullscreen ? 'mt-3' : 'mt-6'}`}>
          <button
            type="button"
            onClick={() => {
              const categories = fallbackData.categories.map((c) => c.slug);
              const currentIdx = categories.indexOf(selectedCategory);
              setSelectedCategory(categories[(currentIdx - 1 + categories.length) % categories.length]);
            }}
            className="rounded bg-slate-700 text-white font-semibold hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 px-3 py-1.5 text-sm"
          >
            ← ก่อนหน้า
          </button>
          <span className="text-slate-600 text-sm">
            {fallbackData.categories.findIndex((c) => c.slug === selectedCategory) + 1} /{' '}
            {fallbackData.categories.length}
          </span>
          <button
            type="button"
            onClick={() => {
              const categories = fallbackData.categories.map((c) => c.slug);
              const currentIdx = categories.indexOf(selectedCategory);
              setSelectedCategory(categories[(currentIdx + 1) % categories.length]);
            }}
            className="rounded bg-slate-700 text-white font-semibold hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 px-3 py-1.5 text-sm"
          >
            ถัดไป →
          </button>
        </div>
      </div>

      {/* Loading Indicator */}
      {loading && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white shadow-lg">
          <div className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-blue-300"></div>
          <span className="text-sm font-medium">กำลังโหลด...</span>
        </div>
      )}
    </div>
  );
}
