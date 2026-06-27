'use client';

import { useCallback, useEffect, useState } from 'react';
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
    team_id?: string;
    team?: {
      name: string;
      short_name?: string;
    };
  };
  match?: {
    id: string;
    matchday: string | number;
    home_team_id?: string;
    away_team_id?: string;
  };
}

interface Player {
  id: string;
  full_name: string;
  shirt_no?: number;
  team_id: string;
  team?: {
    name: string;
    short_name?: string;
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
  const [players, setPlayers] = useState<Player[]>([]);

  // Card form states
  const [cardPlayerId, setCardPlayerId] = useState<string>('');
  const [cardType, setCardType] = useState<string>('yellow');
  const [cardMinute, setCardMinute] = useState<string>('');
  const [cardNote, setCardNote] = useState<string>('');
  const [addingCard, setAddingCard] = useState(false);

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
      } catch (err) {
        console.error('[MATCH_MANAGE] Load matches error:', err);
        setError('Failed to load matches');
      } finally {
        setLoading(false);
      }
    };

    loadMatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId, ageGroupId, divisionId]);

  // Load match data when selectedMatch changes
  useEffect(() => {
    if (!selectedMatch) return;
    loadMatchDataCallback(selectedMatch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMatchId]);


  const loadMatchDataCallback = useCallback(
    async (match: MatchWithTeams) => {
      try {
        const token = localStorage.getItem('admin_token');

        // Load goals, cards, and players
        const [goalsRes, cardsRes, playersRes] = await Promise.all([
          fetch(`/api/admin/goals?match_id=${match.id}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          }),
          fetch(`/api/admin/cards?matchId=${match.id}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          }),
          fetch(`/api/admin/players?teamIds=${match.home_team_id},${match.away_team_id}`, {
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
        if (playersRes.ok) {
          const playersData = await playersRes.json();
          setPlayers(playersData);
        }

        // Set score and status
        setHomeScore((match.home_score ?? 0).toString());
        setAwayScore((match.away_score ?? 0).toString());
        setMatchStatus(match.status || 'scheduled');

        // Reset card form
        setCardPlayerId('');
        setCardType('yellow');
        setCardMinute('');
        setCardNote('');
      } catch (err) {
        console.error('[MATCH_MANAGE] Load match data error:', err);
      }
    },
    []
  );

  const handleMatchSelect = (match: MatchWithTeams) => {
    setSelectedMatch(match);
    setSelectedMatchId(match.id);
    loadMatchDataCallback(match);
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

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMatch || !cardPlayerId) {
      setError('Please select a player');
      return;
    }

    setAddingCard(true);
    setError(null);

    try {
      const token = localStorage.getItem('admin_token');
      const cardMinuteNum = cardMinute ? parseInt(cardMinute) : null;

      const res = await fetch('/api/admin/cards', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          match_id: selectedMatch.id,
          player_id: cardPlayerId,
          card_type: cardType,
          minute: cardMinuteNum,
          note: cardNote || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to add card');
      }

      setSuccess('✓ Card added');
      // Reload cards
      setTimeout(() => {
        loadMatchDataCallback(selectedMatch);
      }, 500);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMsg);
    } finally {
      setAddingCard(false);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    if (!selectedMatch || !window.confirm('Delete this card?')) return;

    setSaving(true);
    setError(null);

    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/cards/${cardId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete card');
      }

      setSuccess('✓ Card deleted');
      // Reload cards
      setTimeout(() => {
        loadMatchDataCallback(selectedMatch);
      }, 500);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const calculateGoalConsistency = () => {
    if (!selectedMatch) return null;

    const homeGoalSum = goals
      .filter((g) => g.team_id === selectedMatch.home_team_id)
      .reduce((sum, g) => sum + g.goals, 0);

    const awayGoalSum = goals
      .filter((g) => g.team_id === selectedMatch.away_team_id)
      .reduce((sum, g) => sum + g.goals, 0);

    const homeScoreNum = parseInt(homeScore);
    const awayScoreNum = parseInt(awayScore);

    return {
      homeMatches: homeGoalSum === homeScoreNum,
      awayMatches: awayGoalSum === awayScoreNum,
      homeGoalSum,
      awayGoalSum,
      homeScoreNum,
      awayScoreNum,
    };
  };

  const handleFinishMatch = async () => {
    if (!selectedMatch) return;

    const consistency = calculateGoalConsistency();
    if (!consistency) return;

    const { homeMatches, awayMatches, homeGoalSum, awayGoalSum, homeScoreNum, awayScoreNum } = consistency;

    if (!homeMatches || !awayMatches) {
      const warnings = [];
      if (!homeMatches) warnings.push(`Home: ${homeGoalSum} goals ≠ ${homeScoreNum} score`);
      if (!awayMatches) warnings.push(`Away: ${awayGoalSum} goals ≠ ${awayScoreNum} score`);

      const msg = `Goal/Score mismatch:\n${warnings.join('\n')}\n\nContinue anyway?`;
      if (!window.confirm(msg)) return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/matches/${selectedMatch.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          home_score: parseInt(homeScore),
          away_score: parseInt(awayScore),
          status: 'finished',
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to finish match');
      }

      const updated = await res.json();
      setSelectedMatch(updated);
      setMatchStatus('finished');
      setSuccess('✓ Match finished');
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
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Score & Status</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={handleSaveScore}
                disabled={saving}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save Score'}
              </button>
              <button
                onClick={handleFinishMatch}
                disabled={saving || matchStatus === 'finished'}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'Processing...' : 'จบการแข่งขัน'}
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
              onGoalsChange={() => selectedMatch && loadMatchDataCallback(selectedMatch)}
            />
          </div>

          {/* Cards Manager */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Cards</h2>

            {/* Card Form */}
            <form onSubmit={handleAddCard} className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200 space-y-4">
              <h3 className="font-semibold text-gray-800">➕ Add Card</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Player</label>
                  <select
                    value={cardPlayerId}
                    onChange={(e) => setCardPlayerId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="">-- Select player --</option>
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        #{p.shirt_no} {p.full_name} ({p.team?.short_name || p.team?.name})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Card Type</label>
                  <select
                    value={cardType}
                    onChange={(e) => setCardType(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="yellow">ใบเหลือง</option>
                    <option value="second_yellow">ใบเหลืองที่ 2</option>
                    <option value="red">ใบแดง</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Minute</label>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={cardMinute}
                    onChange={(e) => setCardMinute(e.target.value)}
                    placeholder="optional"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Note</label>
                  <input
                    type="text"
                    value={cardNote}
                    onChange={(e) => setCardNote(e.target.value)}
                    placeholder="optional"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={addingCard || !cardPlayerId}
                className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {addingCard ? 'Adding...' : 'Add Card'}
              </button>
            </form>

            {/* Cards List */}
            <div className="space-y-2">
              <h3 className="font-semibold text-gray-800">Cards ({cards.length})</h3>
              {cards.length === 0 ? (
                <p className="text-slate-500 text-sm">No cards yet</p>
              ) : (
                <div className="space-y-2">
                  {cards.map((card) => (
                    <div key={card.id} className="flex items-center justify-between p-3 bg-slate-50 rounded border border-slate-200">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-slate-800">
                          #{card.player?.shirt_no} {card.player?.full_name}
                        </p>
                        <p className="text-xs text-slate-600">
                          {card.card_type === 'yellow' && '🟨 ใบเหลือง'}
                          {card.card_type === 'second_yellow' && '🟨🟨 ใบเหลืองที่ 2'}
                          {card.card_type === 'red' && '🟥 ใบแดง'}
                          {card.minute && ` · นาที ${card.minute}`}
                          {card.note && ` · ${card.note}`}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteCard(card.id)}
                        disabled={saving}
                        className="ml-3 px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
                      >
                        ลบ
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
