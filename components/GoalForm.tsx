'use client';

import { useState } from 'react';
import { PlayerSelector } from './PlayerSelector';

interface GoalFormProps {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  onSuccess?: () => void;
  isEditing?: boolean;
  goalId?: string;
  initialPlayerId?: string;
  initialGoals?: number;
}

export function GoalForm({
  matchId,
  homeTeamId,
  awayTeamId,
  onSuccess,
  isEditing = false,
  goalId,
  initialPlayerId,
  initialGoals = 1,
}: GoalFormProps) {
  const [playerId, setPlayerId] = useState(initialPlayerId || '');
  const [goals, setGoals] = useState(initialGoals.toString());
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Validate
    if (!playerId) {
      setError('Please select a player');
      return;
    }

    const goalsNum = parseInt(goals);
    if (isNaN(goalsNum) || goalsNum < 1 || goalsNum > 10) {
      setError('Goals must be between 1 and 10');
      return;
    }

    setIsSaving(true);

    try {
      const token = localStorage.getItem('admin_token');

      if (!token) {
        setError('Not authenticated');
        return;
      }

      if (isEditing && goalId) {
        // Update goal
        console.log('[GOAL_FORM] Updating goal:', goalId);
        const response = await fetch(`/api/admin/goals/${goalId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            goals: goalsNum,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to update goal');
        }

        setSuccessMessage('✓ Goal updated');
      } else {
        // Create goal
        console.log('[GOAL_FORM] Creating goal');
        const response = await fetch('/api/admin/goals', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            match_id: matchId,
            player_id: playerId,
            goals: goalsNum,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to create goal');
        }

        setSuccessMessage('✓ Goal added');
        // Reset form
        setPlayerId('');
        setGoals('1');
      }

      // Call success callback
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, 1000);
    } catch (err) {
      console.error('[GOAL_FORM] Error:', err);
      const errorMsg = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMsg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
      <h3 className="font-semibold text-gray-800">
        {isEditing ? '✏️ Edit Goal' : '➕ Add Goal'}
      </h3>

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
          {successMessage}
        </div>
      )}

      {!isEditing && (
        <PlayerSelector
          matchId={matchId}
          homeTeamId={homeTeamId}
          awayTeamId={awayTeamId}
          onSelect={setPlayerId}
          value={playerId}
          disabled={isSaving}
        />
      )}

      {/* Goals count input */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          Goals
        </label>
        <input
          type="number"
          min="1"
          max="10"
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
          disabled={isSaving}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
        />
        <p className="text-xs text-gray-500 mt-1">Enter number of goals (1-10)</p>
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={isSaving || (!isEditing && !playerId)}
        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-semibold transition text-sm"
      >
        {isSaving ? '⏳ Saving...' : isEditing ? '💾 Update Goal' : '➕ Add Goal'}
      </button>
    </form>
  );
}
