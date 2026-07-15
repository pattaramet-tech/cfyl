import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { requireTournamentSuperAdmin } from '../auth';
import { NextRequest } from 'next/server';

// Mock the Tournament Supabase client
vi.mock('@/lib/tournament/db/supabase-tournament', () => ({
  getTournamentServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(),
        })),
      })),
    })),
  })),
}));

// Mock the League Supabase client (auth.getUser)
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(),
    },
  })),
}));

describe('requireTournamentSuperAdmin', () => {
  let ORIGINAL_ENV: NodeJS.ProcessEnv;

  beforeEach(() => {
    ORIGINAL_ENV = { ...process.env };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://league-test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'league-test-key';
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.resetModules();
  });

  it('should return 401 if no Authorization header', async () => {
    const request = new NextRequest('http://localhost:3000/api/test', { method: 'GET' });
    const result = await requireTournamentSuperAdmin(request);

    expect(result.authenticated).toBe(false);
    expect(result.authorized).toBe(false);
    expect(result.error).toContain('Authorization');
  });

  it('should return 401 if token is invalid', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const mockClient = createClient('url', 'key');
    mockClient.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: new Error('Invalid token'),
    });

    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET',
      headers: { Authorization: 'Bearer invalid-token' },
    });

    const result = await requireTournamentSuperAdmin(request);

    expect(result.authenticated).toBe(false);
    expect(result.authorized).toBe(false);
  });

  it('should return 403 if profile is not found', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const mockLeagueClient = createClient('url', 'key');
    mockLeagueClient.auth.getUser = vi.fn().mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
      error: null,
    });

    const { getTournamentServiceClient } = await import('@/lib/tournament/db/supabase-tournament');
    const mockTournamentClient = getTournamentServiceClient();
    mockTournamentClient.from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    }));

    const request = new NextRequest('http://localhost:3000/api/test', {
      method: 'GET',
      headers: { Authorization: 'Bearer valid-token' },
    });

    const result = await requireTournamentSuperAdmin(request);

    expect(result.authenticated).toBe(true);
    expect(result.authorized).toBe(false);
    expect(result.error).toContain('profile');
  });
});
