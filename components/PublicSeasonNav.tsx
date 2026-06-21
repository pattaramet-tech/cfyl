'use client';

import { useState } from 'react';
import type { Season, AgeGroup } from '@/types/db';

interface PublicSeasonNavProps {
  seasons: Season[];
  ageGroups: AgeGroup[];
  seasonId: string;
  ageGroupId: string;
  onSeasonChange: (season: Season) => void;
  onAgeChange: (ageGroup: AgeGroup) => void;
  /** Clean URL of the current view — enables the Copy Link button. */
  copyPath?: string | null;
  /** Sub-filter chip rows (division / matchday). */
  children?: React.ReactNode;
}

function ageChipClass(active: boolean, code: string): string {
  if (!active) return 'cfyl-chip';
  const up = code.toUpperCase();
  if (up.includes('14')) return 'cfyl-chip bg-amber-500 text-white hover:bg-amber-500';
  if (up.includes('17')) return 'cfyl-chip bg-blue-700 text-white hover:bg-blue-700';
  return 'cfyl-chip cfyl-chip-active';
}

function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const url = typeof window !== 'undefined' ? window.location.origin + path : path;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <button onClick={onCopy} className="cfyl-chip text-xs" title={path}>
      {copied ? '✓ คัดลอกแล้ว' : '🔗 คัดลอกลิงก์'}
    </button>
  );
}

export function PublicSeasonNav({
  seasons,
  ageGroups,
  seasonId,
  ageGroupId,
  onSeasonChange,
  onAgeChange,
  copyPath,
  children,
}: PublicSeasonNavProps) {
  return (
    <div className="cfyl-section space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-600 whitespace-nowrap">ฤดูกาล</span>
          <select
            value={seasonId}
            onChange={(e) => {
              const s = seasons.find((x) => x.id === e.target.value);
              if (s) onSeasonChange(s);
            }}
            className="cfyl-select"
          >
            {seasons.length === 0 && <option value="">—</option>}
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {copyPath && <CopyLinkButton path={copyPath} />}
      </div>

      {ageGroups.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-slate-600 whitespace-nowrap">รุ่นอายุ</span>
          {ageGroups.map((ag) => (
            <button
              key={ag.id}
              onClick={() => onAgeChange(ag)}
              className={ageChipClass(ag.id === ageGroupId, ag.code)}
            >
              {ag.code}
            </button>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}
