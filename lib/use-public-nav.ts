'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Season, AgeGroup } from '@/types/db';
import { buildPath, resolveSeasonSwitchPath, type PublicPage, type SubFilter } from '@/lib/public-slugs';

/**
 * Shared season/age-group navigation for public pages.
 * - Loads seasons + age groups of the current season
 * - onSeasonChange: clean URL of the new season (keeps age + sub-filter if they exist)
 * - onAgeChange: clean URL of the chosen age group (drops the sub-filter)
 */
export function usePublicNav(
  page: PublicPage,
  seasonId: string,
  ageGroupId: string,
  sub?: SubFilter
) {
  const router = useRouter();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>([]);

  useEffect(() => {
    fetch('/api/public/seasons')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Season[]) => setSeasons(data))
      .catch(() => setSeasons([]));
  }, []);

  useEffect(() => {
    if (!seasonId) return;
    fetch(`/api/public/age-groups?seasonId=${seasonId}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: AgeGroup[]) =>
        setAgeGroups([...data].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
      )
      .catch(() => setAgeGroups([]));
  }, [seasonId]);

  const season = seasons.find((s) => s.id === seasonId);
  const ageGroup = ageGroups.find((a) => a.id === ageGroupId);
  const year = season?.year;
  const code = ageGroup?.code;

  const onSeasonChange = useCallback(
    async (s: Season) => {
      const desiredAge = code || ageGroups[0]?.code || '';
      const path = await resolveSeasonSwitchPath(page, s, desiredAge, sub);
      router.push(path);
    },
    [page, code, ageGroups, sub, router]
  );

  const onAgeChange = useCallback(
    (ag: AgeGroup) => {
      if (year != null) router.push(buildPath(page, year, ag.code));
    },
    [page, year, router]
  );

  return { router, seasons, ageGroups, season, ageGroup, year, code, onSeasonChange, onAgeChange };
}
