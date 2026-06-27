import { resolveTournamentContext, computeGroupStandings } from '@/lib/public-tournament';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ seasonSlug: string; ageGroupCode: string }> }) {
  const { seasonSlug, ageGroupCode } = await params;
  const ctx = await resolveTournamentContext(seasonSlug, ageGroupCode);
  if (!ctx) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const groups = await computeGroupStandings(ctx.season.id, ctx.ageGroup.id);
  return NextResponse.json({ season: ctx.season, ageGroup: ctx.ageGroup, groups });
}
