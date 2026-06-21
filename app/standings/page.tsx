'use client';

import { useSearchParams } from 'next/navigation';
import { SeasonSelector } from '@/components/SeasonSelector';
import { StandingsView } from '@/components/StandingsView';

export default function StandingsPage() {
  const searchParams = useSearchParams();
  const seasonId = searchParams.get('season');
  const ageGroupId = searchParams.get('ageGroup');
  const divisionId = searchParams.get('division'); // optional, additive

  return (
    <div className="space-y-6">
      <div className="cfyl-section">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 mb-4">📊 ตารางคะแนน</h1>
        <SeasonSelector />
      </div>

      {!seasonId || !ageGroupId ? (
        <div className="cfyl-empty">โปรดเลือกฤดูกาลและรุ่นอายุ</div>
      ) : (
        <StandingsView
          seasonId={seasonId}
          ageGroupId={ageGroupId}
          divisionId={divisionId}
        />
      )}
    </div>
  );
}
