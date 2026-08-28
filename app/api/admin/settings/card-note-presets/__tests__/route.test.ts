import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

type Row = { id: string; note: string; created_at?: string | null };

type AuthState = {
  authenticated: boolean;
  error?: string;
  profile?: {
    id: string;
    email: string;
    can_edit_cards: boolean;
  };
};

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  nextId: 1,
  auth: {
    authenticated: true,
    profile: { id: 'admin-1', email: 'admin@example.com', can_edit_cards: true },
  } as AuthState,
}));

vi.mock('@/lib/admin-middleware', () => ({
  verifyAdminAuth: vi.fn(async () => state.auth),
}));

vi.mock('@/lib/audit-log', () => ({
  logAdminAction: vi.fn(async () => undefined),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from(table: string) {
      if (table !== 'card_note_presets') throw new Error(`Unexpected table ${table}`);

      const filters: Array<[string, unknown]> = [];
      let operation: 'select' | 'insert' | 'delete' = 'select';
      let insertValue: Partial<Row> | null = null;

      const selected = () =>
        state.rows.filter((row) => filters.every(([column, value]) => row[column as keyof Row] === value));

      const execute = () => {
        if (operation === 'insert') {
          const note = String(insertValue?.note || '');
          const duplicate = state.rows.some(
            (row) => row.note.trim().toLocaleLowerCase() === note.trim().toLocaleLowerCase()
          );
          if (duplicate) {
            return { data: null, error: { code: '23505', message: 'duplicate' } };
          }
          const row: Row = {
            id: `preset-${state.nextId++}`,
            note,
            created_at: '2026-08-28T00:00:00Z',
          };
          state.rows.push(row);
          return { data: [row], error: null };
        }

        if (operation === 'delete') {
          const ids = new Set(selected().map((row) => row.id));
          state.rows = state.rows.filter((row) => !ids.has(row.id));
          return { data: [], error: null };
        }

        return { data: selected(), error: null };
      };

      // Supabase query builders are thenable; keep this mock surface minimal.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const api: any = {
        select() {
          return api;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return api;
        },
        order() {
          return api;
        },
        insert(value: Partial<Row>) {
          operation = 'insert';
          insertValue = value;
          return api;
        },
        delete() {
          operation = 'delete';
          return api;
        },
        maybeSingle() {
          const result = execute();
          return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
        },
        single() {
          const result = execute();
          return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
        },
        then(resolve: (value: { data: Row[] | null; error: unknown }) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(execute()).then(resolve, reject);
        },
      };
      return api;
    },
  })),
}));

import { logAdminAction } from '@/lib/audit-log';
import { DELETE, GET, POST } from '../route';

function requestBody(body: Record<string, unknown>): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function emptyRequest(): NextRequest {
  return {} as NextRequest;
}

describe('Admin card note preset settings API', () => {
  beforeEach(() => {
    state.rows = [];
    state.nextId = 1;
    state.auth = {
      authenticated: true,
      profile: { id: 'admin-1', email: 'admin@example.com', can_edit_cards: true },
    };
    vi.mocked(logAdminAction).mockClear();
  });

  it('requires authentication to read presets', async () => {
    state.auth = { authenticated: false, error: 'Unauthorized' };
    const response = await GET(emptyRequest());
    expect(response.status).toBe(401);
  });

  it('allows an authenticated admin to read presets in deterministic order', async () => {
    state.rows = [
      { id: '2', note: 'ประท้วงคำตัดสิน', created_at: '2026-08-02T00:00:00Z' },
      { id: '1', note: 'เล่นอันตราย', created_at: '2026-08-01T00:00:00Z' },
    ];
    const response = await GET(emptyRequest());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.map((row: Row) => row.id)).toEqual(['1', '2']);
  });

  it('keeps preset creation optional but rejects an empty preset value', async () => {
    const response = await POST(requestBody({ note: '   ' }));
    expect(response.status).toBe(400);
    expect(state.rows).toHaveLength(0);
  });

  it('trims and creates a reusable preset without touching card event data', async () => {
    const response = await POST(requestBody({ note: '  เล่นอันตราย  ' }));
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.note).toBe('เล่นอันตราย');
    expect(state.rows).toHaveLength(1);
    expect(logAdminAction).toHaveBeenCalledOnce();
  });

  it('rejects duplicate presets case-insensitively', async () => {
    await POST(requestBody({ note: 'Dangerous Play' }));
    const duplicate = await POST(requestBody({ note: '  dangerous play  ' }));
    expect(duplicate.status).toBe(409);
    expect(state.rows).toHaveLength(1);
  });

  it('requires card-edit permission to add or remove presets', async () => {
    state.auth.profile!.can_edit_cards = false;
    const create = await POST(requestBody({ note: 'เล่นอันตราย' }));
    const remove = await DELETE(requestBody({ id: 'preset-1' }));
    expect(create.status).toBe(403);
    expect(remove.status).toBe(403);
  });

  it('removes only the preset record; historical cards.note is independent text', async () => {
    const create = await POST(requestBody({ note: 'ประท้วงคำตัดสิน' }));
    const created = await create.json();
    const response = await DELETE(requestBody({ id: created.id }));
    expect(response.status).toBe(200);
    expect(state.rows).toHaveLength(0);
    expect(logAdminAction).toHaveBeenCalledTimes(2);
  });
});
