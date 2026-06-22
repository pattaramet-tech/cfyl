import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { buildTemplate, firstRoundSlots, resolveGroupRanks, resolveSource, BRACKET_SIZES } from '@/lib/bracket';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

interface SourceSpec { type: string; ref: string }

export async function POST(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json();
  const { seasonId, ageGroupId } = body;
  const size = Number(body.size);
  const mapping = (body.mapping || []) as SourceSpec[];
  if (!seasonId || !ageGroupId) return NextResponse.json({ error: 'seasonId and ageGroupId required' }, { status: 400 });
  if (!BRACKET_SIZES.includes(size as any)) return NextResponse.json({ error: 'bracket size ต้องเป็น 4, 8 หรือ 16' }, { status: 400 });
  if (mapping.length !== size) return NextResponse.json({ error: `ต้องระบุแหล่งที่มาให้ครบ ${size} ทีม` }, { status: 400 });

  const tpl = buildTemplate(size);
  const slots = firstRoundSlots(tpl);
  const ranks = await resolveGroupRanks(supabaseAdmin, seasonId, ageGroupId);
  const { data: teamRows } = await supabaseAdmin
    .from('teams').select('id, name').eq('season_id', seasonId).eq('age_group_id', ageGroupId);
  const teamName = new Map((teamRows || []).map((t: any) => [t.id, t.name]));

  // first-round sources per match key/slot
  const firstSrc = new Map<string, SourceSpec>();
  slots.forEach((s, i) => firstSrc.set(`${s.key}:${s.slot}`, mapping[i]));

  // feeder labels for later rounds
  const feeder = new Map<string, string>();
  for (const m of tpl.matches) {
    if (m.winnerToKey) feeder.set(`${m.winnerToKey}:${m.winnerToSlot}`, `ผู้ชนะ ${m.key}`);
    if (m.loserToKey) feeder.set(`${m.loserToKey}:${m.loserToSlot}`, `ผู้แพ้ ${m.key}`);
  }

  const warnings: string[] = [];
  const sideInfo = (key: string, slot: 'home' | 'away') => {
    if (firstSrc.has(`${key}:${slot}`)) {
      const src = firstSrc.get(`${key}:${slot}`)!;
      const r = resolveSource(src.type, src.ref, ranks);
      if (r.warning) warnings.push(`${key} ${slot}: ${r.warning}`);
      return { label: r.label, teamName: r.teamId ? teamName.get(r.teamId) || null : null, warning: r.warning || null };
    }
    return { label: feeder.get(`${key}:${slot}`) || '—', teamName: null, warning: null };
  };

  const matches = tpl.matches.map((m) => ({
    key: m.key, stage: m.stage, position: m.position,
    home: sideInfo(m.key, 'home'), away: sideInfo(m.key, 'away'),
  }));

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_bracket.preview', entityType: 'bracket', entityLabel: `preview ${size} teams`,
    newData: { seasonId, ageGroupId, size },
  });

  return NextResponse.json({ size, rounds: tpl.rounds, matches, warnings });
}
