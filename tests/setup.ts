// Set fake env vars so suspension-calc.ts module-level check passes
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

// Set fake Tournament V2 env vars (separate project per D-01) so any test
// importing lib/tournament/db/supabase-tournament.ts has safe defaults.
// Individual test files may still override these per-case.
process.env.TOURNAMENT_SUPABASE_URL = 'https://tournament-test.example.supabase.co';
process.env.TOURNAMENT_SUPABASE_ANON_KEY = 'test-tournament-anon-key';
process.env.TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY = 'test-tournament-service-role-key';
