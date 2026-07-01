'use client';

import { useCallback, useEffect, useState } from 'react';
import { GoalsList } from '@/components/GoalsList';
import type { Match } from '@/types/db';

interface MatchWithTeams extends Match {
  home_team?: { id: string; name: string; short_name?: string };
  away_team?: { id: string; name: string; short_name?: string };
  division?: { name: string };
}

interface Goal {
  id: string;
  match_id: string;
  player_id: string;
  team_id: string;
  goals: number;
  minute?: number | null;
  created_at: string;
  updated_at: string;
  player?: {
    id: string;
    full_name: string;
    shirt_no?: number;
    team_id?: string;
    team?: {
      id?: string;
      name?: string;
      short_name?: string;
    } | null;
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

type CardType = 'yellow' | 'second_yellow' | 'red';

interface CardRow {
  rowId: string;
  playerId: string;
  cardType: CardType;
  minute: string;
  note: string;
}

function sortPlayersForMatch(
  players: Player[],
  homeTeamId?: string,
  awayTeamId?: string
): Player[] {
  return [...players].sort((a, b) => {
    const teamRank = (teamId: string) => {
      if (teamId === homeTeamId) return 0;
      if (teamId === awayTeamId) return 1;
      return 2;
    };

    const rankA = teamRank(a.team_id);
    const rankB = teamRank(b.team_id);
    if (rankA !== rankB) return rankA - rankB;

    const shirtA = a.shirt_no ?? 9999;
    const shirtB = b.shirt_no ?? 9999;
    if (shirtA !== shirtB) return shirtA - shirtB;

    return a.full_name.localeCompare(b.full_name, 'th');
  });
}

function createCardRow(): CardRow {
  return {
    rowId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    playerId: '',
    cardType: 'yellow' as CardType,
    minute: '',
    note: '',
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
  const [cardRows, setCardRows] = useState<CardRow[]>([createCardRow()]);
  const [addingCard, setAddingCard] = useState(false);

  // Staff discipline states
  const [staffs, setStaffs] = useState<any[]>([]);
  const [staffDisciplineEvents, setStaffDisciplineEvents] = useState<any[]>([]);
  const [staffId, setStaffId] = useState('');
  const [staffDisciplineType, setStaffDisciplineType] = useState<'warning' | 'caution' | 'ejection' | 'ban'>('warning');
  const [staffDisciplineMinute, setStaffDisciplineMinute] = useState('');
  const [staffDisciplineReason, setStaffDisciplineReason] = useState('');
  const [staffSuspendedMatches, setStaffSuspendedMatches] = useState('0');
  const [staffDisciplineNote, setStaffDisciplineNote] = useState('');
  const [addingStaffDiscipline, setAddingStaffDiscipline] = useState(false);

  const [loading, setLoading] = useState(false);
  const [loadingMatchData, setLoadingMatchData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Card row helpers
  const addCardRow = () => {
    setCardRows((prev) => [...prev, createCardRow()]);
  };

  const removeCardRow = (rowId: string) => {
    setCardRows((prev) => (prev.length > 1 ? prev.filter((r) => r.rowId !== rowId) : prev));
  };

  const updateCardRow = (rowId: string, field: keyof CardRow, value: string) => {
    setCardRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, [field]: value } : r))
    );
  };

  // Derived player groupings
  const homePlayers = players.filter((p) => p.team_id === selectedMatch?.home_team_id);
  const awayPlayers = players.filter((p) => p.team_id === selectedMatch?.away_team_id);

  const homeTeamName = selectedMatch?.home_team?.name || 'ทีมเหย้า';
  const awayTeamName = selectedMatch?.away_team?.name || 'ทีมเยือน';

  function playerOptionLabel(p: Player) {
    return `#${p.shirt_no ?? '—'} ${p.full_name}`;
  }

  // Sort cards by team, shirt_no, minute
  const sortedCards = [...cards].sort((a, b) => {
    const teamIdA = a.player?.team_id || '';
    const teamIdB = b.player?.team_id || '';

    const teamRank = (teamId: string) => {
      if (teamId === selectedMatch?.home_team_id) return 0;
      if (teamId === selectedMatch?.away_team_id) return 1;
      return 2;
    };

    const rankA = teamRank(teamIdA);
    const rankB = teamRank(teamIdB);
    if (rankA !== rankB) return rankA - rankB;

    const shirtA = a.player?.shirt_no ?? 9999;
    const shirtB = b.player?.shirt_no ?? 9999;
    if (shirtA !== shirtB) return shirtA - shirtB;

    const minuteA = a.minute ?? 9999;
    const minuteB = b.minute ?? 9999;
    if (minuteA !== minuteB) return minuteA - minuteB;

    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });

  // Staff helpers
  const homeStaffs = staffs.filter((s) => s.team_id === selectedMatch?.home_team_id);
  const awayStaffs = staffs.filter((s) => s.team_id === selectedMatch?.away_team_id);

  const staffPositionPriority = (position?: string | null) => {
    const p = String(position || '');
    if (p.includes('ผู้จัดการ')) return 0;
    if (p.includes('ผู้ฝึกสอน') && !p.includes('ผู้ช่วย')) return 1;
    if (p.includes('ผู้ช่วย')) return 2;
    if (p.includes('เจ้าหน้าที่')) return 3;
    return 9;
  };

  const sortedHomeStaffs = [...homeStaffs].sort((a, b) => staffPositionPriority(a.position) - staffPositionPriority(b.position));
  const sortedAwayStaffs = [...awayStaffs].sort((a, b) => staffPositionPriority(a.position) - staffPositionPriority(b.position));

  const [showFinishValidation, setShowFinishValidation] = useState(false);
  const [isEditingFinishedMatch, setIsEditingFinishedMatch] = useState(false);
  const [showConfirmEditFinished, setShowConfirmEditFinished] = useState(false);

  // Auto-hide success/error messages
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [error]);

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
        setError('ไม่สามารถโหลดข้อมูลแมตช์ได้');
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
      setLoadingMatchData(true);
      try {
        const token = localStorage.getItem('admin_token');

        // Load goals, cards, players, staffs, and staff discipline events
        const [goalsRes, cardsRes, playersRes, staffsRes, staffDisciplineRes] = await Promise.all([
          fetch(`/api/admin/goals?match_id=${match.id}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          }),
          fetch(`/api/admin/cards?matchId=${match.id}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          }),
          fetch(`/api/admin/players?teamIds=${match.home_team_id},${match.away_team_id}`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          }),
          fetch(`/api/admin/team-staffs?teamIds=${match.home_team_id},${match.away_team_id}&active=true`, {
            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
          }),
          fetch(`/api/admin/staff-discipline?matchId=${match.id}&status=active`, {
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
          setPlayers(sortPlayersForMatch(playersData, match.home_team_id, match.away_team_id));
        }
        if (staffsRes.ok) {
          const staffsData = await staffsRes.json();
          setStaffs(staffsData);
        }
        if (staffDisciplineRes.ok) {
          const disciplineData = await staffDisciplineRes.json();
          setStaffDisciplineEvents(disciplineData);
        }

        // Set score and status
        setHomeScore((match.home_score ?? 0).toString());
        setAwayScore((match.away_score ?? 0).toString());
        setMatchStatus(match.status || 'scheduled');

        // Reset card form
        setCardRows([createCardRow()]);
      } catch (err) {
        console.error('[MATCH_MANAGE] Load match data error:', err);
      } finally {
        setLoadingMatchData(false);
      }
    },
    []
  );

  const handleMatchSelect = (match: MatchWithTeams) => {
    setSelectedMatch(match);
    setSelectedMatchId(match.id);
    setIsEditingFinishedMatch(false);
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
        throw new Error('กรุณากรอกสกอร์เป็นตัวเลข');
      }
      if (homeScoreNum < 0 || awayScoreNum < 0) {
        throw new Error('สกอร์ต้องไม่ติดลบ');
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
        throw new Error(data.error || 'ไม่สามารถบันทึกสกอร์ได้');
      }

      const updated = await res.json();
      setSelectedMatch(updated);
      setSuccess('✓ บันทึกสกอร์เรียบร้อย');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleAddCard = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedMatch) return;

    const validRows = cardRows.filter((r) => r.playerId);

    if (validRows.length === 0) {
      setError('กรุณาเลือกนักเตะอย่างน้อย 1 คน');
      return;
    }

    // Validate minute for all rows
    for (const row of validRows) {
      const minuteValue = row.minute.trim() === '' ? null : Number(row.minute);

      if (
        minuteValue !== null &&
        (!Number.isInteger(minuteValue) || minuteValue < 0 || minuteValue > 120)
      ) {
        setError('นาทีของใบต้องเป็นตัวเลข 0-120 หรือเว้นว่าง');
        return;
      }
    }

    setAddingCard(true);
    setError(null);

    try {
      const token = localStorage.getItem('admin_token');

      for (const row of validRows) {
        const minuteValue = row.minute.trim() === '' ? null : Number(row.minute);

        const res = await fetch('/api/admin/cards', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            matchId: selectedMatch.id,
            playerId: row.playerId,
            cardType: row.cardType,
            minute: minuteValue,
            note: row.note.trim() || null,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const player = players.find((p) => p.id === row.playerId);
          throw new Error(
            data.error ||
              `ไม่สามารถเพิ่มใบให้ ${player?.full_name || 'นักเตะที่เลือก'} ได้`
          );
        }
      }

      setSuccess(`✓ เพิ่มใบเรียบร้อย ${validRows.length} รายการ`);
      setCardRows([createCardRow()]);

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
    if (!selectedMatch || !window.confirm('ยืนยันการลบใบนี้?')) return;

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
        throw new Error(data.error || 'ไม่สามารถลบใบได้');
      }

      setSuccess('✓ ลบใบเรียบร้อย');
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

  const handleAddStaffDiscipline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMatch || !staffId) {
      setError('กรุณาเลือกเจ้าหน้าที่ทีม');
      return;
    }

    const minuteValue = staffDisciplineMinute.trim() === '' ? null : Number(staffDisciplineMinute);

    if (minuteValue !== null && (!Number.isInteger(minuteValue) || minuteValue < 0 || minuteValue > 120)) {
      setError('นาทีต้องเป็นตัวเลข 0-120 หรือเว้นว่าง');
      return;
    }

    const suspendedMatchesValue = Number(staffSuspendedMatches || 0);
    if (!Number.isInteger(suspendedMatchesValue) || suspendedMatchesValue < 0) {
      setError('จำนวนแมตช์ที่แบนต้องเป็นตัวเลข 0 ขึ้นไป');
      return;
    }

    setAddingStaffDiscipline(true);
    setError(null);

    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/staff-discipline', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          matchId: selectedMatch.id,
          staffId,
          disciplineType: staffDisciplineType,
          minute: minuteValue,
          reason: staffDisciplineReason.trim() || null,
          suspendedMatches: suspendedMatchesValue,
          note: staffDisciplineNote.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'ไม่สามารถบันทึกโทษเจ้าหน้าที่ทีมได้');
      }

      setSuccess('✓ บันทึกโทษเจ้าหน้าที่ทีมเรียบร้อย');
      setStaffId('');
      setStaffDisciplineType('warning');
      setStaffDisciplineMinute('');
      setStaffDisciplineReason('');
      setStaffSuspendedMatches('0');
      setStaffDisciplineNote('');

      await loadMatchDataCallback(selectedMatch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setAddingStaffDiscipline(false);
    }
  };

  const handleDeleteStaffDiscipline = async (eventId: string) => {
    if (!selectedMatch || !window.confirm('ยืนยันการลบการบันทึกโทษนี้?')) return;

    setSaving(true);
    setError(null);

    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`/api/admin/staff-discipline/${eventId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'ไม่สามารถลบการบันทึกโทษได้');
      }

      setSuccess('✓ ลบการบันทึกโทษเรียบร้อย');
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

  // Normalize text for comparison
  const normalizeText = (value?: string | null): string => {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');
  };

  // Resolve team_id from goal with exact match first, then name-based fallback
  const getGoalTeamId = (goal: Goal): string | null => {
    // Collect candidate IDs
    const candidateIds = [
      goal.team_id,
      goal.team?.id,
      goal.player?.team_id,
      players.find((p) => p.id === goal.player_id)?.team_id,
    ].filter(Boolean) as string[];

    // Try exact ID match with match teams first
    for (const id of candidateIds) {
      if (id === selectedMatch?.home_team_id) return selectedMatch.home_team_id;
      if (id === selectedMatch?.away_team_id) return selectedMatch.away_team_id;
    }

    // Fallback by team name/short_name
    const goalTeamNames = [
      goal.team?.name,
      goal.team?.short_name,
      goal.player?.team?.name,
      goal.player?.team?.short_name,
      players.find((p) => p.id === goal.player_id)?.team?.name,
      players.find((p) => p.id === goal.player_id)?.team?.short_name,
    ].map(normalizeText).filter(Boolean);

    const homeNames = [
      selectedMatch?.home_team?.name,
      selectedMatch?.home_team?.short_name,
    ].map(normalizeText).filter(Boolean);

    const awayNames = [
      selectedMatch?.away_team?.name,
      selectedMatch?.away_team?.short_name,
    ].map(normalizeText).filter(Boolean);

    if (goalTeamNames.some((name) => homeNames.includes(name))) {
      return selectedMatch?.home_team_id || null;
    }

    if (goalTeamNames.some((name) => awayNames.includes(name))) {
      return selectedMatch?.away_team_id || null;
    }

    return candidateIds[0] || null;
  };

  const calculateGoalConsistency = () => {
    if (!selectedMatch) return null;

    const homeGoalSum = goals
      .filter((g) => getGoalTeamId(g) === selectedMatch.home_team_id)
      .reduce((sum, g) => sum + Number(g.goals || 0), 0);

    const awayGoalSum = goals
      .filter((g) => getGoalTeamId(g) === selectedMatch.away_team_id)
      .reduce((sum, g) => sum + Number(g.goals || 0), 0);

    const homeScoreNum = parseInt(homeScore);
    const awayScoreNum = parseInt(awayScore);

    // Debug logging (development only)
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[MATCH_MANAGE] Consistency check', {
        selectedMatch: {
          id: selectedMatch.id,
          home_team_id: selectedMatch.home_team_id,
          away_team_id: selectedMatch.away_team_id,
          home_team: selectedMatch.home_team,
          away_team: selectedMatch.away_team,
        },
        goals: goals.map((g) => ({
          id: g.id,
          player_id: g.player_id,
          raw_team_id: g.team_id,
          relation_team_id: g.team?.id,
          relation_team_name: g.team?.name,
          player_team_id: g.player?.team_id,
          player_team_name: g.player?.team?.name,
          resolved_team_id: getGoalTeamId(g),
          goals: g.goals,
        })),
        results: { homeGoalSum, awayGoalSum, homeScoreNum, awayScoreNum },
      });
    }

    return {
      homeMatches: homeGoalSum === homeScoreNum,
      awayMatches: awayGoalSum === awayScoreNum,
      homeGoalSum,
      awayGoalSum,
      homeScoreNum,
      awayScoreNum,
    };
  };

  // Helper functions
  const isFinished = selectedMatch?.status === 'finished';
  const isReadOnlyFinished = isFinished && !isEditingFinishedMatch;

  const handleOpenEditFinishedMatch = () => {
    setShowConfirmEditFinished(true);
  };

  const handleConfirmEditFinished = () => {
    setShowConfirmEditFinished(false);
    setIsEditingFinishedMatch(true);
  };

  const handleCancelEditFinished = () => {
    setShowConfirmEditFinished(false);
  };

  const handleCancelEditMode = async () => {
    setIsEditingFinishedMatch(false);
    // Reload match data to restore original values
    if (selectedMatch) {
      await loadMatchDataCallback(selectedMatch);
    }
  };

  const handleFinishMatch = async (confirmed = false) => {
    if (!selectedMatch) return;

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Fetch latest goals from server BEFORE validation
      const token = localStorage.getItem('admin_token');
      const goalsRes = await fetch(`/api/admin/goals?match_id=${selectedMatch.id}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });

      let freshGoals = goals;
      if (goalsRes.ok) {
        const goalsData = await goalsRes.json();
        freshGoals = goalsData || [];
        setGoals(freshGoals);
        console.debug('[MATCH_MANAGE] Fetched fresh goals:', freshGoals.length, 'records');
      } else {
        console.warn('[MATCH_MANAGE] Failed to fetch fresh goals, using cached state');
      }

      // Calculate consistency with fresh goals
      const homeGoalSum = freshGoals
        .filter((g: Goal) => getGoalTeamId(g) === selectedMatch.home_team_id)
        .reduce((sum, g: Goal) => sum + Number(g.goals || 0), 0);

      const awayGoalSum = freshGoals
        .filter((g: Goal) => getGoalTeamId(g) === selectedMatch.away_team_id)
        .reduce((sum, g: Goal) => sum + Number(g.goals || 0), 0);

      const homeScoreNum = parseInt(homeScore);
      const awayScoreNum = parseInt(awayScore);

      const homeMatches = homeGoalSum === homeScoreNum;
      const awayMatches = awayGoalSum === awayScoreNum;

      console.debug('[MATCH_MANAGE] Fresh consistency check:', {
        homeGoalSum,
        awayGoalSum,
        homeScoreNum,
        awayScoreNum,
        homeMatches,
        awayMatches,
      });

      // Show validation modal if there's a mismatch
      if (!homeMatches || !awayMatches) {
        if (!confirmed) {
          setShowFinishValidation(true);
          setSaving(false);
          return;
        }
      }

      // Proceed with finishing the match
      if (!token) {
        throw new Error('Not authenticated');
      }

      const res = await fetch(`/api/admin/matches/${selectedMatch.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          home_score: homeScoreNum,
          away_score: awayScoreNum,
          status: 'finished',
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'ไม่สามารถจบการแข่งขันได้');
      }

      const updated = await res.json();
      setSelectedMatch(updated);
      setMatchStatus('finished');
      setShowFinishValidation(false);
      if (isEditingFinishedMatch) {
        setIsEditingFinishedMatch(false);
        setSuccess(`✓ ยืนยันการแก้ไขผลการแข่งขันเรียบร้อย (${updated.home_score}-${updated.away_score})`);
      } else {
        setSuccess(`✓ จบการแข่งขันเรียบร้อย (${updated.home_score}-${updated.away_score}) · ข้อมูล Sync ไปยังหน้า Public`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
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
      <div className="bg-white rounded-lg shadow p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">เลือกแมตช์</h2>
        <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-6">
          {/* Season */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">ฤดูกาล</label>
            <select
              value={seasonId}
              onChange={(e) => setSeasonId(e.target.value)}
              className="w-full px-3 sm:px-4 py-2.5 sm:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm sm:text-base"
            >
              <option value="">-- เลือกฤดูกาล --</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.year})
                </option>
              ))}
            </select>
          </div>

          {/* Age Group */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">ระดับอายุ</label>
            <select
              value={ageGroupId}
              onChange={(e) => setAgeGroupId(e.target.value)}
              disabled={!seasonId}
              className="w-full px-3 sm:px-4 py-2.5 sm:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100 text-sm sm:text-base"
            >
              <option value="">-- เลือกระดับอายุ --</option>
              {ageGroups.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.code} - {ag.name}
                </option>
              ))}
            </select>
          </div>

          {/* Division */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">ดิวิชั่น</label>
            <select
              value={divisionId}
              onChange={(e) => setDivisionId(e.target.value)}
              disabled={!ageGroupId}
              className="w-full px-3 sm:px-4 py-2.5 sm:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100 text-sm sm:text-base"
            >
              <option value="">-- เลือกดิวิชั่น --</option>
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
          <div className="flex items-center justify-center py-6">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-2"></div>
            <span className="text-gray-600 text-sm">กำลังโหลดแมตช์...</span>
          </div>
        ) : matches.length > 0 ? (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">เลือกแมตช์</label>
            <select
              value={selectedMatchId}
              onChange={(e) => {
                const match = matches.find((m) => m.id === e.target.value);
                if (match) {
                  handleMatchSelect(match);
                }
              }}
              className="w-full px-3 sm:px-4 py-2.5 sm:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm sm:text-base"
            >
              <option value="">-- เลือกแมตช์ --</option>
              {matches.map((match) => (
                <option key={match.id} value={match.id}>
                  MD{match.matchday} | {new Date(match.match_date).toLocaleDateString('th-TH')}
                  {match.match_time && ` ${match.match_time.substring(0, 5)}`} | {match.home_team?.name || 'ทีมเหย้า'} vs{' '}
                  {match.away_team?.name || 'ทีมเยือน'}
                  {match.status === 'finished' && match.home_score != null && match.away_score != null
                    ? ` (${match.home_score}-${match.away_score})`
                    : ''}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="text-center py-6 sm:py-8">
            <p className="text-gray-500 text-sm">ไม่พบแมตช์ กรุณาเลือกดิวิชั่น</p>
          </div>
        )}
      </div>

      {/* Error/Success */}
      {error && (
        <div className="p-3 sm:p-4 bg-red-50 border border-red-200 rounded-lg animate-in fade-in">
          <p className="text-red-700 text-sm sm:text-base">❌ {error}</p>
        </div>
      )}
      {success && (
        <div className="p-3 sm:p-4 bg-green-50 border border-green-200 rounded-lg animate-in fade-in">
          <p className="text-green-700 text-sm sm:text-base font-semibold">{success}</p>
        </div>
      )}

      {/* Confirm Edit Finished Match Modal */}
      {showConfirmEditFinished && selectedMatch && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:w-full max-w-md p-4 sm:p-6 space-y-4">
            <h3 className="text-lg sm:text-xl font-bold text-gray-800">เปิดแก้ไขผลการแข่งขัน</h3>

            <div className="bg-amber-50 p-4 rounded-lg border border-amber-200 text-sm text-amber-800 space-y-2">
              <p className="font-semibold">⚠️ เตือน:</p>
              <p>การแก้ไขผลการแข่งขันที่จบแล้ว อาจส่งผลต่อ:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>หน้า Public (ผลแมตช์, ตารางคะแนน)</li>
                <li>ดาวซัลโว (จำนวนประตู)</li>
                <li>โทษแบน (ใบเหลือง/แดง)</li>
              </ul>
            </div>

            <div className="space-y-2 sm:space-y-0 sm:flex sm:gap-3">
              <button
                onClick={handleCancelEditFinished}
                className="w-full sm:flex-1 px-4 py-3 sm:py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 font-semibold text-sm sm:text-base transition"
              >
                ยกเลิก
              </button>
              <button
                onClick={handleConfirmEditFinished}
                className="w-full sm:flex-1 px-4 py-3 sm:py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-semibold text-sm sm:text-base transition"
              >
                ✓ เปิดแก้ไข
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Finish Match Validation Modal */}
      {showFinishValidation && selectedMatch && (() => {
        // Use goals from state (which should be fresh after fetch)
        const homeGoalSum = goals
          .filter((g) => getGoalTeamId(g) === selectedMatch.home_team_id)
          .reduce((sum, g) => sum + Number(g.goals || 0), 0);

        const awayGoalSum = goals
          .filter((g) => getGoalTeamId(g) === selectedMatch.away_team_id)
          .reduce((sum, g) => sum + Number(g.goals || 0), 0);

        const homeScoreNum = parseInt(homeScore);
        const awayScoreNum = parseInt(awayScore);

        const homeMatches = homeGoalSum === homeScoreNum;
        const awayMatches = awayGoalSum === awayScoreNum;
        const hasError = !homeMatches || !awayMatches;

        return (
          <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:w-full max-w-md p-4 sm:p-6 space-y-4">
              <h3 className="text-lg sm:text-xl font-bold text-gray-800">ตรวจสอบก่อนจบการแข่งขัน</h3>

              <div className="space-y-3 sm:space-y-4 py-2">
                {/* Home Team */}
                <div className="p-3 sm:p-4 rounded-lg border-2" style={{ borderColor: homeMatches ? '#10b981' : '#ef4444', backgroundColor: homeMatches ? '#ecfdf5' : '#fef2f2' }}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-800">{selectedMatch.home_team?.name || 'ทีมเหย้า'}</span>
                    <span className="text-2xl">{homeMatches ? '✅' : '⚠️'}</span>
                  </div>
                  <div className="text-sm text-gray-600 mt-2">
                    <p>Score: <span className="font-bold text-gray-800">{homeScoreNum}</span></p>
                    <p>Goals: <span className="font-bold text-gray-800">{homeGoalSum}</span></p>
                    {homeMatches ? (
                      <p className="text-green-600 font-semibold mt-1">✓ ตรงกัน</p>
                    ) : (
                      <p className="text-red-600 font-semibold mt-1">✗ ไม่ตรงกัน</p>
                    )}
                  </div>
                </div>

                {/* Away Team */}
                <div className="p-3 sm:p-4 rounded-lg border-2" style={{ borderColor: awayMatches ? '#10b981' : '#ef4444', backgroundColor: awayMatches ? '#ecfdf5' : '#fef2f2' }}>
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-gray-800">{selectedMatch.away_team?.name || 'ทีมเยือน'}</span>
                    <span className="text-2xl">{awayMatches ? '✅' : '⚠️'}</span>
                  </div>
                  <div className="text-sm text-gray-600 mt-2">
                    <p>Score: <span className="font-bold text-gray-800">{awayScoreNum}</span></p>
                    <p>Goals: <span className="font-bold text-gray-800">{awayGoalSum}</span></p>
                    {awayMatches ? (
                      <p className="text-green-600 font-semibold mt-1">✓ ตรงกัน</p>
                    ) : (
                      <p className="text-red-600 font-semibold mt-1">✗ ไม่ตรงกัน</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-slate-100 p-3 sm:p-4 rounded-lg text-sm text-slate-700">
                {hasError ? (
                  <p>ข้อมูลประตูไม่ตรงกับสกอร์ ตรวจสอบข้อมูลการลงทะเบียนของผู้เล่นหรือปรับสกอร์</p>
                ) : (
                  <p className="text-green-700 font-semibold">✓ ข้อมูลถูกต้อง พร้อมจบการแข่งขัน</p>
                )}
              </div>

              <div className="space-y-2 sm:space-y-0 sm:flex sm:gap-3">
                <button
                  onClick={() => setShowFinishValidation(false)}
                  className="w-full sm:flex-1 px-4 py-3 sm:py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 font-semibold text-sm sm:text-base transition"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={() => handleFinishMatch(true)}
                  disabled={saving}
                  className={`w-full sm:flex-1 px-4 py-3 sm:py-2 rounded-lg font-semibold text-sm sm:text-base transition ${
                    hasError
                      ? 'bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50'
                      : 'bg-green-600 text-white hover:bg-green-700 disabled:opacity-50'
                  }`}
                >
                  {saving ? 'กำลังประมวลผล...' : (hasError ? '🚨 จบแมตช์แม้ไม่ตรง' : '✓ จบการแข่งขัน')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Match Detail & Management */}
      {selectedMatch && (
        <>
          {/* Match Summary */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">สรุปการแข่งขัน</h2>
            <div className="space-y-2 text-sm sm:text-base">
              <p>
                <span className="font-semibold">นัด:</span> MD{selectedMatch.matchday}
              </p>
              <p>
                <span className="font-semibold">วันที่:</span>{' '}
                {new Date(selectedMatch.match_date).toLocaleDateString('th-TH')}
                {selectedMatch.match_time && ` ${selectedMatch.match_time.substring(0, 5)}`}
              </p>
              <p>
                <span className="font-semibold">ดิวิชั่น:</span> {selectedMatch.division?.name || 'ไม่ระบุ'}
              </p>
              <p>
                <span className="font-semibold">ทีม:</span> {selectedMatch.home_team?.name || 'ทีมเหย้า'} vs{' '}
                {selectedMatch.away_team?.name || 'ทีมเยือน'}
              </p>
            </div>
          </div>

          {/* Score Editor */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">สกอร์ & สถานะ</h2>
            <div className="space-y-3 sm:space-y-4 mb-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  {selectedMatch.home_team?.name || 'ทีมเหย้า'}
                </label>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={homeScore}
                  onChange={(e) => setHomeScore(e.target.value)}
                  disabled={saving || loadingMatchData || isReadOnlyFinished}
                  className="w-full px-3 sm:px-4 py-3 sm:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100 text-base sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">สถานะ</label>
                <select
                  value={matchStatus}
                  onChange={(e) => setMatchStatus(e.target.value)}
                  disabled={isReadOnlyFinished}
                  className="w-full px-3 sm:px-4 py-3 sm:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100 text-sm sm:text-base"
                >
                  <option value="scheduled">ยังไม่แข่ง</option>
                  <option value="finished">แข่งจบแล้ว</option>
                  <option value="postponed">เลื่อนการแข่ง</option>
                  <option value="cancelled">ยกเลิก</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  {selectedMatch.away_team?.name || 'ทีมเยือน'}
                </label>
                <input
                  type="number"
                  min="0"
                  max="99"
                  value={awayScore}
                  onChange={(e) => setAwayScore(e.target.value)}
                  disabled={saving || loadingMatchData || isReadOnlyFinished}
                  className="w-full px-3 sm:px-4 py-3 sm:py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100 text-base sm:text-sm"
                />
              </div>
            </div>

            {isReadOnlyFinished ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-amber-800 text-sm font-semibold mb-3">
                  ⚠️ แมตช์นี้จบการแข่งขันแล้ว
                </p>
                <p className="text-amber-700 text-sm mb-4">
                  หากต้องการแก้ไขผลการแข่งขัน ผู้ทำประตู หรือใบเหลือง/แดง กรุณากดเปิดแก้ไขก่อน
                </p>
                <button
                  onClick={handleOpenEditFinishedMatch}
                  className="w-full bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700 font-semibold text-sm transition"
                >
                  🔓 เปิดแก้ไขผลการแข่งขัน
                </button>
              </div>
            ) : isEditingFinishedMatch ? (
              <div className="space-y-3">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-blue-800 text-sm font-semibold">
                    ℹ️ โหมดแก้ไขผลย้อนหลัง
                  </p>
                  <p className="text-blue-700 text-xs mt-2">
                    หลังแก้ไขเสร็จ กรุณาตรวจสอบสกอร์ ผู้ทำประตู และใบเหลือง/แดงอีกครั้ง
                  </p>
                </div>
                <div className="space-y-2 sm:space-y-0 sm:grid sm:grid-cols-2 sm:gap-3">
                  <button
                    onClick={() => handleCancelEditMode()}
                    className="bg-gray-400 text-white px-4 py-3 sm:py-2 rounded-lg hover:bg-gray-500 font-semibold text-sm sm:text-base transition"
                  >
                    ยกเลิกโหมดแก้ไข
                  </button>
                  <button
                    onClick={() => handleFinishMatch()}
                    disabled={saving}
                    className="bg-green-600 text-white px-4 py-3 sm:py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 font-semibold text-sm sm:text-base transition"
                  >
                    {saving ? 'กำลังประมวลผล...' : '✅ ตรวจสอบและยืนยันผล'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 sm:space-y-0 sm:grid sm:grid-cols-2 sm:gap-3">
                <button
                  onClick={handleSaveScore}
                  disabled={saving || loadingMatchData}
                  className="bg-blue-600 text-white px-4 py-3 sm:py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold text-sm sm:text-base transition"
                >
                  {saving ? 'กำลังบันทึก...' : 'บันทึกสกอร์'}
                </button>
                <button
                  onClick={() => handleFinishMatch()}
                  disabled={saving || loadingMatchData}
                  className="bg-green-600 text-white px-4 py-3 sm:py-2 rounded-lg hover:bg-green-700 disabled:opacity-50 font-semibold text-sm sm:text-base transition"
                >
                  {saving ? 'กำลังประมวลผล...' : '🏁 จบการแข่งขัน'}
                </button>
              </div>
            )}
          </div>

          {/* Loading indicator for match data */}
          {loadingMatchData && (
            <div className="flex items-center justify-center py-6 bg-blue-50 rounded-lg border border-blue-200">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 mr-3"></div>
              <span className="text-blue-600 font-semibold text-sm">กำลังโหลดข้อมูลแมตช์...</span>
            </div>
          )}

          {/* Goals */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">ประตู</h2>
            {isReadOnlyFinished ? (
              <div className="text-center py-8">
                <p className="text-slate-500 text-sm mb-3">📌 เปิดแก้ไขก่อนจึงจะแก้ผู้ทำประตูได้</p>
                <button
                  onClick={handleOpenEditFinishedMatch}
                  className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-semibold text-sm transition"
                >
                  🔓 เปิดแก้ไข
                </button>
              </div>
            ) : (
              <GoalsList
                matchId={selectedMatch.id}
                homeTeamId={selectedMatch.home_team_id}
                awayTeamId={selectedMatch.away_team_id}
                goals={goals}
                isLoading={false}
                onGoalsChange={() => selectedMatch && loadMatchDataCallback(selectedMatch)}
              />
            )}
          </div>

          {/* Cards Manager */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">ใบเหลือง/ใบแดง</h2>

            {isReadOnlyFinished && (
              <div className="text-center py-8 bg-slate-50 rounded-lg mb-6">
                <p className="text-slate-500 text-sm mb-3">📌 เปิดแก้ไขก่อนจึงจะแก้ใบเหลือง/แดงได้</p>
                <button
                  onClick={handleOpenEditFinishedMatch}
                  className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-semibold text-sm transition"
                >
                  🔓 เปิดแก้ไข
                </button>
              </div>
            )}

            {/* Card Form */}
            {!isReadOnlyFinished && (
            <form onSubmit={handleAddCard} className="mb-6 p-3 sm:p-4 bg-blue-50 rounded-lg border border-blue-200 space-y-3 sm:space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-gray-800 text-sm sm:text-base">➕ เพิ่มใบหลายรายการ</h3>
                <button
                  type="button"
                  onClick={addCardRow}
                  disabled={addingCard}
                  className="px-3 py-1.5 bg-white border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 text-sm font-semibold disabled:opacity-50"
                >
                  + เพิ่มแถว
                </button>
              </div>

              <div className="space-y-2">
                {cardRows.map((row, index) => (
                  <div
                    key={row.rowId}
                    className="grid grid-cols-1 lg:grid-cols-[32px_1.4fr_160px_100px_1fr_44px] gap-2 items-end bg-white/70 p-3 rounded-lg border border-blue-100"
                  >
                    <div className="text-xs text-gray-500 font-semibold pb-2">
                      {index + 1}.
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">นักเตะ</label>
                      <select
                        value={row.playerId}
                        onChange={(e) => updateCardRow(row.rowId, 'playerId', e.target.value)}
                        disabled={players.length === 0 || addingCard}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:bg-gray-100 text-sm"
                      >
                        <option value="">
                          {players.length === 0 ? '-- โหลดนักเตะ --' : '-- เลือกนักเตะ --'}
                        </option>

                        {homePlayers.length > 0 && (
                          <optgroup label={homeTeamName}>
                            {homePlayers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {playerOptionLabel(p)}
                              </option>
                            ))}
                          </optgroup>
                        )}

                        {awayPlayers.length > 0 && (
                          <optgroup label={awayTeamName}>
                            {awayPlayers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {playerOptionLabel(p)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">ประเภท</label>
                      <select
                        value={row.cardType}
                        onChange={(e) => updateCardRow(row.rowId, 'cardType', e.target.value)}
                        disabled={addingCard}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                      >
                        <option value="yellow">ใบเหลือง</option>
                        <option value="second_yellow">ใบเหลืองที่ 2</option>
                        <option value="red">ใบแดง</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">นาที</label>
                      <input
                        type="number"
                        min="0"
                        max="120"
                        value={row.minute}
                        onChange={(e) => updateCardRow(row.rowId, 'minute', e.target.value)}
                        disabled={addingCard}
                        placeholder="-"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">หมายเหตุ</label>
                      <input
                        type="text"
                        value={row.note}
                        onChange={(e) => updateCardRow(row.rowId, 'note', e.target.value)}
                        disabled={addingCard}
                        placeholder="ไม่บังคับ"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => removeCardRow(row.rowId)}
                      disabled={addingCard || cardRows.length === 1}
                      className="px-3 py-2 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-40 text-sm font-semibold"
                      title="ลบแถว"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <button
                type="submit"
                disabled={addingCard || cardRows.every((r) => !r.playerId)}
                className="w-full bg-blue-600 text-white px-4 py-3 sm:py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-semibold text-sm sm:text-base transition"
              >
                {addingCard
                  ? 'กำลังเพิ่ม...'
                  : `เพิ่มใบ (${cardRows.filter((r) => r.playerId).length || 0} รายการ)`}
              </button>
            </form>
            )}

            {/* Cards List */}
            <div className="space-y-2 sm:space-y-3">
              <h3 className="font-semibold text-gray-800 text-base sm:text-lg">ใบแสดง ({cards.length})</h3>
              {cards.length === 0 ? (
                <p className="text-slate-500 text-sm">ยังไม่มีใบแสดง</p>
              ) : (
                <div className="space-y-2 sm:space-y-3">
                  {sortedCards.map((card) => (
                    <div key={card.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 bg-slate-50 rounded border border-slate-200">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm sm:text-base text-slate-800">
                          #{card.player?.shirt_no} {card.player?.full_name || 'ไม่ระบุ'}
                        </p>
                        <p className="text-xs sm:text-sm text-slate-600 mt-1">
                          {card.card_type === 'yellow' && '🟨 ใบเหลือง'}
                          {card.card_type === 'second_yellow' && '🟨🟨 ใบเหลืองที่ 2'}
                          {card.card_type === 'red' && '🟥 ใบแดง'}
                          {card.minute !== null && card.minute !== undefined ? ` · นาที ${card.minute}` : ' · ไม่ระบุนาที'}
                          {card.note && ` · ${card.note}`}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteCard(card.id)}
                        disabled={saving || isReadOnlyFinished}
                        className="w-full sm:w-auto px-3 sm:px-4 py-2 sm:py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 font-semibold transition"
                      >
                        ลบ
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Staff Discipline Manager */}
          <div className="bg-white rounded-lg shadow p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">👔 เจ้าหน้าที่ทีม / ผู้ฝึกสอน</h2>

            {isReadOnlyFinished && (
              <div className="text-center py-8 bg-slate-50 rounded-lg mb-6">
                <p className="text-slate-500 text-sm mb-3">📌 เปิดแก้ไขก่อนจึงจะแก้โทษเจ้าหน้าที่ทีมได้</p>
                <button
                  onClick={handleOpenEditFinishedMatch}
                  className="inline-block bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 font-semibold text-sm transition"
                >
                  🔓 เปิดแก้ไข
                </button>
              </div>
            )}

            {/* Staff Discipline Form */}
            {!isReadOnlyFinished && (
            <form onSubmit={handleAddStaffDiscipline} className="mb-6 p-3 sm:p-4 bg-purple-50 rounded-lg border border-purple-200 space-y-3 sm:space-y-4">
              <h3 className="font-semibold text-gray-800 text-sm sm:text-base">➕ บันทึกโทษเจ้าหน้าที่ทีม</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">เจ้าหน้าที่ทีม *</label>
                  <select
                    value={staffId}
                    onChange={(e) => setStaffId(e.target.value)}
                    disabled={addingStaffDiscipline}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm"
                  >
                    <option value="">-- เลือกเจ้าหน้าที่ทีม --</option>
                    {sortedHomeStaffs.length > 0 && (
                      <optgroup label={homeTeamName}>
                        {sortedHomeStaffs.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.position} · {s.full_name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {sortedAwayStaffs.length > 0 && (
                      <optgroup label={awayTeamName}>
                        {sortedAwayStaffs.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.position} · {s.full_name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">ประเภท *</label>
                  <select
                    value={staffDisciplineType}
                    onChange={(e) => setStaffDisciplineType(e.target.value as any)}
                    disabled={addingStaffDiscipline}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm"
                  >
                    <option value="warning">🟨 การคาดโทษ (ใบเหลือง)</option>
                    <option value="ejection">🟥 การไล่ออก (ใบแดง)</option>
                    <option value="ban">🚫 แบน / ห้ามคุมทีม</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">นาที</label>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={staffDisciplineMinute}
                    onChange={(e) => setStaffDisciplineMinute(e.target.value)}
                    disabled={addingStaffDiscipline}
                    placeholder="ไม่บังคับ"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">แมตช์ที่แบน</label>
                  <input
                    type="number"
                    min="0"
                    value={staffSuspendedMatches}
                    onChange={(e) => setStaffSuspendedMatches(e.target.value)}
                    disabled={addingStaffDiscipline}
                    placeholder="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">เหตุผล</label>
                <input
                  type="text"
                  value={staffDisciplineReason}
                  onChange={(e) => setStaffDisciplineReason(e.target.value)}
                  disabled={addingStaffDiscipline}
                  placeholder="เช่น ประท้วงคำตัดสิน"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">หมายเหตุ</label>
                <input
                  type="text"
                  value={staffDisciplineNote}
                  onChange={(e) => setStaffDisciplineNote(e.target.value)}
                  disabled={addingStaffDiscipline}
                  placeholder="ไม่บังคับ"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={addingStaffDiscipline || !staffId}
                className="w-full bg-purple-600 text-white px-4 py-3 sm:py-2 rounded-lg hover:bg-purple-700 disabled:opacity-50 font-semibold text-sm sm:text-base transition"
              >
                {addingStaffDiscipline ? 'กำลังบันทึก...' : '💾 บันทึกโทษ'}
              </button>
            </form>
            )}

            {/* Staff Discipline List */}
            <div className="space-y-2 sm:space-y-3">
              <h3 className="font-semibold text-gray-800 text-base sm:text-lg">การบันทึกโทษ ({staffDisciplineEvents.length})</h3>
              {staffDisciplineEvents.length === 0 ? (
                <p className="text-slate-500 text-sm">ยังไม่มีการบันทึกโทษเจ้าหน้าที่ทีม</p>
              ) : (
                <div className="space-y-2 sm:space-y-3">
                  {staffDisciplineEvents.map((event) => (
                    <div key={event.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 bg-slate-50 rounded border border-slate-200">
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm sm:text-base text-slate-800">
                          {event.minute !== null ? `นาที ${event.minute}'` : 'ไม่ระบุนาที'} · {event.staff?.full_name} · {event.staff?.position}
                        </p>
                        <p className="text-xs sm:text-sm text-slate-600 mt-1">
                          {(event.discipline_type === 'warning' || event.discipline_type === 'caution') && '🟨 การคาดโทษ (ใบเหลือง)'}
                          {event.discipline_type === 'ejection' && '🟥 การไล่ออก (ใบแดง)'}
                          {event.discipline_type === 'ban' && '🚫 แบน / ห้ามคุมทีม'}
                          {event.suspended_matches > 0 && ` · แบน ${event.suspended_matches} แมตช์`}
                          {event.reason && ` · ${event.reason}`}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteStaffDiscipline(event.id)}
                        disabled={saving || isReadOnlyFinished}
                        className="w-full sm:w-auto px-3 sm:px-4 py-2 sm:py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 font-semibold transition"
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
