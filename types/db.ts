// Database types matching schema.sql

export interface Season {
  id: string;
  name: string;
  year: number;
  season_slug?: string | null;
  competition_type?: 'league' | 'tournament' | 'mixed';
  start_date: string | null;
  end_date: string | null;
  status: 'upcoming' | 'active' | 'completed';
  created_at: string;
  updated_at: string;
}

export interface AgeGroup {
  id: string;
  season_id: string;
  code: 'U14' | 'U17';
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Division {
  id: string;
  season_id: string;
  age_group_id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Team {
  id: string;
  season_id: string;
  age_group_id: string;
  division_id: string | null;
  name: string;
  short_name: string | null;
  logo_url: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Player {
  id: string;
  player_code: string;
  season_id: string;
  age_group_id: string;
  division_id: string | null;
  team_id: string;
  shirt_no: number | null;
  full_name: string;
  birth_date: string | null;
  remarks: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Match {
  id: string;
  match_code: string;
  season_id: string;
  age_group_id: string;
  division_id: string | null;
  matchday: string;
  match_no: number | null;
  match_date: string;
  match_time: string | null;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  status: 'scheduled' | 'finished' | 'postponed' | 'cancelled';
  stage?: string | null;
  tournament_group_id?: string | null;
  venue?: string | null;
  winner_team_id?: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnockoutRound {
  id: string;
  season_id: string;
  age_group_id: string;
  name: string;
  stage: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BracketMatch {
  id: string;
  season_id: string;
  age_group_id: string;
  round_id: string;
  match_id: string | null;
  bracket_position: number;
  home_source_type: string | null;
  home_source_ref: string | null;
  away_source_type: string | null;
  away_source_ref: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  winner_to_bracket_match_id: string | null;
  winner_to_slot: 'home' | 'away' | null;
  loser_to_bracket_match_id: string | null;
  loser_to_slot: 'home' | 'away' | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Goal {
  id: string;
  match_id: string;
  player_id: string;
  team_id: string;
  goals: number;
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: string;
  match_id: string;
  player_id: string;
  team_id: string;
  card_type: 'Yellow' | 'Red';
  unit: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Suspension {
  id: string;
  season_id: string;
  player_id: string;
  team_id: string;
  source_match_id: string | null;
  suspended_matches: number;
  suspended_from_matchday: string | null;
  discipline_points: number | null;
  status: 'pending' | 'served' | 'cancelled';
  note: string | null;
  created_at: string;
  updated_at: string;
}

// View types
export interface Standing {
  season_id: string;
  age_group_id: string;
  division_id: string;
  team_id: string;
  team_name: string;
  team_short_name?: string | null;
  team_logo_url?: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_diff: number;
  points: number;
}

export interface TopScorer {
  player_id: string;
  player_code: string;
  full_name: string;
  team_id: string;
  team_name: string;
  age_group: string;
  division: string;
  total_goals: number;
}

export interface DisciplineRecord {
  player_id: string;
  player_code: string;
  full_name: string;
  shirt_no: number | null;
  team_id: string;
  team_name: string;
  age_group: string;
  division: string;
  yellow_cards: number;
  red_cards: number;
  discipline_points: number;
  matches_banned: number;
}
