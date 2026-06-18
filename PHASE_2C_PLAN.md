# 📋 Phase 2c Implementation Plan

## ✅ Pre-Implementation Checklist

- [ ] Migration run in Supabase: `scripts/migration-remove-goals-unique.sql`
- [ ] Build locally: `npm run build` (should pass)
- [ ] No Phase 2b breaks (match editing still works)
- [ ] Database: unique constraint removed from goals

---

## 📂 Files to Create

### Pages (1 file)
```
app/admin/goals/page.tsx
├── Match selector (season → age group → division → match)
├── Goals list table (current goals in selected match)
├── Add goal form (player dropdown + count)
├── Edit/Delete buttons per goal row
└── Uses /api/admin/goals for CRUD
```

### Components (3 files)
```
components/PlayerSelector.tsx
├── Dropdown with search
├── Filter by: home_team_id OR away_team_id
├── Show: full_name + shirt_no (jersey #)
└── Return: player.id

components/GoalsList.tsx
├── Table: player name | team | goals | actions
├── Edit button → opens form
├── Delete button → confirm → calls API
└── Refresh after each operation

components/GoalForm.tsx
├── Player selector dropdown
├── Count input (1-10)
├── Save button
├── Error/Success messages
└── Reset on save
```

### API Routes (2 files)
```
app/api/admin/goals/route.ts
├── POST: Create goal
├── GET: List goals for match (optional)
├── Auth: JWT + can_edit_goals
└── Body: { match_id, player_id, goals }

app/api/admin/goals/[goalId]/route.ts
├── PUT: Update goal count
├── DELETE: Remove goal
├── Auth: JWT + can_edit_goals
└── Params: goalId (UUID)
```

### Modified Files (2 files)
```
app/admin/layout.tsx
├── Add "Goal Management" nav link → /admin/goals

ADMIN_ROADMAP.md
├── Update Phase 2c status: PENDING → IN PROGRESS
├── Mark 2c.1, 2c.2, 2c.3 as COMPLETE
```

---

## 🔍 Implementation Details

### Player Selector Logic
```typescript
// When match selected:
const match = await fetch(`/api/public/matches?matchId=${matchId}`);

// Get players from both teams
const homeTeamId = match.home_team_id;
const awayTeamId = match.away_team_id;

const players = allPlayers.filter(p => 
  p.team_id === homeTeamId || p.team_id === awayTeamId
);

// Build dropdown options
players.map(p => ({
  value: p.id,
  label: `${p.full_name} (#${p.shirt_no}) - ${p.team.short_name}`
}))
```

### Goal Entry Data Model
```typescript
interface GoalEntry {
  id: string;           // UUID
  match_id: string;     // UUID
  player_id: string;    // UUID (primary key for player)
  team_id: string;      // UUID
  goals: number;        // Count (usually 1, can be 2-3)
  created_at: string;   // ISO timestamp
  updated_at: string;
}

interface GoalWithRelations extends GoalEntry {
  player?: {
    full_name: string;
    shirt_no: number;
    team?: { short_name: string };
  };
  team?: { name: string; short_name: string };
}
```

### API Request/Response Examples

**POST /api/admin/goals**
```
Request:
{
  "match_id": "550e8400-e29b-41d4-a716-446655440000",
  "player_id": "660e8400-e29b-41d4-a716-446655440001",
  "goals": 1
}

Response (200):
{
  "success": true,
  "goal": {
    "id": "770e8400-...",
    "match_id": "550e8400-...",
    "player_id": "660e8400-...",
    "goals": 1,
    "created_at": "2026-06-18T16:00:00Z"
  }
}
```

**PUT /api/admin/goals/[goalId]**
```
Request:
{
  "goals": 2  // Change 1 goal → 2 goals
}

Response (200):
{
  "success": true,
  "goal": { ...updated goal... }
}
```

**DELETE /api/admin/goals/[goalId]**
```
Request: (no body)

Response (200):
{
  "success": true,
  "message": "Goal deleted"
}
```

---

## 🛡️ Permission & Validation

### Permission Check (all endpoints)
```typescript
if (!authResult.profile.can_edit_goals) {
  return NextResponse.json(
    { error: 'You do not have permission to edit goals' },
    { status: 403 }
  );
}
```

### Input Validation
```
POST /api/admin/goals:
✅ match_id: UUID, exists, not null
✅ player_id: UUID, exists, not null
✅ player is in match's teams
✅ goals: 1-10 (integer)

PUT /api/admin/goals/[goalId]:
✅ goalId: UUID, exists
✅ goals: 1-10
✅ player_id (optional): UUID, in match's teams if changed

DELETE /api/admin/goals/[goalId]:
✅ goalId: UUID, exists
```

### Error Messages
```
"Player not in this match"
"Invalid goal count (must be 1-10)"
"Goal not found"
"You do not have permission to edit goals"
"Match not found"
```

---

## 🔗 Integration with Public API

**No changes to public API**:
- `/api/public/top-scorers` already recalculates
- Uses `SUM(goals) as total` per player per division
- Auto-updates when database changes

**Flow**:
1. Admin adds goal → POST /api/admin/goals
2. Database updated (goals table)
3. Admin goes to /top-scorers (public page)
4. GET /api/public/top-scorers queries latest data
5. SUM(goals) recalculates → new rankings shown

---

## 🧪 Testing Scenarios

After implementation:

1. **Add Goal**
   - Select match → Player A from home team
   - Add 1 goal → Verify in table
   - Add another goal for same player → Should allow (no unique constraint)
   - Verify /top-scorers shows 2 total goals

2. **Edit Goal**
   - Edit Player A's goal: 1 → 2
   - Verify updated in table
   - Verify /top-scorers shows correct total

3. **Delete Goal**
   - Delete one of Player A's goals
   - Verify removed from table
   - Verify /top-scorers recalculated

4. **Error Cases**
   - Try to add goal for non-match team → Error: "Player not in this match"
   - Try without can_edit_goals permission → Error: 403
   - Invalid goal count → Error: "must be 1-10"

5. **Phase 2b Not Broken**
   - /admin/matches still works
   - Edit match score still works
   - No 404 errors

---

## 📊 Estimated Scope

| Component | Est. Lines | Effort |
|-----------|-----------|--------|
| goals/page.tsx | 400 | Medium |
| PlayerSelector.tsx | 150 | Small |
| GoalsList.tsx | 200 | Small |
| GoalForm.tsx | 200 | Small |
| /api/admin/goals/route.ts | 200 | Small-Medium |
| /api/admin/goals/[goalId]/route.ts | 200 | Small-Medium |
| layout.tsx update | 5 | Trivial |
| **Total** | **~1350** | **1-2 days** |

---

## ✅ Completion Criteria

- [ ] All files created
- [ ] No breaking changes to Phase 2b
- [ ] Can add goals (API works)
- [ ] Can edit goals (API works)
- [ ] Can delete goals (API works)
- [ ] Player filtered by match teams
- [ ] can_edit_goals permission enforced
- [ ] /top-scorers auto-updates
- [ ] npm run build passes (21 routes + 2 new API)
- [ ] PROJECT_STATUS.md updated
- [ ] CHANGELOG.md updated
- [ ] Production testing OK

---

## 🚀 Deployment Order

1. Run migration in Supabase
2. Deploy code to Vercel (commit 1)
3. Test admin login
4. Test /admin/goals
5. Test add/edit/delete
6. Verify /top-scorers updated
7. Complete Phase 2c

---

## Next Phase (2d)

After 2c complete:
- Similar flow for Card Management
- Card types: Yellow, Red
- Suspension calculation
