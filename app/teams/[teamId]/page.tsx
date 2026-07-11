'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TeamLogo } from '@/components/TeamLogo';

interface TeamProfile {
  team: {
    id: string;
    name: string;
    short_name?: string | null;
    logo_url?: string | null;
    season_id?: string | null;
    age_group_id?: string | null;
    division_id?: string | null;
    division?: { id: string; name: string } | null;
    age_group?: { id: string; code: string; name: string } | null;
    season?: { id: string; name: string; year: number } | null;
  };
  players: Array<{
    id: string;
    full_name: string;
    shirt_no?: number | null;
    position?: string | null;
    team_id: string;
  }>;
  matches: Array<{
    id: string;
    match_code?: string | null;
    matchday?: number | string | null;
    match_date: string;
    match_time?: string | null;
    status: string;
    home_score?: number | null;
    away_score?: number | null;
    home_team_id: string;
    away_team_id: string;
    home_team?: { id: string; name: string; short_name?: string | null } | null;
    away_team?: { id: string; name: string; short_name?: string | null } | null;
    division?: { id: string; name: string } | null;
  }>;
  goals: Array<{
    id: string;
    player_id?: string | null;
    team_id: string;
    match_id?: string | null;
    goals: number;
    is_own_goal?: boolean;
    note?: string | null;
    player?: { id: string; full_name: string; shirt_no?: number | null } | null;
  }>;
  cards: Array<{
    id: string;
    player_id: string;
    team_id: string;
    card_type: string;
    minute?: number | null;
    match_id?: string | null;
    player?: { id: string; full_name: string; shirt_no?: number | null } | null;
    match?: { id: string; matchday?: number | string | null; match_date: string; status: string } | null;
  }>;
  suspensions: Array<{
    id?: string;
    player_id: string;
    player_name?: string | null;
    shirt_no?: number | null;
    total_points?: number | null;
    ban_matches?: number | null;
    status?: string | null;
    suspension_reason?: string | null;
    suspended_from_match_id?: string | null;
    suspension_details?: string | null;
  }>;
}

type TeamMatch = TeamProfile['matches'][number];

type TopScorer = {
  playerId: string;
  playerName: string;
  shirtNo?: number | null;
  goals: number;
};

function formatThaiDate(dateStr?: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '-';
  const months = [
    'มกราคม',
    'กุมภาพันธ์',
    'มีนาคม',
    'เมษายน',
    'พฤษภาคม',
    'มิถุนายน',
    'กรกฎาคม',
    'สิงหาคม',
    'กันยายน',
    'ตุลาคม',
    'พฤศจิกายน',
    'ธันวาคม',
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear() + 543}`;
}

function getCardIcon(cardType: string): string {
  if (cardType === 'yellow') return '🟨';
  if (cardType === 'red') return '🟥';
  if (cardType === 'second_yellow') return '🟨🟨';
  return '';
}

function getTeamDisplayName(
  team?: { name?: string | null; short_name?: string | null } | null,
  fallback = '—'
): string {
  return team?.name || team?.short_name || fallback;
}

export default function TeamProfilePage() {
  const params = useParams<{ teamId: string }>();
  const teamId = params?.teamId;

  const [data, setData] = useState<TeamProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!teamId) {
      setError('ไม่พบรหัสทีม');
      setIsLoading(false);
      return;
    }

    const loadTeamData = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`/api/public/teams/${encodeURIComponent(teamId)}`);

        if (response.status === 404) {
          setError('ไม่พบทีมนี้');
          setData(null);
          return;
        }

        if (!response.ok) {
          throw new Error('ไม่สามารถโหลดข้อมูลทีมได้');
        }

        const json = await response.json();
        setData(json);
        setError(null);
      } catch (err) {
        console.error('[TEAM_PROFILE] Load error:', err);
        setError('เกิดข้อผิดพลาดในการโหลดข้อมูล');
        setData(null);
      } finally {
        setIsLoading(false);
      }
    };

    loadTeamData();
  }, [teamId]);

  if (isLoading) {
    return (
      <div className="cfyl-container py-4 sm:py-6">
        <div className="h-96 bg-gray-200 animate-pulse rounded-lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="cfyl-container py-6">
        <div className="text-center">
          <p className="text-lg font-semibold text-red-600 mb-4">❌ {error || 'ไม่พบข้อมูล'}</p>
          <Link href="/" className="text-blue-600 hover:underline">
            ← กลับไปหน้าหลัก
          </Link>
        </div>
      </div>
    );
  }

  const team = data.team;
  const players = data.players || [];
  const matches = data.matches || [];
  const goals = data.goals || [];
  const cards = data.cards || [];
  const suspensions = data.suspensions || [];
  const playersById = new Map(players.map((p) => [p.id, p]));

  const finishedMatches = matches.filter((m) => m.status === 'finished');
  const wins = finishedMatches.filter((m) => {
    const isHome = m.home_team_id === teamId;
    const score = isHome ? m.home_score : m.away_score;
    const opponentScore = isHome ? m.away_score : m.home_score;
    return (score ?? 0) > (opponentScore ?? 0);
  }).length;

  const draws = finishedMatches.filter((m) => m.home_score === m.away_score).length;
  const losses = finishedMatches.filter((m) => {
    const isHome = m.home_team_id === teamId;
    const score = isHome ? m.home_score : m.away_score;
    const opponentScore = isHome ? m.away_score : m.home_score;
    return (score ?? 0) < (opponentScore ?? 0);
  }).length;

  const goalsFor = finishedMatches.reduce((sum, m) => {
    const isHome = m.home_team_id === teamId;
    return sum + (isHome ? m.home_score ?? 0 : m.away_score ?? 0);
  }, 0);

  const goalsAgainst = finishedMatches.reduce((sum, m) => {
    const isHome = m.home_team_id === teamId;
    return sum + (isHome ? m.away_score ?? 0 : m.home_score ?? 0);
  }, 0);

  const points = wins * 3 + draws;
  const suspensionsCount = suspensions.filter((s) => {
    const banMatches = Number(s.ban_matches || 0);
    const totalPoints = Number(s.total_points || 0);
    return banMatches > 0 || totalPoints >= 6;
  }).length;

  const yellowCards = cards.filter((c) => c.card_type === 'yellow').length;
  const redCards = cards.filter((c) => c.card_type === 'red').length;
  const secondYellowCards = cards.filter((c) => c.card_type === 'second_yellow').length;

  const recentCards = [...cards]
    .sort((a, b) => {
      const dateA = new Date(a.match?.match_date || '').getTime();
      const dateB = new Date(b.match?.match_date || '').getTime();
      return dateB - dateA;
    })
    .slice(0, 5);

  const playerGoalsMap = new Map<string, number>();
  const topScorersMap = new Map<string, TopScorer>();

  goals.forEach((g: any) => {
    // Skip own goals - they don't count toward player scoring
    if (g.is_own_goal || !g.player_id || !g.player) {
      return;
    }

    const playerId = g.player_id;
    const goalCount = Number(g.goals || 0);

    playerGoalsMap.set(playerId, (playerGoalsMap.get(playerId) ?? 0) + goalCount);

    const existing = topScorersMap.get(playerId);
    if (existing) {
      existing.goals += goalCount;
    } else {
      topScorersMap.set(playerId, {
        playerId,
        playerName: g.player?.full_name || 'ไม่ทราบชื่อ',
        shirtNo: g.player?.shirt_no ?? null,
        goals: goalCount,
      });
    }
  });

  const topScorers = Array.from(topScorersMap.values())
    .filter((scorer) => scorer.goals > 0)
    .sort((a, b) => {
      if (a.goals !== b.goals) return b.goals - a.goals;
      const shirtA = a.shirtNo ?? 999;
      const shirtB = b.shirtNo ?? 999;
      if (shirtA !== shirtB) return shirtA - shirtB;
      return a.playerName.localeCompare(b.playerName, 'th');
    })
    .slice(0, 5);

  const playerCardsMap = new Map<string, number>();
  cards.forEach((c) => {
    playerCardsMap.set(c.player_id, (playerCardsMap.get(c.player_id) ?? 0) + 1);
  });

  const getPlayerBanStatus = (playerId: string): string => {
    const suspension = suspensions.find((s) => s.player_id === playerId);
    if (!suspension) return '-';
    const banMatches = Number(suspension.ban_matches || 0);
    const totalPoints = Number(suspension.total_points || 0);
    return banMatches > 0 || totalPoints >= 6 ? '🚨' : '-';
  };

  const getTeamLogo = (): string => {
    if (team.logo_url) return team.logo_url;
    const initials = team.name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    return initials;
  };

  const getOpponentTeam = (match: TeamMatch) => {
    if (match.home_team_id === teamId) {
      return match.away_team;
    }
    return match.home_team;
  };

  const getScore = (match: TeamMatch) => {
    if (match.home_team_id === teamId) {
      return { own: match.home_score, opponent: match.away_score };
    }
    return { own: match.away_score, opponent: match.home_score };
  };

  return (
    <div className="cfyl-container py-4 sm:py-6">
      {/* Back Link */}
      <Link href="/" className="inline-block text-blue-600 hover:underline mb-4 sm:mb-6">
        ← กลับไปหน้าหลัก
      </Link>

      {/* Header */}
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 mb-6">ข้อมูลทีม</h1>

      {/* 1. Team Hero */}
      <section className="cfyl-card mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">{team.name}</h2>
            <div className="space-y-1 text-sm text-gray-600">
              {team.age_group && <p>🎯 รุ่นอายุ: {team.age_group.name}</p>}
              {team.division && <p>⚽ ดิวิชั่น: {team.division.name}</p>}
              {team.season && <p>🗓️ ฤดูกาล: {team.season.name}</p>}
            </div>
          </div>
          <TeamLogo
            logoUrl={team.logo_url}
            name={team.name}
            shortName={team.short_name}
            size="xl"
            className="shrink-0"
          />
        </div>
      </section>

      {/* 2. Team Stats Summary */}
      <section className="mb-6">
        <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-3">สถิติทีม</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          <div className="cfyl-card text-center p-3 sm:p-4">
            <div className="text-xl sm:text-2xl font-bold text-blue-600">{finishedMatches.length}</div>
            <div className="text-xs sm:text-sm text-gray-600">แมตช์ที่จบ</div>
          </div>
          <div className="cfyl-card text-center p-3 sm:p-4">
            <div className="text-xl sm:text-2xl font-bold text-green-600">
              {wins}-{draws}-{losses}
            </div>
            <div className="text-xs sm:text-sm text-gray-600">ชนะ-เสมอ-แพ้</div>
          </div>
          <div className="cfyl-card text-center p-3 sm:p-4">
            <div className="text-xl sm:text-2xl font-bold text-orange-600">
              {goalsFor}:{goalsAgainst}
            </div>
            <div className="text-xs sm:text-sm text-gray-600">ได้:เสีย</div>
          </div>
          <div className="cfyl-card text-center p-3 sm:p-4">
            <div className="text-xl sm:text-2xl font-bold text-purple-600">{points}</div>
            <div className="text-xs sm:text-sm text-gray-600">คะแนน</div>
          </div>
        </div>
      </section>

      {/* 3. Fixtures & Results */}
      <section className="mb-6">
        <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-3">โปรแกรมแข่งขัน</h3>
        {matches.length === 0 ? (
          <div className="cfyl-card text-center py-6 text-gray-600">ยังไม่มีแมตช์</div>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            {matches.map((match) => {
              const opponent = getOpponentTeam(match);
              const score = getScore(match);
              const isFinished = match.status === 'finished';
              const matchDate = new Date(match.match_date);
              const today = new Date();
              const isSameDay =
                matchDate.getFullYear() === today.getFullYear() &&
                matchDate.getMonth() === today.getMonth() &&
                matchDate.getDate() === today.getDate();

              return (
                <Link
                  key={match.id}
                  href={`/matches/${match.id}`}
                  className="cfyl-card p-3 sm:p-4 hover:shadow-md transition block"
                >
                  <div className="flex items-center justify-between gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-500 mb-1">
                        {formatThaiDate(match.match_date)}
                        {match.match_time && ` เวลา ${match.match_time}`}
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3 mb-2">
                        <div className="flex-1 text-right min-w-0">
                          <div className="font-semibold text-sm sm:text-base text-gray-800 break-words">
                            {team.name || team.short_name}
                          </div>
                        </div>
                        <div className="w-16 sm:w-24 shrink-0 text-center">
                          {isFinished ? (
                            <div className="font-bold text-base sm:text-lg">
                              {score.own} - {score.opponent}
                            </div>
                          ) : (
                            <div className="font-bold text-gray-400">VS</div>
                          )}
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <div className="font-semibold text-sm sm:text-base text-gray-800 break-words">
                            {getTeamDisplayName(opponent, '-')}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-600">
                        {isSameDay ? '🔴 กำลังแข่ง' : match.status === 'finished' ? '✅ จบแล้ว' : '⏳ รอการแข่ง'}
                      </div>
                    </div>
                    <div className="shrink-0 text-blue-600 font-semibold text-sm">→</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. Players List */}
      <section className="mb-6">
        <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-3">รายชื่อนักกีฬา</h3>
        {players.length === 0 ? (
          <div className="cfyl-card text-center py-6 text-gray-600">ยังไม่มีข้อมูลนักกีฬา</div>
        ) : (
          <div className="space-y-2">
            {players.map((player) => {
              const playerGoals = playerGoalsMap.get(player.id) ?? 0;
              const playerCards = playerCardsMap.get(player.id) ?? 0;
              const banStatus = getPlayerBanStatus(player.id);
              return (
                <div key={player.id} className="cfyl-card p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-2 sm:gap-4">
                    <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gray-200 rounded-full flex items-center justify-center shrink-0">
                        <span className="font-bold text-sm text-gray-600">{player.shirt_no || '-'}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 text-sm sm:text-base truncate">
                          {player.full_name}
                        </div>
                        <div className="text-xs text-gray-500">{player.position || '-'}</div>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold">⚽ {playerGoals}</div>
                      <div className="text-sm text-gray-600">
                        🟨 {playerCards}
                        {banStatus !== '-' && (
                          <span className="ml-2 text-red-600 font-semibold">🚨 ติดโทษแบน</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 5. Top Scorers */}
      <section className="mb-6">
        <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-3">ดาวซัลโวของทีม</h3>
        {topScorers.length === 0 ? (
          <div className="cfyl-card text-center py-6 text-gray-600">ยังไม่มีประตู</div>
        ) : (
          <div className="space-y-2">
            {topScorers.map((scorer, index) => (
              <div key={scorer.playerId} className="cfyl-card p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 bg-yellow-100 rounded-full flex items-center justify-center shrink-0">
                      <span className="font-bold text-yellow-600 text-sm sm:text-base">{index + 1}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 text-sm sm:text-base">
                        {scorer.playerName}
                      </div>
                      <div className="text-xs text-gray-500">#{scorer.shirtNo || '-'}</div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-lg sm:text-xl font-bold text-orange-600">⚽ {scorer.goals}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 6. Cards Summary */}
      <section className="mb-6">
        <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-3">ใบเหลือง/แดง</h3>
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
          <div className="cfyl-card text-center p-3 sm:p-4">
            <div className="text-2xl sm:text-3xl font-bold text-yellow-500">🟨</div>
            <div className="text-base sm:text-lg font-bold text-yellow-600">{yellowCards}</div>
          </div>
          <div className="cfyl-card text-center p-3 sm:p-4">
            <div className="text-2xl sm:text-3xl font-bold text-red-500">🟥</div>
            <div className="text-base sm:text-lg font-bold text-red-600">{redCards}</div>
          </div>
          <div className="cfyl-card text-center p-3 sm:p-4">
            <div className="text-2xl sm:text-3xl font-bold">🟨🟨</div>
            <div className="text-base sm:text-lg font-bold text-orange-600">{secondYellowCards}</div>
          </div>
        </div>

        {recentCards.length === 0 ? (
          <div className="cfyl-card text-center py-6 text-gray-600">ยังไม่มีใบ</div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 px-2">ล่าสุด 5 รายการ:</p>
            {recentCards.map((card) => (
              <div key={card.id} className="cfyl-card p-3 sm:p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="text-xl shrink-0">{getCardIcon(card.card_type)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 text-sm sm:text-base">
                        {card.player?.full_name || 'ไม่ทราบชื่อ'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {card.match?.match_date ? formatThaiDate(card.match.match_date) : '-'}
                        {card.minute !== undefined && card.minute !== null ? ` นาที ${card.minute}` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 7. Suspensions */}
      <section className="mb-6">
        <h3 className="text-lg sm:text-xl font-bold text-gray-800 mb-3">ผู้เล่นติดโทษแบน</h3>
        {suspensionsCount === 0 ? (
          <div className="cfyl-card text-center py-6 text-gray-600">ไม่มีผู้เล่นติดโทษแบน</div>
        ) : (
          <div className="space-y-2">
            {suspensions.map((susp) => (
                <div key={susp.id} className="cfyl-card p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="text-xl shrink-0">🚨</div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-gray-900 text-sm sm:text-base">
                          {susp.player_name || playersById.get(susp.player_id)?.full_name || 'ไม่ทราบชื่อ'}
                        </div>
                        <div className="text-xs text-gray-500">
                          #{susp.shirt_no ?? playersById.get(susp.player_id)?.shirt_no ?? '-'} • คะแนนสะสม: {susp.total_points || 0}
                        </div>
                        {susp.suspension_reason && (
                          <div className="text-xs text-red-600 mt-1.5 leading-tight">
                            {susp.suspension_reason}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-bold text-red-600">
                        {susp.ban_matches && susp.ban_matches > 0 ? `แบน ${susp.ban_matches} นัด` : 'ตรวจสอบ'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>
    </div>
  );
}
