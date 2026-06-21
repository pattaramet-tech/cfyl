'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DisciplineView } from '@/components/DisciplineView';
import { resolveCurrentSeasonSlug } from '@/lib/public-slugs';

export default function DisciplinePage() {
  const searchParams = useSearchParams();
  const qSeason = searchParams.get('season');
  const qAge = searchParams.get('ageGroup');

  const [fallback, setFallback] = useState<{ seasonId: string; ageGroupId: string } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'empty'>(qSeason && qAge ? 'ready' : 'loading');

  useEffect(() => {
    if (qSeason && qAge) {
      setState('ready');
      return;
    }
    let active = true;
    resolveCurrentSeasonSlug().then((r) => {
      if (!active) return;
      if (r) {
        setFallback({ seasonId: r.seasonId, ageGroupId: r.ageGroupId });
        setState('ready');
      } else {
        setState('empty');
      }
    });
    return () => {
      active = false;
    };
  }, [qSeason, qAge]);

  const seasonId = qSeason || fallback?.seasonId;
  const ageGroupId = qAge || fallback?.ageGroupId;

  return (
    <div className="space-y-6">
      <div className="cfyl-section">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">⚠️ ใบเหลืองใบแดง / โทษแบน</h1>
      </div>

      {state === 'loading' ? (
        <div className="cfyl-loading">
          <span className="cfyl-spinner w-5 h-5" />
          กำลังโหลดข้อมูล...
        </div>
      ) : state === 'empty' || !seasonId || !ageGroupId ? (
        <div className="cfyl-empty">ไม่พบฤดูกาลที่เปิดให้ดูในขณะนี้</div>
      ) : (
        <DisciplineView seasonId={seasonId} ageGroupId={ageGroupId} />
      )}
    </div>
  );
}
