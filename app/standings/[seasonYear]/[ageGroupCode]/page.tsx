'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { StandingsView } from '@/components/StandingsView';
import { resolveStandingsSlug, type ResolvedStandings } from '@/lib/public-slugs';

export default function StandingsByAgeGroupPage() {
  const params = useParams();
  const year = String(params.seasonYear ?? '');
  const ageCode = String(params.ageGroupCode ?? '');

  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');
  const [resolved, setResolved] = useState<ResolvedStandings | null>(null);

  useEffect(() => {
    let active = true;
    setState('loading');
    resolveStandingsSlug(year, ageCode).then((r) => {
      if (!active) return;
      if (r) {
        setResolved(r);
        setState('ok');
      } else {
        setState('notfound');
      }
    });
    return () => {
      active = false;
    };
  }, [year, ageCode]);

  return (
    <div className="space-y-6">
      <div className="cfyl-section">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">📊 ตารางคะแนน</h1>
        <p className="text-sm text-slate-500 mt-1">
          CFYL {year} · {ageCode.toUpperCase()} · ทุกดิวิชั่น
        </p>
      </div>

      {state === 'loading' ? (
        <div className="cfyl-loading">
          <span className="cfyl-spinner w-5 h-5" />
          กำลังโหลดข้อมูล...
        </div>
      ) : state === 'notfound' || !resolved ? (
        <div className="cfyl-section text-center space-y-3">
          <p className="text-slate-600">ไม่พบหน้าที่ระบุ ({year}/{ageCode})</p>
          <Link href="/standings" className="cfyl-btn-secondary">ไปหน้าตารางคะแนน</Link>
        </div>
      ) : (
        <StandingsView
          seasonId={resolved.seasonId}
          ageGroupId={resolved.ageGroupId}
          allDivisions
        />
      )}
    </div>
  );
}
