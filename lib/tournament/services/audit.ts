import { getTournamentServiceClient } from '../db/supabase-tournament';

export interface TournamentAuditAdmin {
  id?: string | null;
  email?: string | null;
}

export interface LogTournamentAdminActionParams {
  tournamentId?: string | null;
  admin?: TournamentAuditAdmin;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityLabel?: string | null;
  oldData?: unknown;
  newData?: unknown;
}

/**
 * Write an admin action to tournament_audit_logs.
 *
 * IMPORTANT: this never throws — a failed audit insert must not break the main
 * action. Errors are logged and swallowed.
 */
export async function logTournamentAdminAction(
  params: LogTournamentAdminActionParams
): Promise<void> {
  try {
    const tournamentClient = getTournamentServiceClient();

    const { error } = await tournamentClient.from('tournament_audit_logs').insert({
      tournament_id: params.tournamentId ?? null,
      admin_id: params.admin?.id ?? null,
      admin_email: params.admin?.email ?? null,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId ?? null,
      entity_label: params.entityLabel ?? null,
      old_data: params.oldData ?? null,
      new_data: params.newData ?? null,
    });

    if (error) {
      console.error('[TOURNAMENT_AUDIT] insert failed:', error.message);
    }
  } catch (err) {
    console.error('[TOURNAMENT_AUDIT] logTournamentAdminAction error:', err instanceof Error ? err.message : err);
  }
}
