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

interface CandidateOption {
  team_id: string;
  team_code: string;
  team_name: string;
}

interface VersionCandidate {
  team_id: string;
  team_code: string;
  team_name: string;
  is_selected: boolean;
  draw_order: number | null;
}

interface DrawVersion {
  draw_id: string;
  version: number;
  is_active: boolean;
  drawn_by: string | null;
  drawn_at: string;
  note: string | null;
  is_manual_candidate_confirmation: boolean;
  candidates: VersionCandidate[];
}

interface DrawState {
  category_id: string;
  candidate_options: CandidateOption[];
  placeholder_source_refs: string[];
  versions: DrawVersion[];
}

interface AffectedMatch {
  match_id: string;
  match_code: string;
  side: 'home' | 'away';
  source_ref: string;
  resolved_team_code: string;
  resolved_team_name: string;
}

interface SaveSummary {
  draw_id: string;
  version: number;
  updated_match_ids: string[];
  selected_source_refs: string[];
}

function getToken(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem('admin_token');
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export default function QualificationDrawPage() {
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [tournamentId, setTournamentId] = useState('');
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryCode, setCategoryCode] = useState('');

  const [drawState, setDrawState] = useState<DrawState | null>(null);
  const [candidateIds, setCandidateIds] = useState<[string, string, string]>(['', '', '']);
  const [selections, setSelections] = useState<Record<string, string>>({});

  const [affectedMatches, setAffectedMatches] = useState<AffectedMatch[] | null>(null);
  const [saveSummary, setSaveSummary] = useState<SaveSummary | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) {
      window.location.href = '/admin/login';
      return;
    }

    fetch('/api/tournament/admin/tournaments', { headers: authHeaders(), cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 403) throw new Error('ไม่มีสิทธิ์ใช้งาน Tournament V2');
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || 'โหลด Tournament ไม่สำเร็จ');
        }
        return response.json();
      })
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

    fetch(`/api/tournament/admin/categories?tournament_id=${tournamentId}`, {
      headers: authHeaders(),
      cache: 'no-store',
    })
      .then((response) => response.json())
      .then((payload) => setCategories((payload.data || []) as CategoryOption[]))
      .catch(() => setCategories([]));
  }, [tournamentId]);

  const onSelectTournament = (id: string) => {
    setTournamentId(id);
    setCategories([]);
    setCategoryCode('');
    setDrawState(null);
  };

  const selectedTournament = tournaments.find((t) => t.id === tournamentId);

  const loadDrawState = async (code: string) => {
    if (!selectedTournament || !code) return;
    setBusy(true);
    setError('');
    setDrawState(null);
    setAffectedMatches(null);
    setSaveSummary(null);
    setCandidateIds(['', '', '']);
    setSelections({});

    try {
      const response = await fetch(
        `/api/tournament/admin/qualification-draws?tournament_slug=${selectedTournament.slug}&category_code=${code}`,
        { headers: authHeaders() }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'โหลดข้อมูลจับฉลากไม่สำเร็จ');
      setDrawState(payload.data as DrawState);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'โหลดข้อมูลจับฉลากไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const onSelectCategory = (code: string) => {
    setCategoryCode(code);
    void loadDrawState(code);
  };

  const candidatesValid =
    candidateIds.every((id) => id) && new Set(candidateIds).size === 3;

  const selectionEntries = drawState ? drawState.placeholder_source_refs.map((ref) => selections[ref] || '') : [];
  const selectionsValid =
    drawState !== null &&
    drawState.placeholder_source_refs.length > 0 &&
    selectionEntries.every((teamId) => teamId && candidateIds.includes(teamId)) &&
    new Set(selectionEntries).size === selectionEntries.length;

  const activeVersion = drawState?.versions.find((v) => v.is_active) || null;

  const runPreview = async () => {
    if (!selectedTournament || !candidatesValid || !selectionsValid || !drawState) return;
    setBusy(true);
    setError('');
    setAffectedMatches(null);
    setSaveSummary(null);

    try {
      const response = await fetch('/api/tournament/admin/qualification-draws', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          tournament_slug: selectedTournament.slug,
          category_code: categoryCode,
          candidate_team_ids: candidateIds,
          selections: drawState.placeholder_source_refs.map((ref) => ({
            source_ref: ref,
            team_id: selections[ref],
          })),
          preview: true,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Preview ไม่สำเร็จ');
      setAffectedMatches(payload.data.affected_matches as AffectedMatch[]);
      setShowConfirm(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Preview ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const confirmSave = async () => {
    if (!selectedTournament || !drawState) return;
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/tournament/admin/qualification-draws', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          tournament_slug: selectedTournament.slug,
          category_code: categoryCode,
          candidate_team_ids: candidateIds,
          selections: drawState.placeholder_source_refs.map((ref) => ({
            source_ref: ref,
            team_id: selections[ref],
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'บันทึกผลจับฉลากไม่สำเร็จ');
      setSaveSummary(payload.data as SaveSummary);
      setShowConfirm(false);
      setAffectedMatches(null);
      await loadDrawState(categoryCode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'บันทึกผลจับฉลากไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="rounded-xl bg-white p-8 shadow-sm">กำลังโหลด Tournament V2...</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">TOURNAMENT V2</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
            บันทึกผลจับฉลากจากหน้างาน
          </span>
        </div>
        <h1 className="mt-3 text-3xl font-bold text-slate-900">บันทึกผลจับฉลากรอบคัดเลือกทีมอันดับ 3</h1>
        <div className="mt-3 rounded-lg border-l-4 border-blue-500 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-900">
          ระบบนี้ใช้สำหรับบันทึกผลจับฉลากที่ดำเนินการหน้างานเท่านั้น
          <br />
          ระบบจะไม่สุ่มหรือจับฉลากทีมให้อัตโนมัติ
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      {saveSummary && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-900">
          <h2 className="font-bold">บันทึกผลจับฉลากเรียบร้อย</h2>
          <p className="mt-1 text-sm">
            เวอร์ชัน {saveSummary.version} · อัปเดต {saveSummary.updated_match_ids.length} Match ·{' '}
            {saveSummary.selected_source_refs.join(', ')}
          </p>
        </div>
      )}

      <section className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Tournament</span>
            <select
              value={tournamentId}
              onChange={(event) => onSelectTournament(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {tournaments.length === 0 && <option value="">ยังไม่มี Tournament V2</option>}
              {tournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>
                  {tournament.name} ({tournament.status})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Category (เช่น G-U16)</span>
            <select
              value={categoryCode}
              onChange={(event) => onSelectCategory(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">เลือก Category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.code}>
                  {category.code} — {category.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {drawState && drawState.placeholder_source_refs.length === 0 && (
        <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-amber-900">
          Category นี้ไม่ได้ตั้งค่ากติกาคัดเลือกแบบจับฉลาก (draw method) จึงไม่มี Placeholder ให้บันทึกผล
        </div>
      )}

      {drawState && drawState.placeholder_source_refs.length > 0 && (
        <>
          {activeVersion && (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="font-bold text-slate-900">ผลจับฉลากปัจจุบัน (เวอร์ชัน {activeVersion.version})</h2>
              <p className="text-xs text-slate-500">
                บันทึกเมื่อ {new Date(activeVersion.drawn_at).toLocaleString('th-TH')}
                {activeVersion.is_manual_candidate_confirmation && ' · ยืนยันผู้เข้ารอบด้วยตนเองโดย Admin'}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-slate-700">
                {activeVersion.candidates.map((candidate) => (
                  <li key={candidate.team_id}>
                    {candidate.team_name} ({candidate.team_code}){' '}
                    {candidate.is_selected ? (
                      <span className="font-semibold text-emerald-700">
                        — เลือกเป็นลำดับ {candidate.draw_order}
                      </span>
                    ) : (
                      <span className="text-slate-400">— ผู้เข้ารอบ (ไม่ถูกเลือก)</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {drawState.versions.length > 1 && (
            <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <summary className="cursor-pointer font-bold text-slate-900">
                ประวัติการบันทึก ({drawState.versions.length} เวอร์ชัน)
              </summary>
              <ul className="mt-3 space-y-3 text-sm">
                {drawState.versions.map((version) => (
                  <li key={version.draw_id} className="border-t border-slate-100 pt-2">
                    <div className="font-semibold">
                      เวอร์ชัน {version.version} {version.is_active ? '(ปัจจุบัน)' : '(ถูกแทนที่แล้ว)'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(version.drawn_at).toLocaleString('th-TH')}
                    </div>
                    <div className="mt-1 text-slate-600">
                      {version.candidates
                        .map((c) => `${c.team_name}${c.is_selected ? ` (เลือก ${c.draw_order})` : ''}`)
                        .join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <section className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="font-bold text-slate-900">ขั้นที่ 1 — ยืนยันทีมผู้มีสิทธิ์เข้ารอบ (3 ทีม)</h2>
            <p className="mt-1 text-sm text-slate-500">
              เลือก 3 ทีมอันดับ 3 ที่มีสิทธิ์เข้ารอบตามผลการแข่งขันจริงหน้างาน (Admin ยืนยันด้วยตนเอง
              ระบบยังไม่คำนวณอันดับกลุ่มอัตโนมัติ)
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {[0, 1, 2].map((index) => (
                <label key={index} className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">ผู้เข้ารอบคนที่ {index + 1}</span>
                  <select
                    value={candidateIds[index]}
                    onChange={(event) => {
                      const next = [...candidateIds] as [string, string, string];
                      next[index] = event.target.value;
                      setCandidateIds(next);
                      setAffectedMatches(null);
                      setShowConfirm(false);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">เลือกทีม</option>
                    {drawState.candidate_options.map((option) => (
                      <option key={option.team_id} value={option.team_id}>
                        {option.team_name} ({option.team_code})
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {!candidatesValid && candidateIds.some((id) => id) && (
              <p className="mt-2 text-xs text-red-600">ต้องเลือก 3 ทีมที่ไม่ซ้ำกัน</p>
            )}
          </section>

          {candidatesValid && (
            <section className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <h2 className="font-bold text-slate-900">ขั้นที่ 2 — บันทึกผลจับฉลาก (เลือก 2 จาก 3 ทีม)</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {drawState.placeholder_source_refs.map((ref) => (
                  <label key={ref} className="block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">{ref}</span>
                    <select
                      value={selections[ref] || ''}
                      onChange={(event) => {
                        setSelections((prev) => ({ ...prev, [ref]: event.target.value }));
                        setAffectedMatches(null);
                        setShowConfirm(false);
                      }}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="">เลือกทีม</option>
                      {candidateIds
                        .filter((id) => id)
                        .map((id) => {
                          const option = drawState.candidate_options.find((c) => c.team_id === id);
                          return (
                            <option key={id} value={id}>
                              {option?.team_name} ({option?.team_code})
                            </option>
                          );
                        })}
                    </select>
                  </label>
                ))}
              </div>
              {selectionEntries.length === 2 && new Set(selectionEntries).size !== selectionEntries.length && (
                <p className="mt-2 text-xs text-red-600">ห้ามเลือกทีมเดียวกันซ้ำในสอง Placeholder</p>
              )}

              {activeVersion && (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                  มีการบันทึกผลจับฉลากไว้แล้ว การยืนยันครั้งนี้จะสร้างเวอร์ชันใหม่และแทนที่ผลเดิม
                </p>
              )}

              <button
                type="button"
                onClick={runPreview}
                disabled={busy || !candidatesValid || !selectionsValid}
                className="mt-4 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {busy ? 'กำลังตรวจสอบ...' : 'ตรวจสอบก่อนบันทึก (Preview)'}
              </button>
            </section>
          )}

          {showConfirm && affectedMatches && (
            <section className="rounded-xl border-2 border-blue-300 bg-blue-50 p-6">
              <h2 className="font-bold text-blue-900">Preview — Match ที่จะถูก Resolve</h2>
              {affectedMatches.length === 0 ? (
                <p className="mt-2 text-sm text-blue-800">ยังไม่มี Match ใดอ้างอิง Placeholder เหล่านี้</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-blue-900">
                  {affectedMatches.map((match) => (
                    <li key={`${match.match_id}-${match.side}`}>
                      {match.match_code}: ฝั่ง {match.side === 'home' ? 'เหย้า' : 'เยือน'} ({match.source_ref}) →{' '}
                      <span className="font-semibold">
                        {match.resolved_team_name} ({match.resolved_team_code})
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={confirmSave}
                  disabled={busy}
                  className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {busy ? 'กำลังบันทึก...' : 'ยืนยันบันทึกผลจับฉลาก'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowConfirm(false)}
                  disabled={busy}
                  className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  ยกเลิก
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
