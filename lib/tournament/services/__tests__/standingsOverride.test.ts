import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;
type FailConfig = Partial<Record<string, Partial<Record<'select' | 'insert' | 'update' | 'upsert' | 'delete', boolean>>>>;

function createMockClient(db: Db, failConfig: FailConfig = {}) {
  function builder(table: string) {
    let mode: 'select' | 'update' | 'insert' | 'upsert' | 'delete' = 'select';
    let patch: Row | null = null;
    let insertRows: Row[] = [];
    let upsertRow: Row | null = null;
    let upsertConflictCols: string[] = [];
    const filters: Array<['eq' | 'is' | 'in', string, unknown]> = [];

    const rows = (): Row[] => db[table] || (db[table] = []);

    function matches(row: Row): boolean {
      return filters.every(([op, col, val]) => {
        if (op === 'eq') return row[col] === val;
        if (op === 'is') return (row[col] ?? null) === val;
        if (op === 'in') return (val as unknown[]).includes(row[col]);
        return true;
      });
    }

    function forcedError(op: keyof NonNullable<FailConfig[string]>): { message: string } | null {
      if (failConfig[table]?.[op]) {
        return { message: `Simulated ${String(op)} failure on ${table}` };
      }
      return null;
    }

    function execute(): { data: Row[] | Row | null; error: { message: string } | null } {
      if (mode === 'update') {
        const err = forcedError('update');
        if (err) return { data: null, error: err };
        const matched = rows().filter(matches);
        matched.forEach((row) => Object.assign(row, patch));
        return { data: matched, error: null };
      }
      if (mode === 'delete') {
        const err = forcedError('delete');
        if (err) return { data: null, error: err };
        const remaining: Row[] = [];
        const deleted: Row[] = [];
        for (const row of rows()) {
          if (matches(row)) deleted.push(row);
          else remaining.push(row);
        }
        db[table] = remaining;
        return { data: deleted, error: null };
      }
      if (mode === 'insert') {
        const err = forcedError('insert');
        if (err) return { data: null, error: err };
        const created = insertRows.map((row) => {
          const withId: Row = { id: `mock-${Math.random().toString(36).slice(2)}`, ...row };
          rows().push(withId);
          return withId;
        });
        return { data: created, error: null };
      }
      if (mode === 'upsert') {
        const err = forcedError('upsert');
        if (err) return { data: null, error: err };
        const conflictMatch = (row: Row) => upsertConflictCols.every((col) => row[col] === (upsertRow as Row)[col]);
        const existingIndex = rows().findIndex(conflictMatch);
        if (existingIndex >= 0) {
          Object.assign(rows()[existingIndex], upsertRow);
        } else {
          rows().push({ ...(upsertRow as Row) });
        }
        return { data: [upsertRow as Row], error: null };
      }
      const err = forcedError('select');
      if (err) return { data: null, error: err };
      return { data: rows().filter(matches), error: null };
    }

    const api = {
      select() {
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push(['eq', col, val]);
        return api;
      },
      is(col: string, val: unknown) {
        filters.push(['is', col, val]);
        return api;
      },
      in(col: string, val: unknown[]) {
        filters.push(['in', col, val]);
        return api;
      },
      update(p: Row) {
        mode = 'update';
        patch = p;
        return api;
      },
      delete() {
        mode = 'delete';
        return api;
      },
      insert(p: Row | Row[]) {
        mode = 'insert';
        insertRows = Array.isArray(p) ? p : [p];
        return api;
      },
      upsert(p: Row, opts?: { onConflict?: string }) {
        mode = 'upsert';
        upsertRow = p;
        upsertConflictCols = (opts?.onConflict || '').split(',').map((s) => s.trim()).filter(Boolean);
        return api;
      },
      maybeSingle() {
        const { data, error } = execute();
        const list = (data as Row[]) || [];
        return Promise.resolve({ data: Array.isArray(data) ? (list.length ? list[0] : null) : data, error });
      },
      single() {
        const { data, error } = execute();
        const list = (data as Row[]) || [];
        return Promise.resolve({ data: Array.isArray(data) ? (list.length ? list[0] : null) : data, error });
      },
      then(resolve: (value: { data: Row[] | Row | null; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(execute()).then(resolve, reject);
      },
    };
    return api;
  }

  return { from: (table: string) => builder(table) };
}

const state = vi.hoisted(() => ({ client: null as ReturnType<typeof createMockClient> | null }));

vi.mock('@/lib/tournament/db/supabase-tournament', () => ({
  getTournamentServiceClient: () => state.client,
}));

import { previewStandingsOverride, saveStandingsOverride, StandingsOverrideError } from '../standingsOverride';

const TOURNAMENT_ID = 'tour-1';
const OTHER_TOURNAMENT_ID = 'tour-2';
const GROUP_ID = 'group-a';
const TEAM_ID = 'team-1';

function baseDb(): Db {
  return {
    tournaments: [
      { id: TOURNAMENT_ID, status: 'active', deleted_at: null },
      { id: OTHER_TOURNAMENT_ID, status: 'active', deleted_at: null },
    ],
    tournament_groups: [{ id: GROUP_ID, tournament_id: TOURNAMENT_ID, category_id: 'cat-1', code: 'A' }],
    tournament_teams: [
      { id: TEAM_ID, tournament_id: TOURNAMENT_ID, category_id: 'cat-1', deleted_at: null },
      { id: 'team-2', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', deleted_at: null },
      { id: 'team-3', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', deleted_at: null },
      { id: 'team-other-tournament', tournament_id: OTHER_TOURNAMENT_ID, category_id: 'cat-9', deleted_at: null },
      { id: 'team-not-in-group', tournament_id: TOURNAMENT_ID, category_id: 'cat-1', deleted_at: null },
    ],
    tournament_group_members: [
      { group_id: GROUP_ID, team_id: TEAM_ID },
      { group_id: GROUP_ID, team_id: 'team-2' },
      { group_id: GROUP_ID, team_id: 'team-3' },
    ],
    tournament_standing_overrides: [],
    tournament_audit_logs: [],
  };
}

async function doPreview(overrides: Partial<Parameters<typeof previewStandingsOverride>[0]> = {}) {
  return previewStandingsOverride({
    client: state.client as never,
    tournamentId: TOURNAMENT_ID,
    groupId: GROUP_ID,
    teamId: TEAM_ID,
    overrideRank: 1,
    reason: 'คำสั่งกรรมการกลาง',
    actorUserId: 'admin-1',
    ...overrides,
  });
}

async function doSave(overrides: Partial<Parameters<typeof saveStandingsOverride>[0]> = {}) {
  return saveStandingsOverride({
    client: state.client as never,
    tournamentId: TOURNAMENT_ID,
    groupId: GROUP_ID,
    teamId: TEAM_ID,
    overrideRank: 1,
    reason: 'คำสั่งกรรมการกลาง',
    actorUserId: 'admin-1',
    actorEmail: 'admin@test.com',
    previewToken: '',
    ...overrides,
  });
}

describe('standingsOverride — Preview/Save safety', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    state.client = createMockClient(baseDb());
  });

  it('1. Save without a Preview Token is rejected', async () => {
    await expect(doSave({ previewToken: '' })).rejects.toMatchObject({ code: 'STANDINGS_OVERRIDE_PREVIEW_REQUIRED' });
  });

  it('2. A valid Preview Token allows Save to succeed', async () => {
    const db = baseDb();
    state.client = createMockClient(db);
    const preview = await doPreview();
    const result = await doSave({ previewToken: preview.previewToken });
    expect(result.auditLogged).toBe(true);
    expect(result.overrideRank).toBe(1);
    expect(db.tournament_standing_overrides).toHaveLength(1);
    expect(db.tournament_standing_overrides[0]).toMatchObject({ group_id: GROUP_ID, team_id: TEAM_ID, override_rank: 1 });
    expect(db.tournament_audit_logs).toHaveLength(1);
  });

  it('3. A tampered Preview Token is rejected', async () => {
    const preview = await doPreview();
    const [payload, signature] = preview.previewToken.split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    decoded.overrideRank = 2;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded), 'utf-8').toString('base64url');
    const tamperedToken = `${tamperedPayload}.${signature}`;
    await expect(doSave({ previewToken: tamperedToken })).rejects.toMatchObject({ code: 'STANDINGS_OVERRIDE_PREVIEW_INVALID' });
  });

  it('4. An expired Preview Token is rejected', async () => {
    vi.useFakeTimers();
    try {
      const preview = await doPreview();
      vi.advanceTimersByTime(16 * 60 * 1000);
      await expect(doSave({ previewToken: preview.previewToken })).rejects.toMatchObject({
        code: 'STANDINGS_OVERRIDE_PREVIEW_EXPIRED',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('5. A changed rank after Preview is rejected', async () => {
    const preview = await doPreview({ overrideRank: 1 });
    await expect(doSave({ previewToken: preview.previewToken, overrideRank: 2 })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_PREVIEW_MISMATCH',
    });
  });

  it('6. A changed reason after Preview is rejected', async () => {
    const preview = await doPreview({ reason: 'เหตุผล A' });
    await expect(doSave({ previewToken: preview.previewToken, reason: 'เหตุผล B' })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_PREVIEW_MISMATCH',
    });
  });

  it('7. Actor substitution after Preview is rejected', async () => {
    const preview = await doPreview({ actorUserId: 'admin-1' });
    await expect(doSave({ previewToken: preview.previewToken, actorUserId: 'admin-2' })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_PREVIEW_MISMATCH',
    });
  });

  it('8. A Group from another Tournament is rejected', async () => {
    const db = baseDb();
    db.tournament_groups = [{ id: GROUP_ID, tournament_id: OTHER_TOURNAMENT_ID, category_id: 'cat-1', code: 'A' }];
    state.client = createMockClient(db);
    await expect(doPreview()).rejects.toMatchObject({ code: 'STANDINGS_OVERRIDE_GROUP_TOURNAMENT_MISMATCH' });
  });

  it('9. A Team from another Tournament is rejected', async () => {
    await expect(doPreview({ teamId: 'team-other-tournament' })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_TEAM_TOURNAMENT_MISMATCH',
    });
  });

  it('10. A Team not in the Group is rejected', async () => {
    await expect(doPreview({ teamId: 'team-not-in-group' })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_TEAM_NOT_IN_GROUP',
    });
  });

  it('11. A rank greater than the Group size is rejected', async () => {
    // Group A has 3 resolved teams.
    await expect(doPreview({ overrideRank: 99 })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_RANK_OUT_OF_RANGE',
    });
  });

  it('12. A duplicate override rank (already used by another team in the group) is rejected', async () => {
    const db = baseDb();
    db.tournament_standing_overrides = [{ group_id: GROUP_ID, team_id: 'team-2', override_rank: 1, reason: 'existing' }];
    state.client = createMockClient(db);
    await expect(doPreview({ teamId: TEAM_ID, overrideRank: 1 })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_RANK_CONFLICT',
    });
  });

  it('re-saving your own existing override at the same rank is NOT treated as a conflict', async () => {
    const db = baseDb();
    db.tournament_standing_overrides = [{ group_id: GROUP_ID, team_id: TEAM_ID, override_rank: 1, reason: 'old reason' }];
    state.client = createMockClient(db);
    const preview = await doPreview({ overrideRank: 1, reason: 'new reason' });
    const result = await doSave({ previewToken: preview.previewToken, overrideRank: 1, reason: 'new reason' });
    expect(result.reason).toBe('new reason');
  });

  it('existing override state changed since Preview (race) is rejected', async () => {
    const preview = await doPreview();
    // Simulate another admin's save landing in between this Preview and Save
    // by re-pointing the client at a db where the override row already
    // changed underneath this operator.
    const db2 = baseDb();
    db2.tournament_standing_overrides = [{ group_id: GROUP_ID, team_id: TEAM_ID, override_rank: 2, reason: 'someone else' }];
    state.client = createMockClient(db2);
    await expect(doSave({ previewToken: preview.previewToken })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_STATE_CHANGED',
    });
  });

  it('15. Audit failure triggers a compensating rollback (override reverted, error surfaced)', async () => {
    const db = baseDb();
    state.client = createMockClient(db, { tournament_audit_logs: { insert: true } });
    const preview = await doPreview();
    await expect(doSave({ previewToken: preview.previewToken })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_AUDIT_FAILED_ROLLED_BACK',
    });
    // No override row should remain (rolled back to "no prior override").
    expect(db.tournament_standing_overrides).toHaveLength(0);
  });

  it('audit failure rollback restores the prior override values when one existed', async () => {
    const db = baseDb();
    db.tournament_standing_overrides = [{ group_id: GROUP_ID, team_id: TEAM_ID, override_rank: 2, reason: 'original' }];
    state.client = createMockClient(db, { tournament_audit_logs: { insert: true } });
    const preview = await doPreview({ overrideRank: 3, reason: 'attempted change' });
    await expect(doSave({ previewToken: preview.previewToken, overrideRank: 3, reason: 'attempted change' })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_AUDIT_FAILED_ROLLED_BACK',
    });
    expect(db.tournament_standing_overrides).toHaveLength(1);
    expect(db.tournament_standing_overrides[0]).toMatchObject({ override_rank: 2, reason: 'original' });
  });

  it('16. When the compensating rollback also fails, that is reported accurately (never silently reports success)', async () => {
    const db = baseDb();
    state.client = createMockClient(db, {
      tournament_audit_logs: { insert: true },
      tournament_standing_overrides: { delete: true },
    });
    const preview = await doPreview();
    await expect(doSave({ previewToken: preview.previewToken })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_AUDIT_FAILED_ROLLBACK_FAILED',
    });
  });

  it('never returns success while the Audit Log write is missing', async () => {
    const db = baseDb();
    state.client = createMockClient(db, { tournament_audit_logs: { insert: true } });
    const preview = await doPreview();
    let threw = false;
    try {
      await doSave({ previewToken: preview.previewToken });
    } catch (error) {
      threw = true;
      expect(error).toBeInstanceOf(StandingsOverrideError);
    }
    expect(threw).toBe(true);
  });
});
