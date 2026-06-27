'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TournamentOpt { id: string; name: string; year: number; slug: string; ageGroups: { code: string; name: string }[] }

export default function TournamentsIndexPage() {
  const [list, setList] = useState<TournamentOpt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/public/tournaments')
      .then((r) => (r.ok ? r.json() : []))
      .then(setList)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="cfyl-section">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">🏆 ทัวร์นาเมนต์</h1>
        <p className="text-sm text-slate-500 mt-1">รายการแข่งขันแบบทัวร์นาเมนต์ — รอบแบ่งกลุ่ม + น็อกเอาท์</p>
      </div>

      {loading ? (
        <div className="cfyl-loading"><span className="cfyl-spinner w-5 h-5" />กำลังโหลดข้อมูล...</div>
      ) : list.length === 0 ? (
        <div className="cfyl-empty">ยังไม่มีรายการทัวร์นาเมนต์</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {list.map((t) => (
            <div key={t.id} className="cfyl-card">
              <h2 className="font-bold text-blue-900 text-lg">{t.name}</h2>
              <p className="text-xs text-slate-500 mb-3">ปี {t.year}</p>
              {t.ageGroups.length === 0 ? (
                <p className="text-sm text-slate-400">ยังไม่มีรุ่นอายุ</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {t.ageGroups.map((a) => (
                    <Link key={a.code} href={`/tournaments/${t.slug}/${a.code}`} className="cfyl-chip">
                      {a.code}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
