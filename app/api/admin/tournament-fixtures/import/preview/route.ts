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

async function resolveContext(seasonId: string, ageGroupId: string) {
  const { data: season } = await supabaseAdmin
    .from('seasons').select('id, season_slug, year').eq('id', seasonId).single();
  const { data: ag } = await supabaseAdmin
    .from('age_groups').select('id, code').eq('id', ageGroupId).single();
  if (!season || !ag) return null;
  const seg = season.season_slug || String(season.year);
  return buildFixtureContext(supabaseAdmin, seasonId, ageGroupId, seg, ag.code);
}

export async function POST(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const seasonId = body.seasonId;
  const ageGroupId = body.ageGroupId;
  const rows = (body.rows || []) as RawFixtureRow[];
  if (!seasonId || !ageGroupId) {
    return NextResponse.json({ error: 'seasonId and ageGroupId required' }, { status: 400 });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'ไม่มีข้อมูลแถวให้ตรวจสอบ' }, { status: 400 });
  }

  const ctx = await resolveContext(seasonId, ageGroupId);
  if (!ctx) return NextResponse.json({ error: 'ไม่พบฤดูกาล/รุ่นอายุ' }, { status: 404 });

  const seen = newBatchSeen();
  const results = rows.map((r, i) => validateFixtureRow(r, ctx, i + 1, seen));
  const valid = results.filter((r) => r.status === 'valid').length;

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_fixture.import_preview',
    entityType: 'match',
    entityLabel: `import preview (${rows.length} rows)`,
    newData: { seasonId, ageGroupId, count: rows.length, validRows: valid, errorRows: rows.length - valid },
  });

  return NextResponse.json({
    results: results.map(({ insert, ...rest }) => rest), // don't leak insert payload
    summary: { total: rows.length, valid, error: rows.length - valid },
  });
}
