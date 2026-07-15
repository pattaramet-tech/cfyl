'use client';

import { useEffect, useMemo, useState, use as usePromise } from 'react';
import { useSearchParams } from 'next/navigation';
import { clearLocalDraft, loadLocalDraft, saveLocalDraft } from '@/lib/tournament/services/localDraft';
import {
  cancelQueuedRetry,
  enqueueRetry,
  getRetryQueue,
  markFailed,
  markRetrying,
  markSuccess,
  type RetryQueueItem,
} from '@/lib/tournament/services/retryQueue';

interface MatchSummary {
  match_id: string;
  match_code: string;
  match_no: number | null;
  match_date: string | null;
  match_time: string | null;
  category_code: string;
  home_team_name: string;
  away_team_name: string;
  status: string;
  has_quick_result: boolean;
  eligible: boolean;
  ineligible_reason: string | null;
}

interface PreviewData {
  match_id: string;
  category_code: string;
  category_name: string;
  venue_name: string;
  court_name: string;
  match_code: string;
  match_no: number | null;
  match_date: string | null;
  match_time: string | null;
  home_team_name: string;
  away_team_name: string;
  home_score: number;
  away_score: number;
  current_version: number;
}

function getToken(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem('admin_token');
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return { ...(extra || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  const key = 'tournament_v2_matchday_session_id';
  let sessionId = window.sessionStorage.getItem(key);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    window.sessionStorage.setItem(key, sessionId);
  }
  return sessionId;
}

function groupLabel(match: MatchSummary): string {
  if (match.status === 'in_progress') return 'กำลังแข่งขัน';
  if (match.has_quick_result) return 'บันทึกผลเบื้องต้นแล้ว';
  if (match.status === 'scheduled') return 'รอบันทึกผล';
  return 'นัดถัดไป';
}

const GROUP_ORDER = ['กำลังแข่งขัน', 'นัดถัดไป', 'รอบันทึกผล', 'บันทึกผลเบื้องต้นแล้ว'];

function ineligibleMessage(reason: string | null): string {
  if (!reason) return '';
  if (reason === 'HOME_TEAM_UNRESOLVED') return 'ทีมเหย้ายังไม่ถูกกำหนด (TBD)';
  if (reason === 'AWAY_TEAM_UNRESOLVED') return 'ทีมเยือนยังไม่ถูกกำหนด (TBD)';
  if (reason === 'RESULT_ALREADY_PUBLISHED') return 'มีผลการแข่งขันอย่างเป็นทางการแล้ว';
  if (reason.startsWith('MATCH_STATUS_INCOMPATIBLE')) return 'สถานะ Match นี้ไม่รองรับผลด่วน (เช่น BYE)';
  return reason;
}

export default function VenueMatchdayPage({ params }: { params: Promise<{ venueId: string }> }) {
  const { venueId } = usePromise(params);
  const searchParams = useSearchParams();
  const tournamentSlug = searchParams.get('tournament_slug') || '';
  const date = searchParams.get('date') || new Date().toISOString().slice(0, 10);

  const [matches, setMatches] = useState<MatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [homeScoreInput, setHomeScoreInput] = useState('');
  const [awayScoreInput, setAwayScoreInput] = useState('');
  const [matchVersion, setMatchVersion] = useState<number | null>(null);

  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const [draftSavedNotice, setDraftSavedNotice] = useState(false);
  const [retryQueue, setRetryQueue] = useState<RetryQueueItem[]>([]);

  const loadMatches = () => {
    if (!tournamentSlug) return;
    setLoading(true);
    setError('');
    fetch(
      `/api/tournament/admin/venues/${venueId}/matchday?tournament_slug=${tournamentSlug}&date=${date}`,
      { headers: authHeaders(), cache: 'no-store' }
    )
      .then(async (response) => {
        if (response.status === 403) throw new Error('ไม่มีสิทธิ์ใช้งานสนามนี้');
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || 'โหลดตารางแข่งขันไม่สำเร็จ');
        }
        return response.json();
      })
      .then((payload) => setMatches((payload.data?.matches || []) as MatchSummary[]))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'โหลดตารางแข่งขันไม่สำเร็จ'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const token = getToken();
    if (!token) {
      window.location.href = '/admin/login';
      return;
    }
    // Fetch-on-mount-and-param-change: loadMatches/setRetryQueue set state
    // only inside their own async continuations (.then/.finally) except for
    // the initial setLoading(true)/setRetryQueue seed, which is intentional
    // here — this effect's sole purpose is to synchronize this page with the
    // tournamentSlug/date/venueId route params.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMatches();
    setRetryQueue(getRetryQueue());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentSlug, date, venueId]);

  const grouped = useMemo(() => {
    const groups: Record<string, MatchSummary[]> = {};
    for (const match of matches) {
      const label = groupLabel(match);
      groups[label] = groups[label] || [];
      groups[label].push(match);
    }
    return groups;
  }, [matches]);

  const selectedMatch = matches.find((m) => m.match_id === selectedMatchId) || null;

  const selectMatch = (match: MatchSummary) => {
    setSelectedMatchId(match.match_id);
    setPreview(null);
    setPreviewStale(false);
    setSubmitError('');
    setSuccessMessage('');
    setConflict(false);
    setIdempotencyKey(null);

    const draft = loadLocalDraft(tournamentSlug, venueId, match.match_id);
    if (draft) {
      setHomeScoreInput(draft.homeScore);
      setAwayScoreInput(draft.awayScore);
      setMatchVersion(draft.matchVersion);
      setDraftSavedNotice(true);
    } else {
      setHomeScoreInput('');
      setAwayScoreInput('');
      setMatchVersion(null);
      setDraftSavedNotice(false);
    }
  };

  const onScoreChange = (side: 'home' | 'away', value: string) => {
    if (side === 'home') setHomeScoreInput(value);
    else setAwayScoreInput(value);
    // Editing after Preview invalidates it — a fresh Preview is required before Submit.
    if (preview) setPreviewStale(true);

    if (selectedMatchId) {
      saveLocalDraft({
        tournamentId: tournamentSlug,
        venueId,
        matchId: selectedMatchId,
        homeScore: side === 'home' ? value : homeScoreInput,
        awayScore: side === 'away' ? value : awayScoreInput,
        matchVersion: matchVersion || 0,
        savedAt: new Date().toISOString(),
      });
      setDraftSavedNotice(true);
    }
  };

  const runPreview = async () => {
    if (!selectedMatchId) return;
    setBusy(true);
    setSubmitError('');
    setConflict(false);
    try {
      const response = await fetch(`/api/tournament/admin/matches/${selectedMatchId}/quick-result`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          tournament_slug: tournamentSlug,
          venue_id: venueId,
          home_score: homeScoreInput,
          away_score: awayScoreInput,
          preview: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'ดูตัวอย่างไม่สำเร็จ');
      setPreview(payload.data as PreviewData);
      setPreviewStale(false);
      setMatchVersion((payload.data as PreviewData).current_version);
      setIdempotencyKey(crypto.randomUUID());
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : 'ดูตัวอย่างไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const submitQuickResult = async (retryKey?: string) => {
    if (!selectedMatchId || !preview || previewStale || matchVersion === null) return;
    const key = retryKey || idempotencyKey;
    if (!key) return;

    setBusy(true);
    setSubmitError('');
    setConflict(false);

    try {
      const response = await fetch(`/api/tournament/admin/matches/${selectedMatchId}/quick-result`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          tournament_slug: tournamentSlug,
          venue_id: venueId,
          home_score: preview.home_score,
          away_score: preview.away_score,
          expected_version: matchVersion,
          idempotency_key: key,
          session_id: getSessionId(),
          device_metadata: { user_agent: navigator.userAgent, platform: navigator.platform },
        }),
      });
      const payload = await response.json();

      if (response.status === 409) {
        setConflict(true);
        setSubmitError('ข้อมูลการแข่งขันมีการเปลี่ยนแปลง กรุณาตรวจสอบใหม่');
        setPreviewStale(true);
        markFailed(key, 'version_conflict');
        setRetryQueue(getRetryQueue());
        return;
      }
      if (!response.ok) throw new Error(payload.error || 'ส่งผลเบื้องต้นไม่สำเร็จ');

      markSuccess(key);
      setRetryQueue(getRetryQueue());
      clearLocalDraft(tournamentSlug, venueId, selectedMatchId);
      setSuccessMessage('ส่งผลเบื้องต้นสำเร็จ');
      setPreview(null);
      setIdempotencyKey(null);
      setDraftSavedNotice(false);
      loadMatches();
    } catch (reason) {
      // Network failure — queue for retry, preserving the same idempotency key.
      enqueueRetry({
        idempotencyKey: key,
        matchId: selectedMatchId,
        tournamentId: tournamentSlug,
        venueId,
        homeScore: preview.home_score,
        awayScore: preview.away_score,
        expectedVersion: matchVersion,
      });
      setRetryQueue(getRetryQueue());
      setSubmitError(reason instanceof Error ? reason.message : 'รอเชื่อมต่อเพื่อส่งอีกครั้ง');
    } finally {
      setBusy(false);
    }
  };

  const retryQueuedItem = async (item: RetryQueueItem) => {
    markRetrying(item.idempotencyKey);
    setRetryQueue(getRetryQueue());
    setBusy(true);
    try {
      const response = await fetch(`/api/tournament/admin/matches/${item.matchId}/quick-result`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          tournament_slug: item.tournamentId,
          venue_id: item.venueId,
          home_score: item.homeScore,
          away_score: item.awayScore,
          expected_version: item.expectedVersion,
          idempotency_key: item.idempotencyKey,
          session_id: getSessionId(),
        }),
      });
      if (response.ok) {
        markSuccess(item.idempotencyKey);
        clearLocalDraft(item.tournamentId, item.venueId, item.matchId);
        loadMatches();
      } else {
        const payload = await response.json().catch(() => null);
        markFailed(item.idempotencyKey, payload?.error || 'retry_failed');
      }
    } catch {
      markFailed(item.idempotencyKey, 'network_error');
    } finally {
      setRetryQueue(getRetryQueue());
      setBusy(false);
    }
  };

  const cancelRetry = (idempotencyKey: string) => {
    setRetryQueue(cancelQueuedRetry(idempotencyKey));
  };

  if (loading) {
    return <div className="rounded-xl bg-white p-8 shadow-sm">กำลังโหลด...</div>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-2">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">TOURNAMENT V2</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">บันทึกผลด่วน</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Matchday — {date}</h1>
        <div className="mt-2 rounded-lg border-l-4 border-blue-500 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-900">
          ผลด่วนเป็นข้อมูลเบื้องต้นสำหรับการดำเนินงานหน้างาน
          <br />
          ยังไม่ใช่ผลการแข่งขันที่เผยแพร่อย่างเป็นทางการ
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      {retryQueue.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="text-sm font-bold text-amber-900">รอเชื่อมต่อเพื่อส่งอีกครั้ง ({retryQueue.length})</h2>
          <ul className="mt-2 space-y-2">
            {retryQueue.map((item) => (
              <li key={item.idempotencyKey} className="flex items-center justify-between text-xs text-amber-900">
                <span>
                  {item.homeScore}-{item.awayScore} ({item.status}, ครั้งที่ {item.attempts})
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => retryQueuedItem(item)}
                    disabled={busy}
                    className="rounded bg-amber-600 px-2 py-1 font-semibold text-white"
                  >
                    ลองอีกครั้ง
                  </button>
                  {item.status !== 'success' && (
                    <button
                      type="button"
                      onClick={() => cancelRetry(item.idempotencyKey)}
                      className="rounded border border-amber-400 px-2 py-1 font-semibold text-amber-800"
                    >
                      ยกเลิก
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!selectedMatch && (
        <section className="space-y-4">
          {GROUP_ORDER.filter((label) => grouped[label]?.length).map((label) => (
            <div key={label}>
              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{label}</h2>
              <div className="space-y-2">
                {grouped[label].map((match) => (
                  <button
                    key={match.match_id}
                    type="button"
                    onClick={() => selectMatch(match)}
                    className="w-full rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 active:bg-slate-50"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-mono font-semibold">{match.match_code}</span>
                      <span>#{match.match_no ?? '-'}</span>
                    </div>
                    <div className="mt-1 text-base font-semibold text-slate-900">
                      {match.home_team_name} <span className="text-slate-400">vs</span> {match.away_team_name}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {match.category_code} · {match.match_time || '—'}
                    </div>
                    {!match.eligible && (
                      <div className="mt-1 text-xs font-semibold text-red-600">{ineligibleMessage(match.ineligible_reason)}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {matches.length === 0 && <p className="text-sm text-slate-500">ไม่มี Match ในสนามและวันที่นี้</p>}
        </section>
      )}

      {selectedMatch && (
        <section className="space-y-4">
          <button type="button" onClick={() => setSelectedMatchId(null)} className="text-sm font-semibold text-blue-700">
            ← กลับไปรายการ Match
          </button>

          <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-mono font-semibold">{selectedMatch.match_code}</span>
              <span>#{selectedMatch.match_no ?? '-'}</span>
            </div>
            <div className="mt-1 text-sm text-slate-500">
              {selectedMatch.category_code} · สนามนี้ · {selectedMatch.match_time || '—'}
            </div>

            {!selectedMatch.eligible ? (
              <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                ไม่สามารถบันทึกผลด่วนได้: {ineligibleMessage(selectedMatch.ineligible_reason)}
              </div>
            ) : (
              <>
                {draftSavedNotice && (
                  <p className="mt-2 text-xs font-semibold text-emerald-700">บันทึกร่างในอุปกรณ์แล้ว</p>
                )}
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">{selectedMatch.home_team_name}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={homeScoreInput}
                      onChange={(event) => onScoreChange('home', event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-4 text-center text-3xl font-bold"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-semibold text-slate-700">{selectedMatch.away_team_name}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={awayScoreInput}
                      onChange={(event) => onScoreChange('away', event.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-4 text-center text-3xl font-bold"
                    />
                  </label>
                </div>

                {submitError && (
                  <div role="alert" className="mt-3 rounded-lg border-l-4 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {submitError}
                  </div>
                )}
                {successMessage && (
                  <div className="mt-3 rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    {successMessage}
                  </div>
                )}

                {!preview || previewStale ? (
                  <button
                    type="button"
                    onClick={runPreview}
                    disabled={busy || homeScoreInput === '' || awayScoreInput === ''}
                    className="mt-4 w-full rounded-lg bg-blue-600 px-5 py-3.5 text-base font-semibold text-white disabled:bg-slate-300"
                  >
                    {busy ? 'กำลังตรวจสอบ...' : 'ดูตัวอย่าง'}
                  </button>
                ) : (
                  <div className="mt-4 rounded-xl border-2 border-blue-300 bg-blue-50 p-4">
                    <h3 className="font-bold text-blue-900">ผลเบื้องต้น (ตัวอย่าง)</h3>
                    <dl className="mt-2 space-y-1 text-sm text-blue-900">
                      <div>Match: {preview.match_code} (#{preview.match_no})</div>
                      <div>{preview.category_name} · {preview.venue_name} / {preview.court_name}</div>
                      <div>{preview.match_date} {preview.match_time}</div>
                      <div className="text-lg font-bold">
                        {preview.home_team_name} {preview.home_score} - {preview.away_score} {preview.away_team_name}
                      </div>
                      <div className="text-xs text-blue-700">เวอร์ชันปัจจุบัน: {preview.current_version}</div>
                    </dl>
                    <div className="mt-4 flex gap-3">
                      <button
                        type="button"
                        onClick={() => submitQuickResult()}
                        disabled={busy}
                        className="flex-1 rounded-lg bg-emerald-700 px-5 py-3.5 text-base font-semibold text-white disabled:bg-slate-300"
                      >
                        {busy ? 'กำลังส่ง...' : 'ยืนยันส่งผลเบื้องต้น'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPreview(null);
                          setPreviewStale(false);
                        }}
                        disabled={busy}
                        className="rounded-lg border border-slate-300 px-5 py-3.5 text-base font-semibold text-slate-700"
                      >
                        ยกเลิก
                      </button>
                    </div>
                    {conflict && (
                      <p className="mt-2 text-xs font-semibold text-red-700">
                        กรุณากด &quot;ดูตัวอย่าง&quot; ใหม่อีกครั้งก่อนยืนยัน
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
