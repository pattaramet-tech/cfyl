'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { Match } from '@/types/db';

interface Goal {
  id: string;
  match_id: string;
  player_id: string;
  team_id: string;
  goals: number;
  created_at: string;
  player?: {
    id: string;
    full_name: string;
    shirt_no?: number | null;
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
  team_id: string;
  card_type: string;
  minute?: number | null;
  note?: string | null;
  created_at: string;
  player?: {
    id: string;
    full_name: string;
    shirt_no?: number | null;
  };
  team?: {
    id: string;
    name: string;
    short_name: string;
  };
}

interface MatchDetail extends Match {
  home_team?: { id?: string; name?: string; short_name?: string; logo_url?: string };
  away_team?: { id?: string; name?: string; short_name?: string; logo_url?: string };
  division?: { id?: string; name?: string };
  season?: { id?: string; name?: string; year?: number };
  age_group?: { id?: string; code?: string; name?: string };
}

function formatThaiDate(dateStr?: string | null): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

function formatTime(timeStr?: string | null): string {
  if (!timeStr) return '—';
  return String(timeStr).substring(0, 5);
}

function getStatusLabel(status?: string): string {
  if (!status) return 'ไม่ระบุ';
  switch (status) {
    case 'finished':
      return 'แข่งจบแล้ว';
    case 'scheduled':
      return 'ยังไม่แข่ง';
    case 'postponed':
      return 'เลื่อนการแข่งขัน';
    case 'cancelled':
      return 'ยกเลิก';
    default:
      return status;
  }
}

function getStatusBadgeClass(status?: string): string {
  if (!status) return 'bg-slate-100 text-slate-600';
  switch (status) {
    case 'finished':
      return 'bg-blue-100 text-blue-700';
    case 'scheduled':
      return 'bg-slate-100 text-slate-600';
    case 'postponed':
      return 'bg-amber-100 text-amber-700';
    case 'cancelled':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

function getCardLabel(cardType: string): string {
  switch (cardType) {
    case 'yellow':
      return 'ใบเหลือง';
    case 'second_yellow':
      return 'ใบเหลืองที่ 2';
    case 'red':
      return 'ใบแดง';
    default:
      return cardType;
  }
}

function getCardIcon(cardType: string): string {
  switch (cardType) {
    case 'yellow':
      return '🟨';
    case 'second_yellow':
      return '🟨🟨';
    case 'red':
      return '🟥';
    default:
      return '•';
  }
}

function formatMinute(minute?: number | null): string {
  if (minute === null || minute === undefined) return 'ไม่ระบุนาที';
  return `${minute}'`;
}

export default function MatchPage({ params }: { params: { matchId: string } }) {
  const [data, setData] = useState<{ match: MatchDetail; goals: Goal[]; cards: Card[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/public/matches/${params.matchId}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError('ไม่พบแมตช์นี้');
          } else {
            setError('ไม่สามารถโหลดข้อมูลแมตช์ได้');
          }
          return;
        }
        const d = await res.json();
        setData(d);
      } catch (err) {
        console.error('Error loading match:', err);
        setError('เกิดข้อผิดพลาดในการโหลดข้อมูล');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [params.matchId]);

  const goalsByTeam = useMemo(() => {
    if (!data) return { home: [], away: [] };
    const home = data.goals.filter((g) => g.team_id === data.match.home_team_id).sort((a, b) => {
      const aGoals = a.goals || 0;
      const bGoals = b.goals || 0;
      if (aGoals !== bGoals) return bGoals - aGoals;
      return (a.player?.shirt_no || 999) - (b.player?.shirt_no || 999);
    });
    const away = data.goals.filter((g) => g.team_id === data.match.away_team_id).sort((a, b) => {
      const aGoals = a.goals || 0;
      const bGoals = b.goals || 0;
      if (aGoals !== bGoals) return bGoals - aGoals;
      return (a.player?.shirt_no || 999) - (b.player?.shirt_no || 999);
    });
    return { home, away };
  }, [data]);

  const timeline = useMemo(() => {
    if (!data) return [];
    const events: Array<{ type: 'goal' | 'card'; minute: number | null; data: Goal | Card }> = [];

    data.goals.forEach((g) => {
      events.push({ type: 'goal', minute: null, data: g });
    });

    data.cards.forEach((c) => {
      events.push({ type: 'card', minute: c.minute || null, data: c });
    });

    return events.sort((a, b) => {
      const aMin = a.minute ?? 999;
      const bMin = b.minute ?? 999;
      if (aMin !== bMin) return aMin - bMin;
      return a.type === 'goal' ? -1 : 1;
    });
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-slate-600">กำลังโหลดข้อมูลแมตช์...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-6">
        <Link
          href="/fixtures"
          className="inline-flex items-center text-blue-600 hover:text-blue-700 mb-6 font-semibold"
        >
          ← กลับไปโปรแกรมแข่งขัน
        </Link>
        <div className="cfyl-card p-6 bg-red-50 border border-red-200">
          <p className="text-red-700 font-semibold">❌ {error || 'ไม่พบข้อมูล'}</p>
        </div>
      </div>
    );
  }

  const m = data.match;
  const isFinished = m.status === 'finished';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <Link
            href="/fixtures"
            className="inline-flex items-center text-blue-600 hover:text-blue-700 mb-4 font-semibold text-sm"
          >
            ← กลับไปโปรแกรมแข่งขัน
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-800">รายละเอียดแมตช์</h1>
        </div>

        {/* Hero Card */}
        <div className="cfyl-card p-6 bg-gradient-to-br from-blue-50 to-white border-l-4 border-blue-600">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-blue-900">
                MD{m.matchday}
                {m.division?.name && <span className="text-slate-500 ml-2">· {m.division.name}</span>}
              </div>
              <span className={`cfyl-badge px-3 py-1 text-sm font-semibold ${getStatusBadgeClass(m.status)}`}>
                {getStatusLabel(m.status)}
              </span>
            </div>

            <div className="text-center text-sm text-slate-600">
              {formatThaiDate(m.match_date)} {formatTime(m.match_time) && `· ${formatTime(m.match_time)}`}
            </div>

            {/* Teams and Score */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 py-4">
              <div className="text-right">
                <p className="font-bold text-slate-800 break-words text-sm sm:text-base">
                  {m.home_team?.name || 'ทีมเหย้า'}
                </p>
                {m.home_team?.short_name && (
                  <p className="text-xs text-slate-500">{m.home_team.short_name}</p>
                )}
              </div>

              {isFinished && m.home_score !== null && m.away_score !== null ? (
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-100">
                  <span className="text-3xl font-bold text-blue-900">{m.home_score}</span>
                  <span className="text-slate-400">-</span>
                  <span className="text-3xl font-bold text-blue-900">{m.away_score}</span>
                </div>
              ) : (
                <span className="text-slate-400 font-semibold">VS</span>
              )}

              <div className="text-left">
                <p className="font-bold text-slate-800 break-words text-sm sm:text-base">
                  {m.away_team?.name || 'ทีมเยือน'}
                </p>
                {m.away_team?.short_name && (
                  <p className="text-xs text-slate-500">{m.away_team.short_name}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Goals Summary */}
        {isFinished && (data.goals.length > 0 || true) && (
          <div className="cfyl-card p-6">
            <h2 className="cfyl-section-title mb-4">⚽ ผู้ทำประตู</h2>
            {data.goals.length === 0 ? (
              <p className="cfyl-empty text-center py-6">ยังไม่มีข้อมูลผู้ทำประตู</p>
            ) : (
              <div className="space-y-6">
                {/* Home team goals */}
                <div>
                  <p className="font-semibold text-slate-700 mb-2 text-sm">
                    {m.home_team?.name || 'ทีมเหย้า'}
                  </p>
                  <div className="space-y-1">
                    {goalsByTeam.home.length === 0 ? (
                      <p className="text-slate-400 text-xs">ไม่มีผู้ทำประตู</p>
                    ) : (
                      goalsByTeam.home.map((g) => (
                        <div key={g.id} className="flex items-center justify-between text-sm px-3 py-2 bg-slate-50 rounded">
                          <span className="font-semibold text-slate-800">
                            #{g.player?.shirt_no || '?'} {g.player?.full_name || 'ไม่ระบุ'}
                          </span>
                          <span className="text-slate-600">×{g.goals || 1}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Away team goals */}
                <div>
                  <p className="font-semibold text-slate-700 mb-2 text-sm">
                    {m.away_team?.name || 'ทีมเยือน'}
                  </p>
                  <div className="space-y-1">
                    {goalsByTeam.away.length === 0 ? (
                      <p className="text-slate-400 text-xs">ไม่มีผู้ทำประตู</p>
                    ) : (
                      goalsByTeam.away.map((g) => (
                        <div key={g.id} className="flex items-center justify-between text-sm px-3 py-2 bg-slate-50 rounded">
                          <span className="font-semibold text-slate-800">
                            #{g.player?.shirt_no || '?'} {g.player?.full_name || 'ไม่ระบุ'}
                          </span>
                          <span className="text-slate-600">×{g.goals || 1}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Cards Summary */}
        {data.cards.length > 0 && (
          <div className="cfyl-card p-6">
            <h2 className="cfyl-section-title mb-4">🟨 ใบเหลือง/ใบแดง</h2>
            <div className="space-y-2">
              {data.cards.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm px-3 py-2 bg-slate-50 rounded">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lg shrink-0">{getCardIcon(c.card_type)}</span>
                    <span className="font-semibold text-slate-800 truncate">
                      #{c.player?.shirt_no || '?'} {c.player?.full_name || 'ไม่ระบุ'}
                    </span>
                  </div>
                  <span className="text-slate-500 shrink-0 ml-2">{c.team?.short_name || c.team?.name || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        {timeline.length > 0 && (
          <div className="cfyl-card p-6">
            <h2 className="cfyl-section-title mb-4">📅 Timeline เหตุการณ์</h2>
            <div className="space-y-2">
              {timeline.map((event, idx) => {
                const isGoal = event.type === 'goal';
                const data = event.data as any;
                const minute = event.minute;
                const minuteStr = minute === null ? 'ไม่ระบุนาที' : `${minute}'`;

                return (
                  <div
                    key={`${event.type}-${data.id}`}
                    className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded text-sm"
                  >
                    <span className="text-lg shrink-0">{isGoal ? '⚽' : getCardIcon(data.card_type)}</span>
                    <span className="w-12 text-slate-500 shrink-0 font-semibold">{minuteStr}</span>
                    <span className="flex-1 min-w-0">
                      <span className="font-semibold text-slate-800">
                        #{data.player?.shirt_no || '?'} {data.player?.full_name || 'ไม่ระบุ'}
                      </span>
                      {!isGoal && data.note && (
                        <span className="text-slate-500 ml-1">• {data.note}</span>
                      )}
                    </span>
                    <span className="text-slate-500 shrink-0 text-xs">{data.team?.short_name || data.team?.name || '—'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {timeline.length === 0 && data.goals.length === 0 && data.cards.length === 0 && (
          <div className="cfyl-card p-6 bg-slate-50">
            <p className="cfyl-empty text-center">ยังไม่มีเหตุการณ์ในแมตช์นี้</p>
          </div>
        )}

        {/* Match Info */}
        <div className="cfyl-card p-6">
          <h2 className="cfyl-section-title mb-4">ℹ️ ข้อมูลแมตช์</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {m.id && (
              <div>
                <p className="text-slate-500">รหัสแมตช์</p>
                <p className="font-semibold text-slate-800 break-all">{m.id}</p>
              </div>
            )}
            {m.age_group && (
              <div>
                <p className="text-slate-500">รุ่นอายุ</p>
                <p className="font-semibold text-slate-800">
                  {m.age_group.code} — {m.age_group.name}
                </p>
              </div>
            )}
            {m.division && (
              <div>
                <p className="text-slate-500">ดิวิชั่น</p>
                <p className="font-semibold text-slate-800">{m.division.name}</p>
              </div>
            )}
            {m.season && (
              <div>
                <p className="text-slate-500">ฤดูกาล</p>
                <p className="font-semibold text-slate-800">
                  {m.season.name} ({m.season.year})
                </p>
              </div>
            )}
            <div>
              <p className="text-slate-500">วันที่</p>
              <p className="font-semibold text-slate-800">{formatThaiDate(m.match_date)}</p>
            </div>
            <div>
              <p className="text-slate-500">เวลา</p>
              <p className="font-semibold text-slate-800">{formatTime(m.match_time)}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center py-6">
          <Link
            href="/fixtures"
            className="inline-flex items-center justify-center px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition"
          >
            ← กลับไปโปรแกรมแข่งขัน
          </Link>
        </div>
      </div>
    </div>
  );
}
