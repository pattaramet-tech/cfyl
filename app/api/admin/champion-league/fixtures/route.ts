import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { logAdminAction } from '@/lib/audit-log';
import { refreshSuspensionServingMatches } from '@/lib/suspension-calc';
import {
  calculateChampionLeagueStandings,
  getChampionLeagueFixtureStructureStatus,
  getChampionLeaguePlacementPairings,
  getChampionLeagueProgress,
  getChampionLeagueRoundRobinPairings,
  getGeneratedLeaguePostMatchCode,
  isGeneratedLeaguePostMatchCode,
  isSameTeamPair,
  parseChampionLeagueQualifierSnapshot,
  validateChampionLeaguePlacementFixtures,
  type ChampionLeagueQualifier,
  type ChampionLeagueRoundRobinPairing,
} from '@/lib/champion-league';
import type { Match } from '@/types/db';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const dynamic = 'force-dynamic';

interface Scope {
  seasonId: string;
  ageGroupId: string;
  divisionId: string;
}

interface ScheduleInput {
  slot?: number;
  match_no?: number | string | null;
  match_date?: string | null;
  match_time?: string | null;
  venue?: string | null;
}

interface NormalizedSchedule {
  slot?: number;
  match_no: number | null;
  match_date: string;
  match_time: string | null;
  venue: string | null;
}

const SCOPE_MATCH_SELECT =
  'id, match_code, season_id, age_group_id, division_id, matchday, match_no, match_date, match_time, venue, home_team_id, away_team_id, home_score, away_score, status, league_phase, note, created_at, updated_at';

function getScopeFromRequest(request: NextRequest): Scope | null {
  const seasonId = request.nextUrl.searchParams.get('seasonId') || '';
  const ageGroupId = request.nextUrl.searchParams.get('ageGroupId') || '';
  const divisionId = request.nextUrl.searchParams.get('divisionId') || '';
  return seasonId && ageGroupId && divisionId ? { seasonId, ageGroupId, divisionId } : null;
}

function getScopeFromBody(body: Record<string, unknown>): Scope | null {
  const seasonId = typeof body.season_id === 'string' ? body.season_id : '';
  const ageGroupId = typeof body.age_group_id === 'string' ? body.age_group_id : '';
  const divisionId = typeof body.division_id === 'string' ? body.division_id : '';
  return seasonId && ageGroupId && divisionId ? { seasonId, ageGroupId, divisionId } : null;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeSchedule(value: unknown, expectedSlot?: number): NormalizedSchedule | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as ScheduleInput;
  if (expectedSlot != null && Number(row.slot) !== expectedSlot) return null;

  const date = typeof row.match_date === 'string' ? row.match_date.trim() : '';
  if (!isValidDate(date)) return null;

  let matchNo: number | null = null;
  if (row.match_no !== null && row.match_no !== undefined && row.match_no !== '') {
    matchNo = Number(row.match_no);
    if (!Number.isInteger(matchNo) || matchNo < 1) return null;
  }

  let time: string | null = null;
  if (row.match_time !== null && row.match_time !== undefined && row.match_time !== '') {
    if (typeof row.match_time !== 'string') return null;
    const trimmed = row.match_time.trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(trimmed)) return null;
    time = trimmed.length === 5 ? `${trimmed}:00` : trimmed;
  }

  let venue: string | null = null;
  if (row.venue !== null && row.venue !== undefined && row.venue !== '') {
    if (typeof row.venue !== 'string') return null;
    venue = row.venue.trim();
    if (!venue || venue.length > 200) return null;
  }

  return { slot: expectedSlot, match_no: matchNo, match_date: date, match_time: time, venue };
}

async function requireMatchEditor(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return { auth: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!auth.profile.can_edit_matches) {
    return {
      auth: null,
      response: NextResponse.json({ error: 'You do not have permission to edit matches' }, { status: 403 }),
    };
  }
  return { auth, response: null };
}

async function loadChampionScope(scope: Scope): Promise<{
  qualifiers: ChampionLeagueQualifier[] | null;
  matches: Match[];
  snapshot: { id: string; activated_at: string | null } | null;
  error: unknown | null;
}> {
  const [snapshotResult, matchesResult] = await Promise.all([
    supabaseAdmin
      .from('league_champion_league_snapshots')
      .select('id, qualifiers, activated_at')
      .eq('season_id', scope.seasonId)
      .eq('age_group_id', scope.ageGroupId)
      .eq('division_id', scope.divisionId)
      .maybeSingle(),
    supabaseAdmin
      .from('matches')
      .select(SCOPE_MATCH_SELECT)
      .eq('season_id', scope.seasonId)
      .eq('age_group_id', scope.ageGroupId)
      .eq('division_id', scope.divisionId)
      .order('match_date', { ascending: true })
      .order('match_time', { ascending: true }),
  ]);

  if (snapshotResult.error) {
    return { qualifiers: null, matches: [], snapshot: null, error: snapshotResult.error };
  }
  if (matchesResult.error) {
    return { qualifiers: null, matches: [], snapshot: null, error: matchesResult.error };
  }

  const snapshot = snapshotResult.data
    ? { id: snapshotResult.data.id, activated_at: snapshotResult.data.activated_at || null }
    : null;
  const qualifiers = snapshotResult.data
    ? parseChampionLeagueQualifierSnapshot(snapshotResult.data.qualifiers)
    : null;
  return {
    qualifiers,
    matches: (matchesResult.data || []) as Match[],
    snapshot,
    error: null,
  };
}

function decoratePairing(pairing: ChampionLeagueRoundRobinPairing, qualifiers: ChampionLeagueQualifier[], divisionId: string) {
  const byId = new Map(qualifiers.map((row) => [row.team_id, row]));
  return {
    ...pairing,
    match_code: getGeneratedLeaguePostMatchCode('champion_league', divisionId, pairing.slot),
    home_team: byId.get(pairing.home_team_id) || null,
    away_team: byId.get(pairing.away_team_id) || null,
  };
}

function findExistingPair(matches: Match[], phase: Match['league_phase'], homeId: string, awayId: string): Match | null {
  return (
    matches.find(
      (match) =>
        match.league_phase === phase &&
        isSameTeamPair(match.home_team_id, match.away_team_id, homeId, awayId)
    ) || null
  );
}

function buildState(scope: Scope, qualifiers: ChampionLeagueQualifier[], matches: Match[]) {
  const pairings = getChampionLeagueRoundRobinPairings(qualifiers);
  const structure = getChampionLeagueFixtureStructureStatus(qualifiers, matches);
  const progress = getChampionLeagueProgress(qualifiers, matches);
  const standings = calculateChampionLeagueStandings(qualifiers, matches);
  const placementPairings = getChampionLeaguePlacementPairings(standings, progress);
  const placementIntegrity = validateChampionLeaguePlacementFixtures(qualifiers, matches);
  const finalMatch = matches.find((match) => match.league_phase === 'final') || null;
  const thirdPlaceMatch = matches.find((match) => match.league_phase === 'third_place') || null;

  return {
    scope: {
      season_id: scope.seasonId,
      age_group_id: scope.ageGroupId,
      division_id: scope.divisionId,
    },
    active: true,
    qualifiers,
    round_robin: {
      preview: pairings.map((pairing) => ({
        ...decoratePairing(pairing, qualifiers, scope.divisionId),
        existing_match: findExistingPair(
          matches,
          'champion_league',
          pairing.home_team_id,
          pairing.away_team_id
        ),
      })),
      structure,
      can_generate: structure.fixture_matches === 0,
      already_generated: structure.complete,
    },
    progress,
    standings,
    placement: {
      can_generate: Boolean(placementPairings && placementIntegrity.valid),
      pairings: placementPairings,
      integrity: placementIntegrity,
      final_match: finalMatch,
      third_place_match: thirdPlaceMatch,
    },
  };
}

function inactiveState(scope: Scope, reason: string) {
  return {
    scope: { season_id: scope.seasonId, age_group_id: scope.ageGroupId, division_id: scope.divisionId },
    active: false,
    reason,
    qualifiers: [],
    round_robin: {
      preview: [],
      structure: null,
      can_generate: false,
      already_generated: false,
    },
    placement: { can_generate: false, pairings: null, integrity: null, final_match: null, third_place_match: null },
  };
}

export async function GET(request: NextRequest) {
  const permission = await requireMatchEditor(request);
  if (permission.response) return permission.response;

  const scope = getScopeFromRequest(request);
  if (!scope) {
    return NextResponse.json({ error: 'seasonId, ageGroupId and divisionId are required' }, { status: 400 });
  }

  const loaded = await loadChampionScope(scope);
  if (loaded.error) {
    console.error('[CHAMPION_FIXTURES_GET] scope load error:', loaded.error);
    return NextResponse.json({ error: 'Failed to load Champion League fixture state' }, { status: 500 });
  }
  if (!loaded.snapshot) {
    return NextResponse.json(inactiveState(scope, 'Champion League has not been activated'));
  }
  if (!loaded.qualifiers) {
    return NextResponse.json(inactiveState(scope, 'Champion League snapshot is invalid'), { status: 409 });
  }

  return NextResponse.json(buildState(scope, loaded.qualifiers, loaded.matches));
}

async function resolveConcurrentSuccess(scope: Scope, action: string) {
  const reloaded = await loadChampionScope(scope);
  if (reloaded.error || !reloaded.qualifiers) return null;
  const state = buildState(scope, reloaded.qualifiers, reloaded.matches);
  if (action === 'generate_round_robin' && state.round_robin.structure.complete) return state;
  if (
    action === 'generate_placements' &&
    state.placement.integrity.valid &&
    state.placement.final_match &&
    state.placement.third_place_match
  ) {
    return state;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const permission = await requireMatchEditor(request);
  if (permission.response || !permission.auth?.profile) return permission.response!;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const scope = getScopeFromBody(body);
  if (!scope) {
    return NextResponse.json({ error: 'season_id, age_group_id and division_id are required' }, { status: 400 });
  }
  const action = typeof body.action === 'string' ? body.action : '';
  if (action !== 'generate_round_robin' && action !== 'generate_placements') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  const loaded = await loadChampionScope(scope);
  if (loaded.error) {
    console.error('[CHAMPION_FIXTURES_POST] scope load error:', loaded.error);
    return NextResponse.json({ error: 'Failed to load Champion League fixture state' }, { status: 500 });
  }
  if (!loaded.snapshot || !loaded.qualifiers) {
    return NextResponse.json(
      { error: 'Champion League must be activated with a valid frozen Top 4 before generating fixtures' },
      { status: 409 }
    );
  }

  if (action === 'generate_round_robin') {
    const structure = getChampionLeagueFixtureStructureStatus(loaded.qualifiers, loaded.matches);
    if (structure.complete) {
      return NextResponse.json({ success: true, idempotent: true, ...buildState(scope, loaded.qualifiers, loaded.matches) });
    }
    if (structure.fixture_matches > 0) {
      return NextResponse.json(
        {
          error: 'Champion League fixtures already exist but are incomplete or invalid; resolve them before generation',
          structure,
        },
        { status: 409 }
      );
    }

    if (!Array.isArray(body.schedules) || body.schedules.length !== 6) {
      return NextResponse.json({ error: 'Exactly six round-robin schedules are required' }, { status: 400 });
    }

    const schedules: NormalizedSchedule[] = [];
    for (let slot = 1; slot <= 6; slot += 1) {
      const raw = body.schedules.find(
        (entry) => entry && typeof entry === 'object' && Number((entry as ScheduleInput).slot) === slot
      );
      const normalized = normalizeSchedule(raw, slot);
      if (!normalized) {
        return NextResponse.json(
          { error: `Invalid schedule for Champion League slot ${slot}; match_date is required` },
          { status: 400 }
        );
      }
      schedules.push(normalized);
    }

    const pairings = getChampionLeagueRoundRobinPairings(loaded.qualifiers);
    if (pairings.length !== 6) {
      return NextResponse.json({ error: 'Frozen Top 4 cannot produce a valid round robin' }, { status: 409 });
    }

    const rows = pairings.map((pairing) => {
      const schedule = schedules[pairing.slot - 1];
      return {
        season_id: scope.seasonId,
        age_group_id: scope.ageGroupId,
        division_id: scope.divisionId,
        match_code: getGeneratedLeaguePostMatchCode('champion_league', scope.divisionId, pairing.slot),
        matchday: pairing.matchday,
        match_no: schedule.match_no,
        match_date: schedule.match_date,
        match_time: schedule.match_time,
        venue: schedule.venue,
        home_team_id: pairing.home_team_id,
        away_team_id: pairing.away_team_id,
        home_score: null,
        away_score: null,
        status: 'scheduled',
        league_phase: 'champion_league',
        stage: null,
        tournament_group_id: null,
        note: `Generated Champion League round ${pairing.round_no} slot ${pairing.slot}`,
      };
    });

    const { error: insertError } = await supabaseAdmin.from('matches').insert(rows);
    if (insertError) {
      if (insertError.code === '23505') {
        const concurrentState = await resolveConcurrentSuccess(scope, action);
        if (concurrentState) {
          return NextResponse.json({ success: true, idempotent: true, concurrent: true, ...concurrentState });
        }
        return NextResponse.json({ error: 'Champion League fixtures conflict with existing generated data' }, { status: 409 });
      }
      console.error('[CHAMPION_FIXTURES_POST] round-robin insert error:', insertError);
      return NextResponse.json({ error: 'Failed to generate Champion League fixtures' }, { status: 500 });
    }

    const after = await loadChampionScope(scope);
    if (after.error || !after.qualifiers) {
      return NextResponse.json({ error: 'Fixtures were generated but verification reload failed' }, { status: 500 });
    }
    const state = buildState(scope, after.qualifiers, after.matches);
    if (!state.round_robin.structure.complete) {
      return NextResponse.json({ error: 'Generated Champion League fixture structure failed verification' }, { status: 500 });
    }

    await logAdminAction({
      admin: { id: permission.auth.profile.id, email: permission.auth.profile.email },
      action: 'champion_league.fixtures.generate_round_robin',
      entityType: 'division',
      entityId: scope.divisionId,
      entityLabel: `Champion League fixtures ${scope.seasonId}/${scope.ageGroupId}/${scope.divisionId}`,
      newData: { rows: rows.map(({ match_code, matchday, match_no, match_date, match_time, venue }) => ({ match_code, matchday, match_no, match_date, match_time, venue })) },
    });

    return NextResponse.json({ success: true, idempotent: false, ...state }, { status: 201 });
  }

  const progress = getChampionLeagueProgress(loaded.qualifiers, loaded.matches);
  const standings = calculateChampionLeagueStandings(loaded.qualifiers, loaded.matches);
  const pairings = getChampionLeaguePlacementPairings(standings, progress);
  const integrity = validateChampionLeaguePlacementFixtures(loaded.qualifiers, loaded.matches);
  if (!pairings || !progress.complete) {
    return NextResponse.json(
      { error: 'Champion League must finish all six valid matches before generating Final/Third Place', progress },
      { status: 409 }
    );
  }
  if (!integrity.valid) {
    return NextResponse.json({ error: integrity.reason || 'Existing placement fixtures are invalid' }, { status: 409 });
  }

  const scheduleObject = body.schedules && typeof body.schedules === 'object'
    ? (body.schedules as Record<string, unknown>)
    : null;
  if (!scheduleObject) {
    return NextResponse.json({ error: 'Final and Third Place schedules are required' }, { status: 400 });
  }
  const finalSchedule = normalizeSchedule(scheduleObject.final);
  const thirdSchedule = normalizeSchedule(scheduleObject.third_place);
  if (!finalSchedule || !thirdSchedule) {
    return NextResponse.json({ error: 'Valid match_date is required for Final and Third Place schedules' }, { status: 400 });
  }

  const existingFinal = loaded.matches.find((match) => match.league_phase === 'final') || null;
  const existingThird = loaded.matches.find((match) => match.league_phase === 'third_place') || null;
  if (existingFinal && existingThird) {
    return NextResponse.json({ success: true, idempotent: true, ...buildState(scope, loaded.qualifiers, loaded.matches) });
  }

  const placementRows: Array<Record<string, unknown>> = [];
  if (!existingFinal) {
    placementRows.push({
      season_id: scope.seasonId,
      age_group_id: scope.ageGroupId,
      division_id: scope.divisionId,
      match_code: getGeneratedLeaguePostMatchCode('final', scope.divisionId),
      matchday: 'FINAL',
      match_no: finalSchedule.match_no,
      match_date: finalSchedule.match_date,
      match_time: finalSchedule.match_time,
      venue: finalSchedule.venue,
      home_team_id: pairings.final.home_team_id,
      away_team_id: pairings.final.away_team_id,
      home_score: null,
      away_score: null,
      status: 'scheduled',
      league_phase: 'final',
      stage: null,
      tournament_group_id: null,
      note: 'Generated Champion League Final (rank 1 vs 2)',
    });
  }
  if (!existingThird) {
    placementRows.push({
      season_id: scope.seasonId,
      age_group_id: scope.ageGroupId,
      division_id: scope.divisionId,
      match_code: getGeneratedLeaguePostMatchCode('third_place', scope.divisionId),
      matchday: 'THIRD',
      match_no: thirdSchedule.match_no,
      match_date: thirdSchedule.match_date,
      match_time: thirdSchedule.match_time,
      venue: thirdSchedule.venue,
      home_team_id: pairings.third_place.home_team_id,
      away_team_id: pairings.third_place.away_team_id,
      home_score: null,
      away_score: null,
      status: 'scheduled',
      league_phase: 'third_place',
      stage: null,
      tournament_group_id: null,
      note: 'Generated Champion League Third Place (rank 3 vs 4)',
    });
  }

  const { error: placementError } = await supabaseAdmin.from('matches').insert(placementRows);
  if (placementError) {
    if (placementError.code === '23505') {
      const concurrentState = await resolveConcurrentSuccess(scope, action);
      if (concurrentState) {
        return NextResponse.json({ success: true, idempotent: true, concurrent: true, ...concurrentState });
      }
      return NextResponse.json({ error: 'Placement fixtures conflict with existing generated data' }, { status: 409 });
    }
    console.error('[CHAMPION_FIXTURES_POST] placement insert error:', placementError);
    return NextResponse.json({ error: 'Failed to generate Final/Third Place fixtures' }, { status: 500 });
  }

  const after = await loadChampionScope(scope);
  if (after.error || !after.qualifiers) {
    return NextResponse.json({ error: 'Placement fixtures were generated but verification reload failed' }, { status: 500 });
  }
  const afterIntegrity = validateChampionLeaguePlacementFixtures(after.qualifiers, after.matches);
  const afterFinal = after.matches.filter((match) => match.league_phase === 'final');
  const afterThird = after.matches.filter((match) => match.league_phase === 'third_place');
  if (!afterIntegrity.valid || afterFinal.length !== 1 || afterThird.length !== 1) {
    return NextResponse.json({ error: 'Generated placement fixtures failed integrity verification' }, { status: 500 });
  }

  await logAdminAction({
    admin: { id: permission.auth.profile.id, email: permission.auth.profile.email },
    action: 'champion_league.fixtures.generate_placements',
    entityType: 'division',
    entityId: scope.divisionId,
    entityLabel: `Champion League placements ${scope.seasonId}/${scope.ageGroupId}/${scope.divisionId}`,
    newData: {
      final: pairings.final,
      third_place: pairings.third_place,
      generated_match_codes: placementRows.map((row) => row.match_code),
    },
  });

  return NextResponse.json({ success: true, idempotent: false, ...buildState(scope, after.qualifiers, after.matches) }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const permission = await requireMatchEditor(request);
  if (permission.response || !permission.auth?.profile) return permission.response!;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const matchId = typeof body.match_id === 'string' ? body.match_id : '';
  const schedule = normalizeSchedule(body.schedule);
  if (!matchId || !schedule) {
    return NextResponse.json(
      { error: 'match_id and a valid schedule with match_date are required' },
      { status: 400 }
    );
  }

  const { data: currentMatch, error: matchError } = await supabaseAdmin
    .from('matches')
    .select(SCOPE_MATCH_SELECT)
    .eq('id', matchId)
    .single();
  if (matchError || !currentMatch) {
    return NextResponse.json({ error: 'Generated League fixture not found' }, { status: 404 });
  }
  const match = currentMatch as Match;
  if (
    !isGeneratedLeaguePostMatchCode(match.match_code) ||
    !['champion_league', 'final', 'third_place'].includes(match.league_phase || '') ||
    !match.season_id ||
    !match.age_group_id ||
    !match.division_id
  ) {
    return NextResponse.json(
      { error: 'Only generated Champion League / placement fixtures can be scheduled here' },
      { status: 409 }
    );
  }
  if (match.status === 'finished') {
    return NextResponse.json({ error: 'Finished generated fixtures are read-only for scheduling' }, { status: 409 });
  }

  const scope: Scope = {
    seasonId: match.season_id,
    ageGroupId: match.age_group_id,
    divisionId: match.division_id,
  };
  const loaded = await loadChampionScope(scope);
  if (loaded.error || !loaded.snapshot || !loaded.qualifiers) {
    return NextResponse.json({ error: 'Valid frozen Champion League snapshot is required' }, { status: 409 });
  }

  const qualifierIds = new Set(loaded.qualifiers.map((row) => row.team_id));
  if (!qualifierIds.has(match.home_team_id) || !qualifierIds.has(match.away_team_id)) {
    return NextResponse.json({ error: 'Generated fixture teams are outside the frozen Top 4' }, { status: 409 });
  }

  if (match.league_phase === 'champion_league') {
    const expected = getChampionLeagueRoundRobinPairings(loaded.qualifiers);
    const validPair = expected.some((pairing) =>
      isSameTeamPair(
        pairing.home_team_id,
        pairing.away_team_id,
        match.home_team_id,
        match.away_team_id
      )
    );
    if (!validPair) {
      return NextResponse.json({ error: 'Generated Champion League pairing is not valid for the frozen Top 4' }, { status: 409 });
    }
  } else {
    const progress = getChampionLeagueProgress(loaded.qualifiers, loaded.matches);
    const standings = calculateChampionLeagueStandings(loaded.qualifiers, loaded.matches);
    const placementPairings = getChampionLeaguePlacementPairings(standings, progress);
    if (!placementPairings) {
      return NextResponse.json({ error: 'Champion League is not complete enough to schedule placement fixtures' }, { status: 409 });
    }
    const expected = match.league_phase === 'final' ? placementPairings.final : placementPairings.third_place;
    if (
      !isSameTeamPair(
        match.home_team_id,
        match.away_team_id,
        expected.home_team_id,
        expected.away_team_id
      )
    ) {
      return NextResponse.json({ error: 'Placement fixture teams no longer match Champion League standings' }, { status: 409 });
    }
  }

  const oldSchedule = {
    match_no: match.match_no,
    match_date: match.match_date,
    match_time: match.match_time,
    venue: match.venue,
  };
  const { data: updated, error: updateError } = await supabaseAdmin
    .from('matches')
    .update({
      match_no: schedule.match_no,
      match_date: schedule.match_date,
      match_time: schedule.match_time,
      venue: schedule.venue,
      updated_at: new Date().toISOString(),
    })
    .eq('id', matchId)
    .select(SCOPE_MATCH_SELECT)
    .single();

  if (updateError || !updated) {
    console.error('[CHAMPION_FIXTURES_PATCH] update error:', updateError);
    return NextResponse.json({ error: 'Failed to update generated fixture schedule' }, { status: 500 });
  }

  await logAdminAction({
    admin: { id: permission.auth.profile.id, email: permission.auth.profile.email },
    action: 'champion_league.fixture.schedule_update',
    entityType: 'match',
    entityId: matchId,
    entityLabel: match.match_code,
    oldData: oldSchedule,
    newData: {
      match_no: schedule.match_no,
      match_date: schedule.match_date,
      match_time: schedule.match_time,
      venue: schedule.venue,
    },
  });

  try {
    await Promise.all([
      refreshSuspensionServingMatches({
        seasonId: match.season_id,
        ageGroupId: match.age_group_id,
        teamId: match.home_team_id,
        changedMatchId: matchId,
      }),
      refreshSuspensionServingMatches({
        seasonId: match.season_id,
        ageGroupId: match.age_group_id,
        teamId: match.away_team_id,
        changedMatchId: matchId,
      }),
    ]);
  } catch (error) {
    console.error('[CHAMPION_FIXTURES_PATCH] suspension serving refresh warning:', error);
  }

  return NextResponse.json({ success: true, match: updated });
}
