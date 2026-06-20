'use client';

import { useEffect, useState, useCallback } from 'react';
import { MatchSummaryCard } from '@/components/cards/MatchSummaryCard';
import { QuickAddCardForm } from '@/components/cards/QuickAddCardForm';
import { BulkAddCardForm } from '@/components/cards/BulkAddCardForm';
import { CardsInMatchPanel } from '@/components/cards/CardsInMatchPanel';
import { SuspensionImpactPanel } from '@/components/cards/SuspensionImpactPanel';

// ─── Types ──────────────────────────────────────────────────────────────────

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
  matchday: number | string;
  match_date?: string;
  match_time?: string;
  home_team_id: string;
  away_team_id: string;
  home_score?: number | null;
  away_score?: number | null;
  status?: string;
  home_team?: { name: string; short_name: string };
  away_team?: { name: string; short_name: string };
  division?: { name: string };
}

interface Card {
  id: string;
  match_id: string;
  player_id: string;
  card_type: string;
  minute: number | null;
  note: string | null;
  created_at: string;
  player?: {
    id: string;
    full_name: string;
    shirt_no?: number | null;
    team_id?: string;
    team?: { name: string; short_name: string };
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchLabel(m: Match): string {
  const code = m.match_code || m.id.substring(0, 8);
  const time = m.match_time ? m.match_time.substring(0, 5) : '--:--';
  const home =
    m.home_team?.name || m.home_team?.short_name || 'ทีมเหย้า';
  const away =
    m.away_team?.name || m.away_team?.short_name || 'ทีมเยือน';
  const score =
    m.home_score != null && m.away_score != null
      ? `${m.home_score}–${m.away_score}`
      : 'vs';
  return `[${code}] MD${m.matchday} | ${time} | ${home} ${score} ${away}`;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CardsPage() {
  // Cascading selectors
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);

  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedAgeGroup, setSelectedAgeGroup] = useState('');
  const [selectedDivision, setSelectedDivision] = useState('');
  const [selectedMatch, setSelectedMatch] = useState('');

  const [isLoadingSeasons, setIsLoadingSeasons] = useState(true);
  const [isLoadingAgeGroups, setIsLoadingAgeGroups] = useState(false);
  const [isLoadingDivisions, setIsLoadingDivisions] = useState(false);
  const [isLoadingMatches, setIsLoadingMatches] = useState(false);
  const [isLoadingCards, setIsLoadingCards] = useState(false);

  const [cards, setCards] = useState<Card[]>([]);

  // ── Load seasons ──────────────────────────────────────────────────────────

  useEffect(() => {
    const fetch_ = async () => {
      try {
        const res = await fetch('/api/public/seasons');
        if (res.ok) {
          const data: Season[] = await res.json();
          setSeasons(data);
          if (data.length > 0) setSelectedSeason(data[0].id);
        }
      } finally {
        setIsLoadingSeasons(false);
      }
    };
    fetch_();
  }, []);

  // ── Load age groups ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedSeason) return;
    setIsLoadingAgeGroups(true);
    setSelectedAgeGroup('');
    setSelectedDivision('');
    setSelectedMatch('');
    setCards([]);

    fetch(`/api/public/age-groups?seasonId=${selectedSeason}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: AgeGroup[]) => {
        setAgeGroups(data);
        if (data.length > 0) setSelectedAgeGroup(data[0].id);
      })
      .finally(() => setIsLoadingAgeGroups(false));
  }, [selectedSeason]);

  // ── Load divisions ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedSeason || !selectedAgeGroup) return;
    setIsLoadingDivisions(true);
    setSelectedDivision('');
    setSelectedMatch('');
    setCards([]);

    fetch(`/api/public/divisions?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: Division[]) => {
        setDivisions(data);
        if (data.length > 0) setSelectedDivision(data[0].id);
      })
      .finally(() => setIsLoadingDivisions(false));
  }, [selectedSeason, selectedAgeGroup]);

  // ── Load matches ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!selectedSeason || !selectedAgeGroup || !selectedDivision) return;
    setIsLoadingMatches(true);
    setSelectedMatch('');
    setCards([]);

    fetch(
      `/api/public/matches?seasonId=${selectedSeason}&ageGroupId=${selectedAgeGroup}&divisionId=${selectedDivision}`
    )
      .then((r) => r.ok ? r.json() : [])
      .then((data: Match[]) => setMatches(data))
      .finally(() => setIsLoadingMatches(false));
  }, [selectedSeason, selectedAgeGroup, selectedDivision]);

  // ── Load cards ────────────────────────────────────────────────────────────

  const fetchCards = useCallback(async (matchId: string) => {
    if (!matchId) { setCards([]); return; }
    setIsLoadingCards(true);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/cards?matchId=${matchId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setCards(await res.json());
    } finally {
      setIsLoadingCards(false);
    }
  }, []);

  useEffect(() => {
    if (selectedMatch) fetchCards(selectedMatch);
    else setCards([]);
  }, [selectedMatch, fetchCards]);

  const refreshCards = useCallback(() => {
    if (selectedMatch) fetchCards(selectedMatch);
  }, [selectedMatch, fetchCards]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const selectedMatchData = matches.find((m) => m.id === selectedMatch);

  const selectClass =
    'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 bg-white';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold text-gray-800">🟨 Card Management</h1>
        <p className="text-gray-600 mt-1">จัดการใบเหลือง ใบแดง และโทษแบน</p>
      </div>

      {/* ── Match Selector ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Season */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Season</label>
            <select
              value={selectedSeason}
              onChange={(e) => setSelectedSeason(e.target.value)}
              disabled={isLoadingSeasons}
              className={selectClass}
            >
              <option value="">เลือก Season...</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Age Group */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Age Group</label>
            <select
              value={selectedAgeGroup}
              onChange={(e) => setSelectedAgeGroup(e.target.value)}
              disabled={isLoadingAgeGroups || !selectedSeason}
              className={selectClass}
            >
              <option value="">เลือก Age Group...</option>
              {ageGroups.map((ag) => (
                <option key={ag.id} value={ag.id}>{ag.name}</option>
              ))}
            </select>
          </div>

          {/* Division */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Division</label>
            <select
              value={selectedDivision}
              onChange={(e) => setSelectedDivision(e.target.value)}
              disabled={isLoadingDivisions || !selectedAgeGroup}
              className={selectClass}
            >
              <option value="">เลือก Division...</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          {/* Match */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Match</label>
            <select
              value={selectedMatch}
              onChange={(e) => setSelectedMatch(e.target.value)}
              disabled={isLoadingMatches || !selectedDivision}
              className={selectClass}
            >
              <option value="">เลือก Match...</option>
              {matches.map((m) => (
                <option key={m.id} value={m.id}>{matchLabel(m)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Content (only when match selected) ─────────────────────────── */}
      {!selectedMatch && selectedDivision && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-blue-700 text-sm">
          เลือก Match เพื่อจัดการใบโทษ
        </div>
      )}

      {selectedMatch && selectedMatchData && (
        <>
          {/* Match Summary */}
          <MatchSummaryCard match={selectedMatchData} cards={cards} />

          {/* Two-column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            {/* ── Left: Add forms ────────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-4">
              {/* Quick Add */}
              <div className="bg-white rounded-lg shadow p-4">
                <QuickAddCardForm
                  matchId={selectedMatch}
                  homeTeamId={selectedMatchData.home_team_id}
                  awayTeamId={selectedMatchData.away_team_id}
                  onSuccess={refreshCards}
                />
              </div>

              {/* Bulk Add */}
              <div className="bg-white rounded-lg shadow p-4">
                <BulkAddCardForm
                  matchId={selectedMatch}
                  homeTeamId={selectedMatchData.home_team_id}
                  awayTeamId={selectedMatchData.away_team_id}
                  onSuccess={refreshCards}
                />
              </div>
            </div>

            {/* ── Right: Cards list + impact ─────────────────────────────── */}
            <div className="lg:col-span-3 space-y-4">
              {/* Cards in Match */}
              <div className="bg-white rounded-lg shadow p-4">
                <CardsInMatchPanel
                  cards={cards}
                  isLoading={isLoadingCards}
                  onCardsChanged={refreshCards}
                />
              </div>

              {/* Suspension Impact */}
              <div className="bg-white rounded-lg shadow p-4">
                <SuspensionImpactPanel cards={cards} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
