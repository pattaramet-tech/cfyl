import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Tournament V2 Supabase client — DECISION LOCKED (D-01, 2026-07-14).
 *
 * Tournament uses a fully separate Supabase project from League. This file
 * must be the only place `TOURNAMENT_SUPABASE_*` env vars are read to build
 * a client. Do not import this file outside `lib/tournament/**` or
 * `app/api/tournament/**`/`app/(tournament)/**` — see eslint.config.mjs.
 *
 * Both clients default to the `tournament` Postgres schema (not `public`), so
 * callers can write `.from('tournaments')` directly without repeating
 * `.schema('tournament')` on every query.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TournamentClient = SupabaseClient<any, any, 'tournament', any, any>;

function assertNotLeagueProject(tournamentUrl: string): void {
  const leagueUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (leagueUrl && tournamentUrl === leagueUrl) {
    throw new Error(
      '[TOURNAMENT] TOURNAMENT_SUPABASE_URL points at the same project as League ' +
        '(NEXT_PUBLIC_SUPABASE_URL). Tournament V2 requires a separate Supabase project (D-01).'
    );
  }
}

let anonClient: TournamentClient | null = null;

/** Anon client for public reads (e.g. server components rendering public pages). */
export function getTournamentClient(): TournamentClient {
  if (anonClient) return anonClient;

  const url = process.env.TOURNAMENT_SUPABASE_URL;
  const anonKey = process.env.TOURNAMENT_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('[TOURNAMENT] Missing TOURNAMENT_SUPABASE_URL or TOURNAMENT_SUPABASE_ANON_KEY');
  }
  assertNotLeagueProject(url);

  anonClient = createClient(url, anonKey, { db: { schema: 'tournament' } });
  return anonClient;
}

/** Service-role client for server-side admin writes. Never bundle to client. */
export function getTournamentServiceClient(): TournamentClient {
  const url = process.env.TOURNAMENT_SUPABASE_URL;
  const serviceKey = process.env.TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('[TOURNAMENT] Missing TOURNAMENT_SUPABASE_URL or TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY');
  }
  assertNotLeagueProject(url);

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'tournament' },
  });
}
