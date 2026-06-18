'use client';

import { useState } from 'react';
import { CardForm } from './CardForm';

interface Card {
  id: string;
  player_id: string;
  card_type: string;
  minute: number;
  player?: {
    id: string;
    full_name: string;
    shirt_no?: number;
  };
}

interface CardsListProps {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  cards: Card[];
  isLoading?: boolean;
  onCardDeleted?: () => void;
  onCardUpdated?: () => void;
}

const CARD_EMOJI: Record<string, string> = {
  yellow: '🟡',
  red: '🔴',
  second_yellow: '🟨🟨',
};

const CARD_LABEL: Record<string, string> = {
  yellow: 'Yellow',
  red: 'Red',
  second_yellow: '2nd Yellow',
};

export function CardsList({
  matchId,
  homeTeamId,
  awayTeamId,
  cards,
  isLoading = false,
  onCardDeleted,
  onCardUpdated,
}: CardsListProps) {
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDeleteCard = async (cardId: string) => {
    if (!confirm('Are you sure you want to delete this card?')) return;

    try {
      setDeletingCardId(cardId);
      setError(null);

      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/cards/${cardId}`, {
        method: 'DELETE',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete card');
      }

      onCardDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete card');
    } finally {
      setDeletingCardId(null);
    }
  };

  const handleEditCard = async (data: {
    playerId: string;
    cardType: string;
    minute: number;
  }) => {
    try {
      setError(null);

      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/cards/${editingCardId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        body: JSON.stringify({
          cardType: data.cardType,
          minute: data.minute,
        }),
      });

      if (!res.ok) {
        const resData = await res.json();
        throw new Error(resData.error || 'Failed to update card');
      }

      setEditingCardId(null);
      onCardUpdated?.();
    } catch (err) {
      throw err;
    }
  };

  const sortedCards = [...cards].sort((a, b) => a.minute - b.minute);

  if (editingCardId) {
    const card = cards.find((c) => c.id === editingCardId);
    if (card) {
      return (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-800">Edit Card</h3>
          <CardForm
            matchId={matchId}
            homeTeamId={homeTeamId}
            awayTeamId={awayTeamId}
            onSave={handleEditCard}
            onCancel={() => setEditingCardId(null)}
            initialData={{
              playerId: card.player_id,
              cardType: card.card_type,
              minute: card.minute,
            }}
            isLoading={isLoading}
          />
        </div>
      );
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {sortedCards.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No cards issued yet
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-200 text-gray-800">
              <tr>
                <th className="px-4 py-3 text-left">Player</th>
                <th className="px-4 py-3 text-left">Jersey</th>
                <th className="px-4 py-3 text-center">Card</th>
                <th className="px-4 py-3 text-center">Min</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedCards.map((card) => (
                <tr key={card.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-800">
                    {card.player?.full_name || 'Unknown'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    #{card.player?.shirt_no || '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-lg">
                      {CARD_EMOJI[card.card_type] || '?'}
                    </span>
                    <span className="text-gray-600 ml-1 text-xs">
                      {CARD_LABEL[card.card_type] || card.card_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-gray-800 font-semibold">
                    {card.minute}'
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => setEditingCardId(card.id)}
                        disabled={isLoading || deletingCardId === card.id}
                        className="px-3 py-1 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white rounded text-xs font-semibold transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteCard(card.id)}
                        disabled={
                          isLoading ||
                          deletingCardId !== null
                        }
                        className="px-3 py-1 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white rounded text-xs font-semibold transition"
                      >
                        {deletingCardId === card.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
