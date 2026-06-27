'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface TournamentOpt { id: string; name: string; slug: string; ageGroups: { code: string; name: string }[] }

const SUBS = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'groups', label: 'กลุ่ม' },
  { key: 'fixtures', label: 'โปรแกรม' },
  { key: 'bracket', label: 'สายแข่งขัน' },
];

export function TournamentSubNav({ seasonSlug, ageCode, active }: { seasonSlug: string; ageCode: string; active: string }) {
  const router = useRouter();
  const [list, setList] = useState<TournamentOpt[]>([]);

  useEffect(() => {
    fetch('/api/public/tournaments').then((r) => (r.ok ? r.json() : [])).then(setList);
  }, []);

  const path = (slug: string, age: string, sub: string) =>
    sub === 'overview' ? `/tournaments/${slug}/${age}` : `/tournaments/${slug}/${age}/${sub}`;

  const current = list.find((t) => t.slug.toLowerCase() === seasonSlug.toLowerCase());
  const ages = current?.ageGroups || [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={current?.slug || ''}
          onChange={(e) => {
            const t = list.find((x) => x.slug === e.target.value);
            const firstAge = t?.ageGroups[0]?.code || ageCode;
            if (t) router.push(path(t.slug, firstAge, active));
          }}
          className="cfyl-select"
        >
          {list.length === 0 && <option value="">—</option>}
          {list.map((t) => <option key={t.id} value={t.slug}>{t.name}</option>)}
        </select>
        <div className="flex flex-wrap gap-1.5">
          {ages.map((a) => (
            <button
              key={a.code}
              onClick={() => router.push(path(seasonSlug, a.code, active))}
              className={`cfyl-chip ${a.code.toLowerCase() === ageCode.toLowerCase() ? 'cfyl-chip-active' : ''}`}
            >
              {a.code}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
        {SUBS.map((s) => (
          <button
            key={s.key}
            onClick={() => router.push(path(seasonSlug, ageCode, s.key))}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              active === s.key ? 'bg-blue-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
