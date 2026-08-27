'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Qualifier {
  team_id: string;
  league_rank: number;
  team_name: string;
  team_short_name?: string | null;
}

interface FixtureMatch {
  id: string;
  match_code: string;
  match_no?: number | null;
  match_date: string;
  match_time?: string | null;
  venue?: string | null;
  status: string;
  league_phase: string;
  home_team_id: string;
  away_team_id: string;
}

interface PreviewPairing {
  slot: number;
  round_no: number;
  matchday: string;
  match_code: string;
  home_team_id: string;
  away_team_id: string;
  home_team: Qualifier | null;
  away_team: Qualifier | null;
  existing_match: FixtureMatch | null;
}

interface FixtureState {
  scope: {
    season_id: string;
    age_group_id: string;
    division_id: string;
  };
  active: boolean;
  reason?: string;
  qualifiers: Qualifier[];
  round_robin: {
    preview: PreviewPairing[];
    structure: {
      expected_matches: number;
      fixture_matches: number;
      unique_pairings: number;
      duplicate_pairings: number;
      invalid_pairings: number;
      missing_pairings: number;
      complete: boolean;
    } | null;
    can_generate: boolean;
    already_generated: boolean;
  };
  progress?: {
    complete: boolean;
    finished_unique_matches: number;
  };
  placement: {
    can_generate: boolean;
    pairings: {
      final: { home_team_id: string; away_team_id: string };
      third_place: { home_team_id: string; away_team_id: string };
    } | null;
    final_match: FixtureMatch | null;
    third_place_match: FixtureMatch | null;
  };
}

interface ScheduleDraft {
  match_no: string;
  match_date: string;
  match_time: string;
  venue: string;
}

const emptySchedule = (): ScheduleDraft => ({
  match_no: '',
  match_date: '',
  match_time: '',
  venue: '',
});

function scheduleFromMatch(match: FixtureMatch | null | undefined): ScheduleDraft {
  if (!match) return emptySchedule();
  return {
    match_no: match.match_no == null ? '' : String(match.match_no),
    match_date: match.match_date || '',
    match_time: match.match_time ? match.match_time.slice(0, 5) : '',
    venue: match.venue || '',
  };
}

function payloadSchedule(draft: ScheduleDraft, slot?: number) {
  return {
    ...(slot ? { slot } : {}),
    match_no: draft.match_no.trim() === '' ? null : Number(draft.match_no),
    match_date: draft.match_date,
    match_time: draft.match_time || null,
    venue: draft.venue.trim() || null,
  };
}

interface ChampionLeagueFixtureManagerProps {
  seasonId: string;
  ageGroupId: string;
  divisionId: string;
  onChanged?: () => void | Promise<void>;
}

export function getChampionLeagueFixtureScopeKey(
  seasonId: string,
  ageGroupId: string,
  divisionId: string
): string {
  return `${seasonId}::${ageGroupId}::${divisionId}`;
}

export function isChampionLeagueFixturePayloadForScope(
  payload: Pick<FixtureState, 'scope'> | null | undefined,
  scopeKey: string
): boolean {
  if (!payload?.scope) return false;
  return getChampionLeagueFixtureScopeKey(
    payload.scope.season_id || '',
    payload.scope.age_group_id || '',
    payload.scope.division_id || ''
  ) === scopeKey;
}

export function ChampionLeagueFixtureManager(props: ChampionLeagueFixtureManagerProps) {
  const scopeKey = getChampionLeagueFixtureScopeKey(
    props.seasonId,
    props.ageGroupId,
    props.divisionId
  );
  return <ChampionLeagueFixtureManagerScope key={scopeKey} {...props} scopeKey={scopeKey} />;
}

function ChampionLeagueFixtureManagerScope({
  seasonId,
  ageGroupId,
  divisionId,
  onChanged,
  scopeKey,
}: ChampionLeagueFixtureManagerProps & { scopeKey: string }) {
  const [scopedData, setScopedData] = useState<{ scopeKey: string; data: FixtureState } | null>(null);
  const data = scopedData?.scopeKey === scopeKey ? scopedData.data : null;
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [roundSchedules, setRoundSchedules] = useState<Record<number, ScheduleDraft>>({});
  const [finalSchedule, setFinalSchedule] = useState<ScheduleDraft>(emptySchedule());
  const [thirdSchedule, setThirdSchedule] = useState<ScheduleDraft>(emptySchedule());
  const requestSeq = useRef(0);
  const mountedRef = useRef(true);
  const lifecycleEpochRef = useRef(0);

  const scopeReady = Boolean(seasonId && ageGroupId && divisionId);
  const isLifecycleCurrent = useCallback(
    (epoch: number) => mountedRef.current && lifecycleEpochRef.current === epoch,
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      lifecycleEpochRef.current += 1;
      requestSeq.current += 1;
    };
  }, []);

  const syncDrafts = useCallback((next: FixtureState) => {
    const round: Record<number, ScheduleDraft> = {};
    for (const pairing of next.round_robin.preview || []) {
      round[pairing.slot] = scheduleFromMatch(pairing.existing_match);
    }
    setRoundSchedules(round);
    setFinalSchedule(scheduleFromMatch(next.placement.final_match));
    setThirdSchedule(scheduleFromMatch(next.placement.third_place_match));
  }, []);

  const load = useCallback(async () => {
    const epoch = lifecycleEpochRef.current;
    if (!isLifecycleCurrent(epoch)) return;
    const seq = ++requestSeq.current;
    if (!scopeReady) {
      setScopedData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('admin_token');
      const url = `/api/admin/champion-league/fixtures?seasonId=${encodeURIComponent(seasonId)}&ageGroupId=${encodeURIComponent(ageGroupId)}&divisionId=${encodeURIComponent(divisionId)}`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!isLifecycleCurrent(epoch) || seq !== requestSeq.current) return;
      const payload = await res.json().catch(() => ({}));
      if (!isLifecycleCurrent(epoch) || seq !== requestSeq.current) return;
      if (!res.ok && res.status !== 409) {
        throw new Error(payload.error || 'ไม่สามารถโหลดสถานะตาราง Champion League ได้');
      }
      if (!isLifecycleCurrent(epoch) || seq !== requestSeq.current) return;
      const typed = payload as FixtureState;
      if (!isChampionLeagueFixturePayloadForScope(typed, scopeKey)) {
        throw new Error('Champion League fixture response scope mismatch');
      }
      setScopedData({ scopeKey, data: typed });
      syncDrafts(typed);
    } catch (err) {
      if (!isLifecycleCurrent(epoch) || seq !== requestSeq.current) return;
      setScopedData(null);
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดสถานะ Champion League ได้');
    } finally {
      if (isLifecycleCurrent(epoch) && seq === requestSeq.current) {
        setLoading(false);
      }
    }
  }, [ageGroupId, divisionId, isLifecycleCurrent, scopeKey, scopeReady, seasonId, syncDrafts]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestSeq.current += 1;
    };
  }, [load]);

  const qualifierMap = useMemo(
    () => new Map((data?.qualifiers || []).map((row) => [row.team_id, row])),
    [data?.qualifiers]
  );

  const updateRoundSchedule = (slot: number, field: keyof ScheduleDraft, value: string) => {
    setRoundSchedules((prev) => ({
      ...prev,
      [slot]: { ...(prev[slot] || emptySchedule()), [field]: value },
    }));
  };

  const notifyChanged = async (epoch: number) => {
    if (!isLifecycleCurrent(epoch)) return;
    await load();
    if (!isLifecycleCurrent(epoch)) return;
    if (onChanged) {
      await onChanged();
      if (!isLifecycleCurrent(epoch)) return;
    }
  };

  const activate = async () => {
    const epoch = lifecycleEpochRef.current;
    if (!scopeReady || !isLifecycleCurrent(epoch)) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/champion-league/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          season_id: seasonId,
          age_group_id: ageGroupId,
          division_id: divisionId,
        }),
      });
      if (!isLifecycleCurrent(epoch)) return;
      const payload = await res.json().catch(() => ({}));
      if (!isLifecycleCurrent(epoch)) return;
      if (!res.ok) {
        const readiness = payload.readiness;
        const detail = readiness
          ? ` (ค้าง ${readiness.unfinished_match_count || 0} นัด, ทีมไม่มีนัด ${readiness.teams_without_regular_match?.length || 0})`
          : '';
        throw new Error((payload.error || 'ไม่สามารถเปิด Champion League ได้') + detail);
      }
      if (!isLifecycleCurrent(epoch)) return;
      setSuccess(payload.already_active ? 'Champion League ถูกเปิดไว้แล้ว' : 'ล็อก Top 4 และเปิด Champion League แล้ว');
      await notifyChanged(epoch);
      if (!isLifecycleCurrent(epoch)) return;
    } catch (err) {
      if (!isLifecycleCurrent(epoch)) return;
      setError(err instanceof Error ? err.message : 'ไม่สามารถเปิด Champion League ได้');
    } finally {
      if (isLifecycleCurrent(epoch)) setBusy(false);
    }
  };

  const generateRoundRobin = async () => {
    const epoch = lifecycleEpochRef.current;
    if (!data?.active || !isLifecycleCurrent(epoch)) return;
    const schedules = data.round_robin.preview.map((pairing) => ({
      slot: pairing.slot,
      ...payloadSchedule(roundSchedules[pairing.slot] || emptySchedule()),
    }));
    if (schedules.some((row) => !row.match_date)) {
      setError('กรุณากำหนดวันที่แข่งขันให้ครบทั้ง 6 คู่ก่อนสร้างตาราง');
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/champion-league/fixtures', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'generate_round_robin',
          season_id: seasonId,
          age_group_id: ageGroupId,
          division_id: divisionId,
          schedules,
        }),
      });
      if (!isLifecycleCurrent(epoch)) return;
      const payload = await res.json().catch(() => ({}));
      if (!isLifecycleCurrent(epoch)) return;
      if (!res.ok) throw new Error(payload.error || 'สร้าง 6 คู่ Champion League ไม่สำเร็จ');
      setSuccess(payload.idempotent ? 'ตาราง Champion League 6 คู่มีอยู่ครบแล้ว' : 'สร้างตาราง Champion League 6 คู่เรียบร้อย');
      await notifyChanged(epoch);
      if (!isLifecycleCurrent(epoch)) return;
    } catch (err) {
      if (!isLifecycleCurrent(epoch)) return;
      setError(err instanceof Error ? err.message : 'สร้างตาราง Champion League ไม่สำเร็จ');
    } finally {
      if (isLifecycleCurrent(epoch)) setBusy(false);
    }
  };

  const generatePlacements = async () => {
    const epoch = lifecycleEpochRef.current;
    if (!data?.placement.pairings || !isLifecycleCurrent(epoch)) return;
    if (!finalSchedule.match_date || !thirdSchedule.match_date) {
      setError('กรุณากำหนดวันที่สำหรับ Final และชิงอันดับที่ 3');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/champion-league/fixtures', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'generate_placements',
          season_id: seasonId,
          age_group_id: ageGroupId,
          division_id: divisionId,
          schedules: {
            final: payloadSchedule(finalSchedule),
            third_place: payloadSchedule(thirdSchedule),
          },
        }),
      });
      if (!isLifecycleCurrent(epoch)) return;
      const payload = await res.json().catch(() => ({}));
      if (!isLifecycleCurrent(epoch)) return;
      if (!res.ok) throw new Error(payload.error || 'สร้าง Final / ชิงอันดับที่ 3 ไม่สำเร็จ');
      setSuccess(payload.idempotent ? 'Final / ชิงอันดับที่ 3 มีอยู่แล้ว' : 'สร้าง Final และชิงอันดับที่ 3 เรียบร้อย');
      await notifyChanged(epoch);
      if (!isLifecycleCurrent(epoch)) return;
    } catch (err) {
      if (!isLifecycleCurrent(epoch)) return;
      setError(err instanceof Error ? err.message : 'สร้าง Final / ชิงอันดับที่ 3 ไม่สำเร็จ');
    } finally {
      if (isLifecycleCurrent(epoch)) setBusy(false);
    }
  };

  const saveExistingSchedule = async (match: FixtureMatch, draft: ScheduleDraft) => {
    const epoch = lifecycleEpochRef.current;
    if (!isLifecycleCurrent(epoch)) return;
    if (!draft.match_date) {
      setError('วันที่แข่งขันจำเป็นต้องระบุ');
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/champion-league/fixtures', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ match_id: match.id, schedule: payloadSchedule(draft) }),
      });
      if (!isLifecycleCurrent(epoch)) return;
      const payload = await res.json().catch(() => ({}));
      if (!isLifecycleCurrent(epoch)) return;
      if (!res.ok) throw new Error(payload.error || 'บันทึกตารางเวลาไม่สำเร็จ');
      setSuccess(`บันทึกตารางเวลา ${match.match_code} แล้ว`);
      await notifyChanged(epoch);
      if (!isLifecycleCurrent(epoch)) return;
    } catch (err) {
      if (!isLifecycleCurrent(epoch)) return;
      setError(err instanceof Error ? err.message : 'บันทึกตารางเวลาไม่สำเร็จ');
    } finally {
      if (isLifecycleCurrent(epoch)) setBusy(false);
    }
  };

  const swapHomeAway = async (match: FixtureMatch) => {
    const epoch = lifecycleEpochRef.current;
    if (!isLifecycleCurrent(epoch)) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('/api/admin/champion-league/fixtures', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ match_id: match.id, swap_home_away: true }),
      });
      if (!isLifecycleCurrent(epoch)) return;
      const payload = await res.json().catch(() => ({}));
      if (!isLifecycleCurrent(epoch)) return;
      if (!res.ok) throw new Error(payload.error || 'สลับทีมเหย้า–เยือนไม่สำเร็จ');
      setSuccess(`สลับทีมเหย้า–เยือน ${match.match_code} แล้ว`);
      await notifyChanged(epoch);
      if (!isLifecycleCurrent(epoch)) return;
    } catch (err) {
      if (!isLifecycleCurrent(epoch)) return;
      setError(err instanceof Error ? err.message : 'สลับทีมเหย้า–เยือนไม่สำเร็จ');
    } finally {
      if (isLifecycleCurrent(epoch)) setBusy(false);
    }
  };

  if (!scopeReady) return null;

  const scheduleFields = (
    draft: ScheduleDraft,
    onChange: (field: keyof ScheduleDraft, value: string) => void,
    disabled: boolean
  ) => (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <input
        type="number"
        min="1"
        value={draft.match_no}
        onChange={(event) => onChange('match_no', event.target.value)}
        placeholder="Match No"
        disabled={disabled}
        className="rounded border border-gray-300 px-2 py-2 text-sm disabled:bg-gray-100"
      />
      <input
        type="date"
        value={draft.match_date}
        onChange={(event) => onChange('match_date', event.target.value)}
        disabled={disabled}
        className="rounded border border-gray-300 px-2 py-2 text-sm disabled:bg-gray-100"
      />
      <input
        type="time"
        value={draft.match_time}
        onChange={(event) => onChange('match_time', event.target.value)}
        disabled={disabled}
        className="rounded border border-gray-300 px-2 py-2 text-sm disabled:bg-gray-100"
      />
      <input
        type="text"
        value={draft.venue}
        onChange={(event) => onChange('venue', event.target.value)}
        placeholder="สนาม"
        disabled={disabled}
        className="rounded border border-gray-300 px-2 py-2 text-sm disabled:bg-gray-100"
      />
    </div>
  );

  const teamName = (teamId: string) => qualifierMap.get(teamId)?.team_name || teamId;
  const finalDisplayPair = data?.placement.pairings
    ? {
        home_team_id:
          data.placement.final_match?.home_team_id || data.placement.pairings.final.home_team_id,
        away_team_id:
          data.placement.final_match?.away_team_id || data.placement.pairings.final.away_team_id,
      }
    : null;
  const thirdPlaceDisplayPair = data?.placement.pairings
    ? {
        home_team_id:
          data.placement.third_place_match?.home_team_id ||
          data.placement.pairings.third_place.home_team_id,
        away_team_id:
          data.placement.third_place_match?.away_team_id ||
          data.placement.pairings.third_place.away_team_id,
      }
    : null;

  return (
    <div id="champion-league-fixture-manager" className="rounded-lg bg-white p-4 shadow sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">🏆 Champion League Fixture Generator</h2>
          <p className="mt-1 text-xs text-gray-500">
            ระบบกำหนดคู่ทีมจาก Top 4 ที่ล็อกไว้ แอดมินกำหนด Match No / วัน / เวลา / สนาม และสลับตำแหน่งเหย้า–เยือนได้ก่อนแข่งจบ
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || busy}
          className="rounded border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 disabled:opacity-50"
        >
          {loading ? 'กำลังโหลด...' : 'รีเฟรช'}
        </button>
      </div>

      {error && <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">❌ {error}</div>}
      {success && <div className="mt-4 rounded border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">✓ {success}</div>}

      {!loading && data && !data.active && (
        <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-800">{data.reason || 'Champion League ยังไม่เปิด'}</p>
          <button
            type="button"
            onClick={() => void activate()}
            disabled={busy}
            className="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'กำลังตรวจ...' : 'ล็อก Top 4 / เปิด Champion League'}
          </button>
        </div>
      )}

      {!loading && data?.active && (
        <div className="mt-5 space-y-6">
          <div className="rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-600">Top 4 ที่ล็อกไว้</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {data.qualifiers.map((row) => (
                <span key={row.team_id} className="rounded-full bg-white px-3 py-1 text-xs text-slate-700 shadow-sm">
                  {row.league_rank}. {row.team_name}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-gray-800">6 คู่ Champion League</h3>
              {data.round_robin.structure && (
                <span className="text-xs text-gray-500">
                  โครงสร้าง {data.round_robin.structure.unique_pairings}/6 คู่ · ผลจบ {data.progress?.finished_unique_matches || 0}/6
                </span>
              )}
            </div>

            {data.round_robin.structure && !data.round_robin.structure.complete && data.round_robin.structure.fixture_matches > 0 && (
              <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                พบ fixture เดิมที่ยังไม่เป็นโครงสร้าง 6 คู่ที่สมบูรณ์ ระบบจะไม่ generate ทับ กรุณาตรวจข้อมูลเดิมก่อน
              </div>
            )}

            <div className="mt-3 space-y-3">
              {data.round_robin.preview.map((pairing) => {
                const existing = pairing.existing_match;
                const draft = roundSchedules[pairing.slot] || emptySchedule();
                const displayHomeId = existing?.home_team_id || pairing.home_team_id;
                const displayAwayId = existing?.away_team_id || pairing.away_team_id;
                const displayHomeName = qualifierMap.get(displayHomeId)?.team_name || displayHomeId;
                const displayAwayName = qualifierMap.get(displayAwayId)?.team_name || displayAwayId;
                return (
                  <div key={pairing.slot} className="rounded border border-gray-200 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-semibold text-gray-800">
                        รอบ {pairing.round_no} · คู่ {pairing.slot}: {displayHomeName} vs {displayAwayName}
                      </span>
                      <span className="font-mono text-[11px] text-gray-400">{pairing.match_code}</span>
                    </div>
                    {scheduleFields(
                      draft,
                      (field, value) => updateRoundSchedule(pairing.slot, field, value),
                      busy || existing?.status === 'finished'
                    )}
                    {existing && (
                      <div className="mt-2 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void swapHomeAway(existing)}
                          disabled={busy || existing.status === 'finished'}
                          className="rounded border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 disabled:opacity-40"
                        >
                          ⇄ สลับเหย้า–เยือน
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveExistingSchedule(existing, draft)}
                          disabled={busy || existing.status === 'finished'}
                          className="rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                        >
                          บันทึกตารางเวลาคู่นี้
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {data.round_robin.can_generate && (
              <button
                type="button"
                onClick={() => void generateRoundRobin()}
                disabled={busy}
                className="mt-4 w-full rounded bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'กำลังสร้าง...' : 'สร้าง Champion League 6 คู่'}
              </button>
            )}
            {data.round_robin.already_generated && (
              <div className="mt-3 rounded border border-green-200 bg-green-50 p-3 text-xs font-semibold text-green-700">
                ✓ โครงสร้าง Champion League ครบ 6 unique pairings แล้ว ทีมของแต่ละคู่ถูกล็อก
              </div>
            )}
          </div>

          {data.progress?.complete && data.placement.pairings && (
            <div className="border-t border-gray-200 pt-5">
              <h3 className="font-semibold text-gray-800">Final / ชิงอันดับที่ 3</h3>
              <p className="mt-1 text-xs text-gray-500">เปิดเมื่อ Champion League จบครบ 6 คู่เท่านั้น</p>

              <div className="mt-3 space-y-3">
                <div className="rounded border border-yellow-200 bg-yellow-50 p-3">
                  <p className="mb-2 text-sm font-semibold text-yellow-900">
                    Final: {finalDisplayPair ? teamName(finalDisplayPair.home_team_id) : ''} vs {finalDisplayPair ? teamName(finalDisplayPair.away_team_id) : ''}
                  </p>
                  {scheduleFields(finalSchedule, (field, value) => setFinalSchedule((prev) => ({ ...prev, [field]: value })), busy || data.placement.final_match?.status === 'finished')}
                  {data.placement.final_match && (
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void swapHomeAway(data.placement.final_match!)}
                        disabled={busy || data.placement.final_match.status === 'finished'}
                        className="rounded border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 disabled:opacity-40"
                      >
                        ⇄ สลับเหย้า–เยือน
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveExistingSchedule(data.placement.final_match!, finalSchedule)}
                        disabled={busy || data.placement.final_match.status === 'finished'}
                        className="rounded bg-yellow-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        บันทึกตาราง Final
                      </button>
                    </div>
                  )}
                </div>

                <div className="rounded border border-orange-200 bg-orange-50 p-3">
                  <p className="mb-2 text-sm font-semibold text-orange-900">
                    ชิงอันดับที่ 3: {thirdPlaceDisplayPair ? teamName(thirdPlaceDisplayPair.home_team_id) : ''} vs {thirdPlaceDisplayPair ? teamName(thirdPlaceDisplayPair.away_team_id) : ''}
                  </p>
                  {scheduleFields(thirdSchedule, (field, value) => setThirdSchedule((prev) => ({ ...prev, [field]: value })), busy || data.placement.third_place_match?.status === 'finished')}
                  {data.placement.third_place_match && (
                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void swapHomeAway(data.placement.third_place_match!)}
                        disabled={busy || data.placement.third_place_match.status === 'finished'}
                        className="rounded border border-blue-300 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 disabled:opacity-40"
                      >
                        ⇄ สลับเหย้า–เยือน
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveExistingSchedule(data.placement.third_place_match!, thirdSchedule)}
                        disabled={busy || data.placement.third_place_match.status === 'finished'}
                        className="rounded bg-orange-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        บันทึกตารางชิงอันดับที่ 3
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {(!data.placement.final_match || !data.placement.third_place_match) && data.placement.can_generate && (
                <button
                  type="button"
                  onClick={() => void generatePlacements()}
                  disabled={busy}
                  className="mt-4 w-full rounded bg-amber-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy ? 'กำลังสร้าง...' : 'สร้าง Final + ชิงอันดับที่ 3'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
