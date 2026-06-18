'use client';

import { useEffect, useState } from 'react';

interface Player {
  id: string;
  full_name: string;
  shirt_no?: number;
  team_id: string;
  team?: { name: string; short_name: string };
}

interface PlayerSelectorProps {
  matchId: string;
  homeTeamId: string;
  awayTeamId: string;
  onSelect: (playerId: string) => void;
  disabled?: boolean;
  value?: string;
}

export function PlayerSelector({
  matchId,
  homeTeamId,
  awayTeamId,
  onSelect,
  disabled = false,
  value,
}: PlayerSelectorProps) {
  const [players, setPlayers] = useState<Player[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Load players from match teams
  useEffect(() => {
    if (!matchId || !homeTeamId || !awayTeamId) return;

    const loadPlayers = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const token = localStorage.getItem('admin_token');
        const res = await fetch(
          `/api/public/matches?matchId=${matchId}`,
          {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          }
        );

        if (!res.ok) throw new Error('Failed to load match');

        // Get all players - we'll filter client-side
        const matchesData = await res.json();
        const match = Array.isArray(matchesData) ? matchesData[0] : matchesData;

        if (!match) throw new Error('Match not found');

        // Fetch all players and filter by team
        const playersRes = await fetch('/api/public/players?limit=1000');
        const allPlayers = await playersRes.json();

        // Filter players by match teams
        const filteredPlayers = allPlayers.filter(
          (p: Player) => p.team_id === homeTeamId || p.team_id === awayTeamId
        );

        // Sort by team then by name
        filteredPlayers.sort((a: Player, b: Player) => {
          if (a.team_id !== b.team_id) {
            return a.team_id === homeTeamId ? -1 : 1;
          }
          return (a.full_name || '').localeCompare(b.full_name || '');
        });

        setPlayers(filteredPlayers);
      } catch (err) {
        console.error('[PLAYER_SELECTOR] Load error:', err);
        setError('Failed to load players');
      } finally {
        setIsLoading(false);
      }
    };

    loadPlayers();
  }, [matchId, homeTeamId, awayTeamId]);

  // Filter players by search term
  const filteredPlayers = players.filter(
    (p) =>
      p.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.shirt_no?.toString().includes(searchTerm)
  );

  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-gray-700">
        Select Player
      </label>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
          <span className="text-sm text-gray-600">Loading players...</span>
        </div>
      ) : (
        <>
          {/* Search input */}
          <input
            type="text"
            placeholder="Search by name or jersey #"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            disabled={disabled || isLoading}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
          />

          {/* Player dropdown */}
          <select
            value={value || ''}
            onChange={(e) => onSelect(e.target.value)}
            disabled={disabled || isLoading || players.length === 0}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
          >
            <option value="">
              {players.length === 0 ? 'No players available' : 'Choose a player...'}
            </option>

            {/* Group by team */}
            {Array.from(new Set(filteredPlayers.map((p) => p.team_id))).map((teamId) => {
              const teamPlayers = filteredPlayers.filter((p) => p.team_id === teamId);
              const teamName = teamPlayers[0]?.team?.short_name || 'Team';

              return (
                <optgroup key={teamId} label={teamName}>
                  {teamPlayers.map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.full_name} #{player.shirt_no || '—'}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>

          {filteredPlayers.length === 0 && searchTerm && (
            <p className="text-sm text-gray-500">No players match "{searchTerm}"</p>
          )}
        </>
      )}
    </div>
  );
}
