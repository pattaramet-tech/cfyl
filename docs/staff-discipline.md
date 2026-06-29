# Staff Discipline System Documentation

## Overview

The staff discipline system allows admins to record and track discipline events (warnings, cautions, ejections, bans) issued to team staff members during matches. This includes coaches, managers, and other team personnel.

## Setup & Installation

### 1. Database Schema

The system uses two main tables:

**team_staffs** - Stores team staff information
```
- id: UUID (primary key)
- season_id: UUID (foreign key)
- age_group_id: UUID (foreign key)
- division_id: UUID (foreign key)
- team_id: UUID (foreign key)
- full_name: TEXT
- position: TEXT (e.g., "ผู้จัดการทีม", "ผู้ฝึกสอน", "ผู้ช่วยผู้ฝึกสอน", "เจ้าหน้าที่ทีม")
- phone: TEXT
- active: BOOLEAN
- created_at: TIMESTAMP
- updated_at: TIMESTAMP

Unique constraint: (team_id, full_name, position)
```

**staff_discipline_events** - Records discipline incidents
```
- id: UUID (primary key)
- season_id: UUID (foreign key)
- age_group_id: UUID (foreign key)
- division_id: UUID (foreign key)
- match_id: UUID (foreign key, nullable)
- team_id: UUID (foreign key)
- staff_id: UUID (foreign key)
- discipline_type: ENUM ('warning', 'caution', 'ejection', 'ban')
- minute: INT (0-120, nullable)
- reason: TEXT (nullable)
- note: TEXT (nullable)
- suspended_matches: INT (nullable)
- suspended_from_matchday: INT (nullable)
- status: ENUM ('active', 'served', 'cancelled')
- created_by: UUID (nullable)
- created_at: TIMESTAMP
- updated_at: TIMESTAMP

Constraints:
- Check: minute BETWEEN 0 AND 120 (when not null)
- Check: discipline_type IN ('warning', 'caution', 'ejection', 'ban')
- Check: status IN ('active', 'served', 'cancelled')
- Index: (match_id, team_id, status)
- Index: (season_id, age_group_id, division_id)
```

Run the SQL from `docs/add-team-staff-discipline.sql` to create these tables.

### 2. Import Staff Data

Use the import script to load staff from an XLSX file:

```bash
npm run import:staffs -- --file staffs.xlsx --season cfyl
```

**XLSX Format:**
- Sheet name: "Staffs"
- Columns: Age Group, Division, Team, Position, StaffName, StaffPhone
- Example:
  | Age Group | Division | Team | Position | StaffName | StaffPhone |
  |-----------|----------|------|----------|-----------|------------|
  | 14 | 1 | รร.เทศบาลวัดราษฎร์นิยมธรรม | ผู้จัดการทีม | นาย เอกชัย | 0812345678 |
  | 14 | 1 | รร.เทศบาลวัดราษฎร์นิยมธรรม | ผู้ฝึกสอน | นาย อัครเดช | 0812345679 |

**Pre-setup Step:**
Before importing staff, teams must be assigned to divisions:

```bash
npm run assign:teams -- --file staffs.xlsx --season cfyl
```

This script reads the XLSX and updates `teams.division_id` for proper organization.

## Usage

### 1. Recording Discipline in Match Management

Navigate to **Admin → Match Management** (`/admin/matches/manage`) and:

1. Select a match
2. Scroll to "Staff Discipline" section
3. Fill in:
   - **Staff**: Dropdown with staff from home and away teams (grouped by team, sorted by position)
   - **Discipline Type**: warning, caution, ejection, ban
   - **Minute**: When the incident occurred (0-120, optional)
   - **Reason**: Brief description
   - **Note**: Additional notes (optional)
   - **Suspended Matches**: Number of matches to suspend (if applicable)
4. Click "Add Discipline"

**Position Priority (Display Order):**
1. Manager (ผู้จัดการทีม)
2. Coach (ผู้ฝึกสอน)
3. Assistant Coach (ผู้ช่วยผู้ฝึกสอน)
4. Staff (เจ้าหน้าที่ทีม)

### 2. Viewing Public Match Timeline

The public match page (`/matches/[matchId]`) displays a timeline with:
- **Goals** (⚽)
- **Cards** (🟨 yellow, 🟥 red)
- **Staff Discipline** (⚠️ warning, 🟧 caution, 🟥 ejection, 🚫 ban)

Events are sorted by minute and include:
- Minute · Staff Name · Position · Discipline Type · Reason

### 3. Admin Staff Discipline Report

Navigate to **Admin → Staff Discipline** (`/admin/staff-discipline`) to view all discipline records.

**Filters:**
- Season
- Age Group
- Team
- Discipline Type
- Status (Active, Served, Cancelled)

**Columns:**
| Column | Description |
|--------|-------------|
| Matchday | Round number |
| Team | Team name |
| Name | Staff member name |
| Position | Job title |
| Type | Discipline type with emoji |
| Minute | When incident occurred |
| Reason | Description of incident |
| Suspended | Number of suspended matches |
| Status | active/served/cancelled |
| Date | When record was created |
| Delete | Remove record button |

## Discipline Types

- **⚠️ Warning (คาดโทษ)** - Formal warning
- **🟧 Caution (เตือน)** - Serious warning
- **🟥 Ejection (ไล่ออก)** - Removed from match
- **🚫 Ban (แบน)** - Suspended from future matches

## Status Management

- **Active (มีผล)** - Currently in effect
- **Served (ชดเชยแล้ว)** - Completed (e.g., suspension served)
- **Cancelled (ยกเลิก)** - Removed/reversed

## API Endpoints

### GET /api/admin/staff-discipline
Retrieve discipline records with optional filters.

**Query Parameters:**
- `seasonId` - Filter by season
- `ageGroupId` - Filter by age group
- `divisionId` - Filter by division
- `teamId` - Filter by team
- `staffId` - Filter by staff member
- `status` - Filter by status (active/served/cancelled)

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "season_id": "uuid",
      "match_id": "uuid",
      "team_id": "uuid",
      "staff_id": "uuid",
      "discipline_type": "caution",
      "minute": 45,
      "reason": "Excessive arguing with referee",
      "suspended_matches": 2,
      "status": "active",
      "staff": {
        "full_name": "นาย ชื่อ",
        "position": "ผู้ฝึกสอน"
      },
      "team": {
        "name": "โรงเรียน..."
      },
      "created_at": "2026-06-15T10:30:00Z"
    }
  ]
}
```

### POST /api/admin/staff-discipline
Create a new discipline record.

**Request Body:**
```json
{
  "staffId": "uuid",
  "disciplineType": "caution",
  "minute": 45,
  "reason": "Description",
  "note": "Optional notes",
  "suspendedMatches": 2,
  "matchId": "uuid" (optional)
}
```

### DELETE /api/admin/staff-discipline/[eventId]
Soft delete a discipline record (sets status to 'cancelled').

## Match Details API

The public match details endpoint includes staff discipline:

```
GET /api/public/matches/[id]
```

Response includes:
```json
{
  "staff_discipline_events": [
    {
      "id": "uuid",
      "discipline_type": "warning",
      "minute": 20,
      "staff": { "full_name": "...", "position": "..." },
      "team": { "name": "..." }
    }
  ]
}
```

## Data Aggregation Pattern

The system follows an aggregation pattern:
1. **Individual Records**: Each discipline event is stored as a separate record in `staff_discipline_events`
2. **Aggregation for Display**: When rendering timelines or reports, records are:
   - Fetched from the database
   - Filtered by status (e.g., only active events for public view)
   - Sorted chronologically
   - Displayed to users

This allows:
- Easy modification/cancellation of individual records
- Accurate historical tracking
- Flexible filtering and reporting

## Permissions

Recording and managing staff discipline requires:
- Admin login with valid JWT token
- `can_edit_cards` permission (shared with card management)

The permission is checked in headers as:
```
Authorization: Bearer <jwt_token>
```

## Troubleshooting

### Import Script Issues

**"Teams not found" when importing:**
1. Verify XLSX file has "Staffs" sheet
2. Run `npm run assign:teams` first to set up team divisions
3. Check that team names match between XLSX and database

**"Season not found":**
- Ensure season name contains "cfyl" (uses case-insensitive match)
- Verify season exists in database admin panel

**"Division not found":**
- Script matches division numbers (e.g., "1" matches "ดิวิชั่น 1")
- Check division numbers in XLSX match database structure

### Display Issues

**Staff not showing in dropdown:**
1. Verify staff records exist in database
2. Check `active = true` for staff record
3. Ensure staff is assigned to correct team/division

**Timeline not showing discipline events:**
1. Verify event `status = 'active'` (soft-deleted events are hidden)
2. Check that match_id is set correctly
3. Confirm staff_discipline_events table has data

## Performance Considerations

- Staff lists are indexed by (season_id, team_id)
- Discipline records are indexed by (match_id, team_id, status)
- Season/AgeGroup filters are recommended for report performance
- Large exports may require pagination

## Future Enhancements

- [ ] Bulk import discipline events from XLSX
- [ ] Automatic suspension tracking across matches
- [ ] Discipline history graphs/analytics
- [ ] Email notifications for suspensions
- [ ] Appeal/review workflow
