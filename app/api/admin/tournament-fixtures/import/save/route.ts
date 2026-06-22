import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { buildFixtureContext, validateFixtureRow, newBatchSeen, type RawFixtureRow } from '@/lib/tournament-fixtures';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const seasonId = body.seasonId;
  const ageGroupId = body.ageGroupId;
  const rows = (body.rows || []) as RawFixtureRow[];
  if (!seasonId || !ageGroupId || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'seasonId, ageGroupId และ rows จำเป็นต้องระบุ' }, { status: 400 });
  }

  const { data: season } = await supabaseAdmin
    .from('seasons').select('id, season_slug, year').eq('id', seasonId).single();
  const { data: ag } = await supabaseAdmin
    .from('age_groups').select('id, code').eq('id', ageGroupId).single();
  if (!season || !ag) return NextResponse.json({ error: 'ไม่พบฤดูกาล/รุ่นอายุ' }, { status: 404 });
  const seg = season.season_slug || String(season.year);

  // Re-validate against fresh context (guards against changes since preview)
  const ctx = await buildFixtureContext(supabaseAdmin, seasonId, ageGroupId, seg, ag.code);
  const seen = newBatchSeen();
  const results = rows.map((r, i) => validateFixtureRow(r, ctx, i + 1, seen));
  const inserts = results.filter((r) => r.status === 'valid' && r.insert).map((r) => r.insert!);

  let matchIds: string[] = [];
  if (inserts.length > 0) {
    const { data: created, error } = await supabaseAdmin.from('matches').insert(inserts).select('id');
    if (error) {
      if ((error as any).code === '42703') {
        return NextResponse.json({ error: 'ฐานข้อมูลยังไม่มีคอลัมน์ stage/tournament_group_id/venue — กรุณารัน migration phase 5A.4 ก่อน' }, { status: 500 });
      }
      return NextResponse.json({ error: 'บันทึกแมตช์ไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
    }
    matchIds = (created || []).map((m) => m.id);
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_fixture.import_save',
    entityType: 'match',
    entityLabel: `import save (${matchIds.length} matches)`,
    newData: {
      seasonId, ageGroupId,
      count: rows.length,
      validRows: inserts.length,
      errorRows: rows.length - inserts.length,
      matchIds,
    },
  });

  return NextResponse.json({
    saved: matchIds.length,
    skipped: rows.length - inserts.length,
    matchIds,
    results: results.map(({ insert, ...rest }) => rest),
  });
}
