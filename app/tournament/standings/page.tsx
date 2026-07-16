'use client';

import { useEffect, useState } from 'react';
import fallbackData from '@/data/tournament-meeting-fallback.json';

interface StandingsRowDto {
  team_id: string;
  team_name: string;
  team_code: string;
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
}

interface StandingsGroupDto {
  group_code: string;
  is_complete: boolean;
  rows: StandingsRowDto[];
}

interface StandingsResponse {
  category_code: string;
  groups: StandingsGroupDto[];
}

const CATEGORY_OPTIONS = fallbackData.categories.map((c) => ({ code: c.code, name: c.name }));

function qualificationBadge(status: StandingsRowDto['qualification_status']) {
  if (status === 'qualified') return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">ผ่านรอบ</span>;
  if (status === 'eliminated') return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">ตกรอบ</span>;
  return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">รอผล</span>;
}

export default function PublicTournamentStandingsPage() {
  const [categoryCode, setCategoryCode] = useState(CATEGORY_OPTIONS[0]?.code || '');
  const [standings, setStandings] = useState<StandingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notPublished, setNotPublished] = useState(false);

  useEffect(() => {
    if (!categoryCode) return;

    const loadStandings = async () => {
      setLoading(true);
      setError('');
      setNotPublished(false);
      setStandings(null);

      const params = new URLSearchParams({
        tournament_slug: fallbackData.tournament.slug,
        category_code: categoryCode,
      });

      try {
        const response = await fetch(`/api/tournament/public/standings?${params.toString()}`, { cache: 'no-store' });
        if (response.status === 404) {
          setNotPublished(true);
          return;
        }
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || `Failed to load standings: ${response.status}`);
        }
        const payload = await response.json();
        setStandings(payload.data as StandingsResponse);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'โหลดตารางคะแนนไม่สำเร็จ');
      } finally {
        setLoading(false);
      }
    };

    loadStandings();
  }, [categoryCode]);

  const hasAnyPublishedRows = standings?.groups.some((g) => g.rows.length > 0) ?? false;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">ตารางคะแนน CFYL Tournament</h1>
        <p className="mt-2 text-sm text-slate-500">
          แสดงผลจากผลการแข่งขันที่เผยแพร่อย่างเป็นทางการเท่านั้น
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {CATEGORY_OPTIONS.map((option) => (
          <button
            key={option.code}
            type="button"
            onClick={() => setCategoryCode(option.code)}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
              categoryCode === option.code
                ? 'bg-blue-700 text-white'
                : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {option.code}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border-l-4 border-red-500 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      {loading && <div className="rounded-xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm">กำลังโหลดตารางคะแนน...</div>}

      {!loading && (notPublished || !standings) && !error && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">
          ยังไม่มีตารางคะแนนสำหรับรุ่นนี้
        </div>
      )}

      {!loading && standings && !hasAnyPublishedRows && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">
          ยังไม่มีผลการแข่งขันที่เผยแพร่อย่างเป็นทางการสำหรับรุ่นนี้
        </div>
      )}

      {!loading && standings && hasAnyPublishedRows && (
        <div className="space-y-6">
          {standings.groups.map((group) => (
            <section key={group.group_code} className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900">กลุ่ม {group.group_code}</h2>
                {!group.is_complete && (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                    ผลการแข่งขันยังไม่ครบ
                  </span>
                )}
              </div>

              {group.rows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">ยังไม่มีผลการแข่งขันที่เผยแพร่สำหรับกลุ่มนี้</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse text-sm">
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
                            {row.tie_state === 'pending_draw' && (
                              <div className="text-xs font-semibold text-orange-700">รอผลจับฉลาก</div>
                            )}
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
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
