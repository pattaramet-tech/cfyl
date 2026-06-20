'use client';

import { useEffect, useState } from 'react';
import { CardForm } from '@/components/CardForm';
import { CardsList } from '@/components/CardsList';
import { BulkCardForm } from '@/components/BulkCardForm';

interface Season {
  id: string;
  year: number;
  name: string;
}

interface AgeGroup {
  id: string;
  name: string;
}

interface Division {
  id: string;
  name: string;
}

interface Match {
  id: string;
  match_code?: string;
  matchday: number;
  match_time?: string;
  home_team_id: string;
  away_team_id: string;
  home_team?: { name: string; short_name: string };
  away_team?: { name: string; short_name: string };
}

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

export default function CardsPage() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [cards, setCards] = useState<Card[]>([]);

  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState('');
  const [selectedDivision, setSelectedDivision] = useState('');
  const [selectedMatch, setSelectedMatch] = useState('');

  const [isLoadingSeasons, setIsLoadingSeasons] = useState(true);
  const [isLoadingAgeGroups, setIsLoadingAgeGroups] = useState(false);
  const [isLoadingDivisions, setIsLoadingDivisions] = useState(false);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [isLoadingCards, setIsLoadingCards] = useState(false);
  const [isAddingCard, setIsAddingCard] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load seasons
  useEffect(() => {
    const fetchSeasons = async () => {
      try {
        const res = await fetch('/api/public/seasons');
        if (res.ok) {
          const data = await res.json();
          setSeasons(data);
          if (data.length > 0) {
            setSelectedSeason(data[0].id);
          }
        }
      } catch (err) {
        setError('Failed to load seasons');
      } finally {
        setIsLoadingSeasons(false);
      }
    };

    fetchSeasons();
  }, []);

  // Load age groups when season changes
  useEffect(() => {
    if (!selectedSeason) return;

    const fetchAgeGroups = async () => {
      try {
        setIsLoadingAgeGroups(true);
        setSelectedAgeGroup('');
        setSelectedDivision('');
        setSelectedMatch('');
        setCards([]);

        const res = await fetch(
          `/api/public/age-groups?seasonId=${selectedSeason}`
        );
        if (res.ok) {
          const data = await res.json();
          setAgeGroups(data);
          if (data.length > 0) {
            setSelectedAgeGroup(data[0].id);
          }
        }
      } catch (err) {
        setError('Failed to load age groups');
      } finally {
        setIsLoadingAgeGroups(false);
      }
    };

    fetchAgeGroups();
  }, [selectedSeason]);

  // Load divisions when age group changes
  useEffect(() => {
    if (!selectedSeason || !selectedAgeGroup) return;

    const fetchDivisions = async () => {
      try {
        setIsLoadingDivisions(true);
        setSelectedDivision('');
        setSelectedMatch('');
        setCards([]);

        const res = await fetch(
          `/api/public/divisions?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}`
        );
        if (res.ok) {
          const data = await res.json();
          setDivisions(data);
          if (data.length > 0) {
            setSelectedDivision(data[0].id);
          }
        }
      } catch (err) {
        setError('Failed to load divisions');
      } finally {
        setIsLoadingDivisions(false);
      }
    };

    fetchDivisions();
  }, [selectedSeason, selectedAgeGroup]);

  // Load matches when division changes
  useEffect(() => {
    if (!selectedSeason || !selectedAgeGroup || !selectedDivision) return;

    const fetchMatches = async () => {
      try {
        setIsLoadingMatches(true);
        setSelectedMatch('');
        setCards([]);

        const res = await fetch(
          `/api/public/matches?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}&divisionId=${selectedDivision}`
        );
        if (res.ok) {
          const data = await res.json();
          setMatches(data);
        }
      } catch (err) {
        setError('Failed to load matches');
      } finally {
        setIsLoadingMatches(false);
      }
    };

    fetchMatches();
  }, [selectedSeason, selectedAgeGroup, selectedDivision]);

  // Load cards when match changes
  useEffect(() => {
    if (!selectedMatch) {
      setCards([]);
      return;
    }

    const fetchCards = async () => {
      try {
        setIsLoadingCards(true);

        const token = localStorage.getItem('admin_token');
        const res = await fetch(`/api/admin/cards?matchId=${selectedMatch}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (res.ok) {
          const data = await res.json();
          setCards(data);
        }
      } catch (err) {
        setError('Failed to load cards');
      } finally {
        setIsLoadingCards(false);
      }
    };

    fetchCards();
  }, [selectedMatch]);

  const selectedMatchData = matches.find((m) => m.id === selectedMatch);

  const handleAddCard = async (data: {
    playerId: string;
    cardType: string;
    minute: number;
  }) => {
    try {
      setError(null);
      setSuccessMessage(null);
      setIsAddingCard(true);

      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/cards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({
          matchId: selectedMatch,
          playerId: data.playerId,
          cardType: data.cardType,
          minute: data.minute,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to add card');
      }

      setSuccessMessage('Card added successfully');
      // Reload cards
      const cardsRes = await fetch(`/api/admin/cards?matchId=${selectedMatch}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (cardsRes.ok) {
        const cardsData = await cardsRes.json();
        setCards(cardsData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add card');
    } finally {
      setIsAddingCard(false);
    }
  };

  const handleCardDeleted = async () => {
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/cards?matchId=${selectedMatch}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setCards(data);
        setSuccessMessage('Card deleted successfully');
      }
    } catch (err) {
      setError('Failed to reload cards');
    }
  };

  const handleCardUpdated = async () => {
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/cards?matchId=${selectedMatch}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setCards(data);
        setSuccessMessage('Card updated successfully');
      }
    } catch (err) {
      setError('Failed to reload cards');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-800">🟨 Card Management</h1>
        <p className="text-gray-600 mt-2">Manage yellow cards, red cards, and suspensions</p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
          {successMessage}
        </div>
      )}

      {/* Selectors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Season */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Season
          </label>
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value)}
            disabled={isLoadingSeasons}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
          >
            <option value="">Select season...</option>
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Age Group */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Age Group
          </label>
          <select
            value={selectedAgeGroup}
            onChange={(e) => setSelectedAgeGroup(e.target.value)}
            disabled={isLoadingAgeGroups || !selectedSeason}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
          >
            <option value="">Select age group...</option>
            {ageGroups.map((ag) => (
              <option key={ag.id} value={ag.id}>
                {ag.name}
              </option>
            ))}
          </select>
        </div>

        {/* Division */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Division
          </label>
          <select
            value={selectedDivision}
            onChange={(e) => setSelectedDivision(e.target.value)}
            disabled={isLoadingDivisions || !selectedAgeGroup}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
          >
            <option value="">Select division...</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        {/* Match */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Match
          </label>
          <select
            value={selectedMatch}
            onChange={(e) => setSelectedMatch(e.target.value)}
            disabled={isLoadingMatches || !selectedDivision}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100"
          >
            <option value="">Select match...</option>
            {matches.map((m) => {
              const matchCode = m.match_code || m.id.substring(0, 8);
              const matchTime = m.match_time || '';
              const homeTeam = m.home_team?.name || m.home_team?.short_name || 'ไม่พบทีม';
              const awayTeam = m.away_team?.name || m.away_team?.short_name || 'ไม่พบทีม';
              const displayTime = matchTime ? matchTime.substring(0, 5) : '--:--';
              return (
                <option key={m.id} value={m.id}>
                  [{matchCode}] | MD{m.matchday} | {displayTime} | {homeTeam} vs {awayTeam}
                </option>
              );
            })}
          </select>
        </div>
      </div>

      {/* Content */}
      {selectedMatch && selectedMatchData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
          {/* Add Card Form */}
          <div className="md:col-span-1 bg-white p-4 sm:p-6 rounded-lg shadow">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Add Card</h2>
            <CardForm
              matchId={selectedMatch}
              homeTeamId={selectedMatchData.home_team_id}
              awayTeamId={selectedMatchData.away_team_id}
              onSave={handleAddCard}
              onCancel={() => {}}
              isLoading={isLoadingCards}
            />
            <BulkCardForm
              matchId={selectedMatch}
              homeTeamId={selectedMatchData.home_team_id}
              awayTeamId={selectedMatchData.away_team_id}
              onSuccess={handleCardUpdated}
            />
          </div>

          {/* Cards List */}
          <div className="md:col-span-1 lg:col-span-2 bg-white p-4 sm:p-6 rounded-lg shadow">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Cards in Match</h2>
            <CardsList
              matchId={selectedMatch}
              homeTeamId={selectedMatchData.home_team_id}
              awayTeamId={selectedMatchData.away_team_id}
              cards={cards}
              isLoading={isLoadingCards || isAddingCard}
              onCardDeleted={handleCardDeleted}
              onCardUpdated={handleCardUpdated}
            />
          </div>
        </div>
      )}

      {!selectedMatch && selectedDivision && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-blue-700">
          Select a match to view and manage cards
        </div>
      )}
    </div>
  );
}
