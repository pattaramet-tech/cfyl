-- CFYL Database Schema for Supabase
-- Run this script to initialize the database

-- 1. Seasons table
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  year INT NOT NULL UNIQUE,
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('upcoming', 'active', 'completed')),
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- 2. Age Groups table
CREATE TABLE age_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  code TEXT NOT NULL, -- e.g. U12, U14, U16, U17, U18 (no fixed list — tournaments vary)
  name TEXT NOT NULL,
  sort_order INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(season_id, code)
);

-- 3. Divisions table
CREATE TABLE divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  age_group_id UUID NOT NULL REFERENCES age_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INT DEFAULT 1,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(season_id, age_group_id, name)
);

-- 4. Teams table
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  age_group_id UUID NOT NULL REFERENCES age_groups(id) ON DELETE CASCADE,
  division_id UUID REFERENCES divisions(id) ON DELETE CASCADE, -- nullable: tournament teams use tournament_groups instead
  name TEXT NOT NULL,
  short_name TEXT,
  logo_url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(season_id, age_group_id, division_id, name)
);

-- 5. Players table
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_code TEXT NOT NULL,
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  age_group_id UUID NOT NULL REFERENCES age_groups(id) ON DELETE CASCADE,
  division_id UUID REFERENCES divisions(id) ON DELETE CASCADE, -- nullable: tournament players (division-less teams)
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  shirt_no INT,
  full_name TEXT NOT NULL,
  birth_date DATE,
  remarks TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(season_id, player_code)
);

-- 6. Matches table
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_code TEXT NOT NULL,
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  age_group_id UUID NOT NULL REFERENCES age_groups(id) ON DELETE CASCADE,
  division_id UUID REFERENCES divisions(id) ON DELETE CASCADE, -- nullable: tournament group-stage matches
  matchday TEXT NOT NULL,
  match_no INT,
  match_date DATE NOT NULL,
  match_time TEXT,
  home_team_id UUID NOT NULL REFERENCES teams(id),
  away_team_id UUID NOT NULL REFERENCES teams(id),
  home_score INT,
  away_score INT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'finished', 'postponed', 'cancelled')),
  stage TEXT, -- nullable: null = league; group/round_of_16/quarter_final/semi_final/final/third_place
  tournament_group_id UUID REFERENCES tournament_groups(id) ON DELETE SET NULL, -- tournament group-stage matches
  venue TEXT,
  winner_team_id UUID REFERENCES teams(id) ON DELETE SET NULL, -- knockout penalty/draw decider
  note TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(season_id, match_code)
);

-- 7. Goals table (Top Scorers data)
-- NOTE: No unique constraint - supports multiple goal entries per player per match
-- Each row represents one goal event (goals column = count, usually 1)
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id),
  goals INT NOT NULL DEFAULT 1 COMMENT 'Number of goals scored in this event',
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- 8. Cards table (Discipline data)
CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id),
  card_type TEXT NOT NULL CHECK (card_type IN ('Yellow', 'Red')),
  unit INT DEFAULT 1,
  note TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  UNIQUE(match_id, player_id)
);

-- 9. Suspensions table (Ban records)
CREATE TABLE suspensions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES teams(id),
  source_match_id UUID REFERENCES matches(id),
  suspended_matches INT DEFAULT 1,
  suspended_from_matchday TEXT,
  discipline_points INT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'served', 'cancelled')),
  note TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Create Indexes for performance
CREATE INDEX idx_matches_season_age_div ON matches(season_id, age_group_id, division_id);
CREATE INDEX idx_matches_date ON matches(match_date);
CREATE INDEX idx_matches_matchday ON matches(season_id, matchday);
CREATE INDEX idx_players_season_team ON players(season_id, team_id);
CREATE INDEX idx_players_code ON players(player_code, season_id);
CREATE INDEX idx_goals_match ON goals(match_id);
CREATE INDEX idx_goals_player ON goals(player_id);
CREATE INDEX idx_cards_match ON cards(match_id);
CREATE INDEX idx_cards_player ON cards(player_id);
CREATE INDEX idx_suspensions_player ON suspensions(player_id, season_id);
CREATE INDEX idx_teams_season_division ON teams(season_id, division_id);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE age_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE suspensions ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access
CREATE POLICY "seasons are readable by all" ON seasons FOR SELECT USING (true);
CREATE POLICY "age_groups are readable by all" ON age_groups FOR SELECT USING (true);
CREATE POLICY "divisions are readable by all" ON divisions FOR SELECT USING (true);
CREATE POLICY "teams are readable by all" ON teams FOR SELECT USING (true);
CREATE POLICY "players are readable by all" ON players FOR SELECT USING (true);
CREATE POLICY "matches are readable by all" ON matches FOR SELECT USING (true);
CREATE POLICY "goals are readable by all" ON goals FOR SELECT USING (true);
CREATE POLICY "cards are readable by all" ON cards FOR SELECT USING (true);
CREATE POLICY "suspensions are readable by all" ON suspensions FOR SELECT USING (true);
