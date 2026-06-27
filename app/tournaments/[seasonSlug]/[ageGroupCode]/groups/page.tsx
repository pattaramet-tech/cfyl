'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TournamentSubNav } from '@/components/TournamentSubNav';

interface Row {
  rank: number; teamId: string; name: string; shortName: string | null;
  played: number; wins: number; draws: number; losses: number; goalDiff: number; points: number;
}
interface Group { id: string; name: string; teams: Row[] }

export default function TournamentGroupsPage() {
  const params = useParams();
  const slug = String(params.seasonSlug ?? '');
  const age = String(params.ageGroupCode ?? '');
  const [groups, setGroups] = useState<Group[]>([]);
  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');

  useEffect(() => {
    setState('loading');
    fetch(`/api/public/tournaments/${slug}/${age}/groups`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setGroups(d.groups || []); setState('ok'); } else setState('notfound'); })
      .catch(() => setState('notfound'));
  }, [slug, age]);

  return (
    <div className="space-y-6">
      <TournamentSubNav seasonSlug={slug} ageCode={age} active="groups" />
      {state === 'loading' ? (
        <div className="cfyl-loading"><span className="cfyl-spinner w-5 h-5" />กำลังโหลดข้อมูล...</div>
      ) : state === 'notfound' ? (
        <div className="cfyl-section text-center space-y-3">
          <p className="text-slate-600">ไม่พบรายการ</p>
          <Link href="/tournaments" className="cfyl-btn-secondary">กลับหน้าทัวร์นาเมนต์</Link>
        </div>
      ) : groups.length === 0 ? (
        <div className="cfyl-empty">ยังไม่มีกลุ่ม</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {groups.map((g) => (
            <div key={g.id} className="cfyl-section">
              <h2 className="cfyl-section-title mb-3">{g.name}</h2>
              <div className="overflow-x-auto">
                <table className="cfyl-table">
                  <thead>
                    <tr>
                      <th className="text-center">#</th><th className="text-left">ทีม</th>
                      <th className="text-center">แข่ง</th><th className="text-center">ช</th>
                      <th className="text-center">ส</th><th className="text-center">พ</th>
                      <th className="text-center">+/-</th><th className="text-center">คะแนน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.teams.map((t) => (
                      <tr key={t.teamId} className={t.rank <= 2 ? 'bg-blue-50/40' : ''}>
                        <td className="text-center font-bold text-blue-900">{t.rank}</td>
                        <td className="text-left font-semibold text-slate-800">{t.name}{t.shortName ? <span className="text-xs text-slate-400 font-normal"> ({t.shortName})</span> : null}</td>
                        <td className="text-center">{t.played}</td>
                        <td className="text-center">{t.wins}</td>
                        <td className="text-center">{t.draws}</td>
                        <td className="text-center">{t.losses}</td>
                        <td className="text-center">{t.goalDiff > 0 ? '+' : ''}{t.goalDiff}</td>
                        <td className="text-center font-bold text-blue-900">{t.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-400 mt-2">แถบสีน้ำเงิน = อันดับ 1–2 (เข้ารอบน็อกเอาท์)</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
