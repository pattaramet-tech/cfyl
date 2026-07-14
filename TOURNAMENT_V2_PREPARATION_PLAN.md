# Tournament V2 Isolation — Repository Audit & Preparation Plan

## 1. วัตถุประสงค์

ต้องการออกแบบและพัฒนาระบบ **Tournament V2** ใหม่ โดยแยกออกจากระบบ **League** อย่างชัดเจนในทุกส่วน ได้แก่

- ตารางฐานข้อมูล
- ทีมและนักกีฬา
- โปรแกรมแข่งขัน
- ผลการแข่งขัน
- ตารางคะแนน
- ประตูและใบโทษ
- การพักการแข่งขัน
- รอบแบ่งกลุ่ม
- รอบน็อกเอาต์และสายการแข่งขัน
- API
- Admin UI
- Public UI
- Export / Backup / Audit Log

Tournament V2 ยังอยู่ใน Repository, Next.js Application, Vercel Project และ Domain เดียวกับ League ได้ แต่ต้องไม่ใช้ Business Logic และข้อมูลการแข่งขันชุดเดียวกัน

เอกสารนี้เป็นงาน **Audit และ Preparation เท่านั้น**<br>
ยังไม่อนุญาตให้แก้ Production Database, ลบโค้ดเดิม, ย้ายข้อมูลจริง หรือเปลี่ยน Route ที่ใช้งานอยู่

---

## 2. Repository

Repository:

```text
pattaramet-tech/cfyl
```

Default branch:

```text
main
```

Technology ที่พบในปัจจุบัน:

- Next.js 16
- React 19
- TypeScript
- Supabase
- Vercel
- Vitest
- Tailwind CSS
- ExcelJS / XLSX

ก่อนเริ่มงาน ให้ Sync `main` ล่าสุด และสร้าง Branch สำหรับงานวิเคราะห์หรือเอกสารโดยเฉพาะ

ตัวอย่าง:

```bash
git switch main
git pull origin main
git switch -c docs/tournament-v2-preparation
```

ห้ามเริ่มรื้อระบบบน `main` โดยตรง

---

## 3. ปัญหาของโครงสร้าง Tournament ปัจจุบัน

Tournament ปัจจุบันถูกพัฒนาในลักษณะ Additive Mode ซึ่งอยู่ร่วมกับ League แต่ยังใช้แกนข้อมูลเดียวกันหลายส่วน

จุดที่ต้องตรวจสอบเพิ่มเติม:

1. Tournament ใช้ `seasons` ร่วมกับ League และแยกโหมดด้วย `competition_type`
2. Tournament ใช้ `age_groups` ร่วมกับ League
3. Tournament ใช้ `teams` และ `players` ร่วมกับ League
4. Tournament ใช้ `matches` ร่วมกับ League
5. Tournament ใช้ `goals`, `cards` และ `suspensions` ร่วมกับ League
6. Tournament Group Standings นำ Logic ตารางคะแนน League มาใช้
7. Knockout Bracket เชื่อมกลับไปยัง `matches` และ `teams` ชุดกลาง
8. Tournament Team และ Player ใช้แนวทาง `division_id = null`
9. Tournament Fixtures เพิ่มข้อมูลผ่าน `stage`, `tournament_group_id`, `venue` และ `winner_team_id` ในตาราง Match กลาง
10. Admin และ Public API บางส่วนเรียก Resource กลาง เช่น Seasons, Age Groups และ Teams

ให้ตรวจสอบข้อสรุปเหล่านี้กับโค้ดจริงอีกครั้ง และจัดทำ Dependency Map ที่อ้างอิงชื่อไฟล์ ฟังก์ชัน Route และตารางฐานข้อมูลอย่างชัดเจน

---

## 4. เป้าหมาย Architecture ใหม่

ต้องการให้ระบบเป็นลักษณะต่อไปนี้

```text
One GitHub Repository
One Next.js Application
One Vercel Project
One Production Domain
│
├── League Module
│   ├── League Routes
│   ├── League API
│   ├── League Services
│   ├── League Database
│   └── League Business Rules
│
└── Tournament V2 Module
    ├── Tournament Routes
    ├── Tournament API
    ├── Tournament Services
    ├── Tournament Database
    └── Tournament Business Rules
```

ตัวอย่าง Route ที่คาดหวัง:

```text
/league
/league/schedule
/league/standings
/league/teams
/league/discipline

/tournament
/tournament/schedule
/tournament/groups
/tournament/standings
/tournament/bracket
/tournament/teams
/tournament/discipline
```

ตัวอย่าง Admin Route:

```text
/admin/league/...
/admin/tournament/...
```

ตัวอย่าง API:

```text
/api/league/...
/api/tournament/...
```

ตัวอย่างโครงสร้าง Library:

```text
lib/
├── league/
│   ├── standings/
│   ├── schedule/
│   ├── discipline/
│   └── services/
│
└── tournament/
    ├── standings/
    ├── schedule/
    ├── bracket/
    ├── advancement/
    ├── discipline/
    └── services/
```

Shared Code อนุญาตเฉพาะสิ่งที่ไม่ผูกกับ Business Data เช่น:

- UI Components
- Design System
- Authentication Utilities
- Date / Time Formatting
- Generic Validation Helpers
- Generic CSV / XLSX Helpers
- Logging Interface

ไม่ควรแชร์:

- Match Query
- Team Query
- Standings Calculation
- Suspension Calculation
- Qualification Rules
- Bracket Advancement
- Tournament-to-League Data Types

---

## 5. แนวทางฐานข้อมูลที่ต้องประเมิน

แนวทางหลักที่ต้องประเมินคือใช้ Supabase แยก Project

```text
Vercel Application
├── League Supabase Project
└── Tournament Supabase Project
```

Environment Variables ที่คาดหวัง:

```text
LEAGUE_SUPABASE_URL
LEAGUE_SUPABASE_ANON_KEY
LEAGUE_SUPABASE_SERVICE_ROLE_KEY

TOURNAMENT_SUPABASE_URL
TOURNAMENT_SUPABASE_ANON_KEY
TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY
```

ให้ Claude ประเมินอย่างเป็นกลางระหว่างอย่างน้อย 2 ทางเลือก:

### Option A — Supabase Project แยกกัน

ข้อคาดหวัง:

- Isolation สูงสุด
- Migration ของ Tournament ไม่กระทบ League
- RLS และ Backup แยกกัน
- ลดความเสี่ยง Query ข้ามระบบ
- Operation และ Environment ซับซ้อนขึ้นเล็กน้อย

### Option B — Supabase Project เดียว แต่แยก Schema หรือแยก Table Set

ข้อคาดหวัง:

- บริหาร Environment ง่ายกว่า
- อาจทำ Transaction หรือ Shared Auth ได้ง่ายกว่า
- ยังมี Blast Radius ร่วมกัน
- ต้องควบคุม Naming, RLS และ Service Layer อย่างเข้มงวด

ให้สรุป Recommendation พร้อมเหตุผล ความเสี่ยง และผลกระทบต่อ Vercel Deployment

---

## 6. Candidate Data Model สำหรับ Tournament V2

ให้ตรวจสอบและเสนอ Data Model ที่เหมาะสม โดยเริ่มจาก Candidate ต่อไปนี้

```text
tournaments
tournament_categories
tournament_teams
tournament_players
tournament_staff
tournament_venues

tournament_groups
tournament_group_members

tournament_matches
tournament_match_goals
tournament_match_cards
tournament_match_reports

tournament_suspension_events
tournament_suspension_serving_matches

tournament_standing_rules
tournament_qualification_rules

tournament_knockout_rounds
tournament_bracket_matches

tournament_audit_logs
```

ประเด็นที่ต้องพิจารณา:

- Tournament หนึ่งรายการมีหลายรุ่นอายุได้
- รองรับชายและหญิง
- ทีมโรงเรียนเดียวกันอาจลงหลายรุ่น
- Team Code ต้องไม่ชนกันภายใน Tournament Category
- นักกีฬาอาจมี Shirt Number แยกตามรายการ
- โปรแกรมแข่งขันอาจมีหลายสนาม
- Match Number อาจไม่เท่ากับลำดับในรอบ
- รองรับ Bye
- รองรับ Postponed และ Cancelled
- รองรับผลเสมอในรอบแบ่งกลุ่ม
- รองรับผู้ชนะจากจุดโทษในรอบน็อกเอาต์
- รองรับการแก้ผลย้อนหลัง
- รองรับการ Recalculate Bracket อย่างปลอดภัย
- รองรับทีมอันดับ 3 ที่ดีที่สุด
- รองรับกลุ่มที่จำนวนทีมไม่เท่ากัน
- รองรับกติกาการตัดผลกับทีมอันดับสุดท้าย
- รองรับ Fair Play และการจับฉลาก
- รองรับ Manual Override พร้อม Audit Log

---

## 7. Tournament Standings Engine

ต้องไม่ใช้ League Standings Engine โดยตรง

ให้จัดทำข้อเสนอสำหรับ Tournament Standings Engine แยกต่างหาก เช่น:

```text
calculateGroupStandings()
resolveTournamentTiebreak()
rankCrossGroupCandidates()
rankBestThirdPlacedTeams()
calculateQualificationStatus()
applyManualQualificationOverride()
```

ต้องรองรับ Rule Configuration อย่างน้อย:

1. คะแนนชนะ เสมอ แพ้
2. Head-to-head
3. ผลต่างประตู
4. ประตูได้
5. จำนวนชนะ
6. Fair Play
7. จับฉลาก
8. Mini-table ระหว่างทีมที่คะแนนเท่ากัน
9. การเทียบอันดับข้ามกลุ่ม
10. การตัดผลกับทีมอันดับสุดท้าย
11. Manual Override
12. Qualification Slots ต่อกลุ่ม

ให้ระบุว่า Rule ใดควรเก็บใน Database และ Rule ใดควรอยู่ใน Code

---

## 8. Knockout และ Bracket Engine

ให้ตรวจสอบระบบเดิมและออกแบบใหม่โดยไม่ผูกกับ League Match

ความสามารถที่ต้องรองรับ:

- Round of 32
- Round of 16
- Quarter-final
- Semi-final
- Third-place
- Final
- Custom Round
- Bye
- Group Winner / Runner-up Mapping
- Best Third-place Mapping
- Direct Team Placement
- Winner Advancement
- Loser Advancement สำหรับชิงอันดับ 3
- Penalty Winner
- Manual Winner Override
- Recalculate หลังแก้ผล
- ป้องกันการเขียนทับข้อมูล Match ที่บันทึกแล้วโดยไม่ยืนยัน
- Version หรือ Audit History ของ Bracket

ให้เสนอ State Model ของ Bracket Match เช่น:

```text
pending
ready
scheduled
in_progress
finished
blocked
void
```

---

## 9. Discipline และ Suspension

Tournament ต้องมี Discipline Engine แยกจาก League

ให้ตรวจสอบว่า Tournament ต้องใช้กติกาใดบ้าง เช่น:

- ใบเหลือง
- ใบแดงโดยตรง
- ใบเหลืองที่สอง
- คะแนนสะสม
- การล้างใบเมื่อผ่านรอบ
- การพักการแข่งขันนัดถัดไป
- การพักตาม Stage
- การพักข้ามรอบ
- กรณี Bye
- กรณี Match ถูกเลื่อน
- กรณี Match ถูกยกเลิก
- Manual Suspension
- Appeal / Cancellation
- Served Match History

ให้แยก:

- Disciplinary Score
- Suspension Trigger
- Serving Match
- Suspension Completion

ออกจากกันอย่างชัดเจน

---

## 10. Audit งานปัจจุบันที่ต้องทำ

Claude ต้องค้นหาและจัดหมวดหมู่ไฟล์ที่เกี่ยวข้องกับ Tournament ทั้งหมด

### 10.1 Database และ Migration

ค้นหา:

```text
competition_type
tournament_groups
tournament_group_teams
tournament_group_id
knockout_rounds
bracket_matches
winner_team_id
stage
venue
```

ต้องสรุป:

- Migration File
- Table / Column ที่เพิ่ม
- Foreign Key
- Index
- RLS Policy
- Constraint
- สิ่งที่ผูกกับ League Table

### 10.2 Admin Pages

ตรวจสอบอย่างน้อย:

```text
app/admin/tournament-groups
app/admin/tournament-fixtures
app/admin/tournament-bracket
app/admin/seasons
app/admin/teams
app/admin/players
app/admin/matches
app/admin/goals
app/admin/cards
app/admin/suspensions
```

ต้องระบุ:

- API ที่หน้าเรียก
- Shared State หรือ Shared Component
- Resource ที่ใช้ร่วมกับ League
- จุดที่ต้องย้ายหรือเขียนใหม่
- จุดที่สามารถใช้เป็น Reference ได้

### 10.3 APIs

ค้นหา Route ที่เกี่ยวข้องกับ:

```text
/api/admin/tournament-*
/api/public/*
/api/admin/seasons
/api/admin/teams
/api/admin/players
/api/admin/matches
/api/admin/goals
/api/admin/cards
/api/admin/suspensions
```

ต้องสร้าง API Dependency Table:

| Route | Table ที่อ่าน | Table ที่เขียน | Shared กับ League | Recommendation |
|---|---|---|---|---|

### 10.4 Business Logic

ค้นหา:

```text
calculateStandings
tournament
bracket
advancement
qualification
suspension
discipline
winner_team_id
tournament_group_id
```

ต้องระบุ:

- Function Name
- File Path
- Input
- Output
- Database Dependency
- League Dependency
- Test Coverage
- ควร Reuse, Fork หรือ Rewrite

### 10.5 Types

ตรวจสอบ:

```text
types/
lib/types
database types
Team
Player
Match
Standing
Suspension
TournamentGroup
BracketMatch
```

ต้องเสนอ Type Boundary ใหม่ เช่น:

```text
LeagueTeam
TournamentTeam
LeagueMatch
TournamentMatch
LeagueStandingRow
TournamentStandingRow
```

ห้ามใช้ Type กลางที่ทำให้ Tournament ต้องรองรับ Nullable Field ของ League หรือกลับกัน

---

## 11. สิ่งที่ Claude ต้องส่งกลับ

ให้จัดทำเอกสาร Markdown แยกไฟล์ดังนี้

### 11.1 `TOURNAMENT_V2_CURRENT_STATE_AUDIT.md`

ต้องมี:

- Current Architecture
- Tournament Features ที่มีแล้ว
- Dependency กับ League
- Shared Tables
- Shared APIs
- Shared Business Logic
- Shared Types
- Shared Admin Pages
- Shared Public Pages
- Technical Debt
- Production Risk
- File Reference พร้อม Path

### 11.2 `TOURNAMENT_V2_TARGET_ARCHITECTURE.md`

ต้องมี:

- Proposed Architecture
- Route Structure
- API Structure
- Service Structure
- Database Isolation Strategy
- Authentication Strategy
- Environment Variables
- Shared vs Isolated Components
- Deployment Architecture บน Vercel Domain เดียว
- Recommendation ที่เลือกพร้อมเหตุผล

### 11.3 `TOURNAMENT_V2_DATA_MODEL.md`

ต้องมี:

- ERD แบบ Mermaid
- Table Definitions ระดับ Draft
- Primary Keys
- Foreign Keys
- Unique Constraints
- Indexes
- RLS Strategy
- Audit Fields
- Soft Delete Strategy
- Data Retention
- Backup Plan

### 11.4 `TOURNAMENT_V2_MIGRATION_MAP.md`

ต้องมี Mapping ระหว่างระบบเดิมกับระบบใหม่:

| Old Source | New Target | Transform | Risk | Verification |
|---|---|---|---|---|

รวมถึง ID Mapping:

```text
old_season_id -> tournament_id
old_age_group_id -> category_id
old_team_id -> tournament_team_id
old_player_id -> tournament_player_id
old_group_id -> tournament_group_id
old_match_id -> tournament_match_id
old_card_id -> tournament_card_id
old_suspension_id -> tournament_suspension_event_id
```

### 11.5 `TOURNAMENT_V2_IMPLEMENTATION_PHASES.md`

ต้องมี Phase ที่แยกเป็นงานขนาดเล็กและ Rollback ได้

ตัวอย่าง:

```text
Phase 0 — Audit and Freeze
Phase 1 — Database Foundation
Phase 2 — Tournament Core Domain
Phase 3 — Teams / Players / Staff
Phase 4 — Groups and Draw
Phase 5 — Fixtures and Match Operations
Phase 6 — Standings Engine
Phase 7 — Knockout and Bracket
Phase 8 — Discipline and Suspension
Phase 9 — Public Pages
Phase 10 — Import / Export / Backup
Phase 11 — Migration Dry Run
Phase 12 — Parallel Run
Phase 13 — Cutover
Phase 14 — Legacy Decommission
```

แต่ละ Phase ต้องมี:

- Scope
- Files Expected to Change
- Database Change
- Tests
- Acceptance Criteria
- Rollback Plan
- League Regression Checklist

### 11.6 `TOURNAMENT_V2_OPEN_QUESTIONS.md`

รวบรวมคำถามที่ต้องให้เจ้าของระบบตัดสินใจก่อนเริ่มเขียนจริง เช่น:

- ต้องการ Supabase แยก Project หรือไม่
- Tournament และ League ใช้ Admin Account ชุดเดียวกันหรือไม่
- Team Master ต้องแชร์กันหรือ Import แยก
- Player คนเดิมสามารถผูกข้ามรายการได้หรือไม่
- กติกาใบโทษ Tournament เป็นแบบใด
- ต้องรองรับทีมอันดับ 3 ที่ดีที่สุดแบบใด
- ต้องรองรับกลุ่มไม่เท่ากันหรือไม่
- ต้องเก็บ Tournament เก่ากี่ปี
- Public URL ใหม่ต้องเป็นรูปแบบใด
- ข้อมูล Tournament เดิมต้องย้ายทั้งหมดหรือเริ่มรายการใหม่

---

## 12. Test Strategy ที่ต้องเสนอ

ต้องเสนอ Test Plan อย่างน้อย 4 ระดับ

### Unit Tests

- Standings Rules
- Tiebreak Rules
- Best Third-place Ranking
- Qualification
- Bracket Templates
- Advancement
- Penalty Winner
- Suspension Trigger
- Suspension Serving

### Integration Tests

- Tournament API กับ Tournament Database
- Match Result Update แล้ว Standings เปลี่ยน
- Match Result Update แล้ว Bracket เลื่อนทีม
- Card Update แล้ว Suspension Recalculate
- การย้อนแก้ผล
- การลบ Match ที่มี Event

### Migration Tests

- Record Counts
- Foreign Key Integrity
- ID Mapping Completeness
- Score Reconciliation
- Standing Reconciliation
- Bracket Reconciliation
- Card / Suspension Reconciliation
- Idempotency

### League Regression Tests

ทุก Phase ต้องยืนยันว่า League ยังทำงาน:

- League Fixtures
- League Match Result
- League Standings
- League Goals
- League Cards
- League Suspensions
- League Public Pages
- League Admin Pages
- League Exports
- League Backup

---

## 13. Deployment Strategy บน Vercel Domain เดียว

ให้จัดทำข้อเสนอ Deployment โดยยังใช้:

```text
One Vercel Project
One Domain
```

ตัวอย่าง:

```text
production.example.com/league
production.example.com/tournament
```

ระหว่างพัฒนา:

```text
preview-url.vercel.app/tournament-v2
preview-url.vercel.app/admin/tournament-v2
```

ต้องพิจารณา:

- Preview Deployment ใช้ Tournament Test Database เท่านั้น
- Production League Environment ต้องไม่ถูกใช้จาก Preview
- Environment Variables ต้องแยก Preview / Production
- ป้องกัน Service Role Key ถูก Bundle ไปฝั่ง Client
- เพิ่ม Runtime Guard ป้องกัน Tournament Service ใช้ League Client
- เพิ่ม Logging ระบุ Module และ Database Target
- เพิ่ม Health Check แยก League และ Tournament

---

## 14. Migration และ Cutover Strategy

ห้ามทำ Big Bang Migration โดยไม่มี Parallel Verification

แนวทางที่ต้องประเมิน:

1. สร้าง Tournament V2 Database
2. สร้าง V2 APIs และ Admin UI
3. Import ข้อมูลจำลอง
4. Migration Dry Run จากข้อมูลเดิม
5. สร้าง ID Mapping
6. ตรวจสอบจำนวน Record
7. เปรียบเทียบ Match Results
8. เปรียบเทียบ Standings
9. เปรียบเทียบ Bracket
10. เปรียบเทียบ Discipline
11. เปิด `/tournament-v2` ให้ทดสอบ
12. Freeze Tournament เดิมชั่วคราว
13. Final Migration
14. Smoke Test
15. Switch Route
16. เก็บระบบเดิมแบบ Read-only
17. Decommission หลังผ่านช่วงตรวจสอบ

ต้องมี Rollback Plan ที่สามารถสลับกลับ Tournament เดิมได้โดยไม่กระทบ League

---

## 15. ข้อห้ามในรอบ Preparation

Claude ห้ามทำสิ่งต่อไปนี้จนกว่าจะได้รับอนุญาต:

- ห้ามแก้ Production Supabase
- ห้าม Run Migration จริง
- ห้ามลบ Tournament เดิม
- ห้ามแก้ League Table
- ห้ามเปลี่ยน League API
- ห้ามแก้ League Business Logic
- ห้าม Push เข้า `main`
- ห้ามเปลี่ยน Vercel Environment Variables
- ห้ามทำ Cutover
- ห้ามย้ายข้อมูลจริง
- ห้ามสร้าง PR ที่มี Code Refactor จำนวนมาก

อนุญาตเฉพาะ:

- อ่าน Repository
- Search Code
- อ่าน Migration
- อ่าน Commit History
- สร้างเอกสาร Markdown
- สร้าง Diagram
- สร้าง Dependency Map
- สร้าง Draft SQL ที่ยังไม่ถูกรัน
- สร้าง Proposed Folder Structure
- สร้าง Implementation Plan
- สร้าง Risk Register

---

## 16. รูปแบบรายงานผลที่ต้องการ

เริ่มรายงานด้วย Executive Summary:

```text
1. Tournament ปัจจุบันผูกกับ League มากน้อยเพียงใด
2. จุดเสี่ยงสูงสุด 5 อันดับ
3. Recommendation เรื่อง Database Isolation
4. Recommendation เรื่อง Rewrite vs Refactor
5. Estimated Number of Phases
6. สิ่งที่ต้องตัดสินใจก่อนเริ่ม Implementation
```

ทุกข้อสรุปทางเทคนิคต้องมีหลักฐานจาก Repository เช่น:

```text
File:
Function:
Route:
Table:
Migration:
Relevant lines or code summary:
```

ห้ามสรุปจากชื่อไฟล์เพียงอย่างเดียว ต้องอ่าน Implementation จริง

---

## 17. Definition of Done สำหรับรอบ Preparation

งาน Preparation ถือว่าเสร็จเมื่อ:

- [ ] พบไฟล์ Tournament ที่เกี่ยวข้องครบถ้วน
- [ ] มี Dependency Map ระหว่าง Tournament และ League
- [ ] มีรายการ Shared Tables และ Shared APIs
- [ ] มี Target Architecture
- [ ] มี Database Recommendation
- [ ] มี Draft ERD
- [ ] มี Migration Mapping
- [ ] มี Phase Plan
- [ ] มี Test Strategy
- [ ] มี Rollback Strategy
- [ ] มี Risk Register
- [ ] มี Open Questions
- [ ] ไม่มีการแก้ Production
- [ ] ไม่มีการเปลี่ยนพฤติกรรม League
- [ ] ไม่มีการเริ่ม Implementation ก่อนอนุมัติ Architecture

---

## 18. คำสั่งเริ่มต้นสำหรับ Claude

ให้เริ่มจากการ Audit เท่านั้น และตอบกลับด้วยเอกสารที่กำหนด

```text
อ่าน Repository pattaramet-tech/cfyl บน branch main ล่าสุด

เป้าหมายคือเตรียมแผนแยก Tournament V2 ออกจาก League อย่างสมบูรณ์
ทั้ง Database, API, Routes, Services, Teams, Players, Matches, Standings,
Goals, Cards, Suspensions, Groups, Bracket, Public UI และ Admin UI

ยังไม่อนุญาตให้แก้โค้ด Production, Run Migration, ลบของเดิม หรือเปลี่ยน League

ให้ตรวจสอบ Implementation จริง, Migration, Commit History, Tests และ Types
จากนั้นจัดทำเอกสาร:

1. TOURNAMENT_V2_CURRENT_STATE_AUDIT.md
2. TOURNAMENT_V2_TARGET_ARCHITECTURE.md
3. TOURNAMENT_V2_DATA_MODEL.md
4. TOURNAMENT_V2_MIGRATION_MAP.md
5. TOURNAMENT_V2_IMPLEMENTATION_PHASES.md
6. TOURNAMENT_V2_OPEN_QUESTIONS.md

ทุกข้อสรุปต้องอ้างอิง File Path, Route, Function, Table หรือ Migration ที่เกี่ยวข้อง
พร้อมระบุ Risk, Recommendation, Acceptance Criteria และ Rollback Plan

ห้ามเริ่ม Implementation จนกว่า Architecture และ Data Model จะได้รับการอนุมัติ
```
