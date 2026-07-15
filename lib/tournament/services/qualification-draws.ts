import {
  GROUP_THIRD_PLACE_QUALIFICATION_SLOT,
  buildDrawSelectedConfigs,
  buildDrawSelectedSelectionMaps,
  validateDrawSelectedAssignments,
  type DrawSelectedAssignmentInput,
  type TournamentQualificationDrawCandidateRow,
  type TournamentQualificationDrawRow,
} from '@/lib/tournament/scheduling/drawSelected';
import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

interface CategoryRow {
  id: string;
  code: string;
}

interface QualificationRuleRow {
  category_id: string;
  best_third_placed_count: number;
  best_third_placed_method: string;
}

interface GroupRow {
  id: string;
  category_id: string;
  code: string;
}

interface GroupMemberRow {
  group_id: string;
  team_id: string | null;
  team: { name: string; team_code: string } | { name: string; team_code: string }[] | null;
}

interface TournamentMatchStandingRow {
  id: string;
  group_id: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  regulation_home_score: number | null;
  regulation_away_score: number | null;
  status: string;
  winner_team_id: string | null;
}

interface StandingOverrideRow {
  group_id: string;
  team_id: string;
  override_rank: number;
}

interface TournamentMatchSourceRow {
  id: string;
  home_source_type: string | null;
  home_source_ref: string | null;
  away_source_type: string | null;
  away_source_ref: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  sources_resolved_at: string | null;
}

interface TournamentMatchRow extends TournamentMatchStandingRow, TournamentMatchSourceRow {
  category_id: string;
}

interface ActiveDrawRow {
  id: string;
  version: number;
}

interface EligibleThirdPlaceTeam {
  groupId: string;
  groupCode: string;
  teamId: string;
  teamName: string;
  teamCode: string;
  rank: number;
  computedRank: number;
  points: number;
  goalDiff: number;
  goalsFor: number;
}

interface SaveQualificationDrawSelectionsParams {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
  assignments: DrawSelectedAssignmentInput[];
  note?: string;
  actorUserId?: string | null;
}

export interface SaveQualificationDrawSelectionsResult {
  drawId: string;
  version: number;
  updatedMatchIds: string[];
  selectedSourceRefs: string[];
}

function normalizeTeamRelation(
  relation: GroupMemberRow['team']
): { name: string; team_code: string } | null {
  if (!relation) return null;
  return Array.isArray(relation) ? relation[0] || null : relation;
}

function compareEligibleTeams(left: EligibleThirdPlaceTeam, right: EligibleThirdPlaceTeam): number {
  return (
    left.rank - right.rank ||
    left.computedRank - right.computedRank ||
    right.points - left.points ||
    right.goalDiff - left.goalDiff ||
    right.goalsFor - left.goalsFor ||
    left.groupCode.localeCompare(right.groupCode, 'th') ||
    left.teamName.localeCompare(right.teamName, 'th')
  );
}

function computeGroupTable(params: {
  group: GroupRow;
  members: GroupMemberRow[];
  matches: TournamentMatchStandingRow[];
  overridesByTeamId: Map<string, number>;
}): EligibleThirdPlaceTeam[] {
  const memberRows = params.members.filter((member) => member.group_id === params.group.id && member.team_id);
  const teamIds = new Set(memberRows.map((member) => member.team_id as string));
  const groupMatches = params.matches.filter(
    (match) =>
      match.group_id === params.group.id &&
      match.status === 'finished' &&
      match.home_team_id &&
      match.away_team_id &&
      teamIds.has(match.home_team_id) &&
      teamIds.has(match.away_team_id) &&
      match.regulation_home_score !== null &&
      match.regulation_away_score !== null
  );

  const computedRows = memberRows.map((member) => {
    const teamInfo = normalizeTeamRelation(member.team);
    const teamId = member.team_id as string;
    let points = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;

    for (const match of groupMatches) {
      const isHome = match.home_team_id === teamId;
      const isAway = match.away_team_id === teamId;
      if (!isHome && !isAway) continue;

      const scored = isHome ? match.regulation_home_score || 0 : match.regulation_away_score || 0;
      const conceded = isHome ? match.regulation_away_score || 0 : match.regulation_home_score || 0;
      goalsFor += scored;
      goalsAgainst += conceded;

      const winnerTeamId =
        match.winner_team_id ||
        ((match.regulation_home_score || 0) > (match.regulation_away_score || 0)
          ? match.home_team_id
          : (match.regulation_away_score || 0) > (match.regulation_home_score || 0)
            ? match.away_team_id
            : null);

      if (winnerTeamId === teamId) {
        points += 3;
      } else if (winnerTeamId === null) {
        points += 1;
      }
    }

    return {
      groupId: params.group.id,
      groupCode: params.group.code,
      teamId,
      teamName: teamInfo?.name || '',
      teamCode: teamInfo?.team_code || '',
      rank: 0,
      computedRank: 0,
      points,
      goalDiff: goalsFor - goalsAgainst,
      goalsFor,
    };
  });

  const computedOrder = [...computedRows].sort(
    (left, right) =>
      right.points - left.points ||
      right.goalDiff - left.goalDiff ||
      right.goalsFor - left.goalsFor ||
      left.teamName.localeCompare(right.teamName, 'th')
  );

  const withRanks = computedOrder.map((entry, index) => ({
    ...entry,
    computedRank: index + 1,
    rank: params.overridesByTeamId.get(entry.teamId) || index + 1,
  }));

  return withRanks.sort(compareEligibleTeams);
}

export function computeEligibleThirdPlaceTeams(params: {
  groups: GroupRow[];
  members: GroupMemberRow[];
  matches: TournamentMatchStandingRow[];
  overrides: StandingOverrideRow[];
}): EligibleThirdPlaceTeam[] {
  const overridesByGroupAndTeam = new Map<string, number>();
  for (const override of params.overrides) {
    overridesByGroupAndTeam.set(`${override.group_id}|${override.team_id}`, override.override_rank);
  }

  return params.groups
    .flatMap((group) =>
      computeGroupTable({
        group,
        members: params.members,
        matches: params.matches,
        overridesByTeamId: new Map<string, number>(
          params.members
            .filter((member) => member.group_id === group.id && member.team_id)
            .map((member): [string, number] => [
              member.team_id as string,
              overridesByGroupAndTeam.get(`${group.id}|${member.team_id as string}`) || 0,
            ])
            .filter((entry) => entry[1] > 0)
        ),
      })
    )
    .filter((entry) => entry.rank === 3)
    .sort(compareEligibleTeams);
}

export function buildDrawSelectedMatchUpdates(params: {
  matches: TournamentMatchSourceRow[];
  teamIdsBySourceRef: Map<string, string>;
  now: string;
}): Array<{
  id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  sources_resolved_at: string | null;
}> {
  const updates: Array<{
    id: string;
    home_team_id: string | null;
    away_team_id: string | null;
    sources_resolved_at: string | null;
  }> = [];

  for (const match of params.matches) {
    const homeSourceRef = String(match.home_source_ref || '').trim().toUpperCase();
    const awaySourceRef = String(match.away_source_ref || '').trim().toUpperCase();

    const nextHomeTeamId =
      match.home_source_type === 'draw_selected'
        ? params.teamIdsBySourceRef.get(homeSourceRef) || null
        : match.home_team_id;
    const nextAwayTeamId =
      match.away_source_type === 'draw_selected'
        ? params.teamIdsBySourceRef.get(awaySourceRef) || null
        : match.away_team_id;

    if (nextHomeTeamId === match.home_team_id && nextAwayTeamId === match.away_team_id) {
      continue;
    }

    updates.push({
      id: match.id,
      home_team_id: nextHomeTeamId,
      away_team_id: nextAwayTeamId,
      sources_resolved_at: nextHomeTeamId || nextAwayTeamId ? params.now : match.sources_resolved_at,
    });
  }

  return updates;
}

export async function saveQualificationDrawSelections(
  params: SaveQualificationDrawSelectionsParams
): Promise<SaveQualificationDrawSelectionsResult> {
  const categoryCode = params.categoryCode.trim().toUpperCase();
  const now = new Date().toISOString();

  const [
    categoriesResult,
    qualificationRulesResult,
    groupsResult,
    membersResult,
    matchesResult,
    overridesResult,
  ] = await Promise.all([
    params.client
      .from('tournament_categories')
      .select('id, code')
      .eq('tournament_id', params.tournamentId)
      .is('deleted_at', null),
    params.client
      .from('tournament_qualification_rules')
      .select('category_id, best_third_placed_count, best_third_placed_method')
      .eq('tournament_id', params.tournamentId),
    params.client
      .from('tournament_groups')
      .select('id, category_id, code')
      .eq('tournament_id', params.tournamentId),
    params.client
      .from('tournament_group_members')
      .select('group_id, team_id, team:team_id(name, team_code)'),
    params.client
      .from('tournament_matches')
      .select(
        'id, category_id, group_id, home_team_id, away_team_id, home_source_type, home_source_ref, away_source_type, away_source_ref, regulation_home_score, regulation_away_score, status, winner_team_id, sources_resolved_at'
      )
      .eq('tournament_id', params.tournamentId)
      .is('deleted_at', null),
    params.client
      .from('tournament_standing_overrides')
      .select('group_id, team_id, override_rank'),
  ]);

  const queryError = [
    categoriesResult.error,
    qualificationRulesResult.error,
    groupsResult.error,
    membersResult.error,
    matchesResult.error,
    overridesResult.error,
  ].find(Boolean);

  if (queryError) {
    throw new Error(queryError.message);
  }

  const categories = (categoriesResult.data || []) as CategoryRow[];
  const category = categories.find((entry) => entry.code.trim().toUpperCase() === categoryCode);
  if (!category) {
    throw new Error(`Category ${categoryCode} not found`);
  }

  const qualificationRules = ((qualificationRulesResult.data || []) as QualificationRuleRow[])
    .filter((rule) => rule.category_id === category.id)
    .map((rule) => ({
      categoryId: rule.category_id,
      categoryCode: category.code,
      bestThirdPlacedCount: rule.best_third_placed_count,
      bestThirdPlacedMethod: rule.best_third_placed_method,
    }));
  const { configsByRef, configsByCategoryCode } = buildDrawSelectedConfigs(qualificationRules);
  const categoryConfigs = configsByCategoryCode.get(categoryCode) || [];

  if (categoryConfigs.length === 0) {
    throw new Error(`Match references draw reference ${categoryCode}-THIRD-DRAW-1 that has no configuration support`);
  }

  const groups = ((groupsResult.data || []) as GroupRow[]).filter((group) => group.category_id === category.id);
  const groupIds = new Set(groups.map((group) => group.id));
  const members = ((membersResult.data || []) as GroupMemberRow[]).filter(
    (member) => groupIds.has(member.group_id) && member.team_id
  );
  const matches = ((matchesResult.data || []) as TournamentMatchRow[]).filter(
    (match) => match.category_id === category.id
  );
  const overrides = ((overridesResult.data || []) as StandingOverrideRow[]).filter((override) =>
    groupIds.has(override.group_id)
  );
  const eligibleThirdPlaceTeams = computeEligibleThirdPlaceTeams({
    groups,
    members,
    matches,
    overrides,
  });

  const eligibleTeamIds = new Set(eligibleThirdPlaceTeams.map((team) => team.teamId));
  const assignmentErrors = validateDrawSelectedAssignments({
    categoryCode,
    configsByRef,
    configsByCategoryCode,
    assignments: params.assignments,
    eligibleTeamIds,
  });
  if (assignmentErrors.length > 0) {
    throw new Error(assignmentErrors[0]);
  }

  const currentActiveDrawsResult = await params.client
    .from('tournament_qualification_draws')
    .select('id, version')
    .eq('category_id', category.id)
    .eq('qualification_slot', GROUP_THIRD_PLACE_QUALIFICATION_SLOT)
    .is('superseded_at', null)
    .order('version', { ascending: false });

  if (currentActiveDrawsResult.error) {
    throw new Error(currentActiveDrawsResult.error.message);
  }

  const currentActiveDraws = (currentActiveDrawsResult.data || []) as ActiveDrawRow[];
  if (currentActiveDraws.length > 1) {
    throw new Error(`Multiple active qualification draws found for ${categoryCode}`);
  }

  const previousDraw = currentActiveDraws[0];
  if (previousDraw) {
    const { error: supersedeError } = await params.client
      .from('tournament_qualification_draws')
      .update({ superseded_at: now })
      .eq('id', previousDraw.id);
    if (supersedeError) {
      throw new Error(supersedeError.message);
    }
  }

  const { data: drawData, error: drawInsertError } = await params.client
    .from('tournament_qualification_draws')
    .insert({
      category_id: category.id,
      qualification_slot: GROUP_THIRD_PLACE_QUALIFICATION_SLOT,
      slots_available: categoryConfigs.length,
      version: (previousDraw?.version || 0) + 1,
      drawn_by: params.actorUserId || null,
      drawn_at: now,
      note: params.note || null,
    })
    .select('id, category_id, qualification_slot')
    .single();

  if (drawInsertError || !drawData) {
    throw new Error(drawInsertError?.message || 'Failed to create qualification draw');
  }

  const draw = drawData as TournamentQualificationDrawRow;
  const drawOrderByTeamId = new Map(
    params.assignments.map((assignment) => {
      const sourceRef = assignment.sourceRef.trim().toUpperCase();
      const config = configsByRef.get(sourceRef);
      return [assignment.teamId.trim(), config?.drawPosition || 0] as const;
    })
  );

  const candidateRows = eligibleThirdPlaceTeams.map((team) => ({
    draw_id: draw.id,
    team_id: team.teamId,
    group_id: team.groupId,
    is_selected: drawOrderByTeamId.has(team.teamId),
    draw_order: drawOrderByTeamId.get(team.teamId) || null,
  }));

  const { error: candidateInsertError } = await params.client
    .from('tournament_qualification_draw_candidates')
    .insert(candidateRows);
  if (candidateInsertError) {
    throw new Error(candidateInsertError.message);
  }

  const { teamIdsBySourceRef, errors: selectionErrors } = buildDrawSelectedSelectionMaps({
    configsByRef,
    activeDraws: [draw],
    candidates: candidateRows as TournamentQualificationDrawCandidateRow[],
  });
  if (selectionErrors.length > 0) {
    throw new Error(selectionErrors[0]);
  }

  const drawSourceRefs = new Set(categoryConfigs.map((config) => config.sourceRef));
  const impactedMatches = matches.filter(
    (match) =>
      (match.home_source_type === 'draw_selected' &&
        drawSourceRefs.has(String(match.home_source_ref || '').trim().toUpperCase())) ||
      (match.away_source_type === 'draw_selected' &&
        drawSourceRefs.has(String(match.away_source_ref || '').trim().toUpperCase()))
  );

  const updates = buildDrawSelectedMatchUpdates({
    matches: impactedMatches.map((match) => ({
      id: match.id,
      home_source_type: match.home_source_type,
      home_source_ref: match.home_source_ref,
      away_source_type: match.away_source_type,
      away_source_ref: match.away_source_ref,
      home_team_id: match.home_team_id,
      away_team_id: match.away_team_id,
      sources_resolved_at: match.sources_resolved_at || null,
    })),
    teamIdsBySourceRef,
    now,
  });

  const updatedMatchIds: string[] = [];
  for (const update of updates) {
    const { error: matchUpdateError } = await params.client
      .from('tournament_matches')
      .update({
        home_team_id: update.home_team_id,
        away_team_id: update.away_team_id,
        sources_resolved_at: update.sources_resolved_at,
        updated_by: params.actorUserId || null,
        updated_at: now,
      })
      .eq('id', update.id);
    if (matchUpdateError) {
      throw new Error(matchUpdateError.message);
    }
    updatedMatchIds.push(update.id);
  }

  return {
    drawId: draw.id,
    version: (previousDraw?.version || 0) + 1,
    updatedMatchIds,
    selectedSourceRefs: params.assignments.map((assignment) => assignment.sourceRef.trim().toUpperCase()),
  };
}
