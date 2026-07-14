import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { getTournamentClient as GetTournamentClient, getTournamentServiceClient as GetTournamentServiceClient } from '../supabase-tournament';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
}

/**
 * `getTournamentClient` caches a singleton at module scope, so each test needs
 * a fresh module instance (matching the isolation `resetModules` gives us) to
 * exercise the guard independently rather than hitting a previously-cached client.
 */
async function freshModule(): Promise<{
  getTournamentClient: typeof GetTournamentClient;
  getTournamentServiceClient: typeof GetTournamentServiceClient;
}> {
  vi.resetModules();
  return import('../supabase-tournament');
}

describe('supabase-tournament runtime guard', () => {
  beforeEach(() => {
    resetEnv();
  });

  afterEach(() => {
    resetEnv();
  });

  it('throws when TOURNAMENT_SUPABASE_URL is missing (anon client)', async () => {
    delete process.env.TOURNAMENT_SUPABASE_URL;
    process.env.TOURNAMENT_SUPABASE_ANON_KEY = 'fake-anon-key';
    const { getTournamentClient } = await freshModule();
    expect(() => getTournamentClient()).toThrow(/Missing TOURNAMENT_SUPABASE_URL/);
  });

  it('throws when TOURNAMENT_SUPABASE_ANON_KEY is missing (anon client)', async () => {
    process.env.TOURNAMENT_SUPABASE_URL = 'https://tournament-test.example.supabase.co';
    delete process.env.TOURNAMENT_SUPABASE_ANON_KEY;
    const { getTournamentClient } = await freshModule();
    expect(() => getTournamentClient()).toThrow(/Missing TOURNAMENT_SUPABASE_URL/);
  });

  it('throws when TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY is missing (service client)', async () => {
    process.env.TOURNAMENT_SUPABASE_URL = 'https://tournament-test.example.supabase.co';
    delete process.env.TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY;
    const { getTournamentServiceClient } = await freshModule();
    expect(() => getTournamentServiceClient()).toThrow(/Missing TOURNAMENT_SUPABASE_URL/);
  });

  it('throws when TOURNAMENT_SUPABASE_URL equals League NEXT_PUBLIC_SUPABASE_URL (anon client)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://league-test.example.supabase.co';
    process.env.TOURNAMENT_SUPABASE_URL = 'https://league-test.example.supabase.co';
    process.env.TOURNAMENT_SUPABASE_ANON_KEY = 'fake-anon-key';
    const { getTournamentClient } = await freshModule();
    expect(() => getTournamentClient()).toThrow(/separate Supabase project/);
  });

  it('throws when TOURNAMENT_SUPABASE_URL equals League NEXT_PUBLIC_SUPABASE_URL (service client)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://league-test.example.supabase.co';
    process.env.TOURNAMENT_SUPABASE_URL = 'https://league-test.example.supabase.co';
    process.env.TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
    const { getTournamentServiceClient } = await freshModule();
    expect(() => getTournamentServiceClient()).toThrow(/separate Supabase project/);
  });

  it('does not throw with valid, distinct URLs (anon client)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://league-test.example.supabase.co';
    process.env.TOURNAMENT_SUPABASE_URL = 'https://tournament-test.example.supabase.co';
    process.env.TOURNAMENT_SUPABASE_ANON_KEY = 'fake-anon-key';
    const { getTournamentClient } = await freshModule();
    expect(() => getTournamentClient()).not.toThrow();
  });

  it('does not throw with valid, distinct URLs (service client)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://league-test.example.supabase.co';
    process.env.TOURNAMENT_SUPABASE_URL = 'https://tournament-test.example.supabase.co';
    process.env.TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY = 'fake-service-key';
    const { getTournamentServiceClient } = await freshModule();
    expect(() => getTournamentServiceClient()).not.toThrow();
  });

  it('does not throw when League URL is unset (Tournament project standing up before League migration)', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.TOURNAMENT_SUPABASE_URL = 'https://tournament-test.example.supabase.co';
    process.env.TOURNAMENT_SUPABASE_ANON_KEY = 'fake-anon-key';
    const { getTournamentClient } = await freshModule();
    expect(() => getTournamentClient()).not.toThrow();
  });

  it('caches the anon client instance across calls within the same module instance', async () => {
    process.env.TOURNAMENT_SUPABASE_URL = 'https://tournament-test.example.supabase.co';
    process.env.TOURNAMENT_SUPABASE_ANON_KEY = 'fake-anon-key';
    const { getTournamentClient } = await freshModule();
    expect(getTournamentClient()).toBe(getTournamentClient());
  });
});
