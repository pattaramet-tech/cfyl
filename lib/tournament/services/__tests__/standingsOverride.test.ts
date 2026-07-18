import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockSaveStandingsOverrideRpc,
  type RpcFailureInjection,
  type SaveStandingsOverrideRpcArgs,
} from './mockSaveStandingsOverrideRpc';

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;
type FailConfig = Partial<Record<string, Partial<Record<'select' | 'insert' | 'update' | 'upsert' | 'delete', boolean>>>>;

interface DirectWriteCall {
  table: string;
  op: 'insert' | 'update' | 'upsert' | 'delete';
}

function createMockClient(
  db: Db,
  options: { failConfig?: FailConfig; injection?: RpcFailureInjection } = {}
) {
  const failConfig = options.failConfig || {};
  const directWriteCalls: DirectWriteCall[] = [];
  let rpcCallCount = 0;

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
        directWriteCalls.push({ table, op: 'update' });
        const err = forcedError('update');
        if (err) return { data: null, error: err };
        const matched = rows().filter(matches);
        matched.forEach((row) => Object.assign(row, patch));
        return { data: matched, error: null };
      }
      if (mode === 'delete') {
        directWriteCalls.push({ table, op: 'delete' });
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
        directWriteCalls.push({ table, op: 'insert' });
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
        directWriteCalls.push({ table, op: 'upsert' });
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

  return {
    from: (table: string) => builder(table),
    rpc(fnName: string, args: Record<string, unknown>) {
      if (fnName !== 'save_standings_override') {
        return Promise.resolve({ data: null, error: { message: `mock client: unknown rpc "${fnName}"` } });
      }
      rpcCallCount += 1;
      const result = mockSaveStandingsOverrideRpc(db, args as unknown as SaveStandingsOverrideRpcArgs, options.injection);
      return Promise.resolve(result);
    },
    __directWriteCalls: directWriteCalls,
    __rpcCallCount: () => rpcCallCount,
  };
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
    await expect(doSave({ previewToken: '' })).rejects.toBeInstanceOf(StandingsOverrideError);
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

  it('8. A Group from another Tournament is rejected (at Preview)', async () => {
    const db = baseDb();
    db.tournament_groups = [{ id: GROUP_ID, tournament_id: OTHER_TOURNAMENT_ID, category_id: 'cat-1', code: 'A' }];
    state.client = createMockClient(db);
    await expect(doPreview()).rejects.toMatchObject({ code: 'STANDINGS_OVERRIDE_GROUP_TOURNAMENT_MISMATCH' });
  });

  it('9. A Team from another Tournament is rejected (at Preview)', async () => {
    await expect(doPreview({ teamId: 'team-other-tournament' })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_TEAM_TOURNAMENT_MISMATCH',
    });
  });

  it('10. A Team not in the Group is rejected (at Preview)', async () => {
    await expect(doPreview({ teamId: 'team-not-in-group' })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_TEAM_NOT_IN_GROUP',
    });
  });

  it('11. A rank greater than the Group size is rejected (at Preview)', async () => {
    // Group A has 3 resolved teams.
    await expect(doPreview({ overrideRank: 99 })).rejects.toMatchObject({
      code: 'STANDINGS_OVERRIDE_RANK_OUT_OF_RANGE',
    });
  });

  it('12. A duplicate override rank (already used by another team in the group) is rejected (at Preview)', async () => {
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
});

describe('standingsOverride — atomic RPC (migration 017)', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
    state.client = createMockClient(baseDb());
  });

  it('1. Preview writes zero rows', async () => {
    const db = baseDb();
    state.client = createMockClient(db);
    await doPreview();
    expect(db.tournament_standing_overrides).toHaveLength(0);
    expect(db.tournament_audit_logs).toHaveLength(0);
  });

  it('2. Save performs exactly one RPC mutation call', async () => {
    const preview = await doPreview();
    await doSave({ previewToken: preview.previewToken });
    expect(state.client?.__rpcCallCount()).toBe(1);
  });

  it('3. No direct Override upsert remains — the write goes through the RPC only', async () => {
    const preview = await doPreview();
    await doSave({ previewToken: preview.previewToken });
    const directOverrideWrites = (state.client?.__directWriteCalls || []).filter((c) => c.table === 'tournament_standing_overrides');
    expect(directOverrideWrites).toHaveLength(0);
  });

  it('4. No separate Audit call remains — the write goes through the RPC only', async () => {
    const preview = await doPreview();
    await doSave({ previewToken: preview.previewToken });
    const directAuditWrites = (state.client?.__directWriteCalls || []).filter((c) => c.table === 'tournament_audit_logs');
    expect(directAuditWrites).toHaveLength(0);
  });

  it('5. A valid Save creates exactly one Override row and one Audit row', async () => {
    const db = baseDb();
    state.client = createMockClient(db);
    const preview = await doPreview();
    await doSave({ previewToken: preview.previewToken });
    expect(db.tournament_standing_overrides).toHaveLength(1);
    expect(db.tournament_audit_logs).toHaveLength(1);
  });

  it('6. Existing Override old_data is correct when updating a prior override', async () => {
    const db = baseDb();
    db.tournament_standing_overrides = [{ group_id: GROUP_ID, team_id: TEAM_ID, override_rank: 2, reason: 'original reason' }];
    state.client = createMockClient(db);
    const preview = await doPreview({ overrideRank: 3, reason: 'new reason' });
    await doSave({ previewToken: preview.previewToken, overrideRank: 3, reason: 'new reason' });
    const audit = db.tournament_audit_logs[0];
    expect(audit.old_data).toMatchObject({ group_id: GROUP_ID, team_id: TEAM_ID, override_rank: 2, reason: 'original reason' });
    expect(audit.new_data).toMatchObject({ group_id: GROUP_ID, team_id: TEAM_ID, override_rank: 3, reason: 'new reason' });
  });

  it('7. New Override old_data is null when no prior override existed', async () => {
    const db = baseDb();
    state.client = createMockClient(db);
    const preview = await doPreview();
    await doSave({ previewToken: preview.previewToken });
    const audit = db.tournament_audit_logs[0];
    expect(audit.old_data).toBeNull();
  });

  it('8. RPC validation is authoritative — a team soft-deleted after Preview is still rejected at Save, even though Save no longer re-runs full scope validation itself', async () => {
    const db = baseDb();
    state.client = createMockClient(db);
    const preview = await doPreview();
    // Preview already passed with the team active. Simulate the team being
    // soft-deleted in between Preview and Save — Save's own TS-side
    // pre-check only reads the override row, not the team, so only the RPC
    // (the sole authority) can catch this.
    const team = db.tournament_teams.find((t) => t.id === TEAM_ID) as Row;
    team.deleted_at = new Date().toISOString();
    await expect(doSave({ previewToken: preview.previewToken })).rejects.toMatchObject({ code: 'STANDINGS_OVERRIDE_TEAM_DELETED' });
    expect(db.tournament_standing_overrides).toHaveLength(0);
    expect(db.tournament_audit_logs).toHaveLength(0);
  });

  it('12. Override write failure leaves zero Audit rows', async () => {
    const db = baseDb();
    state.client = createMockClient(db, { injection: { failAt: 'override' } });
    const preview = await doPreview();
    await expect(doSave({ previewToken: preview.previewToken })).rejects.toThrow();
    expect(db.tournament_standing_overrides).toHaveLength(0);
    expect(db.tournament_audit_logs).toHaveLength(0);
  });

  it('13. Audit insert failure restores the exact original Override state (transaction rollback, no compensating rollback code needed)', async () => {
    const db = baseDb();
    db.tournament_standing_overrides = [{ group_id: GROUP_ID, team_id: TEAM_ID, override_rank: 2, reason: 'original' }];
    state.client = createMockClient(db, { injection: { failAt: 'audit' } });
    const preview = await doPreview({ overrideRank: 3, reason: 'attempted change' });
    await expect(doSave({ previewToken: preview.previewToken, overrideRank: 3, reason: 'attempted change' })).rejects.toThrow();
    expect(db.tournament_standing_overrides).toHaveLength(1);
    expect(db.tournament_standing_overrides[0]).toMatchObject({ override_rank: 2, reason: 'original' });
    expect(db.tournament_audit_logs).toHaveLength(0);
  });

  it('never throws the old compensating-rollback error codes — that error family no longer exists now the write is one transaction', async () => {
    const db = baseDb();
    state.client = createMockClient(db, { injection: { failAt: 'audit' } });
    const preview = await doPreview();
    let caught: unknown;
    try {
      await doSave({ previewToken: preview.previewToken });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).not.toBe('STANDINGS_OVERRIDE_AUDIT_FAILED_ROLLED_BACK');
    expect((caught as { code?: string }).code).not.toBe('STANDINGS_OVERRIDE_AUDIT_FAILED_ROLLBACK_FAILED');
  });
});

describe('standingsOverride — real concurrency via the transactional RPC mock', () => {
  beforeEach(() => {
    process.env.TOURNAMENT_QUICK_RESULT_PREVIEW_SECRET = 'test-secret-do-not-use-in-production';
  });

  it('10. Two concurrent Saves for different teams requesting the same rank: exactly one succeeds, the other gets RANK_CONFLICT, one row, one audit entry', async () => {
    const db = baseDb();
    state.client = createMockClient(db);
    const previewA = await doPreview({ teamId: TEAM_ID, overrideRank: 1, reason: 'team 1 reason' });
    const previewB = await doPreview({ teamId: 'team-2', overrideRank: 1, reason: 'team 2 reason' });

    const results = await Promise.allSettled([
      doSave({ teamId: TEAM_ID, overrideRank: 1, reason: 'team 1 reason', previewToken: previewA.previewToken }),
      doSave({ teamId: 'team-2', overrideRank: 1, reason: 'team 2 reason', previewToken: previewB.previewToken }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'STANDINGS_OVERRIDE_RANK_CONFLICT' });
    expect(db.tournament_standing_overrides).toHaveLength(1);
    expect(db.tournament_audit_logs).toHaveLength(1);
  });

  it('11. Two concurrent Saves for the same team from the same pre-Preview state but different ranks: exactly one succeeds, the other gets STATE_CHANGED, no lost update', async () => {
    const db = baseDb();
    state.client = createMockClient(db);
    const previewA = await doPreview({ teamId: TEAM_ID, overrideRank: 1, reason: 'first attempt' });
    const previewB = await doPreview({ teamId: TEAM_ID, overrideRank: 2, reason: 'second attempt' });

    const results = await Promise.allSettled([
      doSave({ teamId: TEAM_ID, overrideRank: 1, reason: 'first attempt', previewToken: previewA.previewToken }),
      doSave({ teamId: TEAM_ID, overrideRank: 2, reason: 'second attempt', previewToken: previewB.previewToken }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: 'STANDINGS_OVERRIDE_STATE_CHANGED' });
    expect(db.tournament_standing_overrides).toHaveLength(1);
    expect(db.tournament_audit_logs).toHaveLength(1);
  });
});

describe('tournament.save_standings_override (mock RPC) — authoritative validation, zero writes on failure', () => {
  function rpcArgs(overrides: Partial<SaveStandingsOverrideRpcArgs> = {}): SaveStandingsOverrideRpcArgs {
    return {
      p_tournament_id: TOURNAMENT_ID,
      p_group_id: GROUP_ID,
      p_team_id: TEAM_ID,
      p_override_rank: 1,
      p_reason: 'เหตุผล',
      p_actor_id: 'admin-1',
      p_actor_email: 'admin@test.com',
      p_expected_row_exists: false,
      p_expected_override_rank: null,
      p_expected_reason: null,
      ...overrides,
    };
  }

  it('14a. Tournament not found writes nothing', () => {
    const db = baseDb();
    db.tournaments = db.tournaments.filter((t) => t.id !== TOURNAMENT_ID);
    const result = mockSaveStandingsOverrideRpc(db, rpcArgs());
    expect(result.error?.message).toMatch(/^STANDINGS_OVERRIDE_TOURNAMENT_NOT_FOUND/);
    expect(db.tournament_standing_overrides).toHaveLength(0);
    expect(db.tournament_audit_logs).toHaveLength(0);
  });

  it('14b. Archived tournament writes nothing', () => {
    const db = baseDb();
    (db.tournaments.find((t) => t.id === TOURNAMENT_ID) as Row).status = 'archived';
    const result = mockSaveStandingsOverrideRpc(db, rpcArgs());
    expect(result.error?.message).toMatch(/^STANDINGS_OVERRIDE_TOURNAMENT_NOT_ACTIVE/);
    expect(db.tournament_standing_overrides).toHaveLength(0);
  });

  it('14c. Group not found writes nothing', () => {
    const db = baseDb();
    const result = mockSaveStandingsOverrideRpc(db, rpcArgs({ p_group_id: 'no-such-group' }));
    expect(result.error?.message).toMatch(/^STANDINGS_OVERRIDE_GROUP_NOT_FOUND/);
    expect(db.tournament_standing_overrides).toHaveLength(0);
  });

  it('14d. Group belonging to another tournament writes nothing', () => {
    const db = baseDb();
    const result = mockSaveStandingsOverrideRpc(db, rpcArgs({ p_tournament_id: OTHER_TOURNAMENT_ID }));
    expect(result.error?.message).toMatch(/^STANDINGS_OVERRIDE_GROUP_TOURNAMENT_MISMATCH/);
    expect(db.tournament_standing_overrides).toHaveLength(0);
  });

  it('14e. Team not found writes nothing', () => {
    const db = baseDb();
    const result = mockSaveStandingsOverrideRpc(db, rpcArgs({ p_team_id: 'no-such-team' }));
    expect(result.error?.message).toMatch(/^STANDINGS_OVERRIDE_TEAM_NOT_FOUND/);
    expect(db.tournament_standing_overrides).toHaveLength(0);
  });

  it('14f. Category mismatch between team and group writes nothing', () => {
    const db = baseDb();
    (db.tournament_teams.find((t) => t.id === TEAM_ID) as Row).category_id = 'cat-different';
    const result = mockSaveStandingsOverrideRpc(db, rpcArgs());
    expect(result.error?.message).toMatch(/^STANDINGS_OVERRIDE_TEAM_CATEGORY_MISMATCH/);
    expect(db.tournament_standing_overrides).toHaveLength(0);
  });

  it('14g. Team not a member of the group writes nothing', () => {
    const db = baseDb();
    const result = mockSaveStandingsOverrideRpc(db, rpcArgs({ p_team_id: 'team-not-in-group' }));
    expect(result.error?.message).toMatch(/^STANDINGS_OVERRIDE_TEAM_NOT_IN_GROUP/);
    expect(db.tournament_standing_overrides).toHaveLength(0);
  });

  it('14h. Rank out of range writes nothing', () => {
    const db = baseDb();
    const result = mockSaveStandingsOverrideRpc(db, rpcArgs({ p_override_rank: 99 }));
    expect(result.error?.message).toMatch(/^STANDINGS_OVERRIDE_RANK_OUT_OF_RANGE/);
    expect(db.tournament_standing_overrides).toHaveLength(0);
  });

  it('14i. Empty reason writes nothing', () => {
    const db = baseDb();
    const result = mockSaveStandingsOverrideRpc(db, rpcArgs({ p_reason: '   ' }));
    expect(result.error?.message).toMatch(/^STANDINGS_OVERRIDE_REASON_REQUIRED/);
    expect(db.tournament_standing_overrides).toHaveLength(0);
  });

  it('14j. Rank collision with another team writes nothing', () => {
    const db = baseDb();
    db.tournament_standing_overrides = [{ group_id: GROUP_ID, team_id: 'team-2', override_rank: 1, reason: 'existing' }];
    const result = mockSaveStandingsOverrideRpc(db, rpcArgs({ p_team_id: TEAM_ID, p_override_rank: 1 }));
    expect(result.error?.message).toMatch(/^STANDINGS_OVERRIDE_RANK_CONFLICT/);
    expect(db.tournament_standing_overrides).toHaveLength(1);
  });

  it('expected-row-exists mismatch (row disappeared) writes nothing', () => {
    const db = baseDb();
    const result = mockSaveStandingsOverrideRpc(db, rpcArgs({ p_expected_row_exists: true, p_expected_override_rank: 5, p_expected_reason: 'ghost' }));
    expect(result.error?.message).toMatch(/^STANDINGS_OVERRIDE_STATE_CHANGED/);
    expect(db.tournament_standing_overrides).toHaveLength(0);
  });

  it('expected-no-row mismatch (row appeared) writes nothing', () => {
    const db = baseDb();
    db.tournament_standing_overrides = [{ group_id: GROUP_ID, team_id: TEAM_ID, override_rank: 2, reason: 'surprise' }];
    const result = mockSaveStandingsOverrideRpc(db, rpcArgs({ p_expected_row_exists: false }));
    expect(result.error?.message).toMatch(/^STANDINGS_OVERRIDE_STATE_CHANGED/);
    expect(db.tournament_standing_overrides).toHaveLength(1);
    expect(db.tournament_standing_overrides[0]).toMatchObject({ override_rank: 2, reason: 'surprise' });
  });
});

void StandingsOverrideError;
