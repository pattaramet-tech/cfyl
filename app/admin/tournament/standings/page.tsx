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

interface StandingsRowDto {
  team_id: string;
  team_name: string;
  team_code: string;
  group_id: string;
  group_code: string;
  position: number;
  played: number;
  won: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  fair_play_score: number;
  qualification_status: 'qualified' | 'eliminated' | 'pending';
  tiebreak_explanation: string;
  tie_state: 'resolved' | 'pending_draw' | 'pending_manual_override';
  override_applied: boolean;
  override_reason: string | null;
}

interface StandingsGroupDto {
  group_id: string;
  group_code: string;
  is_complete: boolean;
  rows: StandingsRowDto[];
}

interface StandingsResponse {
  category_id: string;
  category_code: string;
  qualify_rank_per_group: number;
  best_third_placed_count: number;
  best_third_placed_method: 'ranked' | 'draw';
  groups: StandingsGroupDto[];
}

function getToken(): string | null {
  return typeof window === 'undefined' ? null : localStorage.getItem('admin_token');
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function qualificationBadge(status: StandingsRowDto['qualification_status']) {
  if (status === 'qualified') return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">ผ่านรอบ</span>;
  if (status === 'eliminated') return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">ตกรอบ</span>;
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">รอผล</span>;
}

function tieStateBadge(tieState: StandingsRowDto['tie_state']) {
  if (tieState === 'pending_draw') {
    return <span className="ml-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">รอจับฉลาก</span>;
  }
  if (tieState === 'pending_manual_override') {
    return <span className="ml-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800">รอ Admin ตัดสิน</span>;
  }
  return null;
}

export default function TournamentStandingsAdminPage() {
  const [tournaments, setTournaments] = useState<TournamentOption[]>([]);
  const [tournamentId, setTournamentId] = useState('');
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryCode, setCategoryCode] = useState('');

  const [standings, setStandings] = useState<StandingsResponse | null>(null);
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
    fetch(`/api/tournament/admin/categories?tournament_id=${tournamentId}`, { headers: authHeaders(), cache: 'no-store' })
      .then((response) => response.json())
      .then((payload) => setCategories((payload.data || []) as CategoryOption[]))
      .catch(() => setCategories([]));
  }, [tournamentId]);

  const onSelectTournament = (id: string) => {
    setTournamentId(id);
    setCategories([]);
    setCategoryCode('');
    setStandings(null);
  };

  const selectedTournament = tournaments.find((t) => t.id === tournamentId);

  const loadStandings = async (code: string) => {
    if (!selectedTournament || !code) return;
    setBusy(true);
    setError('');
    setStandings(null);

    try {
      const response = await fetch(
        `/api/tournament/admin/standings?tournament_slug=${selectedTournament.slug}&category_code=${code}`,
        { headers: authHeaders() }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'โหลดตารางคะแนนไม่สำเร็จ');
      setStandings(payload.data as StandingsResponse);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'โหลดตารางคะแนนไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const onSelectCategory = (code: string) => {
    setCategoryCode(code);
    void loadStandings(code);
  };

  if (loading) {
    return <div className="rounded-xl bg-white p-8 shadow-sm">กำลังโหลด Tournament V2...</div>;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">TOURNAMENT V2</span>
        </div>
        <h1 className="mt-3 text-3xl font-bold text-slate-900">ตารางคะแนน (Standings)</h1>
        <p className="mt-2 text-sm text-slate-500">
          แสดงผลจากผลการแข่งขันที่เผยแพร่อย่างเป็นทางการเท่านั้น (ไม่รวมผลบันทึกด่วน / ผลร่างที่ยังไม่เผยแพร่)
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-red-800">
          {error}
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
            <span className="mb-2 block text-sm font-semibold text-slate-700">Category</span>
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

      {busy && <div className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">กำลังโหลดตารางคะแนน...</div>}

      {standings && (
        <div className="space-y-6">
          {standings.groups.length === 0 && (
            <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-amber-900">
              Category นี้ยังไม่มีกลุ่ม (Group)
            </div>
          )}

          {standings.groups.map((group) => (
            <section key={group.group_id} className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">กลุ่ม {group.group_code}</h2>
                {!group.is_complete && (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                    ผลการแข่งขันยังไม่ครบ
                  </span>
                )}
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                      <th className="py-2 pr-3">อันดับ</th>
                      <th className="py-2 pr-3">ทีม</th>
                      <th className="py-2 pr-3 text-center">แข่ง</th>
                      <th className="py-2 pr-3 text-center">ชนะ</th>
                      <th className="py-2 pr-3 text-center">แพ้</th>
                      <th className="py-2 pr-3 text-center">ได้</th>
                      <th className="py-2 pr-3 text-center">เสีย</th>
                      <th className="py-2 pr-3 text-center">ผลต่าง</th>
                      <th className="py-2 pr-3 text-center">คะแนน</th>
                      <th className="py-2 pr-3 text-center">แฟร์เพลย์</th>
                      <th className="py-2 pr-3">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.team_id} className="border-b border-slate-100">
                        <td className="py-2 pr-3 font-semibold">{row.position}</td>
                        <td className="py-2 pr-3">
                          <div className="font-medium text-slate-900">{row.team_name}</div>
                          <div className="text-xs text-slate-400">{row.team_code}</div>
                          <div className="mt-0.5 text-xs text-slate-500" title={row.tiebreak_explanation}>
                            {row.tiebreak_explanation}
                            {tieStateBadge(row.tie_state)}
                            {row.override_applied && (
                              <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                                Admin ปรับอันดับ{row.override_reason ? `: ${row.override_reason}` : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-center">{row.played}</td>
                        <td className="py-2 pr-3 text-center">{row.won}</td>
                        <td className="py-2 pr-3 text-center">{row.lost}</td>
                        <td className="py-2 pr-3 text-center">{row.goals_for}</td>
                        <td className="py-2 pr-3 text-center">{row.goals_against}</td>
                        <td className="py-2 pr-3 text-center">{row.goal_difference}</td>
                        <td className="py-2 pr-3 text-center font-bold">{row.points}</td>
                        <td className="py-2 pr-3 text-center">{row.fair_play_score}</td>
                        <td className="py-2 pr-3">{qualificationBadge(row.qualification_status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
