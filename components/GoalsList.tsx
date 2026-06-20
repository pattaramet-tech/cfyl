'use client';

import { useState } from 'react';
import { GoalForm } from './GoalForm';
import { BulkGoalForm } from './BulkGoalForm';

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

interface GoalsListProps {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  goals: Goal[];
  onGoalsChange?: () => void;
  isLoading?: boolean;
}

export function GoalsList({
  matchId,
  homeTeamId,
  awayTeamId,
  goals,
  onGoalsChange,
  isLoading = false,
}: GoalsListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (goalId: string) => {
    if (!confirm('Delete this goal?')) return;

    setDeletingId(goalId);
    setError(null);

    try {
      const token = localStorage.getItem('admin_token');

      if (!token) {
        setError('Not authenticated');
        return;
      }

      console.log('[GOALS_LIST] Deleting goal:', goalId);
      const response = await fetch(`/api/admin/goals/${goalId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete goal');
      }

      console.log('[GOALS_LIST] Goal deleted');
      if (onGoalsChange) onGoalsChange();
    } catch (err) {
      console.error('[GOALS_LIST] Delete error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to delete goal';
      setError(errorMsg);
    } finally {
      setDeletingId(null);
    }
  };

  // Calculate total goals per player
  const goalsByPlayer = goals.reduce(
    (acc, goal) => {
      const key = goal.player_id;
      if (!acc[key]) {
        acc[key] = { ...goal, totalGoals: 0, count: 0 };
      }
      acc[key].totalGoals += goal.goals;
      acc[key].count += 1;
      return acc;
    },
    {} as Record<string, Goal & { totalGoals: number; count: number }>
  );

  const aggregatedGoals = Object.values(goalsByPlayer).sort(
    (a, b) => b.totalGoals - a.totalGoals
  );

  return (
    <div className="space-y-6">
      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Goals table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
          <span className="text-gray-600">Loading goals...</span>
        </div>
      ) : aggregatedGoals.length > 0 ? (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-100 border-b border-gray-300">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Player
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Jersey
                </th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">
                  Team
                </th>
                <th className="px-6 py-3 text-center text-sm font-semibold text-gray-700">
                  Goals
                </th>
                <th className="px-6 py-3 text-center text-sm font-semibold text-gray-700">
                  Entries
                </th>
                <th className="px-6 py-3 text-center text-sm font-semibold text-gray-700">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {aggregatedGoals.map((goal) => (
                <tr key={goal.id} className="hover:bg-gray-50 transition">
                  <td className="px-6 py-4">
                    <p className="font-semibold text-gray-800">{goal.player?.full_name}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    #{goal.player?.shirt_no || '—'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {goal.team?.name || goal.team?.short_name || '—'}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="inline-block px-3 py-1 bg-blue-100 text-blue-800 rounded-full font-bold">
                      {goal.totalGoals}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center text-sm text-gray-600">
                    {goal.count}
                  </td>
                  <td className="px-6 py-4 text-center space-x-2">
                    <button
                      onClick={() => setEditingId(goal.id)}
                      disabled={deletingId === goal.id}
                      className="inline-block px-3 py-1 bg-yellow-500 hover:bg-yellow-600 disabled:bg-gray-300 text-white rounded text-xs font-semibold transition"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => handleDelete(goal.id)}
                      disabled={deletingId !== null}
                      className="inline-block px-3 py-1 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white rounded text-xs font-semibold transition"
                    >
                      {deletingId === goal.id ? '⏳' : '🗑️ Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-gray-50 rounded-lg p-8 text-center">
          <p className="text-gray-500">No goals recorded for this match</p>
        </div>
      )}

      {/* Single add goal form */}
      <GoalForm
        matchId={matchId}
        homeTeamId={homeTeamId}
        awayTeamId={awayTeamId}
        onSuccess={onGoalsChange}
      />

      {/* Bulk add goals */}
      <BulkGoalForm
        matchId={matchId}
        homeTeamId={homeTeamId}
        awayTeamId={awayTeamId}
        onSuccess={onGoalsChange}
      />

      {/* Edit form (modal-like) */}
      {editingId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-800">Edit Goal</h2>
              <button
                onClick={() => setEditingId(null)}
                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <GoalForm
              matchId={matchId}
              homeTeamId={homeTeamId}
              awayTeamId={awayTeamId}
              isEditing={true}
              goalId={editingId}
              initialGoals={goals.find((g) => g.id === editingId)?.goals || 1}
              onSuccess={() => {
                setEditingId(null);
                if (onGoalsChange) onGoalsChange();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
