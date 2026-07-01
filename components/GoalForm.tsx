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
  initialMinute?: number | null;
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
  initialMinute,
}: GoalFormProps) {
  const [playerId, setPlayerId] = useState(initialPlayerId || '');
  const [goals, setGoals] = useState(initialGoals.toString());
  const [minute, setMinute] = useState(
    initialMinute != null ? initialMinute.toString() : ''
  );
  const [isOwnGoal, setIsOwnGoal] = useState(false);
  const [ownGoalTeamId, setOwnGoalTeamId] = useState('');
  const [goalNote, setGoalNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Validate
    if (!isEditing) {
      if (isOwnGoal) {
        if (!ownGoalTeamId) {
          setError('กรุณาเลือกทีมที่ได้รับประตูจาก Own Goal');
          return;
        }
      } else {
        if (!playerId) {
          setError('Please select a player');
          return;
        }
      }
    }

    if (isEditing && !goalId) {
      setError('Missing goal ID');
      return;
    }

    const goalsNum = parseInt(goals);
    if (isNaN(goalsNum) || goalsNum < 1 || goalsNum > 10) {
      setError('Goals must be between 1 and 10');
      return;
    }

    // Validate minute
    const minuteNum = minute.trim() === '' ? null : Number(minute);
    if (
      minuteNum !== null &&
      (!Number.isInteger(minuteNum) || minuteNum < 0 || minuteNum > 120)
    ) {
      setError('นาทีต้องเป็นตัวเลข 0-120 หรือเว้นว่าง');
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
            minute: minuteNum,
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
        const goalData: any = {
          match_id: matchId,
          goals: goalsNum,
          minute: minuteNum,
          is_own_goal: isOwnGoal,
        };

        if (isOwnGoal) {
          goalData.team_id = ownGoalTeamId;
          goalData.player_id = null;
          if (goalNote.trim()) {
            goalData.note = goalNote.trim();
          }
        } else {
          goalData.player_id = playerId;
          if (goalNote.trim()) {
            goalData.note = goalNote.trim();
          }
        }

        const response = await fetch('/api/admin/goals', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(goalData),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to create goal');
        }

        setSuccessMessage(isOwnGoal ? '✓ Own Goal added' : '✓ Goal added');
        // Reset form
        setPlayerId('');
        setGoals('1');
        setMinute('');
        setIsOwnGoal(false);
        setOwnGoalTeamId('');
        setGoalNote('');
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
        <>
          {/* Own Goal checkbox */}
          <label className="flex items-center gap-2 text-sm font-semibold text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={isOwnGoal}
              onChange={(e) => {
                setIsOwnGoal(e.target.checked);
                if (e.target.checked) {
                  setPlayerId('');
                } else {
                  setOwnGoalTeamId('');
                }
              }}
              disabled={isSaving}
              className="w-4 h-4"
            />
            Own Goal / ทำเข้าประตูตัวเอง
          </label>

          {/* Player or Team selector */}
          {isOwnGoal ? (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                ทีมที่ได้รับประตู
              </label>
              <select
                value={ownGoalTeamId}
                onChange={(e) => setOwnGoalTeamId(e.target.value)}
                disabled={isSaving}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
              >
                <option value="">-- เลือกทีมที่ได้รับประตู --</option>
                <option value={homeTeamId}>ทีมเหย้า</option>
                <option value={awayTeamId}>ทีมเยือน</option>
              </select>
            </div>
          ) : (
            <PlayerSelector
              matchId={matchId}
              homeTeamId={homeTeamId}
              awayTeamId={awayTeamId}
              onSelect={setPlayerId}
              value={playerId}
              disabled={isSaving}
            />
          )}
        </>
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
        <p className="text-xs text-gray-500 mt-1">
          ระหว่าง 1–10 • ถ้าต้องใส่นาทีแยกสำหรับแต่ละลูก ให้ใช้ Bulk Goal
        </p>
      </div>

      {/* Minute input */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">
          นาทีที่ทำประตู
        </label>
        <input
          type="number"
          min="0"
          max="120"
          value={minute}
          onChange={(e) => setMinute(e.target.value)}
          disabled={isSaving}
          placeholder="เช่น 12"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
        />
        <p className="text-xs text-gray-500 mt-1">
          เว้นว่างได้ ถ้าไม่ทราบนาที
        </p>
      </div>

      {/* Goal note */}
      {!isEditing && (
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">
            หมายเหตุ (ไม่บังคับ)
          </label>
          <textarea
            value={goalNote}
            onChange={(e) => setGoalNote(e.target.value)}
            disabled={isSaving}
            placeholder="เช่น Own Goal, ทำเข้าประตูตัวเอง"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
            rows={2}
          />
        </div>
      )}

      {/* Submit button */}
      {(() => {
        const isDisabled = isSaving || (!isEditing && (isOwnGoal ? !ownGoalTeamId : !playerId));
        return (
          <button
            type="submit"
            disabled={isDisabled}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-semibold transition text-sm"
          >
            {isSaving ? '⏳ Saving...' : isEditing ? '💾 Update Goal' : '➕ Add Goal'}
          </button>
        );
      })()}
    </form>
  );
}
