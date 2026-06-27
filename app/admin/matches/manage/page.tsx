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

interface Card {
  id: string;
  match_id: string;
  player_id: string;
  card_type: string;
  minute?: number | null;
  note?: string | null;
  created_at: string;
  player?: {
    id: string;
    full_name: string;
    shirt_no?: number;
  };
  team?: {
    id: string;
    name: string;
  };
}

export default function MatchManagePage() {
  const [seasonId, setSeasonId] = useState<string>('');
  const [ageGroupId, setAgeGroupId] = useState<string>('');
  const [divisionId, setDivisionId] = useState<string>('');
  const [selectedMatchId, setSelectedMatchId] = useState<string>('');

  const [seasons, setSeasons] = useState<Array<{ id: string; name: string; year: number }>>([]);
  const [ageGroups, setAgeGroups] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [divisions, setDivisions] = useState<Array<{ id: string; name: string }>>([]);
  const [matches, setMatches] = useState<MatchWithTeams[]>([]);

  const [selectedMatch, setSelectedMatch] = useState<MatchWithTeams | null>(null);
  const [homeScore, setHomeScore] = useState<string>('0');
  const [awayScore, setAwayScore] = useState<string>('0');
  const [matchStatus, setMatchStatus] = useState<string>('scheduled');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [cards, setCards] = useState<Card[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
        console.error('[MATCH_MANAGE] Load seasons error:', err);
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
        console.error('[MATCH_MANAGE] Load age groups error:', err);
      }
    };
    loadAgeGroups();
  }, [seasonId]);

  // Load divisions
  useEffect(() => {
    if (!seasonId || !ageGroupId) return;
    const loadDivisions = async () => {
      try {
        const res = await fetch(`/api/public/divisions?seasonId=${seasonId}&ageGroupId=${ageGroupId}`);
        const data = await res.json();
        setDivisions(data);
        if (data.length > 0) {
          setDivisionId(data[0].id);
        }
      } catch (err) {
        console.error('[MATCH_MANAGE] Load divisions error:', err);
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
      setLoading(true);
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

        // Preserve selected match
        const stillExists = data.find((m: MatchWithTeams) => m.id === selectedMatchId);
        if (stillExists) {
          setSelectedMatch(stillExists);
          loadMatchData(stillExists);
        } else {
          setSelectedMatch(null);
          setSelectedMatchId('');
        }
      } catch (err) {
        console.error('[MATCH_MANAGE] Load matches error:', err);
        setError('Failed to load matches');
      } finally {
        setLoading(false);
      }
    };

    loadMatches();
  }, [seasonId, ageGroupId, divisionId, selectedMatchId]);

  const loadMatchData = async (match: MatchWithTeams) => {
    try {
      const token = localStorage.getItem('admin_token');

      // Load goals and cards
      const [goalsRes, cardsRes] = await Promise.all([
        fetch(`/api/admin/goals?match_id=${match.id}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        }),
        fetch(`/api/admin/cards?match_id=${match.id}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        }),
      ]);

      if (goalsRes.ok) {
        const goalsData = await goalsRes.json();
        setGoals(goalsData);
      }
      if (cardsRes.ok) {
        const cardsData = await cardsRes.json();
        setCards(cardsData);
      }

      // Set score and status
      setHomeScore((match.home_score ?? 0).toString());
      setAwayScore((match.away_score ?? 0).toString());
      setMatchStatus(match.status || 'scheduled');
    } catch (err) {
      console.error('[MATCH_MANAGE] Load match data error:', err);
    }
  };

  const handleMatchSelect = (match: MatchWithTeams) => {
    setSelectedMatch(match);
    setSelectedMatchId(match.id);
    loadMatchData(match);
  };

  const handleSaveScore = async () => {
    if (!selectedMatch) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const homeScoreNum = parseInt(homeScore);
      const awayScoreNum = parseInt(awayScore);

      if (isNaN(homeScoreNum) || isNaN(awayScoreNum)) {
        throw new Error('Score must be a number');
      }
      if (homeScoreNum < 0 || awayScoreNum < 0) {
        throw new Error('Score cannot be negative');
      }

      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/matches/${selectedMatch.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          home_score: homeScoreNum,
          away_score: awayScoreNum,
          status: matchStatus,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save score');
      }

      const updated = await res.json();
      setSelectedMatch(updated);
      setSuccess('✓ Score saved');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-800">⚽ Match Management</h1>
        <p className="text-gray-600 mt-1">Manage match details, score, goals, and cards</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Select Match</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {/* Season */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Season</label>
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

          {/* Age Group */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Age Group</label>
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

          {/* Division */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Division</label>
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

        {/* Match Dropdown */}
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
            <span className="text-gray-600">Loading matches...</span>
          </div>
        ) : matches.length > 0 ? (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">Select Match</label>
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
                  {match.status === 'finished' && match.home_score != null && match.away_score != null
                    ? ` (${match.home_score}-${match.away_score})`
                    : ''}
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

      {/* Error/Success */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700">❌ {error}</p>
        </div>
      )}
      {success && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-green-700">{success}</p>
        </div>
      )}

      {/* Match Detail & Management */}
      {selectedMatch && (
        <>
          {/* Match Summary */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Match Summary</h2>
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-semibold">MatchDay:</span> MD{selectedMatch.matchday}
              </p>
              <p>
                <span className="font-semibold">Date:</span>{' '}
                {new Date(selectedMatch.match_date).toLocaleDateString('th-TH')}
                {selectedMatch.match_time && ` ${selectedMatch.match_time.substring(0, 5)}`}
              </p>
              <p>
                <span className="font-semibold">Division:</span> {selectedMatch.division?.name}
              </p>
              <p>
                <span className="font-semibold">Teams:</span> {selectedMatch.home_team?.name} vs{' '}
                {selectedMatch.away_team?.name}
              </p>
            </div>
          </div>

          {/* Score Editor */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Score</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  {selectedMatch.home_team?.name}
                </label>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={homeScore}
                  onChange={(e) => setHomeScore(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                <select
                  value={matchStatus}
                  onChange={(e) => setMatchStatus(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="finished">Finished</option>
                  <option value="postponed">Postponed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  {selectedMatch.away_team?.name}
                </label>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={awayScore}
                  onChange={(e) => setAwayScore(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
            </div>

            <div className="mt-4">
              <button
                onClick={handleSaveScore}
                disabled={saving}
                className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Score'}
              </button>
            </div>
          </div>

          {/* Goals */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Goals</h2>
            <GoalsList
              matchId={selectedMatch.id}
              homeTeamId={selectedMatch.home_team_id}
              awayTeamId={selectedMatch.away_team_id}
              goals={goals}
              isLoading={false}
              onGoalsChange={() => loadMatchData(selectedMatch)}
            />
          </div>
        </>
      )}
    </div>
  );
}
