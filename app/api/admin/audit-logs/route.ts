import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50));
  const action = searchParams.get('action');
  const entityType = searchParams.get('entityType');
  const adminEmail = searchParams.get('adminEmail');
  const dateFrom = searchParams.get('dateFrom');
  const dateTo = searchParams.get('dateTo');
  const search = searchParams.get('search');

  let query = supabaseAdmin
    .from('admin_audit_logs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (action) query = query.eq('action', action);
  if (entityType) query = query.eq('entity_type', entityType);
  if (adminEmail) query = query.ilike('admin_email', `%${adminEmail}%`);
  if (dateFrom) query = query.gte('created_at', dateFrom);
  if (dateTo) query = query.lte('created_at', `${dateTo}T23:59:59.999`);
  if (search) {
    const s = search.replace(/[%,]/g, ' ');
    query = query.or(
      `entity_label.ilike.%${s}%,action.ilike.%${s}%,admin_email.ilike.%${s}%`
    );
  }

  const from = (page - 1) * limit;
  const { data, error, count } = await query.range(from, from + limit - 1);

  if (error) {
    console.error('[AUDIT_LOGS_GET] Query error:', error.message);
    return NextResponse.json({ error: `Failed to fetch audit logs: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ rows: data || [], total: count ?? 0, page, limit });
}
