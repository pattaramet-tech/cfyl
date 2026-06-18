'use client';

import { useState } from 'react';
import { PlayerSelector } from './PlayerSelector';
import { CardTypeSelect } from './CardTypeSelect';

interface CardFormProps {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  onSave: (data: { playerId: string; cardType: string; minute: number }) => Promise<void>;
  onCancel: () => void;
  initialData?: {
    playerId: string;
    cardType: string;
    minute: number;
  };
  isLoading?: boolean;
}

export function CardForm({
  matchId,
  homeTeamId,
  awayTeamId,
  onSave,
  onCancel,
  initialData,
  isLoading = false,
}: CardFormProps) {
  const [playerId, setPlayerId] = useState(initialData?.playerId || '');
  const [cardType, setCardType] = useState(initialData?.cardType || '');
  const [minute, setMinute] = useState(initialData?.minute ?? '');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!playerId || !cardType || minute === '') {
      setError('All fields are required');
      return;
    }

    const minuteNum = parseInt(minute as string, 10);
    if (isNaN(minuteNum) || minuteNum < 0 || minuteNum > 90) {
      setError('Minute must be between 0 and 90');
      return;
    }

    try {
      setIsSaving(true);
      await onSave({
        playerId,
        cardType,
        minute: minuteNum,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save card');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <PlayerSelector
        matchId={matchId}
        homeTeamId={homeTeamId}
        awayTeamId={awayTeamId}
        value={playerId}
        onSelect={setPlayerId}
        disabled={isLoading || isSaving}
      />

      <CardTypeSelect
        value={cardType}
        onChange={setCardType}
        disabled={isLoading || isSaving}
      />

      <div className="space-y-2">
        <label className="block text-sm font-semibold text-gray-700">
          Minute (0-90)
        </label>
        <input
          type="number"
          min="0"
          max="90"
          value={minute}
          onChange={(e) => setMinute(e.target.value)}
          disabled={isLoading || isSaving}
          placeholder="Enter minute..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isLoading || isSaving || !playerId || !cardType || minute === ''}
          className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg font-semibold transition"
        >
          {isSaving ? 'Saving...' : 'Save Card'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading || isSaving}
          className="flex-1 px-4 py-2 bg-gray-300 hover:bg-gray-400 disabled:bg-gray-200 text-gray-800 rounded-lg font-semibold transition"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
