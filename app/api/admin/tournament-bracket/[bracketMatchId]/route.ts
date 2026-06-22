import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ bracketMatchId: string }> }) {
  const { bracketMatchId } = await params;
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }
  const body = await request.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of ['home_team_id', 'away_team_id', 'home_source_type', 'home_source_ref', 'away_source_type', 'away_source_ref']) {
    if (body[f] !== undefined) updates[f] = body[f] || null;
  }
  if (body.home_team_id !== undefined && body.away_team_id !== undefined && body.home_team_id && body.home_team_id === body.away_team_id) {
    return NextResponse.json({ error: 'home กับ away ต้องไม่ใช่ทีมเดียวกัน' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('bracket_matches').update(updates).eq('id', bracketMatchId).select('id').single();
  if (error) return NextResponse.json({ error: 'แก้ไข bracket match ไม่สำเร็จ' }, { status: 500 });

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_bracket.update', entityType: 'bracket_match', entityId: bracketMatchId, entityLabel: bracketMatchId,
    newData: updates,
  });
  return NextResponse.json({ success: true, bracketMatch: data });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ bracketMatchId: string }> }) {
  const { bracketMatchId } = await params;
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { data: bm } = await supabaseAdmin
    .from('bracket_matches').select('id, match_id').eq('id', bracketMatchId).single();
  if (!bm) return NextResponse.json({ error: 'ไม่พบ bracket match' }, { status: 404 });

  if (bm.match_id) {
    const [{ count: g }, { count: c }] = await Promise.all([
      supabaseAdmin.from('goals').select('id', { count: 'exact', head: true }).eq('match_id', bm.match_id),
      supabaseAdmin.from('cards').select('id', { count: 'exact', head: true }).eq('match_id', bm.match_id),
    ]);
    if ((g || 0) > 0 || (c || 0) > 0) {
      return NextResponse.json({ error: `ลบไม่ได้ — แมตช์มีประตู ${g} / ใบ ${c} บันทึกไว้แล้ว` }, { status: 409 });
    }
  }

  await supabaseAdmin.from('bracket_matches').delete().eq('id', bracketMatchId);
  if (bm.match_id) await supabaseAdmin.from('matches').delete().eq('id', bm.match_id);

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'tournament_bracket.delete', entityType: 'bracket_match', entityId: bracketMatchId, entityLabel: bracketMatchId,
  });
  return NextResponse.json({ success: true });
}
