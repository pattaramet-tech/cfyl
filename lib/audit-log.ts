import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export interface AuditAdmin {
  id?: string | null;
  email?: string | null;
}

export interface LogAdminActionParams {
  /** Preferred: pass the already-verified admin from the route (no re-verify). */
  admin?: AuditAdmin;
  /** Fallback: resolve the admin from the request if `admin` is not given. */
  request?: NextRequest;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  oldData?: unknown;
  newData?: unknown;
}

/**
 * Write an admin action to admin_audit_logs.
 *
 * IMPORTANT: this never throws — a failed audit insert must not break the main
 * action. Errors are logged and swallowed.
 */
export async function logAdminAction(params: LogAdminActionParams): Promise<void> {
  try {
    let admin = params.admin;
    if ((!admin || (!admin.id && !admin.email)) && params.request) {
      const auth = await verifyAdminAuth(params.request);
      if (auth.authenticated && auth.profile) {
        admin = { id: auth.profile.id, email: auth.profile.email };
      }
    }

    const { error } = await supabaseAdmin.from('admin_audit_logs').insert({
      admin_id: admin?.id ?? null,
      admin_email: admin?.email ?? null,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      entity_label: params.entityLabel ?? null,
      old_data: params.oldData ?? null,
      new_data: params.newData ?? null,
    });

    if (error) {
      console.error('[AUDIT] insert failed:', error.message);
    }
  } catch (err) {
    console.error('[AUDIT] logAdminAction error:', err instanceof Error ? err.message : err);
  }
}
