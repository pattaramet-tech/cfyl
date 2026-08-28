'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { TeamLogo } from '@/components/TeamLogo';

type PublicMatch = {
  id: string;
  match_code: string;
  matchday: string | number | null;
  matchday_number: number;
  match_date: string;
  match_time?: string | null;
  status: string;
  league_phase: string;
  is_home: boolean;
  opponent?: { id: string; name: string; short_name?: string | null } | null;
};

type SuspensionHistory = {
  id: string;
  suspension_type: string;
  accumulated_threshold?: number | null;
  ban_matches: number;
  suspension_reason?: string | null;
  suspension_details?: {
    trigger_event?: string | null;
  } | null;
  status: 'active' | 'served' | 'no_next_match';
  served_count: number;
  remaining_count: number;
  served_completed_at?: string | null;
  trigger_match?: PublicMatch | null;
  serving_matches: PublicMatch[];
};

type GoalEvent = {
  id: string;
  match_id: string;
  goals: number;
  minute?: number | null;
  note?: string | null;
  is_own_goal?: boolean | null;
  match?: PublicMatch | null;
};

type CardEvent = {
  id: string;
  match_id: string;
  card_type: string;
  minute?: number | null;
  note?: string | null;
  match?: PublicMatch | null;
};

interface PlayerDetailPayload {
  player: {
    id: string;
    player_code?: string | null;
    full_name: string;
    shirt_no?: number | null;
    active?: boolean;
    team_id: string;
    team?: { id: string; name: string; short_name?: string | null; logo_url?: string | null } | null;
    season?: { id: string; name: string; year: number } | null;
    age_group?: { id: string; code: string; name: string } | null;
    division?: { id: string; name: string } | null;
  };
  summary: {
    goals: number;
    yellow: number;
    red: number;
    second_yellow: number;
    discipline_points: number;
  };
  goals: GoalEvent[];
  cards: CardEvent[];
  suspensions: SuspensionHistory[];
}

function formatThaiDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.valueOf())) return '—';
  return date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(value?: string | null): string {
  return value ? String(value).slice(0, 5) : '';
}

function phaseLabel(phase?: string | null): string {
  if (phase === 'champion_league') return 'Champion League';
  if (phase === 'final') return 'รอบชิงชนะเลิศ';
  if (phase === 'third_place') return 'ชิงอันดับที่ 3';
  return 'รอบลีก';
}

function matchLabel(match?: PublicMatch | null): string {
  if (!match) return '—';
  if (match.league_phase === 'final') return 'Final';
  if (match.league_phase === 'third_place') return 'ชิงอันดับที่ 3';
  if (match.league_phase === 'champion_league') {
    const raw = String(match.matchday || '');
    return raw.toUpperCase().startsWith('CL') ? raw : `CL${match.matchday_number || ''}`;
  }
  return match.matchday_number > 0 ? `MD${match.matchday_number}` : String(match.matchday || match.match_code);
}

function cardIcon(type: string): string {
  if (type === 'yellow') return '🟨';
  if (type === 'red') return '🟥';
  if (type === 'second_yellow') return '🟨🟨';
  return '•';
}

function cardLabel(type: string): string {
  if (type === 'yellow') return 'ใบเหลือง';
  if (type === 'red') return 'ใบแดง';
  if (type === 'second_yellow') return 'ใบเหลืองที่ 2';
  return type;
}

function suspensionTypeLabel(type: string): string {
  if (type === 'accumulated_points') return 'สะสมคะแนนครบเกณฑ์';
  if (type === 'direct_red') return 'ใบแดงโดยตรง';
  if (type === 'second_yellow') return 'ใบเหลืองที่ 2';
  if (type === 'yellow_red') return 'ใบเหลือง + ใบแดง';
  if (type === 'manual') return 'โทษแบนที่กำหนดเอง';
  return 'โทษแบน';
}

function suspensionStatusMeta(status: SuspensionHistory['status']) {
  if (status === 'served') {
    return { label: 'ชดใช้โทษแล้ว', className: 'bg-slate-100 text-slate-700 border-slate-200' };
  }
  if (status === 'no_next_match') {
    return { label: 'ยังไม่พบโปรแกรมนัดถัดไป', className: 'bg-amber-50 text-amber-800 border-amber-200' };
  }
  return { label: 'ติดโทษแบน', className: 'bg-red-50 text-red-700 border-red-200' };
}

function eventSortValue(match?: PublicMatch | null, minute?: number | null): string {
  return `${match?.match_date || '0000-00-00'}T${match?.match_time || '00:00:00'}-${String(minute ?? -1).padStart(3, '0')}`;
}

export default function PublicPlayerDetailPage() {
  const params = useParams<{ playerId: string }>();
  const playerId = params.playerId;
  const [data, setData] = useState<PlayerDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/public/players/${encodeURIComponent(playerId)}`);
        const payload = await response.json().catch(() => ({}));
        if (!active) return;
        if (!response.ok) {
          setData(null);
          setError(response.status === 404 ? 'ไม่พบนักกีฬานี้' : payload.error || 'ไม่สามารถโหลดข้อมูลนักกีฬาได้');
          return;
        }
        setData(payload as PlayerDetailPayload);
        setError(null);
      } catch (err) {
        if (!active) return;
        console.error('[PUBLIC_PLAYER_DETAIL] Load error:', err);
        setData(null);
        setError('เกิดข้อผิดพลาดในการโหลดข้อมูลนักกีฬา');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [playerId]);

  const timeline = useMemo(() => {
    if (!data) return [];
    const goalEvents = data.goals.map((goal) => ({ type: 'goal' as const, ...goal }));
    const cardEvents = data.cards.map((card) => ({ type: 'card' as const, ...card }));
    return [...goalEvents, ...cardEvents].sort((a, b) =>
      eventSortValue(b.match, b.minute).localeCompare(eventSortValue(a.match, a.minute))
    );
  }, [data]);

  if (loading) {
    return (
      <div className="cfyl-container py-6">
        <div className="h-96 animate-pulse rounded-lg bg-slate-200" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="cfyl-container py-6">
        <div className="cfyl-card border border-red-200 bg-red-50 p-6 text-center">
          <p className="font-semibold text-red-700">❌ {error || 'ไม่พบข้อมูลนักกีฬา'}</p>
          <Link href="/" className="mt-4 inline-block text-blue-600 hover:underline">
            ← กลับไปหน้าหลัก
          </Link>
        </div>
      </div>
    );
  }

  const { player, summary, suspensions } = data;
  const activeSuspensions = suspensions.filter((suspension) => suspension.status !== 'served');

  return (
    <div className="cfyl-container py-4 sm:py-6">
      <Link
        href={player.team?.id ? `/teams/${player.team.id}` : '/'}
        className="mb-4 inline-flex text-sm font-semibold text-blue-600 hover:underline sm:mb-6"
      >
        ← {player.team?.id ? 'กลับไปข้อมูลทีม' : 'กลับไปหน้าหลัก'}
      </Link>

      <h1 className="mb-6 text-2xl font-bold text-slate-800 sm:text-3xl">ข้อมูลนักกีฬา</h1>

      <section className="cfyl-card mb-6 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-bold text-blue-800">
                #{player.shirt_no ?? '—'}
              </span>
              {!player.active && (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">ไม่ใช้งาน</span>
              )}
            </div>
            <h2 className="break-words text-2xl font-bold text-slate-900 sm:text-3xl">{player.full_name}</h2>
            {player.team && (
              <Link href={`/teams/${player.team.id}`} className="mt-2 inline-block font-semibold text-blue-700 hover:underline">
                {player.team.name}
              </Link>
            )}
            <div className="mt-3 space-y-1 text-sm text-slate-600">
              {player.age_group && <p>🎯 {player.age_group.code} — {player.age_group.name}</p>}
              {player.division && <p>⚽ {player.division.name}</p>}
              {player.season && <p>🗓️ {player.season.name} ({player.season.year})</p>}
            </div>
          </div>
          {player.team && (
            <TeamLogo
              logoUrl={player.team.logo_url}
              name={player.team.name}
              shortName={player.team.short_name}
              size="xl"
              className="shrink-0"
            />
          )}
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-3 text-lg font-bold text-slate-800 sm:text-xl">สถิตินักกีฬา</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 sm:gap-3">
          <div className="cfyl-card p-3 text-center sm:p-4">
            <div className="text-2xl font-bold text-blue-700">{summary.goals}</div>
            <div className="text-xs text-slate-500">ประตู</div>
          </div>
          <div className="cfyl-card p-3 text-center sm:p-4">
            <div className="text-xl">🟨</div>
            <div className="font-bold text-yellow-600">{summary.yellow}</div>
          </div>
          <div className="cfyl-card p-3 text-center sm:p-4">
            <div className="text-xl">🟥</div>
            <div className="font-bold text-red-600">{summary.red}</div>
          </div>
          <div className="cfyl-card p-3 text-center sm:p-4">
            <div className="text-xl">🟨🟨</div>
            <div className="font-bold text-orange-600">{summary.second_yellow}</div>
          </div>
          <div className="cfyl-card p-3 text-center sm:p-4">
            <div className="text-2xl font-bold text-purple-700">{summary.discipline_points}</div>
            <div className="text-xs text-slate-500">คะแนนโทษ CFYL</div>
          </div>
          <div className="cfyl-card p-3 text-center sm:p-4">
            <div className={`text-2xl font-bold ${activeSuspensions.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {activeSuspensions.length}
            </div>
            <div className="text-xs text-slate-500">โทษแบนคงค้าง</div>
          </div>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-3 text-lg font-bold text-slate-800 sm:text-xl">ประวัติโทษแบน</h3>
        {suspensions.length === 0 ? (
          <div className="cfyl-card py-6 text-center text-slate-500">ไม่มีประวัติโทษแบน</div>
        ) : (
          <div className="space-y-3">
            {suspensions.map((suspension) => {
              const status = suspensionStatusMeta(suspension.status);
              return (
                <div key={suspension.id} className="cfyl-card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900">{suspensionTypeLabel(suspension.suspension_type)}</p>
                      <p className="mt-1 text-sm text-slate-600">แบน {suspension.ban_matches} นัด</p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-bold ${status.className}`}>
                      {status.label}
                    </span>
                  </div>

                  {suspension.suspension_details?.trigger_event && (
                    <p className="mt-3 text-sm text-slate-700">สาเหตุ: {suspension.suspension_details.trigger_event}</p>
                  )}
                  {suspension.suspension_reason && (
                    <p className="mt-1 text-xs text-slate-500">{suspension.suspension_reason}</p>
                  )}

                  <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">แมตช์ที่ทำให้เกิดโทษ</p>
                      {suspension.trigger_match ? (
                        <Link
                          href={`/matches/${suspension.trigger_match.id}`}
                          className="block rounded-lg border border-slate-200 p-3 hover:border-blue-300 hover:bg-blue-50"
                        >
                          <p className="font-semibold text-slate-800">
                            {matchLabel(suspension.trigger_match)} · {phaseLabel(suspension.trigger_match.league_phase)}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatThaiDate(suspension.trigger_match.match_date)} {formatTime(suspension.trigger_match.match_time)}
                          </p>
                        </Link>
                      ) : (
                        <p className="text-sm text-slate-400">ไม่มีข้อมูลแมตช์ต้นเหตุ</p>
                      )}
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">แมตช์ที่ชดใช้โทษ</p>
                      {suspension.serving_matches.length > 0 ? (
                        <div className="space-y-2">
                          {suspension.serving_matches.map((match) => (
                            <Link
                              key={match.id}
                              href={`/matches/${match.id}`}
                              className="block rounded-lg border border-red-100 bg-red-50/40 p-3 hover:border-red-300"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-semibold text-slate-800">
                                  {matchLabel(match)} · vs {match.opponent?.name || '—'}
                                </p>
                                <span className="text-xs text-slate-500">
                                  {match.status === 'finished' ? 'ชดใช้แล้ว' : 'รอแข่งขัน'}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-slate-500">
                                {formatThaiDate(match.match_date)} {formatTime(match.match_time)} · {match.is_home ? 'เหย้า' : 'เยือน'}
                              </p>
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                          ยังไม่พบโปรแกรมนัดที่ต้องชดใช้โทษ
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-6">
        <h3 className="mb-3 text-lg font-bold text-slate-800 sm:text-xl">ประวัติประตูและใบ</h3>
        {timeline.length === 0 ? (
          <div className="cfyl-card py-6 text-center text-slate-500">ยังไม่มีเหตุการณ์ของนักกีฬาคนนี้</div>
        ) : (
          <div className="space-y-2">
            {timeline.map((event) => {
              const match = event.match;
              const isGoal = event.type === 'goal';
              return (
                <Link
                  key={`${event.type}-${event.id}`}
                  href={match ? `/matches/${match.id}` : '#'}
                  className={`cfyl-card flex items-center gap-3 p-3 sm:p-4 ${match ? 'hover:shadow-md' : 'pointer-events-none'}`}
                >
                  <span className="w-10 shrink-0 text-center text-xl">
                    {isGoal ? '⚽' : cardIcon(event.card_type)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-800">
                      {isGoal
                        ? `${event.goals > 1 ? `${event.goals} ประตู` : 'ทำประตู'}`
                        : cardLabel(event.card_type)}
                      {event.minute !== null && event.minute !== undefined ? ` · นาที ${event.minute}` : ''}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {match ? `${matchLabel(match)} · ${phaseLabel(match.league_phase)} · ${formatThaiDate(match.match_date)}` : 'ไม่พบข้อมูลแมตช์'}
                    </p>
                    {event.note && <p className="mt-1 text-xs text-slate-500">{event.note}</p>}
                  </div>
                  {match && <span className="shrink-0 text-sm font-semibold text-blue-600">→</span>}
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
