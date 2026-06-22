import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { buildTeamContext, validateTeamRow, newTeamSeen } from '@/lib/bulk-import';
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
  const { seasonId, ageGroupId } = body;
  const rows = (body.rows || []) as Record<string, string>[];
  if (!seasonId || !ageGroupId || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'seasonId, ageGroupId และ rows จำเป็นต้องระบุ' }, { status: 400 });
  }

  const { data: season } = await supabaseAdmin.from('seasons').select('season_slug, year, competition_type').eq('id', seasonId).single();
  const { data: ag } = await supabaseAdmin.from('age_groups').select('code').eq('id', ageGroupId).single();
  if (!season || !ag) return NextResponse.json({ error: 'ไม่พบฤดูกาล/รุ่นอายุ' }, { status: 404 });
  const seg = season.season_slug || String(season.year);

  const ctx = await buildTeamContext(supabaseAdmin, seasonId, ageGroupId, seg, ag.code, season.competition_type || 'league');
  const seen = newTeamSeen();
  const results = rows.map((r, i) => validateTeamRow(r, ctx, i + 1, seen));
  const inserts = results.filter((r) => r.status !== 'error' && r.insert).map((r) => ({ ...r.insert!, active: r.insert!.active ?? true }));

  let createdIds: string[] = [];
  if (inserts.length > 0) {
    const { data: created, error } = await supabaseAdmin.from('teams').insert(inserts).select('id');
    if (error) {
      if ((error as any).code === '23502') {
        return NextResponse.json({ error: 'ฐานข้อมูลยังบังคับ division_id — กรุณารัน migration phase 5A.2 ก่อน' }, { status: 500 });
      }
      return NextResponse.json({ error: 'บันทึกทีมไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
    }
    createdIds = (created || []).map((t) => t.id);
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'team.bulk_create', entityType: 'team', entityLabel: `bulk create (${createdIds.length} teams)`,
    newData: { seasonId, ageGroupId, totalRows: rows.length, validRows: inserts.length, errorRows: rows.length - inserts.length, createdCount: createdIds.length, createdIds },
  });

  return NextResponse.json({
    saved: createdIds.length, skipped: rows.length - inserts.length, createdIds,
    results: results.map(({ insert, ...rest }) => rest),
  });
}
