import { notFound } from 'next/navigation';
import { StandingsView } from '@/components/StandingsView';
import { resolveCurrentAgeGroupBySeasonSeg } from '@/lib/public-slugs';

export default async function StandingsSeasonSegPage({
  params,
}: {
  params: Promise<{ seasonSeg: string }>;
}) {
  const resolvedParams = await params;
  const { seasonSeg } = resolvedParams;

  const resolved = await resolveCurrentAgeGroupBySeasonSeg(seasonSeg);

  if (!resolved) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="cfyl-section">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">📊 ตารางคะแนน</h1>
      </div>

      <StandingsView seasonId={resolved.seasonId} ageGroupId={resolved.ageGroupId} allDivisions />
    </div>
  );
}
