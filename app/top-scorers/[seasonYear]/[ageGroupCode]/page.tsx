'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { TopScorersView } from '@/components/TopScorersView';
import { resolvePublicSlug, type CurrentSeasonSlug } from '@/lib/public-slugs';

export default function TopScorersByAgeGroupPage() {
  const params = useParams();
  const year = String(params.seasonYear ?? '');
  const ageCode = String(params.ageGroupCode ?? '');

  const [state, setState] = useState<'loading' | 'ok' | 'notfound'>('loading');
  const [resolved, setResolved] = useState<CurrentSeasonSlug | null>(null);

  useEffect(() => {
    let active = true;
    setState('loading');
    resolvePublicSlug(year, ageCode).then((r) => {
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
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">🏆 ดาวซัลโว</h1>
        <p className="text-sm text-slate-500 mt-1">CFYL {year} · {ageCode.toUpperCase()}</p>
      </div>

      {state === 'loading' ? (
        <div className="cfyl-loading">
          <span className="cfyl-spinner w-5 h-5" />
          กำลังโหลดข้อมูล...
        </div>
      ) : state === 'notfound' || !resolved ? (
        <div className="cfyl-section text-center space-y-3">
          <p className="text-slate-600">ไม่พบหน้าที่ระบุ ({year}/{ageCode})</p>
          <Link href="/top-scorers" className="cfyl-btn-secondary">ไปหน้าดาวซัลโว</Link>
        </div>
      ) : (
        <TopScorersView seasonId={resolved.seasonId} ageGroupId={resolved.ageGroupId} />
      )}
    </div>
  );
}
