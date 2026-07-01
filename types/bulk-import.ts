// Bulk Import/Export Types

export interface BulkImportSheet {
  name: 'Matches' | 'Goals' | 'Cards' | 'StaffDiscipline' | 'PlayerUpdates';
  rows: Record<string, any>[];
}

export interface BulkImportRowResult {
  sheet: string;
  rowNumber: number;
  status: 'valid' | 'warning' | 'error';
  action:
    | 'update_match'
    | 'insert_goal'
    | 'insert_card'
    | 'insert_staff_discipline'
    | 'update_player';
  message: string;
  resolved?: Record<string, any>;
  raw?: Record<string, any>;
}

export interface BulkImportPreviewResponse {
  success: boolean;
  summary: {
    matches: number;
    goals: number;
    cards: number;
    staffDiscipline: number;
    playerUpdates: number;
    errors: number;
    warnings: number;
  };
  rows: BulkImportRowResult[];
  canApply: boolean;
  importToken?: string;
}

export interface BulkImportApplyResponse {
  success: boolean;
  message: string;
  summary: {
    matchesUpdated: number;
    goalsInserted: number;
    cardsInserted: number;
    staffDisciplineInserted: number;
    playersUpdated: number;
    affectedPlayersForSuspension: string[];
  };
  errors: Array<{
    sheet: string;
    rowNumber: number;
    message: string;
  }>;
  batchId?: string;
  batchNo?: string;
  logWarning?: string;
}

// Reference Data for Template

export interface TeamRef {
  team_id: string;
  team_name: string;
  short_name: string | null;
  age_group: string | null;
  division: string | null;
}

export interface PlayerRef {
  player_id: string;
  team_id: string;
  team_name: string;
  short_name: string | null;
  shirt_no: number | null;
  full_name: string;
  active: boolean;
}

export interface StaffRef {
  staff_id: string;
  team_id: string;
  team_name: string;
  short_name: string | null;
  staff_name: string;
  position: string;
  active: boolean;
}

export interface MatchRef {
  match_id: string;
  matchday: string | number;
  match_date: string;
  match_time: string | null;
  division: string | null;
  home_team: string;
  away_team: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
}

// Row data structures

export interface MatchesRow {
  match_id: string;
  matchday?: string;
  match_date?: string;
  match_time?: string;
  home_team?: string;
  away_team?: string;
  home_score?: number;
  away_score?: number;
  status?: string;
  note?: string;
}

export interface GoalsRow {
  match_id?: string;
  matchday?: string;
  team?: string;
  shirt_no?: number;
  player_name?: string;
  goals?: number;
  minute?: number;
  note?: string;
}

export interface CardsRow {
  match_id?: string;
  matchday?: string;
  team?: string;
  shirt_no?: number;
  player_name?: string;
  card_type?: string;
  minute?: number;
  count?: number;
  reason?: string;
  note?: string;
}

export interface StaffDisciplineRow {
  match_id?: string;
  matchday?: string;
  team?: string;
  staff_name?: string;
  position?: string;
  discipline_type?: string;
  minute?: number;
  reason?: string;
  suspended_matches?: number;
  note?: string;
}

export interface PlayerUpdatesRow {
  player_id?: string;
  team?: string;
  shirt_no?: number;
  old_full_name?: string;
  new_prefix?: string;
  new_full_name?: string;
  new_shirt_no?: number;
  active?: boolean;
  note?: string;
}

// Batch Logging Types

export interface MatchBulkImportBatch {
  id: string;
  batch_no: string;
  file_name?: string | null;
  import_mode: 'append_only' | 'replace' | 'update_existing';
  season_id: string;
  age_group_id: string;
  division_id?: string | null;
  status: 'success' | 'partial' | 'failed';
  summary: Record<string, any>;
  warnings_count: number;
  errors_count: number;
  matches_updated: number;
  goals_inserted: number;
  cards_inserted: number;
  staff_discipline_inserted: number;
  players_updated: number;
  suspensions_recalculated: number;
  affected_match_ids: string[];
  affected_player_ids: string[];
  affected_team_ids: string[];
  created_by?: string | null;
  created_by_email?: string | null;
  created_at: string;
  season?: { name: string } | null;
  age_group?: { name: string } | null;
  division?: { name: string } | null;
}

export interface MatchBulkImportBatchRow {
  id: string;
  batch_id: string;
  sheet_name: string;
  row_number?: number | null;
  action: string;
  status: 'success' | 'warning' | 'failed' | 'skipped';
  message?: string | null;
  raw_data: Record<string, any>;
  resolved_data: Record<string, any>;
  error?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  match_id?: string | null;
  player_id?: string | null;
  team_id?: string | null;
  created_at: string;
}
