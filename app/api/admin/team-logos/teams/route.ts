import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์แอดมิน' }, { status: 401 });
    }

    const { data: teams, error } = await supabaseAdmin
      .from('teams')
      .select(
        `
        id,
        name,
        short_name,
        logo_url,
        active,
        season_id,
        age_group_id,
        division_id,
        age_group:age_group_id(id, code, name),
        division:division_id(id, name),
        season:season_id(id, name, year)
      `
      )
      .order('season_id', { ascending: false })
      .order('age_group_id', { ascending: true })
      .order('division_id', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('[TEAM_LOGOS_LIST] Error:', error);
      return NextResponse.json(
        { error: 'ไม่สามารถโหลดข้อมูลทีมได้' },
        { status: 500 }
      );
    }

    if (!teams || teams.length === 0) {
      return NextResponse.json([]);
    }

    return NextResponse.json(teams);
  } catch (error) {
    console.error('[TEAM_LOGOS_LIST] Error:', error);
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดในการโหลดข้อมูล' },
      { status: 500 }
    );
  }
}
