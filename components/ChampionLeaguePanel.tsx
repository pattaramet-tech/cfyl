'use client';

import { useEffect, useMemo, useState } from 'react';

interface ChampionLeagueStanding {
  rank: number;
  team_id: string;
  team_name: string;
  team_short_name?: string | null;
  league_rank: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
}

interface ChampionLeagueData {
  scope: {
    season_id: string;
    age_group_id: string;
    division_id: string;
  };
  active: boolean;
  standings: ChampionLeagueStanding[];
  progress: {
    expected_matches: number;
    fixture_matches: number;
    finished_unique_matches: number;
    duplicate_pairings: number;
    invalid_pairings: number;
    complete: boolean;
  };
  pairings: {
    final: { home_team_id: string; away_team_id: string };
    third_place: { home_team_id: string; away_team_id: string };
  } | null;
}

interface ChampionLeaguePanelProps {
  seasonId: string;
  ageGroupId: string;
  divisionId: string;
}

interface LoadState {
  scopeKey: string;
  data: ChampionLeagueData | null;
  error: boolean;
}

export function ChampionLeaguePanel({ seasonId, ageGroupId, divisionId }: ChampionLeaguePanelProps) {
  const scopeKey = `${seasonId}:${ageGroupId}:${divisionId}`;
  const [loadState, setLoadState] = useState<LoadState | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    const url = `/api/public/champion-league?seasonId=${encodeURIComponent(seasonId)}&ageGroupId=${encodeURIComponent(ageGroupId)}&divisionId=${encodeURIComponent(divisionId)}`;

    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Champion League request failed: ${res.status}`);
        return (await res.json()) as ChampionLeagueData;
      })
      .then((payload) => {
        if (!mounted) return;
        const matchesScope =
          payload.scope?.season_id === seasonId &&
          payload.scope?.age_group_id === ageGroupId &&
          payload.scope?.division_id === divisionId;
        if (!matchesScope) throw new Error('Champion League response scope mismatch');
        setLoadState({ scopeKey, data: payload, error: false });
      })
      .catch((error) => {
        if (!mounted || error instanceof DOMException && error.name === 'AbortError') return;
        console.error('[ChampionLeaguePanel] load failed:', error);
        setLoadState({ scopeKey, data: null, error: true });
      });

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [seasonId, ageGroupId, divisionId, scopeKey]);

  const currentState = loadState?.scopeKey === scopeKey ? loadState : null;
  const data = currentState?.data ?? null;
  const teamNameById = useMemo(
    () => new Map((data?.standings || []).map((row) => [row.team_id, row.team_name])),
    [data]
  );

  if (!currentState) {
    return (
      <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/40 p-4 text-sm text-slate-500">
        กำลังโหลดตารางแชมเปี้ยนส์ลีก...
      </div>
    );
  }

  if (currentState.error) {
    return (
      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        ไม่สามารถโหลดข้อมูลแชมเปี้ยนส์ลีกได้ กรุณาลองใหม่อีกครั้ง
      </div>
    );
  }

  if (!data || !data.active || data.standings.length !== 4) return null;

  const pairingName = (teamId: string) => teamNameById.get(teamId) || 'รอยืนยันทีม';
  const progressIssue = data.progress.duplicate_pairings > 0 || data.progress.invalid_pairings > 0;
  const progressionConfirmed = data.progress.complete && data.pairings !== null;

  return (
    <section className="mt-6 overflow-hidden rounded-xl border border-blue-200 bg-white">
      <div className="border-b border-blue-100 bg-blue-50 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-blue-950">🏆 แชมเปี้ยนส์ลีก</h3>
            <p className="mt-1 text-xs text-slate-600 sm:text-sm">
              4 อันดับแรกที่ล็อกจากรอบลีก แข่งพบกันหมดทีมละ 3 นัด · ชนะ 3 เสมอ 1 แพ้ 0
            </p>
            <p className="mt-1 text-xs font-medium text-blue-800">
              คะแนนเท่ากันใช้อันดับรอบลีกที่ล็อกไว้ตัดสินทันที
            </p>
          </div>
          <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-blue-800 shadow-sm">
            {data.progress.finished_unique_matches}/{data.progress.expected_matches} คู่
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 text-center">#</th>
              <th className="px-3 py-2 text-left">ทีม</th>
              <th className="px-2 py-2 text-center">ลีก</th>
              <th className="px-2 py-2 text-center">แข่ง</th>
              <th className="px-2 py-2 text-center">ชนะ</th>
              <th className="px-2 py-2 text-center">เสมอ</th>
              <th className="px-2 py-2 text-center">แพ้</th>
              <th className="px-2 py-2 text-center">ได้</th>
              <th className="px-2 py-2 text-center">เสีย</th>
              <th className="px-2 py-2 text-center">+/-</th>
              <th className="px-3 py-2 text-center font-bold text-blue-900">แต้ม</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.standings.map((row) => (
              <tr key={row.team_id} className={progressionConfirmed && row.rank <= 2 ? 'bg-blue-50/30' : ''}>
                <td className="px-3 py-3 text-center font-bold text-slate-700">{row.rank}</td>
                <td className="px-3 py-3 font-semibold text-slate-800">
                  {row.team_name}
                  {progressionConfirmed && row.rank <= 2 && (
                    <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
                      ชิงชนะเลิศ
                    </span>
                  )}
                </td>
                <td className="px-2 py-3 text-center text-slate-500">{row.league_rank}</td>
                <td className="px-2 py-3 text-center">{row.played}</td>
                <td className="px-2 py-3 text-center">{row.wins}</td>
                <td className="px-2 py-3 text-center">{row.draws}</td>
                <td className="px-2 py-3 text-center">{row.losses}</td>
                <td className="px-2 py-3 text-center">{row.goals_for}</td>
                <td className="px-2 py-3 text-center">{row.goals_against}</td>
                <td className="px-2 py-3 text-center">{row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}</td>
                <td className="px-3 py-3 text-center text-base font-extrabold text-blue-950">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {progressIssue && (
        <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
          ตรวจพบคู่แข่งขันซ้ำหรือทีมที่อยู่นอก Top 4 กรุณาตรวจข้อมูลก่อนยืนยันอันดับสุดท้าย
        </div>
      )}

      {progressionConfirmed && data.pairings && (
        <div className="grid gap-3 border-t border-blue-100 bg-slate-50 p-4 sm:grid-cols-2">
          <div className="rounded-lg border border-blue-200 bg-white p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-blue-700">รอบชิงชนะเลิศ</div>
            <div className="mt-2 font-bold text-slate-900">
              {pairingName(data.pairings.final.home_team_id)}
              <span className="mx-2 text-slate-400">vs</span>
              {pairingName(data.pairings.final.away_team_id)}
            </div>
            <div className="mt-1 text-xs text-slate-500">อันดับ 1 vs อันดับ 2 แชมเปี้ยนส์ลีก</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-600">ชิงอันดับที่ 3</div>
            <div className="mt-2 font-bold text-slate-900">
              {pairingName(data.pairings.third_place.home_team_id)}
              <span className="mx-2 text-slate-400">vs</span>
              {pairingName(data.pairings.third_place.away_team_id)}
            </div>
            <div className="mt-1 text-xs text-slate-500">อันดับ 3 vs อันดับ 4 แชมเปี้ยนส์ลีก</div>
          </div>
        </div>
      )}
    </section>
  );
}
