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
      console.error('Failed to fetch seasons:', error);
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
      console.error('Failed to fetch age groups:', error);
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
    return <div className="text-center py-4">Loading...</div>;
  }

  return (
    <div className="mb-6 flex gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <label htmlFor="season" className="font-semibold text-gray-700">
          ฤดูกาล:
        </label>
        <select
          id="season"
          value={selectedSeason}
          onChange={handleSeasonChange}
          className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
          <label htmlFor="ageGroup" className="font-semibold text-gray-700">
            รุ่นอายุ:
          </label>
          <div className="flex gap-2">
            {ageGroups.map(ag => (
              <button
                key={ag.id}
                onClick={() => {
                  setSelectedAgeGroup(ag.id);
                  updateUrl(selectedSeason, ag.id);
                }}
                className={`px-4 py-2 rounded-lg font-semibold transition ${
                  selectedAgeGroup === ag.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
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
