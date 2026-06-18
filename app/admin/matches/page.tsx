'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Match } from '@/types/db';

interface MatchWithTeams extends Match {
  home_team?: { name: string };
  away_team?: { name: string };
}

export default function AdminMatchesPage() {
  const [matches, setMatches] = useState<MatchWithTeams[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<string>('');
  const [ageGroupId, setAgeGroupId] = useState<string>('');
  const [divisionId, setDivisionId] = useState<string>('');

  const [seasons, setSeasons] = useState<any[]>([]);
  const [ageGroups, setAgeGroups] = useState<any[]>([]);
  const [divisions, setDivisions] = useState<any[]>([]);

  // Load seasons on mount
  useEffect(() => {
    const loadSeasons = async () => {
      try {
        const res = await fetch('/api/public/seasons');
        const data = await res.json();
        setSeasons(data);
        if (data.length > 0) {
          setSeasonId(data[0].id);
        }
      } catch (error) {
        console.error('Load seasons error:', error);
      }
    };
    loadSeasons();
  }, []);

  // Load age groups when season changes
  useEffect(() => {
    if (!seasonId) return;

    const loadAgeGroups = async () => {
      try {
        const res = await fetch(`/api/public/age-groups?seasonId=${seasonId}`);
        const data = await res.json();
        setAgeGroups(data);
        if (data.length > 0) {
          setAgeGroupId(data[0].id);
        }
      } catch (error) {
        console.error('Load age groups error:', error);
      }
    };
    loadAgeGroups();
  }, [seasonId]);

  // Load divisions when age group changes
  useEffect(() => {
    if (!seasonId || !ageGroupId) return;

    const loadDivisions = async () => {
      try {
        const res = await fetch(
          `/api/public/divisions?seasonId=${seasonId}&ageGroupId=${ageGroupId}`
        );
        const data = await res.json();
        setDivisions(data);
        if (data.length > 0) {
          setDivisionId(data[0].id);
        }
      } catch (error) {
        console.error('Load divisions error:', error);
      }
    };
    loadDivisions();
  }, [seasonId, ageGroupId]);

  // Load matches when division changes
  useEffect(() => {
    if (!seasonId || !ageGroupId || !divisionId) return;

    const loadMatches = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem('admin_token');
        const res = await fetch(
          `/api/public/matches?seasonId=${seasonId}&ageGroupId=${ageGroupId}&divisionId=${divisionId}`,
          {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          }
        );

        if (!res.ok) throw new Error('Failed to load matches');

        const data = await res.json();
        setMatches(data);
      } catch (error) {
        console.error('Load matches error:', error);
        setError('Failed to load matches');
      } finally {
        setIsLoading(false);
      }
    };

    loadMatches();
  }, [seasonId, ageGroupId, divisionId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-800">🎮 Match Management</h1>
        <p className="text-gray-600 mt-1">View and edit match scores</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Filters</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Season Select */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Season
            </label>
            <select
              value={seasonId}
              onChange={(e) => setSeasonId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">Select season</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.year})
                </option>
              ))}
            </select>
          </div>

          {/* Age Group Select */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Age Group
            </label>
            <select
              value={ageGroupId}
              onChange={(e) => setAgeGroupId(e.target.value)}
              disabled={!seasonId}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
            >
              <option value="">Select age group</option>
              {ageGroups.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.code} - {ag.name}
                </option>
              ))}
            </select>
          </div>

          {/* Division Select */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Division
            </label>
            <select
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
              disabled={!ageGroupId}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
            >
              <option value="">Select division</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700">❌ {error}</p>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="ml-3 text-gray-600">Loading matches...</p>
        </div>
      )}

      {/* Matches Table */}
      {!isLoading && matches.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-100 border-b border-gray-300">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  MatchDay
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Date & Time
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Match
                </th>
                <th className="px-6 py-3 text-center text-sm font-semibold text-gray-700">
                  Score
                </th>
                <th className="px-6 py-3 text-center text-sm font-semibold text-gray-700">
                  Status
                </th>
                <th className="px-6 py-3 text-center text-sm font-semibold text-gray-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {matches.map((match) => (
                <tr key={match.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {match.matchday}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-700">
                    {new Date(match.match_date).toLocaleDateString('th-TH')}
                    {match.match_time && <> {match.match_time}</>}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-semibold text-gray-800">
                      {match.home_team?.name || 'Team A'}
                    </div>
                    <div className="text-sm text-gray-600">vs</div>
                    <div className="text-sm font-semibold text-gray-800">
                      {match.away_team?.name || 'Team B'}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="text-lg font-bold text-blue-600">
                      {match.home_score != null && match.away_score != null
                        ? `${match.home_score}-${match.away_score}`
                        : '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span
                      className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                        match.status === 'finished'
                          ? 'bg-green-100 text-green-800'
                          : match.status === 'scheduled'
                          ? 'bg-blue-100 text-blue-800'
                          : match.status === 'postponed'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {match.status === 'finished'
                        ? '✓ Finished'
                        : match.status === 'scheduled'
                        ? '⏰ Scheduled'
                        : match.status === 'postponed'
                        ? '⏸ Postponed'
                        : '✕ Cancelled'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <Link
                      href={`/admin/matches/${match.id}`}
                      className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* No matches */}
      {!isLoading && matches.length === 0 && !error && (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <p className="text-gray-500 text-lg">
            {divisionId ? 'No matches found' : 'Select a division to view matches'}
          </p>
        </div>
      )}
    </div>
  );
}
