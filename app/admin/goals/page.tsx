'use client';

import { useEffect, useState } from 'react';
import { GoalsList } from '@/components/GoalsList';
import type { Match } from '@/types/db';

interface MatchWithTeams extends Match {
  home_team?: { id: string; name: string };
  away_team?: { id: string; name: string };
  division?: { name: string };
}

interface Goal {
  id: string;
  match_id: string;
  player_id: string;
  team_id: string;
  goals: number;
  created_at: string;
  updated_at: string;
  player?: {
    id: string;
    full_name: string;
    shirt_no?: number;
  };
  team?: {
    id: string;
    name: string;
    short_name: string;
  };
}

export default function GoalsPage() {
  const [matches, setMatches] = useState<MatchWithTeams[]>([]);
  const [selectedMatch, setSelectedMatch] = useState<MatchWithTeams | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string>('');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [isLoadingGoals, setIsLoadingGoals] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seasonId, setSeasonId] = useState<string>('');
  const [ageGroupId, setAgeGroupId] = useState<string>('');
  const [divisionId, setDivisionId] = useState<string>('');
  const [seasons, setSeasons] = useState<Array<{ id: string; name: string; year: number }>>([]);
  const [ageGroups, setAgeGroups] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [divisions, setDivisions] = useState<Array<{ id: string; name: string }>>([]);

  // Load seasons
  useEffect(() => {
    const loadSeasons = async () => {
      try {
        const res = await fetch('/api/public/seasons');
        const data = await res.json();
        setSeasons(data);
        if (data.length > 0) {
          setSeasonId(data[0].id);
        }
      } catch (err) {
        console.error('[GOALS_PAGE] Load seasons error:', err);
      }
    };
    loadSeasons();
  }, []);

  // Load age groups
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
      } catch (err) {
        console.error('[GOALS_PAGE] Load age groups error:', err);
      }
    };
    loadAgeGroups();
  }, [seasonId]);

  // Load divisions
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
      } catch (err) {
        console.error('[GOALS_PAGE] Load divisions error:', err);
      }
    };
    loadDivisions();
  }, [seasonId, ageGroupId]);

  // Load matches
  useEffect(() => {
    if (!seasonId || !ageGroupId || !divisionId) {
      setMatches([]);
      setSelectedMatch(null);
      setSelectedMatchId('');
      return;
    }

    const loadMatches = async () => {
      setIsLoadingMatches(true);
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

        // Preserve selected match if it still exists, otherwise keep empty
        const stillExists = data.find((m: MatchWithTeams) => m.id === selectedMatchId);
        if (stillExists) {
          setSelectedMatch(stillExists);
          loadGoals(stillExists.id);
        } else {
          setSelectedMatch(null);
          setSelectedMatchId('');
          setGoals([]);
        }
      } catch (err) {
        console.error('[GOALS_PAGE] Load matches error:', err);
        setError('Failed to load matches');
      } finally {
        setIsLoadingMatches(false);
      }
    };

    loadMatches();
  }, [seasonId, ageGroupId, divisionId, selectedMatchId]);

  // Load goals for selected match
  const loadGoals = async (matchId: string) => {
    setIsLoadingGoals(true);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/goals?match_id=${matchId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });

      if (!res.ok) throw new Error('Failed to load goals');

      const data = await res.json();
      setGoals(data);
    } catch (err) {
      console.error('[GOALS_PAGE] Load goals error:', err);
      setError('Failed to load goals');
    } finally {
      setIsLoadingGoals(false);
    }
  };

  const handleMatchSelect = (match: MatchWithTeams) => {
    setSelectedMatch(match);
    setSelectedMatchId(match.id);
    loadGoals(match.id);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-800">⚽ Goal Management</h1>
        <p className="text-gray-600 mt-1">Add, edit, or delete goals for matches</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Select Match</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6">
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

        {/* Match Select */}
        {isLoadingMatches ? (
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
            <span className="text-gray-600">Loading matches...</span>
          </div>
        ) : matches.length > 0 ? (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Select Match
            </label>
            <select
              value={selectedMatchId}
              onChange={(e) => {
                const match = matches.find((m) => m.id === e.target.value);
                if (match) {
                  handleMatchSelect(match);
                }
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
            >
              <option value="">-- Select a match --</option>
              {matches.map((match) => (
                <option key={match.id} value={match.id}>
                  MD{match.matchday} | {new Date(match.match_date).toLocaleDateString('th-TH')}
                  {match.match_time && ` ${match.match_time.substring(0, 5)}`} | {match.home_team?.name} vs{' '}
                  {match.away_team?.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-500">No matches found. Select division to view matches.</p>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700">❌ {error}</p>
        </div>
      )}

      {/* Goals Management */}
      {selectedMatch && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">
            Goals:{' '}
            <span className="text-blue-600">
              {selectedMatch.home_team?.name} vs {selectedMatch.away_team?.name}
            </span>
          </h2>

          <GoalsList
            matchId={selectedMatch.id}
            homeTeamId={selectedMatch.home_team_id}
            awayTeamId={selectedMatch.away_team_id}
            goals={goals}
            isLoading={isLoadingGoals}
            onGoalsChange={() => loadGoals(selectedMatch.id)}
          />
        </div>
      )}
    </div>
  );
}
