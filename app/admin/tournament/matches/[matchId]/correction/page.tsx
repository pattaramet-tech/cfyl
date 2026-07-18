'use client';

import { useEffect, useState, use as usePromise } from 'react';
import { useSearchParams } from 'next/navigation';

interface ResultSnapshot {
  regulation_home_score: number | null;
  regulation_away_score: number | null;
  penalty_home_score: number | null;
  penalty_away_score: number | null;
  decided_by: string | null;
  winner_team_id: string | null;
  result_type: string;
}

interface MatchContext {
  match_id: string;
  match_code: string;
  home_team_id: string;
  home_team_name: string;
  away_team_id: string;
  away_team_name: string;
  current_result: ResultSnapshot;
  current_version: number;
  result_workflow_status: string;
  can_correct: boolean;
}

interface PreviewResponse {
  match_id: string;
  match_code: string;
  current_version: number;
  before_result: ResultSnapshot;
  after_result: ResultSnapshot;
  correction_reason: string;
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

function errorMessageForCode(code: string | undefined, fallback: string): string {
  if (code === 'RESULT_CORRECTION_PREVIEW_EXPIRED') return 'ตัวอย่างการแก้ไขหมดอายุแล้ว กรุณาตรวจสอบตัวอย่างอีกครั้ง';
  if (code === 'RESULT_CORRECTION_PREVIEW_REQUIRED') return 'กรุณาตรวจสอบตัวอย่างก่อนยืนยันการแก้ไข';
  if (code === 'RESULT_CORRECTION_PREVIEW_INVALID') return 'ตัวอย่างไม่ถูกต้อง กรุณาตรวจสอบตัวอย่างอีกครั้ง';
  if (code === 'RESULT_CORRECTION_PREVIEW_MISMATCH') return 'ข้อมูลมีการเปลี่ยนแปลงหลังตรวจสอบตัวอย่าง กรุณาตรวจสอบตัวอย่างอีกครั้ง';
  if (code === 'RESULT_CORRECTION_VERSION_CONFLICT') return 'ข้อมูล Match มีการเปลี่ยนแปลง กรุณาตรวจสอบตัวอย่างใหม่';
  if (code === 'RESULT_CORRECTION_NOT_PUBLISHED') return 'Match นี้ยังไม่มีผลการแข่งขันอย่างเป็นทางการที่เผยแพร่แล้ว';
  if (code === 'RESULT_CORRECTION_NO_CHANGES') return 'ผลที่แก้ไขเหมือนกับผลปัจจุบันทุกประการ ไม่มีการเปลี่ยนแปลง';
  if (code === 'RESULT_CORRECTION_REASON_REQUIRED') return 'กรุณาระบุเหตุผลในการแก้ไขผล';
  if (code === 'RESULT_CORRECTION_RPC_UNAVAILABLE') return 'ระบบแก้ไขผลอย่างเป็นทางการยังไม่พร้อมใช้งานในสภาพแวดล้อมนี้';
  return fallback;
}

function scoreLine(result: ResultSnapshot, homeTeamName: string, awayTeamName: string): string {
  const reg = `${homeTeamName} ${result.regulation_home_score ?? '-'} - ${result.regulation_away_score ?? '-'} ${awayTeamName}`;
  if (result.decided_by === 'penalty') {
    return `${reg} (ลูกโทษ ${result.penalty_home_score ?? '-'}-${result.penalty_away_score ?? '-'})`;
  }
  return reg;
}

export default function ResultCorrectionPage({ params }: { params: Promise<{ matchId: string }> }) {
  const { matchId } = usePromise(params);
  const searchParams = useSearchParams();
  const tournamentSlug = searchParams.get('tournament_slug') || '';

  const [context, setContext] = useState<MatchContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [regulationHome, setRegulationHome] = useState('');
  const [regulationAway, setRegulationAway] = useState('');
  const [penaltyHome, setPenaltyHome] = useState('');
  const [penaltyAway, setPenaltyAway] = useState('');
  const [decidedBy, setDecidedBy] = useState<'regulation' | 'penalty'>('regulation');
  const [winnerTeamId, setWinnerTeamId] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');

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
        const response = await fetch(`/api/tournament/admin/matches/${matchId}/correction?tournament_slug=${tournamentSlug}`, {
          headers: authHeaders(),
          cache: 'no-store',
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(errorMessageForCode(payload.code, payload.error || 'โหลดข้อมูล Match ไม่สำเร็จ'));
        const data = payload.data as MatchContext;
        setContext(data);
        setRegulationHome(String(data.current_result.regulation_home_score ?? ''));
        setRegulationAway(String(data.current_result.regulation_away_score ?? ''));
        setPenaltyHome(data.current_result.penalty_home_score !== null ? String(data.current_result.penalty_home_score) : '');
        setPenaltyAway(data.current_result.penalty_away_score !== null ? String(data.current_result.penalty_away_score) : '');
        setDecidedBy(data.current_result.decided_by === 'penalty' ? 'penalty' : 'regulation');
        setWinnerTeamId(data.current_result.winner_team_id || '');
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

  function buildRequestBody(extra: Record<string, unknown> = {}) {
    return {
      tournament_slug: tournamentSlug,
      regulation_home_score: regulationHome,
      regulation_away_score: regulationAway,
      penalty_home_score: decidedBy === 'penalty' ? penaltyHome : null,
      penalty_away_score: decidedBy === 'penalty' ? penaltyAway : null,
      decided_by: decidedBy,
      winner_team_id: winnerTeamId,
      correction_reason: correctionReason,
      ...extra,
    };
  }

  const runPreview = async () => {
    setBusy(true);
    setFormError('');
    try {
      const response = await fetch(`/api/tournament/admin/matches/${matchId}/correction`, {
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

  const confirmCorrection = async () => {
    if (!preview || previewStale || !idempotencyKey) return;
    setBusy(true);
    setFormError('');
    try {
      const response = await fetch(`/api/tournament/admin/matches/${matchId}/correction`, {
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
        throw new Error(errorMessageForCode(payload.code, payload.error || 'แก้ไขผลไม่สำเร็จ'));
      }
      setSuccessMessage(`แก้ไขผลการแข่งขันอย่างเป็นทางการสำเร็จ (เวอร์ชันใหม่: ${payload.data.new_match_version})`);
      if (context) {
        setContext({
          ...context,
          current_version: payload.data.new_match_version,
          current_result: preview.after_result,
        });
      }
      setPreview(null);
      setIdempotencyKey(null);
      setCorrectionReason('');
    } catch (reason) {
      setFormError(reason instanceof Error ? reason.message : 'แก้ไขผลไม่สำเร็จ');
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

  if (!context.can_correct) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">TOURNAMENT V2</span>
        <h1 className="text-2xl font-bold text-slate-900">แก้ไขผลการแข่งขันที่เผยแพร่แล้ว — {context.match_code}</h1>
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
          <h2 className="font-bold text-amber-900">ยังไม่สามารถแก้ไขผลได้</h2>
          <p className="mt-2 text-sm text-amber-900">
            Match นี้ยังไม่มีผลการแข่งขันอย่างเป็นทางการที่เผยแพร่แล้ว (สถานะ: {context.result_workflow_status}) กรุณาเผยแพร่รายงานผลการแข่งขันฉบับสมบูรณ์ก่อน
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-2">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">TOURNAMENT V2</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">แก้ไขผลที่เผยแพร่แล้ว</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">แก้ไขผลการแข่งขัน (เฉพาะผลสกอร์)</h1>
        <div className="mt-2 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          หน้านี้แก้ไขได้เฉพาะผลสกอร์อย่างเป็นทางการเท่านั้น — ประตู ใบเหลือง/แดง ผู้เล่น และบันทึกการแข่งขัน จะไม่ถูกแก้ไข
        </div>
      </div>

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="grid grid-cols-2 gap-2 text-sm text-slate-600 sm:grid-cols-3">
          <div>Match: <span className="font-semibold text-slate-900">{context.match_code}</span></div>
          <div className="col-span-2 text-base font-bold text-slate-900">
            {context.home_team_name} <span className="text-slate-400">vs</span> {context.away_team_name}
          </div>
          <div className="text-xs text-slate-400">เวอร์ชัน Match ปัจจุบัน: {context.current_version}</div>
        </div>
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-800">
          ผลปัจจุบัน: {scoreLine(context.current_result, context.home_team_name, context.away_team_name)}
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

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <h2 className="font-bold text-slate-900">ผลที่แก้ไข</h2>
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

        <label className="mt-4 block">
          <span className="mb-1 block text-sm font-semibold text-slate-700">เหตุผลในการแก้ไข (จำเป็น)</span>
          <textarea
            value={correctionReason}
            onChange={(e) => {
              setCorrectionReason(e.target.value);
              invalidatePreview();
            }}
            rows={3}
            placeholder="ระบุเหตุผลที่ต้องแก้ไขผลการแข่งขันที่เผยแพร่แล้ว"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
      </section>

      {!preview || previewStale ? (
        <button
          type="button"
          onClick={runPreview}
          disabled={busy || !regulationHome || !regulationAway || !winnerTeamId || !correctionReason.trim()}
          className="w-full rounded-lg bg-blue-600 px-5 py-3.5 text-base font-semibold text-white disabled:bg-slate-300"
        >
          {busy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบตัวอย่างการแก้ไข'}
        </button>
      ) : (
        <section className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
          <h3 className="font-bold text-amber-900">ตรวจสอบตัวอย่างการแก้ไข</h3>

          <div className="mt-3 space-y-2">
            <div className="rounded-lg bg-white px-3 py-2 text-sm">
              <span className="font-semibold text-slate-500">ก่อนแก้ไข: </span>
              <span className="text-slate-700 line-through">{scoreLine(preview.before_result, context.home_team_name, context.away_team_name)}</span>
            </div>
            <div className="rounded-lg bg-white px-3 py-2 text-sm">
              <span className="font-semibold text-emerald-700">หลังแก้ไข: </span>
              <span className="font-bold text-emerald-900">{scoreLine(preview.after_result, context.home_team_name, context.away_team_name)}</span>
            </div>
          </div>

          <div className="mt-3 rounded-lg bg-white px-3 py-2 text-sm">
            <span className="font-semibold text-slate-500">เหตุผล: </span>
            <span className="text-slate-800">{preview.correction_reason}</span>
          </div>

          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={confirmCorrection}
              disabled={busy}
              className="flex-1 rounded-lg bg-amber-700 px-5 py-3.5 text-base font-semibold text-white disabled:bg-slate-300"
            >
              {busy ? 'กำลังยืนยัน...' : 'ยืนยันการแก้ไขผล'}
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
