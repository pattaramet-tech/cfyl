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

  return (
    <div className="min-h-screen bg-black text-white p-4">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-5xl font-bold">{category.name}</h1>
            <p className="mt-2 text-2xl text-gray-300">
              {venue?.name} | {category.teams_count} ทีม | {category.groups_count} กลุ่ม
            </p>
          </div>
          <button
            onClick={async () => {
              const category = fallbackData.categories.find((c) => c.slug === selectedCategory);
              if (!category) return;

              setLoading(true);
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
              setLastUpdated(new Date().toLocaleTimeString('th-TH'));
              setLoading(false);
            }}
            className="rounded bg-blue-600 px-6 py-3 text-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            Refresh
          </button>
        </div>

        <div className="mt-4 flex justify-between items-center">
          <div className="text-right text-gray-400">Last updated: {lastUpdated}</div>
          {loading && <div className="text-yellow-300 text-sm">Loading...</div>}
        </div>

        <div className="mt-8 grid gap-6" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(300px, 1fr))` }}>
          {groups.map((group) => {
            const groupSizes = category?.group_sizes || [];
            const slotCount = groupSizes[groups.indexOf(group)] || 3;

            return (
              <div key={group} className="rounded-lg border-4 border-gray-600 bg-gray-900 p-6">
                <h2 className="text-4xl font-bold text-center mb-4">Group {group}</h2>

                <div className="space-y-3">
                  {Array.from({ length: slotCount }).map((_, i) => {
                    const slotCode = `${group}-S${i + 1}`;
                    const key = `${selectedCategory}-${slotCode}`;
                    const assignment = assignments[key];

                    return (
                      <div
                        key={i}
                        className={`rounded px-4 py-3 text-xl font-semibold border-2 transition-colors ${
                          assignment
                            ? 'bg-green-900 border-green-600 text-white'
                            : 'bg-gray-800 border-gray-600 text-gray-400'
                        }`}
                      >
                        <div className="text-lg text-gray-400">{slotCode}</div>
                        <div className="text-3xl mt-1">{assignment?.team_name || '—'}</div>
                        {assignment?.team_code && (
                          <div className="text-sm text-gray-300 mt-1">({assignment.team_code})</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8 text-center text-gray-500 text-sm">
          <button
            onClick={() => {
              const categories = fallbackData.categories.map((c) => c.slug);
              const currentIdx = categories.indexOf(selectedCategory);
              setSelectedCategory(categories[(currentIdx + 1) % categories.length]);
            }}
            className="rounded bg-gray-700 px-4 py-2 hover:bg-gray-600 transition-colors"
          >
            Next Category →
          </button>
        </div>
      </div>
    </div>
  );
}
