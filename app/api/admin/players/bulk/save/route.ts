import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { buildPlayerContext, validatePlayerRow, newPlayerSeen } from '@/lib/bulk-import';
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

  const { data: season } = await supabaseAdmin.from('seasons').select('season_slug, year').eq('id', seasonId).single();
  const { data: ag } = await supabaseAdmin.from('age_groups').select('code').eq('id', ageGroupId).single();
  if (!season || !ag) return NextResponse.json({ error: 'ไม่พบฤดูกาล/รุ่นอายุ' }, { status: 404 });
  const seg = season.season_slug || String(season.year);

  const ctx = await buildPlayerContext(supabaseAdmin, seasonId, ageGroupId, seg, ag.code);
  const seen = newPlayerSeen();
  const results = rows.map((r, i) => validatePlayerRow(r, ctx, i + 1, seen));
  const inserts = results.filter((r) => r.status !== 'error' && r.insert).map((r) => r.insert!);

  let createdIds: string[] = [];
  if (inserts.length > 0) {
    const { data: created, error } = await supabaseAdmin.from('players').insert(inserts).select('id');
    if (error) {
      if ((error as any).code === '23502') {
        return NextResponse.json({ error: 'ฐานข้อมูลยังบังคับ division_id — กรุณารัน migration phase 5A.3 ก่อน' }, { status: 500 });
      }
      if ((error as any).code === '23505') {
        return NextResponse.json({ error: 'มี player_code ซ้ำ — กรุณาตรวจสอบและลองใหม่' }, { status: 409 });
      }
      return NextResponse.json({ error: 'บันทึกผู้เล่นไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 });
    }
    createdIds = (created || []).map((p) => p.id);
  }

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'player.bulk_create', entityType: 'player', entityLabel: `bulk create (${createdIds.length} players)`,
    newData: { seasonId, ageGroupId, totalRows: rows.length, validRows: inserts.length, errorRows: rows.length - inserts.length, createdCount: createdIds.length, createdIds },
  });

  return NextResponse.json({
    saved: createdIds.length, skipped: rows.length - inserts.length, createdIds,
    results: results.map(({ insert, ...rest }) => rest),
  });
}
