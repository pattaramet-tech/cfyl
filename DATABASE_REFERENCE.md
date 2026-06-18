# 🗄️ DATABASE_REFERENCE.md

Complete Database Schema Documentation

---

## 📐 Database Overview

**Database**: PostgreSQL (Supabase)  
**Tables**: 9  
**Total Records**: ~1,060  
**Status**: ✅ Production  

---

## 📊 Entity Relationship Diagram (Text)

```
seasons (1)
  ├─→ age_groups (1-to-many)
  │   ├─→ divisions (1-to-many)
  │   │   └─→ teams (1-to-many)
  │   │       └─→ players (1-to-many)
  │   │       └─→ matches (home_team_id, away_team_id FK)
  │   │           ├─→ goals (1-to-many)
  │   │           └─→ cards (1-to-many)
  │
  └─→ players → goals (player_id FK)
              → cards (player_id FK)
              → suspensions (player_id FK)

admin_profiles (FK auth.users)
```

---

## 📋 Table Details

### 1. `seasons`

**Purpose**: Define league seasons (e.g., CFYL 2026)

```
Column          Type        Constraint              Description
───────────────────────────────────────────────────────────────
id              UUID        PRIMARY KEY             Auto-generated
name            TEXT        UNIQUE NOT NULL         "CFYL 2026"
year            INT         UNIQUE NOT NULL         2026
start_date      DATE        NULL                    Season start
end_date        DATE        NULL                    Season end
status          TEXT        CHECK (status IN ...)   'upcoming' | 'active' | 'completed'
created_at      TIMESTAMP   DEFAULT now()          Record creation
updated_at      TIMESTAMP   DEFAULT now()          Last modification
```

**Indexes**:
- PRIMARY KEY (id)
- UNIQUE (year)
- UNIQUE (name)

**Example Record**:
```json
{
  "id": "e93c2eb6-e7a2-4b26-b946-5dbfc98d35c2",
  "name": "CFYL 2026",
  "year": 2026,
  "status": "active"
}
```

---

### 2. `age_groups`

**Purpose**: Define age categories (U14, U17)

```
Column          Type        Constraint              Description
───────────────────────────────────────────────────────────────
id              UUID        PRIMARY KEY             Auto-generated
season_id       UUID        FK(seasons)             Parent season
code            TEXT        CHECK (IN 'U14','U17')  Age code
name            TEXT        NOT NULL                "รุ่นอายุไม่เกิน 14 ปี"
sort_order      INT         DEFAULT 1               Display order
created_at      TIMESTAMP   DEFAULT now()          Record creation

Constraints:
- UNIQUE(season_id, code)
- ON DELETE CASCADE
```

**Indexes**:
- PRIMARY KEY (id)
- FOREIGN KEY (season_id)
- UNIQUE (season_id, code)

**Example Record**:
```json
{
  "id": "uuid-1",
  "season_id": "uuid-season",
  "code": "U14",
  "name": "รุ่นอายุไม่เกิน 14 ปี",
  "sort_order": 1
}
```

**Related Records**: 2 (U14, U17)

---

### 3. `divisions`

**Purpose**: Define league divisions within age groups (ดิวิชั่น 1-5)

```
Column          Type        Constraint              Description
───────────────────────────────────────────────────────────────
id              UUID        PRIMARY KEY             Auto-generated
season_id       UUID        FK(seasons)             Parent season
age_group_id    UUID        FK(age_groups)          Parent age group
name            TEXT        NOT NULL                "ดิวิชั่น 1"
sort_order      INT         DEFAULT 1               Display order
created_at      TIMESTAMP   DEFAULT now()          Record creation

Constraints:
- UNIQUE(season_id, age_group_id, name)
- ON DELETE CASCADE
```

**Indexes**:
- PRIMARY KEY (id)
- FOREIGN KEY (season_id)
- FOREIGN KEY (age_group_id)
- UNIQUE (season_id, age_group_id, name)

**Related Records**: 10 divisions

---

### 4. `teams`

**Purpose**: Teams competing in divisions

```
Column          Type        Constraint              Description
───────────────────────────────────────────────────────────────
id              UUID        PRIMARY KEY             Auto-generated
season_id       UUID        FK(seasons)             Parent season
age_group_id    UUID        FK(age_groups)          Parent age group
division_id     UUID        FK(divisions)           Parent division
name            TEXT        NOT NULL                "รร.หัวถนนวิทยา"
short_name      TEXT        NULL                    Abbreviated name
logo_url        TEXT        NULL                    Team logo URL
active          BOOLEAN     DEFAULT true            Active flag
created_at      TIMESTAMP   DEFAULT now()          Record creation
updated_at      TIMESTAMP   DEFAULT now()          Last modification

Constraints:
- UNIQUE(season_id, age_group_id, division_id, name)
- ON DELETE CASCADE
```

**Indexes**:
- PRIMARY KEY (id)
- FOREIGN KEY (season_id, age_group_id, division_id)
- UNIQUE (season_id, age_group_id, division_id, name)

**Related Records**: 32 teams

---

### 5. `players`

**Purpose**: Player roster

```
Column          Type        Constraint              Description
───────────────────────────────────────────────────────────────
id              UUID        PRIMARY KEY             Auto-generated
player_code     TEXT        NOT NULL                Original player ID
season_id       UUID        FK(seasons)             Parent season
age_group_id    UUID        FK(age_groups)          Parent age group
division_id     UUID        FK(divisions)           Parent division
team_id         UUID        FK(teams)               Player's team
shirt_no        INT         NULL                    Jersey number
full_name       TEXT        NOT NULL                Player name
birth_date      DATE        NULL                    Date of birth
remarks         TEXT        NULL                    Notes
active          BOOLEAN     DEFAULT true           Active flag
created_at      TIMESTAMP   DEFAULT now()          Record creation
updated_at      TIMESTAMP   DEFAULT now()          Last modification

Constraints:
- UNIQUE(season_id, player_code)
- ON DELETE CASCADE
```

**Indexes**:
- PRIMARY KEY (id)
- FOREIGN KEY (season_id, team_id, division_id, age_group_id)
- UNIQUE (season_id, player_code)

**Related Records**: 668 players

---

### 6. `matches`

**Purpose**: Match schedule and results

```
Column          Type        Constraint              Description
───────────────────────────────────────────────────────────────
id              UUID        PRIMARY KEY             Auto-generated
match_code      TEXT        NOT NULL                Original match ID
season_id       UUID        FK(seasons)             Parent season
age_group_id    UUID        FK(age_groups)          Parent age group
division_id     UUID        FK(divisions)           Parent division
matchday        TEXT        NOT NULL                "Match Day 1"
match_no        INT         NULL                    Match number
match_date      DATE        NOT NULL                Date of match
match_time      TEXT        NULL                    "18:00" format
home_team_id    UUID        FK(teams)               Home team
away_team_id    UUID        FK(teams)               Away team
home_score      INT         NULL                    Home goals (0-99)
away_score      INT         NULL                    Away goals (0-99)
status          TEXT        NOT NULL DEFAULT ...   'scheduled'|'finished'|'postponed'|'cancelled'
note            TEXT        NULL                   Notes
created_at      TIMESTAMP   DEFAULT now()          Record creation
updated_at      TIMESTAMP   DEFAULT now()          Last modification

Constraints:
- UNIQUE(season_id, match_code)
- ON DELETE CASCADE
```

**Indexes**:
- PRIMARY KEY (id)
- FOREIGN KEY (season_id, age_group_id, division_id, home_team_id, away_team_id)
- UNIQUE (season_id, match_code)

**Related Records**: 224 matches

**Example Record**:
```json
{
  "match_code": "M001",
  "matchday": "Match Day 1",
  "match_date": "2026-06-13",
  "match_time": "09:00",
  "home_score": 0,
  "away_score": 1,
  "status": "finished"
}
```

---

### 7. `goals`

**Purpose**: Goal scorers per match

```
Column          Type        Constraint              Description
───────────────────────────────────────────────────────────────
id              UUID        PRIMARY KEY             Auto-generated
match_id        UUID        FK(matches)             Which match
player_id       UUID        FK(players)             Player who scored
team_id         UUID        FK(teams)               Team
goals           INT         NOT NULL DEFAULT 1      Number of goals
created_at      TIMESTAMP   DEFAULT now()          Record creation
updated_at      TIMESTAMP   DEFAULT now()          Last modification

Constraints:
- UNIQUE(match_id, player_id)
- ON DELETE CASCADE
```

**Indexes**:
- PRIMARY KEY (id)
- FOREIGN KEY (match_id, player_id, team_id)
- UNIQUE (match_id, player_id)

**Related Records**: 89 goals

**Example Record**:
```json
{
  "match_id": "uuid-match",
  "player_id": "uuid-player",
  "team_id": "uuid-team",
  "goals": 2
}
```

---

### 8. `cards`

**Purpose**: Yellow/red cards per match

```
Column          Type        Constraint              Description
───────────────────────────────────────────────────────────────
id              UUID        PRIMARY KEY             Auto-generated
match_id        UUID        FK(matches)             Which match
player_id       UUID        FK(players)             Player who got card
team_id         UUID        FK(teams)               Team
card_type       TEXT        CHECK (IN ...)          'Yellow' | 'Red'
unit            INT         NOT NULL DEFAULT 1      Card count
note            TEXT        NULL                    Notes
created_at      TIMESTAMP   DEFAULT now()          Record creation
updated_at      TIMESTAMP   DEFAULT now()          Last modification

Constraints:
- UNIQUE(match_id, player_id)
- ON DELETE CASCADE
```

**Indexes**:
- PRIMARY KEY (id)
- FOREIGN KEY (match_id, player_id, team_id)
- UNIQUE (match_id, player_id)

**Related Records**: 38 cards

---

### 9. `suspensions`

**Purpose**: Player bans/suspensions

```
Column          Type        Constraint              Description
───────────────────────────────────────────────────────────────
id              UUID        PRIMARY KEY             Auto-generated
season_id       UUID        FK(seasons)             Which season
player_id       UUID        FK(players)             Suspended player
team_id         UUID        FK(teams)               Team
source_match_id UUID        FK(matches) NULL       Which match triggered ban
suspended_matches INT        NOT NULL               Matches to sit out
suspended_from_matchday TEXT NULL                  Which matchday
discipline_points INT        NULL                   Total discipline points
status          TEXT        NOT NULL               'pending'|'served'|'cancelled'
note            TEXT        NULL                   Notes
created_at      TIMESTAMP   DEFAULT now()          Record creation
updated_at      TIMESTAMP   DEFAULT now()          Last modification

Constraints:
- ON DELETE CASCADE
```

**Indexes**:
- PRIMARY KEY (id)
- FOREIGN KEY (season_id, player_id, team_id, source_match_id)

**Related Records**: 0 (Phase 3 feature)

---

### 10. `admin_profiles`

**Purpose**: Admin user permissions (tied to Supabase Auth)

```
Column          Type        Constraint              Description
───────────────────────────────────────────────────────────────
id              UUID        PRIMARY KEY             FK(auth.users)
email           TEXT        NOT NULL UNIQUE         Admin email
full_name       TEXT        NULL                    Display name
role            TEXT        NOT NULL DEFAULT ...   'admin' | 'superadmin'
can_edit_matches BOOLEAN     DEFAULT true           Permission flag
can_edit_goals  BOOLEAN     DEFAULT true           Permission flag
can_edit_cards  BOOLEAN     DEFAULT true           Permission flag
active          BOOLEAN     DEFAULT true           Account active
created_at      TIMESTAMP   DEFAULT now()          Record creation
updated_at      TIMESTAMP   DEFAULT now()          Last modification

Constraints:
- ON DELETE CASCADE (when auth user deleted)
- UNIQUE(email)
```

**Indexes**:
- PRIMARY KEY (id)
- UNIQUE (email)
- INDEX (active)
- INDEX (role)

**Related Records**: 0 (Setup pending)

---

## 🔐 Row Level Security (RLS) Policies

### Public Tables (SELECT only)

#### seasons
```sql
-- Anyone can read seasons
CREATE POLICY "Public can read seasons" ON seasons FOR SELECT USING (true);
```

#### age_groups, divisions, teams, players, matches
```sql
-- Anyone can read these tables (public API)
CREATE POLICY "Public can read" ON [table] FOR SELECT USING (true);
```

#### goals, cards
```sql
-- Anyone can read (for public standings, scorers, discipline)
CREATE POLICY "Public can read goals/cards" ON [table] FOR SELECT USING (true);
```

### Admin Tables (All operations verified)

#### matches (UPDATE only)
```sql
CREATE POLICY "Admin can update match scores"
  ON matches FOR UPDATE
  USING (auth.uid() IN (SELECT id FROM admin_profiles WHERE active = true))
  WITH CHECK (auth.uid() IN (SELECT id FROM admin_profiles WHERE active = true));
```

#### goals (INSERT, UPDATE, DELETE)
```sql
CREATE POLICY "Admin can insert goals"
  ON goals FOR INSERT
  WITH CHECK (auth.uid() IN (SELECT id FROM admin_profiles WHERE can_edit_goals = true));

CREATE POLICY "Admin can update goals"
  ON goals FOR UPDATE
  USING (auth.uid() IN (SELECT id FROM admin_profiles WHERE can_edit_goals = true));

CREATE POLICY "Admin can delete goals"
  ON goals FOR DELETE
  USING (auth.uid() IN (SELECT id FROM admin_profiles WHERE can_edit_goals = true));
```

#### cards (same as goals)
```sql
-- Similar policies for can_edit_cards permission
```

#### admin_profiles (SELECT own profile)
```sql
CREATE POLICY "Admins can read own profile"
  ON admin_profiles FOR SELECT
  USING (auth.uid() = id);
```

---

## 📈 Data Statistics

| Table | Count | Growth | Status |
|-------|-------|--------|--------|
| seasons | 1 | - | ✅ |
| age_groups | 2 | - | ✅ |
| divisions | 10 | - | ✅ |
| teams | 32 | - | ✅ |
| players | 668 | - | ✅ |
| matches | 224 | - | ✅ |
| goals | 89 | - | ✅ |
| cards | 38 | - | ✅ |
| suspensions | 0 | - | ⚪ (Phase 3) |
| admin_profiles | 0 | - | ⚪ (Setup needed) |

**Total Records**: ~1,063

---

## 🔄 Relationships Summary

| From | To | Type | FK Column |
|------|----|----|-----------|
| seasons | age_groups | 1-many | season_id |
| age_groups | divisions | 1-many | age_group_id |
| divisions | teams | 1-many | division_id |
| teams | players | 1-many | team_id |
| matches | goals | 1-many | match_id |
| matches | cards | 1-many | match_id |
| players | goals | 1-many | player_id |
| players | cards | 1-many | player_id |
| players | suspensions | 1-many | player_id |
| matches | suspensions | 0-many | source_match_id |

---

## 🔍 Unique Constraints

```
seasons:        UNIQUE(year), UNIQUE(name)
age_groups:     UNIQUE(season_id, code)
divisions:      UNIQUE(season_id, age_group_id, name)
teams:          UNIQUE(season_id, age_group_id, division_id, name)
players:        UNIQUE(season_id, player_code)
matches:        UNIQUE(season_id, match_code)
goals:          UNIQUE(match_id, player_id)
cards:          UNIQUE(match_id, player_id)
admin_profiles: UNIQUE(email)
```

---

## 📝 Data Type Reference

| Type | Description | Examples |
|------|-------------|----------|
| UUID | Universally Unique Identifier | e93c2eb6-e7a2-4b26-b946-5dbfc98d35c2 |
| TEXT | String (unlimited) | "รร.หัวถนนวิทยา" |
| INT | Integer | 224, 668 |
| DATE | Date only (YYYY-MM-DD) | 2026-06-13 |
| TIMESTAMP | Date + Time | 2026-06-18 12:30:45 |
| BOOLEAN | True/False | true, false |

---

## ✅ Constraints Checklist

- [x] All foreign keys set to ON DELETE CASCADE
- [x] RLS policies enforced on all tables
- [x] UNIQUE constraints prevent duplicates
- [x] NOT NULL on required fields
- [x] DEFAULT values for timestamps
- [x] CHECK constraints on enum fields

---

## 🔄 Backup & Recovery

**Backup Strategy**: Supabase automatic (daily)  
**Restore**: Use Supabase console or restore from backup

**Critical Tables**:
- seasons (1 record)
- matches (224 records)
- players (668 records)

**Recreate Order**:
1. seasons
2. age_groups
3. divisions
4. teams
5. players
6. matches
7. goals
8. cards

---

## 📖 Query Examples

### Get all matches for a season
```sql
SELECT * FROM matches
WHERE season_id = 'uuid-season'
ORDER BY match_date, match_time;
```

### Get top scorers in a division
```sql
SELECT p.full_name, p.shirt_no, t.name, SUM(g.goals) as total_goals
FROM goals g
JOIN players p ON g.player_id = p.id
JOIN teams t ON g.team_id = t.id
WHERE p.division_id = 'uuid-division'
GROUP BY p.id, p.full_name, p.shirt_no, t.name
ORDER BY total_goals DESC;
```

### Get player cards and suspensions
```sql
SELECT c.card_type, c.created_at
FROM cards c
WHERE c.player_id = 'uuid-player'
ORDER BY c.created_at DESC;
```

