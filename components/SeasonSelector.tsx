'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Season, AgeGroup } from '@/types/db';

export function SeasonSelector() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string>(
    searchParams.get('season') || ''
  );
  const [selectedAgeGroup, setSelectedAgeGroup] = useState<string>(
    searchParams.get('ageGroup') || ''
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSeasons();
  }, []);

  useEffect(() => {
    if (selectedSeason) {
      fetchAgeGroups(selectedSeason);
    }
  }, [selectedSeason]);

  const fetchSeasons = async () => {
    try {
      const res = await fetch('/api/public/seasons');
      const data = await res.json();
      setSeasons(data);
      if (data.length > 0 && !selectedSeason) {
        setSelectedSeason(data[0].id);
      }
    } catch (error) {
      console.error('[SEASON_SELECTOR] Failed to fetch seasons:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAgeGroups = async (seasonId: string) => {
    try {
      const res = await fetch(`/api/public/age-groups?seasonId=${seasonId}`);
      const data = await res.json();
      setAgeGroups(data);
      if (data.length > 0 && !selectedAgeGroup) {
        setSelectedAgeGroup(data[0].id);
      }
    } catch (error) {
      console.error('[SEASON_SELECTOR] Failed to fetch age groups:', error);
    }
  };

  const handleSeasonChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSeason = e.target.value;
    setSelectedSeason(newSeason);
    setSelectedAgeGroup('');
    updateUrl(newSeason, '');
  };

  const handleAgeGroupChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newAgeGroup = e.target.value;
    setSelectedAgeGroup(newAgeGroup);
    updateUrl(selectedSeason, newAgeGroup);
  };

  const updateUrl = (season: string, ageGroup: string) => {
    const params = new URLSearchParams();
    if (season) params.set('season', season);
    if (ageGroup) params.set('ageGroup', ageGroup);
    router.push(`?${params.toString()}`);
  };

  if (loading) {
    return <div className="text-center py-4 text-slate-500">กำลังโหลด...</div>;
  }

  // Subtle age-group accent: U14 = amber, U17 = blue
  const ageAccent = (code: string, active: boolean): string => {
    if (!active) return 'cfyl-chip';
    const c = code.toUpperCase();
    if (c.includes('14')) return 'cfyl-chip bg-amber-500 text-white hover:bg-amber-500';
    if (c.includes('17')) return 'cfyl-chip bg-blue-700 text-white hover:bg-blue-700';
    return 'cfyl-chip cfyl-chip-active';
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
      <div className="flex items-center gap-2">
        <label htmlFor="season" className="text-sm font-semibold text-slate-600 whitespace-nowrap">
          ฤดูกาล
        </label>
        <select
          id="season"
          value={selectedSeason}
          onChange={handleSeasonChange}
          className="cfyl-select flex-1 sm:flex-none"
        >
          <option value="">-- เลือกฤดูกาล --</option>
          {seasons.map(season => (
            <option key={season.id} value={season.id}>
              {season.name}
            </option>
          ))}
        </select>
      </div>

      {ageGroups.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-600 whitespace-nowrap">รุ่นอายุ</span>
          <div className="flex gap-2">
            {ageGroups.map(ag => (
              <button
                key={ag.id}
                onClick={() => {
                  setSelectedAgeGroup(ag.id);
                  updateUrl(selectedSeason, ag.id);
                }}
                className={ageAccent(ag.code, selectedAgeGroup === ag.id)}
              >
                {ag.code}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
