'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useParams } from 'next/navigation';
import { StandingsView } from '@/components/StandingsView';
import { resolveCurrentSeasonSlug, resolveCurrentAgeGroupBySeasonSeg } from '@/lib/public-slugs';

export default function StandingsPage() {
  const params = useParams();
  const slug = params.slug as string[] | undefined;
  const searchParams = useSearchParams();
  const qSeason = searchParams.get('season');
  const qAge = searchParams.get('ageGroup');
  const qDiv = searchParams.get('division');

  const [fallback, setFallback] = useState<{ seasonId: string; ageGroupId: string } | null>(null);
  const [slugResolved, setSlugResolved] = useState<{ seasonId: string; ageGroupId: string } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'empty'>(
    slug && slug.length > 0 ? 'loading' : qSeason && qAge ? 'ready' : 'loading'
  );

  // Resolve from slug path
  useEffect(() => {
    if (!slug || slug.length === 0) {
      setSlugResolved(null);
      return;
    }

    let active = true;
    const seasonSeg = slug[0];
    resolveCurrentAgeGroupBySeasonSeg(seasonSeg).then((resolved) => {
      if (!active) return;
      if (resolved) {
        setSlugResolved({ seasonId: resolved.seasonId, ageGroupId: resolved.ageGroupId });
        setState('ready');
      } else {
        setState('empty');
      }
    });

    return () => {
      active = false;
    };
  }, [slug]);

  // Resolve fallback from query params or current season
  useEffect(() => {
    if (qSeason && qAge) {
      setFallback({ seasonId: qSeason, ageGroupId: qAge });
      setState('ready');
      return;
    }

    let active = true;
    resolveCurrentSeasonSlug().then((r) => {
      if (!active) return;
      if (r) {
        setFallback({ seasonId: r.seasonId, ageGroupId: r.ageGroupId });
        setState('ready');
      } else if (!slugResolved) {
        setState('empty');
      }
    });

    return () => {
      active = false;
    };
  }, [qSeason, qAge, slugResolved]);

  const seasonId = slugResolved?.seasonId || qSeason || fallback?.seasonId;
  const ageGroupId = slugResolved?.ageGroupId || qAge || fallback?.ageGroupId;

  return (
    <div className="space-y-6">
      <div className="cfyl-section">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">📊 ตารางคะแนน</h1>
      </div>

      {state === 'loading' ? (
        <div className="cfyl-loading">
          <span className="cfyl-spinner w-5 h-5" />
          กำลังโหลดข้อมูล...
        </div>
      ) : state === 'empty' || !seasonId || !ageGroupId ? (
        <div className="cfyl-empty">ไม่พบฤดูกาลที่เปิดให้ดูในขณะนี้</div>
      ) : (
        <StandingsView seasonId={seasonId} ageGroupId={ageGroupId} divisionId={qDiv} allDivisions={!qDiv} />
      )}
    </div>
  );
}
