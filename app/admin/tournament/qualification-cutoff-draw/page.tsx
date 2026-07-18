'use client';

import { useEffect, useState } from 'react';

interface TournamentOption {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface CategoryOption {
  id: string;
  code: string;
  name: string;
}

interface TeamOption {
  team_id: string;
  team_name: string;
  team_code: string;
}

interface VersionCandidate {
  team_id: string;
  team_code: string;
  team_name: string;
  points_at_draw: number;
  is_selected: boolean;
}

interface DrawVersion {
  draw_id: string;
  version: number;
  is_active: boolean;
  drawn_by: string | null;
  drawn_at: string;
  note: string | null;
  available_slots: number;
  candidates: VersionCandidate[];
}

interface CutoffState {
  category_id: string;
  group_id: string;
  group_code: string;
  active_draw_id: string | null;
  automatic_qualifiers: TeamOption[];
  automatic_eliminated: TeamOption[];
  draw_candidates: TeamOption[];
  available_slots: number;
  selected_by_draw: string[];
  eliminated_by_draw: string[];
  qualification_state: 'resolved' | 'pending_draw' | 'draw_recorded' | 'incomplete' | 'stale_draw';
  explanation: string;
  cutoff_position: number;
  cutoff_points: number | null;
  candidate_snapshot: string;
  versions: DrawVersion[];
}

interface PreviewResponse {
  category_id: string;
  group_id: string;
  group_code: string;
  active_draw_id: string | null;
  draw_candidates: TeamOption[];
  available_slots: number;
  selected_team_ids: string[];
  candidate_snapshot: string;
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
  if (code === 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_EXPIRED') return 'ตัวอย่างผลจับฉลากหมดอายุแล้ว กรุณาตรวจสอบตัวอย่างอีกครั้ง';
  if (code === 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_REQUIRED') return 'กรุณาตรวจสอบตัวอย่างก่อนยืนยันบันทึกผลจับฉลาก';
  if (code === 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_INVALID') return 'ตัวอย่างไม่ถูกต้อง กรุณาตรวจสอบตัวอย่างอีกครั้ง';
  if (code === 'QUALIFICATION_CUTOFF_DRAW_PREVIEW_MISMATCH') return 'ข้อมูลมีการเปลี่ยนแปลงหลังตรวจสอบตัวอย่าง กรุณาตรวจสอบตัวอย่างใหม่';
  if (code === 'QUALIFICATION_CUTOFF_DRAW_STALE_STATE' || code === 'QUALIFICATION_CUTOFF_DRAW_STALE_CANDIDATES')
    return 'ข้อมูลมีการเปลี่ยนแปลงตั้งแต่ครั้งล่าสุดที่โหลด (เช่น มีการแก้ไขผลการแข่งขัน) กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง';
  if (code === 'QUALIFICATION_CUTOFF_DRAW_NOT_APPLICABLE') return 'กลุ่มนี้ไม่มีทีมคะแนนเท่ากันคร่อมเส้นโควตา ไม่ต้องจับฉลาก';
  if (code === 'QUALIFICATION_CUTOFF_DRAW_GROUP_INCOMPLETE') return 'ผลการแข่งขันในกลุ่มยังไม่ครบ ยังไม่สามารถจับฉลากได้';
  if (code === 'QUALIFICATION_CUTOFF_DRAW_RPC_UNAVAILABLE') return 'ระบบบันทึกผลจับฉลากยังไม่พร้อมใช้งานในสภาพแวดล้อมนี้';
  return fallback;
}

function stateLabel(state: CutoffState['qualification_state']): { text: string; color: string } {
  switch (state) {
    case 'resolved':
      return { text: 'ตัดสินด้วยคะแนนแล้ว ไม่ต้องจับฉลาก', color: 'bg-emerald-100 text-emerald-800' };
    case 'pending_draw':
      return { text: 'รอจับฉลาก — มีทีมคะแนนเท่ากันคร่อมเส้นโควตา', color: 'bg-amber-100 text-amber-900' };
    case 'draw_recorded':
      return { text: 'บันทึกผลจับฉลากแล้ว', color: 'bg-emerald-100 text-emerald-800' };
    case 'stale_draw':
      return { text: 'ผลจับฉลากเดิมล้าสมัย — ต้องจับฉลากใหม่', color: 'bg-red-100 text-red-800' };
    case 'incomplete':
    default:
      return { text: 'ผลการแข่งขันในกลุ่มยังไม่ครบ', color: 'bg-slate-100 text-slate-700' };
  }
}

export default function QualificationCutoffDrawPage() {
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [tournamentId, setTournamentId] = useState('');
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryCode, setCategoryCode] = useState('');
  const [groupCode, setGroupCode] = useState('');

  const [cutoffState, setCutoffState] = useState<CutoffState | null>(null);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) {
      window.location.href = '/admin/login';
      return;
    }
    fetch('/api/tournament/admin/tournaments', { headers: authHeaders(), cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => {
        const options = (payload.data || []) as TournamentOption[];
        setTournaments(options);
        if (options.length > 0) setTournamentId(options[0].id);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'โหลด Tournament ไม่สำเร็จ'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!tournamentId) return;
    fetch(`/api/tournament/admin/categories?tournament_id=${tournamentId}`, { headers: authHeaders(), cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => setCategories((payload.data || []) as CategoryOption[]))
      .catch(() => setCategories([]));
  }, [tournamentId]);

  const selectedTournament = tournaments.find((t) => t.id === tournamentId);

  const loadCutoffState = async (code: string, group: string) => {
    if (!selectedTournament || !code || !group) return;
    setBusy(true);
    setError('');
    setCutoffState(null);
    setPreview(null);
    setSelectedTeamIds([]);
    try {
      const response = await fetch(
        `/api/tournament/admin/qualification-cutoff-draws?tournament_slug=${selectedTournament.slug}&category_code=${code}&group_code=${group}`,
        { headers: authHeaders() }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessageForCode(payload.code, payload.error || 'โหลดข้อมูลไม่สำเร็จ'));
      setCutoffState(payload.data as CutoffState);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'โหลดข้อมูลไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const toggleTeam = (teamId: string) => {
    setPreview(null);
    setSelectedTeamIds((prev) => (prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId]));
  };

  const runPreview = async () => {
    if (!selectedTournament || !cutoffState) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/tournament/admin/qualification-cutoff-draws', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          tournament_slug: selectedTournament.slug,
          category_code: categoryCode,
          group_code: groupCode,
          selected_team_ids: selectedTeamIds,
          preview: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(errorMessageForCode(payload.code, payload.error || 'ตรวจสอบตัวอย่างไม่สำเร็จ'));
      setPreview(payload.data as PreviewResponse);
      setPreviewStale(false);
      setIdempotencyKey(crypto.randomUUID());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ตรวจสอบตัวอย่างไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const confirmSave = async () => {
    if (!selectedTournament || !preview || previewStale || !idempotencyKey) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/tournament/admin/qualification-cutoff-draws', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          tournament_slug: selectedTournament.slug,
          category_code: categoryCode,
          group_code: groupCode,
          selected_team_ids: preview.selected_team_ids,
          note: note || null,
          preview_token: preview.preview_token,
          idempotency_key: idempotencyKey,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setPreviewStale(true);
        throw new Error(errorMessageForCode(payload.code, payload.error || 'บันทึกผลจับฉลากไม่สำเร็จ'));
      }
      setSuccessMessage(`บันทึกผลจับฉลากสำเร็จ (เวอร์ชัน ${payload.data.version})`);
      setPreview(null);
      setIdempotencyKey(null);
      await loadCutoffState(categoryCode, groupCode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'บันทึกผลจับฉลากไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="rounded-xl bg-white p-8 shadow-sm">กำลังโหลด...</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-2">
      <div>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">TOURNAMENT V2</span>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">จับฉลากตัดสินสิทธิ์เข้ารอบเมื่อคะแนนเท่ากันคร่อมเส้นโควตา</h1>
        <div className="mt-2 rounded-lg border-l-4 border-amber-500 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          หน้านี้ใช้เมื่อทีมหลายทีมคะแนนเท่ากันคร่อมเส้นโควตาเข้ารอบ<b>ภายในกลุ่ม</b>เท่านั้น — ไม่ใช่การจับฉลากทีมอันดับ 3 ข้ามกลุ่ม (G-U16)
          <br />
          ห้ามใช้ผลการพบกันเอง (H2H) / ผลต่างประตู / ประตูได้ / แฟร์เพลย์ ตัดสินสิทธิ์เข้ารอบ — ต้องจับฉลากจริงที่หน้างานเท่านั้น ระบบไม่มีปุ่มสุ่ม
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {successMessage && <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{successMessage}</div>}

      <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">รายการแข่งขัน</span>
            <select
              value={tournamentId}
              onChange={(e) => {
                setTournamentId(e.target.value);
                setCategoryCode('');
                setGroupCode('');
                setCutoffState(null);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {tournaments.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">ระดับอายุ</span>
            <select
              value={categoryCode}
              onChange={(e) => {
                setCategoryCode(e.target.value);
                setGroupCode('');
                setCutoffState(null);
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">เลือกระดับอายุ</option>
              {categories.map((c) => (
                <option key={c.id} value={c.code}>{c.name} ({c.code})</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">รหัสกลุ่ม (เช่น A, B)</span>
            <div className="flex gap-2">
              <input
                type="text"
                value={groupCode}
                onChange={(e) => setGroupCode(e.target.value.toUpperCase())}
                placeholder="A"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={!categoryCode || !groupCode || busy}
                onClick={() => loadCutoffState(categoryCode, groupCode)}
                className="whitespace-nowrap rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
              >
                โหลด
              </button>
            </div>
          </label>
        </div>
      </section>

      {cutoffState && (
        <>
          <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold text-slate-900">กลุ่ม {cutoffState.group_code} — เส้นโควตาอันดับ {cutoffState.cutoff_position}</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${stateLabel(cutoffState.qualification_state).color}`}>
                {stateLabel(cutoffState.qualification_state).text}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{cutoffState.explanation}</p>

            {cutoffState.automatic_qualifiers.length > 0 && (
              <div className="mt-3 text-sm">
                <span className="font-semibold text-emerald-700">เข้ารอบอัตโนมัติ: </span>
                {cutoffState.automatic_qualifiers.map((t) => t.team_name).join(', ')}
              </div>
            )}

            {cutoffState.draw_candidates.length > 0 && (
              <div className="mt-3 rounded-lg bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-900">
                  ทีมที่ต้องจับฉลาก ({cutoffState.draw_candidates.length} ทีม แย่งชิง {cutoffState.available_slots} สิทธิ์):
                </p>
                <ul className="mt-2 space-y-1">
                  {cutoffState.draw_candidates.map((team) => (
                    <li key={team.team_id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`team-${team.team_id}`}
                        checked={selectedTeamIds.includes(team.team_id)}
                        onChange={() => toggleTeam(team.team_id)}
                        disabled={cutoffState.qualification_state !== 'pending_draw' && cutoffState.qualification_state !== 'stale_draw'}
                      />
                      <label htmlFor={`team-${team.team_id}`} className="text-sm text-slate-800">
                        {team.team_name} ({team.team_code})
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-amber-800">
                  เลือกทีมที่จับฉลากได้จริงที่หน้างานให้ครบ {cutoffState.available_slots} ทีม แล้วกดตรวจสอบตัวอย่าง
                </p>
              </div>
            )}

            <label className="mt-3 block">
              <span className="mb-1 block text-xs font-semibold text-slate-600">หมายเหตุ (ไม่บังคับ)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          </section>

          {(cutoffState.qualification_state === 'pending_draw' || cutoffState.qualification_state === 'stale_draw') &&
            (!preview || previewStale ? (
              <button
                type="button"
                onClick={runPreview}
                disabled={busy || selectedTeamIds.length !== cutoffState.available_slots}
                className="w-full rounded-lg bg-blue-600 px-5 py-3.5 text-base font-semibold text-white disabled:bg-slate-300"
              >
                {busy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบตัวอย่าง'}
              </button>
            ) : (
              <section className="rounded-xl border-2 border-blue-300 bg-blue-50 p-5">
                <h3 className="font-bold text-blue-900">ตรวจสอบตัวอย่างก่อนบันทึก</h3>
                <p className="mt-2 text-sm text-blue-900">
                  ทีมที่จะบันทึกว่าจับได้:{' '}
                  {preview.draw_candidates
                    .filter((t) => preview.selected_team_ids.includes(t.team_id))
                    .map((t) => t.team_name)
                    .join(', ')}
                </p>
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={confirmSave}
                    disabled={busy}
                    className="flex-1 rounded-lg bg-emerald-700 px-5 py-3.5 text-base font-semibold text-white disabled:bg-slate-300"
                  >
                    {busy ? 'กำลังบันทึก...' : 'ยืนยันและบันทึกผลจับฉลาก'}
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
            ))}

          {cutoffState.versions.length > 0 && (
            <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="font-bold text-slate-900">ประวัติการจับฉลาก</h2>
              <ul className="mt-2 space-y-2">
                {cutoffState.versions.map((v) => (
                  <li key={v.draw_id} className={`rounded-lg border p-3 text-sm ${v.is_active ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">เวอร์ชัน {v.version} {v.is_active ? '(ใช้งานอยู่)' : '(ถูกแทนที่)'}</span>
                      <span className="text-xs text-slate-500">{new Date(v.drawn_at).toLocaleString('th-TH')}</span>
                    </div>
                    {v.note && <p className="mt-1 text-xs text-slate-600">{v.note}</p>}
                    <p className="mt-1 text-xs text-slate-700">
                      เลือก: {v.candidates.filter((c) => c.is_selected).map((c) => c.team_name).join(', ') || '-'}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
