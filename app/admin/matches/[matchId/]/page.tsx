'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import type { Match } from '@/types/db';

interface MatchWithTeams extends Match {
  home_team?: { name: string };
  away_team?: { name: string };
}

export default function EditMatchPage() {
  const router = useRouter();
  const params = useParams();
  const matchId = params.matchId as string;

  const [match, setMatch] = useState<MatchWithTeams | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [homeScore, setHomeScore] = useState<number | null>(null);
  const [awayScore, setAwayScore] = useState<number | null>(null);
  const [status, setStatus] = useState<'scheduled' | 'finished' | 'postponed' | 'cancelled'>(
    'scheduled'
  );

  // Load match data
  useEffect(() => {
    const loadMatch = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const token = localStorage.getItem('admin_token');
        const res = await fetch(`/api/public/matches`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });

        if (!res.ok) throw new Error('Failed to load match');

        const data = await res.json();
        const foundMatch = data.find((m: Match) => m.id === matchId);

        if (!foundMatch) {
          setError('Match not found');
          return;
        }

        setMatch(foundMatch);
        setHomeScore(foundMatch.home_score);
        setAwayScore(foundMatch.away_score);
        setStatus(foundMatch.status);
      } catch (error) {
        console.error('Load match error:', error);
        setError('Failed to load match details');
      } finally {
        setIsLoading(false);
      }
    };

    if (matchId) {
      loadMatch();
    }
  }, [matchId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Validate scores
    if (homeScore == null || awayScore == null) {
      setError('Both scores are required');
      return;
    }

    if (homeScore < 0 || awayScore < 0) {
      setError('Scores cannot be negative');
      return;
    }

    if (homeScore > 99 || awayScore > 99) {
      setError('Scores cannot exceed 99');
      return;
    }

    setIsSaving(true);

    try {
      const token = localStorage.getItem('admin_token');

      if (!token) {
        setError('Not authenticated');
        return;
      }

      const response = await fetch(`/api/admin/matches/${matchId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          home_score: homeScore,
          away_score: awayScore,
          status,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update match');
      }

      setSuccessMessage('✓ Match updated successfully!');

      // Reload match data
      const reloadRes = await fetch(`/api/public/matches`);
      const reloadData = await reloadRes.json();
      const updatedMatch = reloadData.find((m: Match) => m.id === matchId);
      if (updatedMatch) {
        setMatch(updatedMatch);
      }

      // Show success for 2 seconds then redirect
      setTimeout(() => {
        router.push('/admin/matches');
      }, 2000);
    } catch (error) {
      console.error('Update match error:', error);
      setError(error instanceof Error ? error.message : 'Failed to update match');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <p className="ml-3 text-gray-600">Loading match...</p>
      </div>
    );
  }

  if (error && !match) {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700">❌ {error}</p>
        </div>
        <Link href="/admin/matches" className="inline-block text-blue-600 hover:underline">
          ← Back to matches
        </Link>
      </div>
    );
  }

  if (!match) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Match not found</p>
        <Link href="/admin/matches" className="inline-block mt-4 text-blue-600 hover:underline">
          ← Back to matches
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Edit Match</h1>
          <p className="text-gray-600 mt-1">{match.matchday}</p>
        </div>
        <Link href="/admin/matches" className="text-blue-600 hover:underline">
          ← Back to matches
        </Link>
      </div>

      {/* Match Info Card */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Match Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm text-gray-600">Home Team</p>
            <p className="text-2xl font-bold text-gray-800">
              {match.home_team?.name || 'Team A'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Away Team</p>
            <p className="text-2xl font-bold text-gray-800">
              {match.away_team?.name || 'Team B'}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Date & Time</p>
            <p className="text-lg font-semibold text-gray-800">
              {new Date(match.match_date).toLocaleDateString('th-TH')}
              {match.match_time && <> {match.match_time}</>}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Match Code</p>
            <p className="text-lg font-semibold text-gray-800">{match.match_code}</p>
          </div>
        </div>
      </div>

      {/* Edit Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-6">Update Score & Status</h2>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-700">❌ {error}</p>
          </div>
        )}

        {successMessage && (
          <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-green-700">✓ {successMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Score Inputs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Home Score */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                {match.home_team?.name || 'Home'} Score
              </label>
              <input
                type="number"
                min="0"
                max="99"
                value={homeScore ?? ''}
                onChange={(e) => setHomeScore(e.target.value ? parseInt(e.target.value) : null)}
                disabled={isSaving}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
                placeholder="0"
              />
            </div>

            {/* Divider */}
            <div className="flex items-end justify-center pb-2">
              <span className="text-3xl font-bold text-gray-400">-</span>
            </div>

            {/* Away Score */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                {match.away_team?.name || 'Away'} Score
              </label>
              <input
                type="number"
                min="0"
                max="99"
                value={awayScore ?? ''}
                onChange={(e) => setAwayScore(e.target.value ? parseInt(e.target.value) : null)}
                disabled={isSaving}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
                placeholder="0"
              />
            </div>
          </div>

          {/* Status Selector */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Match Status
            </label>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as 'scheduled' | 'finished' | 'postponed' | 'cancelled')
              }
              disabled={isSaving}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
            >
              <option value="scheduled">⏰ Scheduled</option>
              <option value="finished">✓ Finished</option>
              <option value="postponed">⏸ Postponed</option>
              <option value="cancelled">✕ Cancelled</option>
            </select>
          </div>

          {/* Info Box */}
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-700">
              💡 <strong>Tip:</strong> Set status to "Finished" after entering scores to mark the
              match as complete.
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-4">
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white font-bold rounded-lg transition"
            >
              {isSaving ? 'Saving...' : '💾 Save Changes'}
            </button>
            <Link
              href="/admin/matches"
              className="px-6 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold rounded-lg transition"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>

      {/* Next Steps */}
      <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
        <h3 className="font-semibold text-gray-800 mb-2">📋 Next Steps</h3>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>✓ Update match scores</li>
          <li>✓ Set status to "Finished"</li>
          <li>• Add goals (Phase 2c)</li>
          <li>• Add cards (Phase 2d)</li>
        </ul>
      </div>
    </div>
  );
}
