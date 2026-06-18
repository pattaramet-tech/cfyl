'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Stats {
  totalMatches: number;
  finishedMatches: number;
  totalGoals: number;
  totalCards: number;
  totalTeams: number;
  totalPlayers: number;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem('admin_token');

        if (!token) {
          setError('Not authenticated');
          return;
        }

        const response = await fetch('/api/admin/stats', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          setError('Failed to fetch stats');
          return;
        }

        const data = await response.json();
        setStats(data.stats);
      } catch (error) {
        console.error('Stats error:', error);
        setError('Error loading statistics');
      } finally {
        setIsLoading(false);
      }
    };

    fetchStats();
  }, []);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-800">📊 Dashboard</h1>
        <p className="text-gray-600 mt-1">Welcome to the admin control panel</p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-red-700">❌ {error}</p>
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="ml-3 text-gray-600">Loading statistics...</p>
        </div>
      )}

      {/* Stats Cards */}
      {stats && !isLoading && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Total Matches */}
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-600">
              <p className="text-gray-600 text-sm font-semibold">Total Matches</p>
              <p className="text-3xl font-bold text-blue-600 mt-2">{stats.totalMatches}</p>
              <p className="text-xs text-gray-500 mt-2">
                {stats.finishedMatches} finished
              </p>
            </div>

            {/* Finished Matches */}
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-600">
              <p className="text-gray-600 text-sm font-semibold">Finished Matches</p>
              <p className="text-3xl font-bold text-green-600 mt-2">{stats.finishedMatches}</p>
              <p className="text-xs text-gray-500 mt-2">
                {((stats.finishedMatches / stats.totalMatches) * 100).toFixed(1)}% complete
              </p>
            </div>

            {/* Total Goals */}
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-orange-600">
              <p className="text-gray-600 text-sm font-semibold">Total Goals Recorded</p>
              <p className="text-3xl font-bold text-orange-600 mt-2">{stats.totalGoals}</p>
              <p className="text-xs text-gray-500 mt-2">
                {stats.totalMatches > 0 ? (stats.totalGoals / stats.totalMatches).toFixed(1) : 0} avg/match
              </p>
            </div>

            {/* Total Cards */}
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-red-600">
              <p className="text-gray-600 text-sm font-semibold">Total Cards Issued</p>
              <p className="text-3xl font-bold text-red-600 mt-2">{stats.totalCards}</p>
              <p className="text-xs text-gray-500 mt-2">
                Yellow & Red cards
              </p>
            </div>

            {/* Total Teams */}
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-purple-600">
              <p className="text-gray-600 text-sm font-semibold">Total Teams</p>
              <p className="text-3xl font-bold text-purple-600 mt-2">{stats.totalTeams}</p>
              <p className="text-xs text-gray-500 mt-2">
                Registered teams
              </p>
            </div>

            {/* Total Players */}
            <div className="bg-white rounded-lg shadow p-6 border-l-4 border-indigo-600">
              <p className="text-gray-600 text-sm font-semibold">Total Players</p>
              <p className="text-3xl font-bold text-indigo-600 mt-2">{stats.totalPlayers}</p>
              <p className="text-xs text-gray-500 mt-2">
                {stats.totalTeams > 0 ? (stats.totalPlayers / stats.totalTeams).toFixed(1) : 0} avg/team
              </p>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-8">
            <h2 className="text-xl font-bold text-gray-800 mb-4">🚀 Quick Actions</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Link
                href="/admin/matches"
                className="p-6 bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border border-blue-200 hover:border-blue-400 transition"
              >
                <h3 className="font-bold text-blue-900 mb-1">🎮 Edit Match Scores</h3>
                <p className="text-sm text-blue-700">Update match results and status</p>
              </Link>

              <Link
                href="/admin/teams"
                className="p-6 bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg border border-purple-200 hover:border-purple-400 transition"
              >
                <h3 className="font-bold text-purple-900 mb-1">⚽ View Teams</h3>
                <p className="text-sm text-purple-700">Manage team information</p>
              </Link>
            </div>
          </div>

          {/* Last Updated */}
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-xs text-gray-600">
            <p>Last updated: {new Date().toLocaleString()}</p>
          </div>
        </>
      )}
    </div>
  );
}
