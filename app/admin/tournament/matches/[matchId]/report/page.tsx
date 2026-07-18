'use client';

import { useEffect, useState, use as usePromise } from 'react';
import { useSearchParams } from 'next/navigation';

interface PlayerOption {
  id: string;
  full_name: string;
  shirt_no: number | null;
}

interface MatchContext {
  match_id: string;
  match_code: string;
  match_no: number | null;
  match_date: string | null;
  match_time: string | null;
  stage: string;
  category_code: string;
  category_name: string;
  group_code: string | null;
  venue_name: string;
  court_name: string;
  home_team_id: string;
  home_team_name: string;
  away_team_id: string;
  away_team_name: string;
  home_team_players: PlayerOption[];
  away_team_players: PlayerOption[];
  current_version: number;
  result_workflow_status: string;
  already_published: boolean;
}

interface GoalRow {
  key: string;
  teamId: string;
  playerId: string;
  minute: string;
  isOwnGoal: boolean;
  goals: string;
  note: string;
}

interface CardRow {
  key: string;
  teamId: string;
  playerId: string;
  cardType: 'yellow' | 'second_yellow' | 'red';
  minute: string;
  note: string;
}

interface QuickResultComparison {
  has_quick_result: boolean;
  quick_result_home_score: number | null;
  quick_result_away_score: number | null;
  full_report_home_score: number;
  full_report_away_score: number;
  matches: boolean;
}

interface PreviewResponse {
  match_id: string;
  match_code: string;
  current_version: number;
  regulation_home_score: number;
  regulation_away_score: number;
  penalty_home_score: number | null;
  penalty_away_score: number | null;
  decided_by: 'regulation' | 'penalty';
  winner_team_id: string;
  quick_result_comparison: QuickResultComparison;
  preview_token: string;
  preview_expires_at: string;
}

function getToken(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem('admin_token');
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return { ...(extra || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function newKey(): string {
  return `k-${Math.random().toString(36).slice(2)}`;
}

function errorMessageForCode(code: string | undefined, fallback: string): string {
  if (code === 'FULL_REPORT_PREVIEW_EXPIRED') return 'ตัวอย่างรายงานหมดอายุแล้ว กรุณาตรวจสอบตัวอย่างอีกครั้ง';
  if (code === 'FULL_REPORT_PREVIEW_REQUIRED') return 'กรุณาตรวจสอบตัวอย่างก่อนยืนยันและเผยแพร่ผล';
  if (code === 'FULL_REPORT_PREVIEW_INVALID') return 'ตัวอย่างไม่ถูกต้อง กรุณาตรวจสอบตัวอย่างอีกครั้ง';
  if (code === 'FULL_REPORT_PREVIEW_MISMATCH') return 'ข้อมูลมีการเปลี่ยนแปลงหลังตรวจสอบตัวอย่าง กรุณาตรวจสอบตัวอย่างอีกครั้ง';
  if (code === 'FULL_REPORT_VERSION_CONFLICT') return 'ข้อมูล Match มีการเปลี่ยนแปลง กรุณาตรวจสอบตัวอย่างใหม่';
  if (code === 'FULL_REPORT_ALREADY_PUBLISHED_USE_CORRECTION') return 'ผลการแข่งขันเผยแพร่แล้ว หากต้องการแก้ไข ต้องเข้าสู่กระบวนการขอแก้ไขผลการแข่งขัน';
  if (code === 'FULL_REPORT_PUBLISH_RPC_UNAVAILABLE') return 'ระบบเผยแพร่ผลอย่างเป็นทางการยังไม่พร้อมใช้งานในสภาพแวดล้อมนี้';
  return fallback;
}

export default function FullMatchReportPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = usePromise(params);
  const searchParams = useSearchParams();
  const tournamentSlug = searchParams.get('tournament_slug') || '';
  const venueId = searchParams.get('venue_id') || null;

  const [context, setContext] = useState<MatchContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [regulationHome, setRegulationHome] = useState('');
  const [regulationAway, setRegulationAway] = useState('');
  const [penaltyHome, setPenaltyHome] = useState('');
  const [penaltyAway, setPenaltyAway] = useState('');
  const [decidedBy, setDecidedBy] = useState<'regulation' | 'penalty'>('regulation');
  const [winnerTeamId, setWinnerTeamId] = useState('');
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [reportText, setReportText] = useState('');

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) {
      window.location.href = '/admin/login';
      return;
    }
    if (!tournamentSlug) return;

    const loadContext = async () => {
      setLoading(true);
      setLoadError('');
      try {
        const response = await fetch(`/api/tournament/admin/matches/${matchId}/full-report?tournament_slug=${tournamentSlug}`, {
          headers: authHeaders(),
          cache: 'no-store',
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'โหลดข้อมูล Match ไม่สำเร็จ');
        setContext(payload.data as MatchContext);
      } catch (reason) {
        setLoadError(reason instanceof Error ? reason.message : 'โหลดข้อมูล Match ไม่สำเร็จ');
      } finally {
        setLoading(false);
      }
    };

    loadContext();
  }, [matchId, tournamentSlug]);

  const invalidatePreview = () => {
    if (preview) setPreviewStale(true);
  };

  const addGoal = (teamId: string) => {
    setGoals((prev) => [...prev, { key: newKey(), teamId, playerId: '', minute: '', isOwnGoal: false, goals: '1', note: '' }]);
    invalidatePreview();
  };
  const removeGoal = (key: string) => {
    setGoals((prev) => prev.filter((g) => g.key !== key));
    invalidatePreview();
  };
  const updateGoal = (key: string, patch: Partial<GoalRow>) => {
    setGoals((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
    invalidatePreview();
  };

  const addCard = (teamId: string) => {
    setCards((prev) => [...prev, { key: newKey(), teamId, playerId: '', cardType: 'yellow', minute: '', note: '' }]);
    invalidatePreview();
  };
  const removeCard = (key: string) => {
    setCards((prev) => prev.filter((c) => c.key !== key));
    invalidatePreview();
  };
  const updateCard = (key: string, patch: Partial<CardRow>) => {
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
    invalidatePreview();
  };

  const playerName = (teamId: string, playerId: string): string => {
    if (!context) return '';
    const list = teamId === context.home_team_id ? context.home_team_players : context.away_team_players;
    return list.find((p) => p.id === playerId)?.full_name || '';
  };

  function buildRequestBody(extra: Record<string, unknown> = {}) {
    return {
      tournament_slug: tournamentSlug,
      venue_id: venueId,
      regulation_home_score: regulationHome,
      regulation_away_score: regulationAway,
      penalty_home_score: decidedBy === 'penalty' ? penaltyHome : null,
      penalty_away_score: decidedBy === 'penalty' ? penaltyAway : null,
      decided_by: decidedBy,
      winner_team_id: winnerTeamId,
      goals: goals.map((g) => ({
        team_id: g.teamId,
        player_id: g.playerId || null,
        minute: g.minute,
        is_own_goal: g.isOwnGoal,
        goals: g.goals,
        note: g.note || null,
      })),
      cards: cards.map((c) => ({
        team_id: c.teamId,
        player_id: c.playerId,
        card_type: c.cardType,
        minute: c.minute,
        note: c.note || null,
      })),
      report_text: reportText || null,
      ...extra,
    };
  }

  const runPreview = async () => {
    setBusy(true);
    setFormError('');
    try {
      const response = await fetch(`/api/tournament/admin/matches/${matchId}/full-report`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(buildRequestBody({ preview: true })),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessageForCode(payload.code, payload.error || 'ตรวจสอบตัวอย่างไม่สำเร็จ'));
      setPreview(payload.data as PreviewResponse);
      setPreviewStale(false);
      setIdempotencyKey(crypto.randomUUID());
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'ตรวจสอบตัวอย่างไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const confirmPublish = async () => {
    if (!preview || previewStale || !idempotencyKey) return;
    setBusy(true);
    setFormError('');
    try {
      const response = await fetch(`/api/tournament/admin/matches/${matchId}/full-report`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(
          buildRequestBody({
            expected_version: preview.current_version,
            idempotency_key: idempotencyKey,
            preview_token: preview.preview_token,
          })
        ),
      });
      const payload = await response.json();
      if (!response.ok) {
        setPreviewStale(true);
        throw new Error(errorMessageForCode(payload.code, payload.error || 'เผยแพร่ผลไม่สำเร็จ'));
      }
      setSuccessMessage('เผยแพร่ผลการแข่งขันอย่างเป็นทางการสำเร็จ');
      setPreview(null);
      setIdempotencyKey(null);
      if (context) setContext({ ...context, already_published: true, current_version: payload.data.new_match_version });
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'เผยแพร่ผลไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="rounded-xl bg-white p-8 shadow-sm">กำลังโหลด...</div>;
  }
  if (loadError || !context) {
    return (
      <div className="mx-auto max-w-3xl">
        <div role="alert" className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-red-800">
          {loadError || 'ไม่พบข้อมูล Match'}
        </div>
      </div>
    );
  }

  if (context.already_published) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">TOURNAMENT V2</span>
        <h1 className="text-2xl font-bold text-slate-900">รายงานผลการแข่งขันฉบับสมบูรณ์ — {context.match_code}</h1>
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-5">
          <h2 className="font-bold text-emerald-900">ผลการแข่งขันเผยแพร่แล้ว</h2>
          <p className="mt-2 text-sm text-emerald-900">หากต้องการแก้ไข ต้องเข้าสู่กระบวนการขอแก้ไขผลการแข่งขัน</p>
        </div>
      </div>
    );
  }

  const teams = [
    { id: context.home_team_id, name: context.home_team_name, players: context.home_team_players },
    { id: context.away_team_id, name: context.away_team_name, players: context.away_team_players },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-2">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">TOURNAMENT V2</span>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">ผลการแข่งขันอย่างเป็นทางการ</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">รายงานผลการแข่งขันฉบับสมบูรณ์</h1>
        <div className="mt-2 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">
          ผลการแข่งขันนี้จะถูกเผยแพร่และนำไปคำนวณตารางคะแนน
          <br />
          เมื่อเผยแพร่แล้ว หากต้องการแก้ไขต้องเข้าสู่กระบวนการขอแก้ไขผล
        </div>
      </div>

      {/* Match context */}
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="grid grid-cols-2 gap-2 text-sm text-slate-600 sm:grid-cols-3">
          <div>Match: <span className="font-semibold text-slate-900">{context.match_code}</span> (#{context.match_no ?? '-'})</div>
          <div>{context.category_code} · {context.group_code ? `กลุ่ม ${context.group_code}` : context.stage}</div>
          <div>{context.match_date} {context.match_time}</div>
          <div>{context.venue_name} / {context.court_name}</div>
          <div className="col-span-2 text-base font-bold text-slate-900">
            {context.home_team_name} <span className="text-slate-400">vs</span> {context.away_team_name}
          </div>
          <div className="text-xs text-slate-400">เวอร์ชัน Match ปัจจุบัน: {context.current_version}</div>
        </div>
      </section>

      {formError && (
        <div role="alert" className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">
          {formError}
        </div>
      )}
      {successMessage && (
        <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{successMessage}</div>
      )}

      {/* Official score */}
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-bold text-slate-900">ผลการแข่งขัน (เวลาแข่งจริง)</h2>
        <div className="mt-3 grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">{context.home_team_name}</span>
            <input
              type="number"
              min={0}
              value={regulationHome}
              onChange={(e) => {
                setRegulationHome(e.target.value);
                invalidatePreview();
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center text-2xl font-bold"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-slate-700">{context.away_team_name}</span>
            <input
              type="number"
              min={0}
              value={regulationAway}
              onChange={(e) => {
                setRegulationAway(e.target.value);
                invalidatePreview();
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-center text-2xl font-bold"
            />
          </label>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-semibold text-slate-700">ตัดสินผลโดย</span>
          <select
            value={decidedBy}
            onChange={(e) => {
              setDecidedBy(e.target.value as 'regulation' | 'penalty');
              invalidatePreview();
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="regulation">ผลเวลาแข่งจริง</option>
            <option value="penalty">ยิงลูกโทษ</option>
          </select>
        </label>

        {decidedBy === 'penalty' && (
          <div className="mt-3 grid grid-cols-2 gap-4">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">ลูกโทษ — {context.home_team_name}</span>
              <input
                type="number"
                min={0}
                value={penaltyHome}
                onChange={(e) => {
                  setPenaltyHome(e.target.value);
                  invalidatePreview();
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">ลูกโทษ — {context.away_team_name}</span>
              <input
                type="number"
                min={0}
                value={penaltyAway}
                onChange={(e) => {
                  setPenaltyAway(e.target.value);
                  invalidatePreview();
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center"
              />
            </label>
          </div>
        )}

        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-semibold text-slate-700">ทีมชนะ</span>
          <select
            value={winnerTeamId}
            onChange={(e) => {
              setWinnerTeamId(e.target.value);
              invalidatePreview();
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2"
          >
            <option value="">เลือกทีมชนะ</option>
            <option value={context.home_team_id}>{context.home_team_name}</option>
            <option value={context.away_team_id}>{context.away_team_name}</option>
          </select>
        </label>
      </section>

      {/* Goal events */}
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-bold text-slate-900">ประตู</h2>
        <div className="mt-2 flex gap-2">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => addGoal(team.id)}
              className="rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800"
            >
              + ประตู {team.name}
            </button>
          ))}
        </div>
        <ul className="mt-3 space-y-3">
          {goals.map((goal) => {
            const team = teams.find((t) => t.id === goal.teamId);
            return (
              <li key={goal.key} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>{team?.name}</span>
                  <button type="button" onClick={() => removeGoal(goal.key)} className="text-red-600">
                    ลบ
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <select
                    value={goal.playerId}
                    onChange={(e) => updateGoal(goal.key, { playerId: e.target.value })}
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">ไม่ระบุผู้เล่น</option>
                    {team?.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} {p.shirt_no ? `#${p.shirt_no}` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="นาที"
                    min={0}
                    value={goal.minute}
                    onChange={(e) => updateGoal(goal.key, { minute: e.target.value })}
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="จำนวนประตู"
                    min={1}
                    value={goal.goals}
                    onChange={(e) => updateGoal(goal.key, { goals: e.target.value })}
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <label className="flex items-center gap-1.5 text-sm text-slate-600">
                    <input type="checkbox" checked={goal.isOwnGoal} onChange={(e) => updateGoal(goal.key, { isOwnGoal: e.target.checked })} />
                    ประตูตัวเอง
                  </label>
                </div>
                <input
                  type="text"
                  placeholder="หมายเหตุ"
                  value={goal.note}
                  onChange={(e) => updateGoal(goal.key, { note: e.target.value })}
                  className="mt-2 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </li>
            );
          })}
          {goals.length === 0 && <p className="text-sm text-slate-400">ยังไม่มีประตูที่บันทึก</p>}
        </ul>
      </section>

      {/* Card events */}
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-bold text-slate-900">ใบเหลือง / ใบแดง</h2>
        <div className="mt-2 flex gap-2">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => addCard(team.id)}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"
            >
              + ใบเตือน {team.name}
            </button>
          ))}
        </div>
        <ul className="mt-3 space-y-3">
          {cards.map((card) => {
            const team = teams.find((t) => t.id === card.teamId);
            return (
              <li key={card.key} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
                  <span>{team?.name}</span>
                  <button type="button" onClick={() => removeCard(card.key)} className="text-red-600">
                    ลบ
                  </button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <select
                    value={card.playerId}
                    onChange={(e) => updateCard(card.key, { playerId: e.target.value })}
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">เลือกผู้เล่น</option>
                    {team?.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} {p.shirt_no ? `#${p.shirt_no}` : ''}
                      </option>
                    ))}
                  </select>
                  <select
                    value={card.cardType}
                    onChange={(e) => updateCard(card.key, { cardType: e.target.value as CardRow['cardType'] })}
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="yellow">ใบเหลือง</option>
                    <option value="second_yellow">ใบเหลืองใบที่สอง</option>
                    <option value="red">ใบแดง</option>
                  </select>
                  <input
                    type="number"
                    placeholder="นาที"
                    min={0}
                    value={card.minute}
                    onChange={(e) => updateCard(card.key, { minute: e.target.value })}
                    className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <input
                  type="text"
                  placeholder="หมายเหตุ"
                  value={card.note}
                  onChange={(e) => updateCard(card.key, { note: e.target.value })}
                  className="mt-2 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </li>
            );
          })}
          {cards.length === 0 && <p className="text-sm text-slate-400">ยังไม่มีใบเหลือง/ใบแดงที่บันทึก</p>}
        </ul>
      </section>

      {/* Report text */}
      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-bold text-slate-900">บันทึกการแข่งขัน</h2>
        <textarea
          value={reportText}
          onChange={(e) => {
            setReportText(e.target.value);
            invalidatePreview();
          }}
          rows={4}
          placeholder="สรุปเหตุการณ์สำคัญ, เหตุการณ์พิเศษ, หมายเหตุการดำเนินงาน"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
      </section>

      {/* Preview / Publish */}
      {!preview || previewStale ? (
        <button
          type="button"
          onClick={runPreview}
          disabled={busy || !regulationHome || !regulationAway || !winnerTeamId}
          className="w-full rounded-lg bg-blue-600 px-5 py-3.5 text-base font-semibold text-white disabled:bg-slate-300"
        >
          {busy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบตัวอย่าง'}
        </button>
      ) : (
        <section className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5">
          <h3 className="font-bold text-blue-900">ตรวจสอบตัวอย่าง</h3>
          <p className="mt-2 text-lg font-bold text-blue-900">
            {context.home_team_name} {preview.regulation_home_score} - {preview.regulation_away_score} {context.away_team_name}
            {preview.decided_by === 'penalty' && (
              <span className="ml-2 text-sm font-semibold text-blue-700">
                (ลูกโทษ {preview.penalty_home_score}-{preview.penalty_away_score})
              </span>
            )}
          </p>

          {preview.quick_result_comparison.has_quick_result && (
            <div
              className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold ${
                preview.quick_result_comparison.matches ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'
              }`}
            >
              ผลด่วนจากหน้างาน: {preview.quick_result_comparison.quick_result_home_score}-{preview.quick_result_comparison.quick_result_away_score}
              {preview.quick_result_comparison.matches ? ' (ตรงกับรายงานฉบับสมบูรณ์)' : ' — ไม่ตรงกับรายงานฉบับสมบูรณ์ กรุณาตรวจสอบ'}
              <div className="mt-1 text-xs font-normal">ผลด่วนเป็นข้อมูลอ้างอิงเบื้องต้นเท่านั้น</div>
            </div>
          )}

          {goals.length > 0 && (
            <div className="mt-3 text-sm text-blue-900">
              <strong>ประตู:</strong>{' '}
              {goals.map((g, i) => `${playerName(g.teamId, g.playerId) || 'ไม่ระบุ'} (${g.minute || '-'}')${i < goals.length - 1 ? ', ' : ''}`)}
            </div>
          )}
          {cards.length > 0 && (
            <div className="mt-1 text-sm text-blue-900">
              <strong>ใบเหลือง/แดง:</strong>{' '}
              {cards.map((c, i) => `${playerName(c.teamId, c.playerId) || '-'} (${c.cardType}, ${c.minute || '-'}')${i < cards.length - 1 ? ', ' : ''}`)}
            </div>
          )}

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={confirmPublish}
              disabled={busy}
              className="flex-1 rounded-lg bg-emerald-700 px-5 py-3.5 text-base font-semibold text-white disabled:bg-slate-300"
            >
              {busy ? 'กำลังเผยแพร่...' : 'ยืนยันและเผยแพร่ผล'}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              disabled={busy}
              className="rounded-lg border border-slate-300 px-5 py-3.5 text-base font-semibold text-slate-700"
            >
              ยกเลิก
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
