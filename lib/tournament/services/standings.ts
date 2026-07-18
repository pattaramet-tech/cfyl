import { getTournamentServiceClient } from '@/lib/tournament/db/supabase-tournament';
import { calculateGroupStandings, type CalculateGroupStandingsParams, type StandingOverrideInput, type TeamInput } from '@/lib/tournament/standings/calculateGroupStandings';
import type { RawCardRow } from '@/lib/tournament/standings/calculateFairPlayScore';
import {
  extractEligibleThirdPlaceCandidates,
  identifyG16ThirdPlaceCandidates,
  rankBestThirdPlacedTeams,
} from '@/lib/tournament/standings/rankCrossGroupCandidates';
import type { BestThirdPlacedRankingResult, G16ThirdPlaceCandidatesResult, GroupStandingsResult, OfficialMatchResult } from '@/lib/tournament/standings/types';

// Data-loading layer for the Tournament V2 Standings Engine. This module is
// the ONLY place that queries Supabase for standings input — it enforces the
// "official results only" filter and then hands plain data to the pure
// calculation functions in lib/tournament/standings/*. It never reads
// tournament_result_submissions (Quick Result / Full Report payloads); it
// reads scores exclusively from tournament_matches' own columns, and only
// for rows where status='finished' AND result_workflow_status='published'.

type TournamentClient = ReturnType<typeof getTournamentServiceClient>;

interface CategoryRow {
  id: string;
  code: string;
}

interface GroupRow {
  id: string;
  category_id: string;
  code: string;
  name: string;
}

interface GroupMemberRow {
  group_id: string;
  team_id: string | null;
}

interface TeamRow {
  id: string;
  category_id: string;
  team_code: string;
  name: string;
}

interface MatchRow {
  id: string;
  group_id: string | null;
  category_id: string;
  home_team_id: string | null;
  away_team_id: string | null;
  regulation_home_score: number | null;
  regulation_away_score: number | null;
  winner_team_id: string | null;
  decided_by: 'regulation' | 'penalty' | null;
  status: string;
  result_workflow_status: string;
  deleted_at: string | null;
}

interface CardRow {
  match_id: string;
  player_id: string;
  team_id: string;
  card_type: 'yellow' | 'red' | 'second_yellow';
}

interface QualificationRuleRow {
  category_id: string;
  qualify_rank_per_group: number;
  best_third_placed_count: number;
  best_third_placed_method: 'ranked' | 'draw';
  cross_group_comparison: boolean;
}

interface StandingOverrideRow {
  group_id: string;
  team_id: string;
  override_rank: number;
  reason: string;
}

/** Official-result eligibility, applied at the query layer: only matches
 * that are finished AND have a published result may affect Standings. This
 * naturally excludes cancelled/abandoned/postponed/bye/void/in_progress
 * matches (none of those are 'finished'), soft-deleted matches, and any
 * match still in draft/previewed/submitted/correction workflow state — a
 * Quick Result submission alone never sets result_workflow_status. */
function isOfficialMatch(match: MatchRow): match is MatchRow & { home_team_id: string; away_team_id: string; regulation_home_score: number; regulation_away_score: number; winner_team_id: string; decided_by: 'regulation' | 'penalty' } {
  return (
    match.status === 'finished' &&
    match.result_workflow_status === 'published' &&
    match.deleted_at === null &&
    !!match.home_team_id &&
    !!match.away_team_id &&
    match.regulation_home_score !== null &&
    match.regulation_away_score !== null &&
    !!match.winner_team_id &&
    !!match.decided_by
  );
}

async function loadCategoryContext(params: { client: TournamentClient; tournamentId: string; categoryCode: string }) {
  const categoryCode = params.categoryCode.trim().toUpperCase();

  const [categoriesResult, groupsResult, qualificationRulesResult, teamsResult] = await Promise.all([
    params.client.from('tournament_categories').select('id, code').eq('tournament_id', params.tournamentId).is('deleted_at', null),
    params.client.from('tournament_groups').select('id, category_id, code, name').eq('tournament_id', params.tournamentId),
    params.client
      .from('tournament_qualification_rules')
      .select('category_id, qualify_rank_per_group, best_third_placed_count, best_third_placed_method, cross_group_comparison')
      .eq('tournament_id', params.tournamentId),
    params.client.from('tournament_teams').select('id, category_id, team_code, name').eq('tournament_id', params.tournamentId).is('deleted_at', null),
  ]);

  const queryError = [categoriesResult.error, groupsResult.error, qualificationRulesResult.error, teamsResult.error].find(Boolean);
  if (queryError) throw new Error(queryError.message);

  const categories = (categoriesResult.data || []) as CategoryRow[];
  const category = categories.find((entry) => entry.code.trim().toUpperCase() === categoryCode);
  if (!category) throw new Error(`Category ${categoryCode} not found`);

  const groups = ((groupsResult.data || []) as GroupRow[]).filter((g) => g.category_id === category.id);
  const qualificationRule = ((qualificationRulesResult.data || []) as QualificationRuleRow[]).find(
    (r) => r.category_id === category.id
  ) || {
    category_id: category.id,
    qualify_rank_per_group: 2,
    best_third_placed_count: 0,
    best_third_placed_method: 'ranked' as const,
    cross_group_comparison: false,
  };
  const teams = ((teamsResult.data || []) as TeamRow[]).filter((t) => t.category_id === category.id);

  return { category, groups, qualificationRule, teams };
}

async function loadGroupMatchesAndCards(params: { client: TournamentClient; tournamentId: string; groupIds: string[] }) {
  if (params.groupIds.length === 0) {
    return { officialMatchesByGroup: new Map<string, OfficialMatchResult[]>(), cardsByGroup: new Map<string, RawCardRow[]>() };
  }

  const matchesResult = await params.client
    .from('tournament_matches')
    .select('id, group_id, category_id, home_team_id, away_team_id, regulation_home_score, regulation_away_score, winner_team_id, decided_by, status, result_workflow_status, deleted_at')
    .in('group_id', params.groupIds);
  if (matchesResult.error) throw new Error(matchesResult.error.message);

  const allMatches = (matchesResult.data || []) as MatchRow[];
  const officialMatches = allMatches.filter(isOfficialMatch);
  const officialMatchIds = officialMatches.map((m) => m.id);

  let cards: CardRow[] = [];
  if (officialMatchIds.length > 0) {
    const cardsResult = await params.client
      .from('tournament_match_cards')
      .select('match_id, player_id, team_id, card_type')
      .in('match_id', officialMatchIds);
    if (cardsResult.error) throw new Error(cardsResult.error.message);
    cards = (cardsResult.data || []) as CardRow[];
  }

  const officialMatchesByGroup = new Map<string, OfficialMatchResult[]>();
  for (const match of officialMatches) {
    if (!match.group_id) continue;
    const list = officialMatchesByGroup.get(match.group_id) || [];
    list.push({
      matchId: match.id,
      groupId: match.group_id,
      categoryId: match.category_id,
      homeTeamId: match.home_team_id,
      awayTeamId: match.away_team_id,
      regulationHomeScore: match.regulation_home_score,
      regulationAwayScore: match.regulation_away_score,
      winnerTeamId: match.winner_team_id,
      decidedBy: match.decided_by,
    });
    officialMatchesByGroup.set(match.group_id, list);
  }

  const cardsByGroup = new Map<string, RawCardRow[]>();
  const groupIdByMatchId = new Map(officialMatches.map((m) => [m.id, m.group_id as string]));
  for (const card of cards) {
    const groupId = groupIdByMatchId.get(card.match_id);
    if (!groupId) continue;
    const list = cardsByGroup.get(groupId) || [];
    list.push({ matchId: card.match_id, playerId: card.player_id, teamId: card.team_id, cardType: card.card_type });
    cardsByGroup.set(groupId, list);
  }

  return { officialMatchesByGroup, cardsByGroup };
}

async function loadOverridesByGroup(params: { client: TournamentClient; groupIds: string[] }) {
  const overridesByGroup = new Map<string, StandingOverrideInput[]>();
  if (params.groupIds.length === 0) return overridesByGroup;

  const overridesResult = await params.client
    .from('tournament_standing_overrides')
    .select('group_id, team_id, override_rank, reason')
    .in('group_id', params.groupIds);
  if (overridesResult.error) throw new Error(overridesResult.error.message);

  for (const row of (overridesResult.data || []) as StandingOverrideRow[]) {
    const list = overridesByGroup.get(row.group_id) || [];
    list.push({ teamId: row.team_id, overrideRank: row.override_rank, reason: row.reason });
    overridesByGroup.set(row.group_id, list);
  }
  return overridesByGroup;
}

export interface CategoryStandingsResult {
  categoryId: string;
  categoryCode: string;
  groups: GroupStandingsResult[];
  qualifyRankPerGroup: number;
  bestThirdPlacedCount: number;
  bestThirdPlacedMethod: 'ranked' | 'draw';
}

/**
 * Loads and computes standings for every group in a category, using only
 * official published match results. Pure calculation happens in
 * calculateGroupStandings — this function is solely responsible for
 * fetching and shaping the DB rows it needs.
 */
export async function getCategoryStandings(params: {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
}): Promise<CategoryStandingsResult> {
  const { category, groups, qualificationRule, teams } = await loadCategoryContext(params);
  const groupIds = groups.map((g) => g.id);

  const [{ officialMatchesByGroup, cardsByGroup }, overridesByGroup, groupMembersResult] = await Promise.all([
    loadGroupMatchesAndCards({ client: params.client, tournamentId: params.tournamentId, groupIds }),
    loadOverridesByGroup({ client: params.client, groupIds }),
    params.client.from('tournament_group_members').select('group_id, team_id').in('group_id', groupIds.length > 0 ? groupIds : ['00000000-0000-0000-0000-000000000000']),
  ]);
  if (groupMembersResult.error) throw new Error(groupMembersResult.error.message);

  const teamsById = new Map(teams.map((t) => [t.id, t]));
  const teamIdsByGroup = new Map<string, string[]>();
  for (const member of (groupMembersResult.data || []) as GroupMemberRow[]) {
    if (!member.team_id) continue;
    const list = teamIdsByGroup.get(member.group_id) || [];
    list.push(member.team_id);
    teamIdsByGroup.set(member.group_id, list);
  }

  const bestThirdPlacedEligible = qualificationRule.best_third_placed_count > 0;

  const groupResults: GroupStandingsResult[] = groups.map((group) => {
    const groupTeamIds = teamIdsByGroup.get(group.id) || [];
    const teamInputs: TeamInput[] = groupTeamIds
      .map((teamId) => teamsById.get(teamId))
      .filter((t): t is TeamRow => !!t)
      .map((t) => ({ teamId: t.id, teamName: t.name, teamCode: t.team_code }));

    const calcParams: CalculateGroupStandingsParams = {
      groupId: group.id,
      groupCode: group.code,
      teams: teamInputs,
      matches: officialMatchesByGroup.get(group.id) || [],
      cardRows: cardsByGroup.get(group.id) || [],
      overrides: overridesByGroup.get(group.id) || [],
      qualifyRankPerGroup: qualificationRule.qualify_rank_per_group,
      bestThirdPlacedEligible,
    };
    return calculateGroupStandings(calcParams);
  });

  return {
    categoryId: category.id,
    categoryCode: category.code,
    groups: groupResults,
    qualifyRankPerGroup: qualificationRule.qualify_rank_per_group,
    bestThirdPlacedCount: qualificationRule.best_third_placed_count,
    bestThirdPlacedMethod: qualificationRule.best_third_placed_method,
  };
}

export async function getGroupStandings(params: {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
  groupCode: string;
}): Promise<GroupStandingsResult> {
  const categoryStandings = await getCategoryStandings(params);
  const group = categoryStandings.groups.find((g) => g.groupCode.trim().toUpperCase() === params.groupCode.trim().toUpperCase());
  if (!group) throw new Error(`Group ${params.groupCode} not found in category ${params.categoryCode}`);
  return group;
}

/** D-07 'ranked' method — general best-third-place ranking. Throws if the
 * category's qualification rule is not 'ranked' (use the G-U16 function
 * below for 'draw' method categories instead). */
export async function getBestThirdPlacedRanking(params: {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
}): Promise<BestThirdPlacedRankingResult & { isComplete: boolean; incompleteReason: string | null }> {
  const categoryStandings = await getCategoryStandings(params);
  if (categoryStandings.bestThirdPlacedMethod !== 'ranked') {
    throw new Error(`Category ${params.categoryCode} does not use the 'ranked' best-third-place method`);
  }
  const { candidates, isComplete, incompleteReason } = extractEligibleThirdPlaceCandidates(categoryStandings.groups);
  if (!isComplete) {
    return {
      ranked: [],
      state: 'incomplete',
      fullyResolved: false,
      explanation: incompleteReason || 'ผลการแข่งขันยังไม่ครบ',
      isComplete,
      incompleteReason,
    };
  }
  const ranking = rankBestThirdPlacedTeams(candidates);
  return { ...ranking, isComplete, incompleteReason: null };
}

export const G16_INCOMPLETE_MESSAGE = 'ยังไม่สามารถระบุทีมอันดับ 3 ได้ เนื่องจากผลการแข่งขันยังไม่ครบหรือยังไม่เผยแพร่';

/** D-29 G-U16 override — identifies exactly the pool of eligible third-place
 * candidates for the physical paper draw. NEVER selects among them. */
export async function getG16ThirdPlaceCandidates(params: {
  client: TournamentClient;
  tournamentId: string;
  categoryCode: string;
}): Promise<G16ThirdPlaceCandidatesResult> {
  const categoryStandings = await getCategoryStandings(params);
  if (categoryStandings.bestThirdPlacedMethod !== 'draw') {
    throw new Error(`Category ${params.categoryCode} does not use the 'draw' best-third-place method`);
  }
  const result = identifyG16ThirdPlaceCandidates(categoryStandings.groups);
  if (!result.isComplete) {
    return { ...result, incompleteReason: G16_INCOMPLETE_MESSAGE };
  }
  return result;
}
