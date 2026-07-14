# Tournament V2 — Target Architecture

**สถานะ**: Proposal เท่านั้น รอการอนุมัติก่อนเริ่ม Implementation
**อ้างอิงข้อเท็จจริงจาก**: `TOURNAMENT_V2_CURRENT_STATE_AUDIT.md`
**ปรับปรุงตาม**: `TOURNAMENT_V2_PREPARATION_PLAN.md` v1.1 — เพิ่มสถาปัตยกรรม Multi-Venue Operations (7 ประเภทการแข่งขัน / 4 สนาม) ดูรายละเอียดเต็มใน [หมวด 11](#11-multi-venue-operations-architecture-v11-addendum) และเอกสารคู่กัน `TOURNAMENT_V2_VENUE_OPERATIONS.md`
**ปรับปรุงเพิ่ม (Scheduling Addendum)**: เพิ่มสถาปัตยกรรมการจัดโปรแกรมแข่งขัน/นำเข้า Excel/จับฉลาก/Placeholder รอบน็อกเอาต์ ดู [หมวด 12](#12-scheduling--import-architecture-addendum) และเอกสารคู่กัน `TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md`

---

## 1. Proposed Architecture

```text
One GitHub Repository (pattaramet-tech/cfyl)
One Next.js 16 Application
One Vercel Project
One Production Domain
│
├── League Module (โค้ดเดิม, ปรับให้อยู่ใต้ namespace ชัดเจนขึ้นเท่านั้น — ไม่ Refactor Logic)
│   ├── Routes:    app/(league)/…            → /, /fixtures, /standings, /top-scorers, /discipline, /teams
│   ├── Admin:     app/admin/league/…         → ย้ายจาก app/admin/{seasons,teams,players,matches,goals,cards,suspensions,...}
│   ├── API:       app/api/league/…           → ย้ายจาก app/api/admin/{seasons,teams,...} และ app/api/public/{standings,discipline,...}
│   ├── Services:  lib/league/…               → ย้าย lib/calculations.ts, lib/suspension-*.ts, lib/public-slugs.ts
│   └── Database:  ตารางเดิมทั้งหมด (seasons, age_groups, divisions, teams, players, matches, goals, cards, suspensions)
│
└── Tournament V2 Module (สร้างใหม่ทั้งหมด)
    ├── Routes:    app/(tournament)/tournament/…     → /tournament, /tournament/schedule, /standings, /groups, /bracket, /teams, /discipline
    ├── Admin:     app/admin/tournament/…            → คงโครงเดิม (tournament-groups/fixtures/bracket) + เพิ่มที่ขาด (score/goals/cards เฉพาะ Tournament)
    ├── API:       app/api/tournament/…              → ย้าย/เขียนใหม่จาก app/api/admin/tournament-* และ app/api/public/tournaments/*
    ├── Services:  lib/tournament/{standings,schedule,bracket,advancement,discipline,services}/…
    └── Database:  ตารางใหม่ทั้งหมดตาม TOURNAMENT_V2_DATA_MODEL.md (ไม่มี FK ไปตารางกลางเดิมเลย)
```

**หลักการสำคัญ**: League module ในแผนนี้ **ไม่ต้อง Refactor Logic** เพียงจัดกลุ่ม Route ใหม่ (Next.js route groups `(league)`) เพื่อความชัดเจน — ความเสี่ยงต่อ League คือศูนย์ถ้าทำแค่ระดับ path/namespace ปัจจุบันแนะนำ **เลื่อนงานจัดกลุ่ม League ไปเป็น Phase ท้ายๆ (Phase 14 เป็นต้นไป)** และให้ Tournament V2 ขึ้นเป็น module ใหม่คู่ขนานก่อน (ดู `TOURNAMENT_V2_IMPLEMENTATION_PHASES.md`)

---

## 2. Route Structure

| ประเภท | ปัจจุบัน | เป้าหมาย V2 |
|---|---|---|
| Public Tournament | `/tournaments`, `/tournaments/[seasonSlug]/[ageGroupCode]/{groups,fixtures,bracket}` | `/tournament`, `/tournament/[tournamentSlug]/[categoryCode]/{schedule,groups,standings,bracket,teams,discipline}` |
| Public Venue (ใหม่ v1.1) | ไม่มีใน V1 | `/tournament/venues/[venueSlug]`, `/tournament/schedule?venue=[venueSlug]&date=YYYY-MM-DD` — filter ตามสนาม/วันแข่งขันได้จริง (V1 ทำไม่ได้เพราะ `venue` เป็น freetext) |
| Admin Tournament | `/admin/tournament-groups`, `/admin/tournament-fixtures`, `/admin/tournament-bracket` | `/admin/tournament/{groups,fixtures,bracket,teams,players,discipline,standings-rules}` |
| Admin Venue Ops (ใหม่ v1.1) | ไม่มีใน V1 | `/admin/tournament/control-center`, `/admin/tournament/venues`, `/admin/tournament/venues/[venueId]/matchday`, `/admin/tournament/categories/[categoryId]`, `/admin/tournament/matches/[matchId]/result`, `/admin/tournament/result-review` |
| League (คงเดิม) | `/`, `/fixtures/**`, `/standings/**`, `/top-scorers/**`, `/discipline/**`, `/teams/**` | ไม่เปลี่ยน URL (เพื่อไม่กระทบ SEO/bookmark เดิม) ภายในจัดกลุ่มเป็น `app/(league)/` |

**หมายเหตุสำคัญ**: ห้ามเปลี่ยน League URL ที่ใช้งานอยู่จริงตามข้อห้ามใน Preparation Plan — งานจัดกลุ่ม `(league)` เป็นแค่ Route Group ภายใน Next.js (ไม่กระทบ URL ที่ผู้ใช้เห็น) ส่วน Tournament URL เปลี่ยนจาก `/tournaments/[seasonSlug]` เป็น `/tournament/[tournamentSlug]` ได้อย่างปลอดภัยเพราะเป็น Route ใหม่ทั้งหมด (Tournament V2 ไม่ reuse Route เดิม)

---

## 3. API Structure

```text
/api/tournament/
  ├── public/
  │   ├── tournaments                          (list)
  │   ├── [tournamentSlug]/[categoryCode]/{overview,groups,schedule,standings,bracket,discipline}
  │   └── venues/[venueSlug]/matchday           (public matchday view ต่อสนาม — ใหม่ v1.1)
  ├── control-center/status                     (ใหม่ v1.1 — ภาพรวม 4 สนามสำหรับ central_control)
  └── admin/
      ├── tournaments, tournament-categories
      ├── teams, players, staff, venues, courts, category-venues   (venues/courts/category-venues ใหม่ v1.1)
      ├── groups, groups/[id]/{teams,standings}
      ├── matches, matches/[id]/{goals,cards}
      ├── matches/[matchId]/quick-result         (ใหม่ v1.1 — Stage A บันทึกผลด่วน)
      ├── matches/[matchId]/report               (ใหม่ v1.1 — Stage B รายงานเต็มรูปแบบ)
      ├── matches/[matchId]/submit               (ใหม่ v1.1 — ส่งผลเข้า Approval Workflow)
      ├── matches/[matchId]/approve               (ใหม่ v1.1 — อนุมัติผล)
      ├── matches/[matchId]/request-correction     (ใหม่ v1.1 — ขอแก้ผลที่ Publish แล้ว)
      ├── venues/[venueId]/matchday               (ใหม่ v1.1 — Venue Matchday Dashboard data)
      ├── knockout-rounds, bracket-matches, bracket-matches/[id]/{recalculate}
      ├── suspensions, suspensions/recalculate
      ├── role-assignments                        (ใหม่ v1.1 — จัดการ RBAC scope ต่อ user)
      ├── groups/[id]/slots                        (ใหม่ Scheduling Addendum — จัดการ Group Slot ก่อนจับฉลาก)
      ├── groups/[id]/generate-pairings             (ใหม่ — Generate Round Robin จาก Group Slot)
      ├── schedule/export                           (ใหม่ — Export โปรแกรมเป็น Excel)
      ├── schedule/import/preview                   (ใหม่ — Preview + Validate ก่อนบันทึก)
      ├── schedule/import/save                      (ใหม่ — บันทึกเฉพาะ Valid Rows)
      ├── schedule/import/batches, batches/[id]/rollback   (ใหม่ — ประวัติ Batch + Rollback)
      ├── draw/import/preview, draw/import/save      (ใหม่ — Import ไฟล์ DRAW_ASSIGNMENTS)
      ├── draw/resolve                                (ใหม่ — Trigger Resolution Engine ด้วยมือ)
      ├── schedule/versions, versions/[id]/publish     (ใหม่ — Schedule Status Workflow)
      ├── knockout/generate-structure                 (ใหม่ — วาง Match + Placeholder ล่วงหน้าทั้งสาย)
      └── audit-logs
```

Route handler ทุกตัวใต้ `/api/tournament/**` ต้องใช้ **Tournament Service Client เท่านั้น** (ดูหมวด 5) — ห้าม import `lib/supabase.ts` (League client) โดยตรง

**ข้อกำหนดเพิ่มจาก v1.1**: ทุก Route ใต้ `/api/tournament/admin/**` ที่รับ `venueId`/`categoryId`/`matchId` จาก body หรือ query string **ห้ามเชื่อค่าที่ Client ส่งมาเพียงอย่างเดียว** ต้องตรวจสอบ Scope จริงของผู้ใช้ที่ Server ทุกครั้ง (ผ่าน `lib/tournament/services/authorizeVenueScope.ts` — ดูหมวด 11.3) มิฉะนั้นเจ้าหน้าที่สนามหนึ่งจะแก้ข้อมูลอีกสนามได้โดยไม่ตั้งใจ (ตรงกับ Production Risk R7 ใน Current State Audit)

---

## 4. Service Structure

```text
lib/
├── league/                    (ย้ายของเดิม ไม่แก้ logic)
│   ├── standings/calculations.ts      ← lib/calculations.ts (เดิม)
│   ├── discipline/suspension-*.ts     ← lib/suspension-{calc,shared,status,table-utils}.ts (เดิม)
│   ├── schedule/public-slugs.ts       ← lib/public-slugs.ts (เดิม)
│   └── services/supabase.ts           ← lib/supabase.ts (เดิม, League client)
│
└── tournament/
    ├── db/supabase-tournament.ts      (ใหม่ — Tournament Service/Anon client, แยก env var)
    ├── standings/
    │   ├── calculateGroupStandings.ts     (Fork จาก calculateStandings เดิม + เพิ่ม tiebreak เต็มรูปแบบ)
    │   ├── resolveTiebreak.ts             (head-to-head, fair play, mini-table, จับฉลาก)
    │   └── rankCrossGroupCandidates.ts, rankBestThirdPlacedTeams.ts
    ├── qualification/
    │   ├── calculateQualificationStatus.ts
    │   └── applyManualQualificationOverride.ts
    ├── bracket/
    │   ├── buildTemplate.ts               (พอร์ตจาก lib/bracket.ts เดิม + รองรับ Round of 32 / custom)
    │   ├── advancement.ts                 (decideWinner, resolveSource, penalty winner)
    │   └── recalculate.ts                 (พร้อม lock/version guard)
    ├── discipline/
    │   ├── suspensionTrigger.ts
    │   ├── suspensionServing.ts
    │   └── suspensionCompletion.ts
    ├── fixtures/
    │   └── validateFixtureRow.ts          (พอร์ตจาก lib/tournament-fixtures.ts เดิม)
    ├── scheduling/                        (ใหม่ Scheduling Addendum)
    │   ├── generateGroupSlots.ts              (สร้างตำแหน่ง A-S1..A-Sn ตามจำนวนทีมที่กำหนด)
    │   ├── generateRoundRobin.ts               (Circle Method — รองรับ 3/4/5/6 ทีม + คี่/คู่)
    │   ├── resolvePlaceholder.ts                (แปลง source_type/source_ref → team_id ทั้ง 8 ชนิด)
    │   ├── validateScheduleImportRow.ts         (Error/Warning Matrix เต็มรูปแบบ)
    │   ├── scheduleExcelTemplate.ts              (Export/Import Column Mapping)
    │   ├── drawAssignmentService.ts              (Import DRAW_ASSIGNMENTS + Versioning)
    │   └── scheduleWorkflow.ts                    (draft→validated→published→revision_required→archived)
    └── services/auditLog.ts               (reuse lib/audit-log.ts pattern แต่เขียนลง tournament_audit_logs)
```

---

## 5. Database Isolation Strategy

### ตัวเลือกที่ประเมิน

| หัวข้อ | Option A — Supabase Project แยก | Option B — Project เดียว, Schema/Table Set แยก |
|---|---|---|
| Isolation | สูงสุด — ไม่มีทางเผลอ query ข้ามระบบเพราะเป็นคนละ connection/คนละ credential | ปานกลาง — ต้องพึ่ง discipline ของโค้ด + RLS + naming (`tournament_*` prefix) |
| Blast Radius เมื่อ Migration พลาด | จำกัดเฉพาะ Tournament DB | อาจกระทบ League ถ้า SQL ผิดตาราง/RLS ผิด policy |
| Backup/Point-in-time recovery | แยกอิสระ | ผูกกับ backup rotation เดียวกับ League |
| Auth (`admin_profiles`) | ต้องตัดสินใจ: ทำซ้ำในสอง Project หรือใช้ League Auth เป็นศูนย์กลางแล้ว Tournament เชื่อม JWT ข้าม Project (ซับซ้อนกว่า) | ใช้ `admin_profiles` เดิมร่วมกันได้ทันที ไม่ต้อง sync |
| Operational overhead | +1 ชุด Environment Variables, +1 Supabase Dashboard, +1 Billing line, +1 ชุด RLS ต้องดูแล | ชุดเดียว แต่ต้อง enforce RLS/Policy naming ให้เข้มงวดกว่าเดิม |
| ความเร็วตอนเริ่มงาน (Greenfield) | เริ่มจากศูนย์ ไม่มี data ต้อง migrate เข้า project ใหม่ (Tournament V2 ยังไม่มีข้อมูลจริง) → ต้นทุน setup ต่ำกว่าที่คิด | เริ่มได้เร็วกว่าเล็กน้อยเพราะไม่ต้องสร้าง Project ใหม่ |
| ผลกระทบต่อ Vercel | เพิ่ม 2 env var groups (`TOURNAMENT_SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY`) ต่อ environment (Production/Preview) — จัดการผ่าน Vercel Project Settings ปกติ ไม่ต้องเพิ่ม Vercel Project | ไม่ต้องเพิ่ม env var ใหม่เลย (ใช้ชุดเดิม) |

### Recommendation: **Option A (Supabase Project แยก)**

**เหตุผล**:
1. ชื่อโครงการคือ "Tournament V2 **Isolation**" — เป้าหมายหลักที่ระบุชัดเจนในเอกสารต้นทางคือ "ต้องไม่ใช้ Business Logic และข้อมูลการแข่งขันชุดเดียวกัน" การใช้ Project เดียวยังเปิดช่องให้เกิดการ join ข้ามระบบโดยไม่ตั้งใจได้เสมอ (เช่นเดียวกับที่ League/Tournament ปัจจุบันเผลอ share ตาราง `matches` เดียวกันจนเกิด R1 ใน Current State Audit)
2. เป็นงาน **Greenfield แท้จริง** — Tournament V2 ไม่มีข้อมูลเดิมต้อง carry-over เข้า schema ใหม่ (ข้อมูล Tournament ปัจจุบันถ้าจะย้าย จะย้ายจาก League DB เข้า Tournament V2 DB อยู่แล้วไม่ว่าจะเลือก Option ไหน) ดังนั้นต้นทุนที่มักอ้างถึงของ Option A (ตั้ง Project ใหม่, ต่อ Vercel) ไม่ใช่ต้นทุนเพิ่มพิเศษในเคสนี้
3. Bug Class ที่พบใน Current Audit (TD-4: `calculateStandings` ถูก reuse ตรงๆ, R4: single blast radius) เกิดจาก **การไม่มีกำแพงทางกายภาพ** ระหว่างสองระบบตั้งแต่ต้น การใช้ Option B ยังต้องพึ่ง "วินัยของทีม" ในการไม่ join ข้ามระบบ ซึ่งเป็นเงื่อนไขที่ Additive Mode เดิมก็เริ่มต้นด้วยความตั้งใจดีเช่นกันแต่จบลงที่การผูกกันลึก (ดู Current State Audit หมวด 3-4)
4. ต้นทุนที่เพิ่มจริง (Option A) มีขอบเขตจำกัดและวัดได้: +1 Supabase Project (free/small tier เพียงพอสำหรับ scale ของ Youth League), +1 ชุด env var, +Runtime Guard 1 จุด (ป้องกัน Tournament Service เรียก League Client ผิด) — ไม่ใช่ความซับซ้อนเชิงสถาปัตยกรรมที่แก้ยาก

**เงื่อนไขที่ทำให้ควรพิจารณา Option B แทน** (ระบุไว้เป็น Open Question เพื่อให้เจ้าของระบบยืนยัน): ถ้าต้องการ Auth เดียวกันแบบ real-time (admin คนเดียวสลับดู League/Tournament ไม่ต้อง login ใหม่) และไม่ต้องการดูแล 2 Supabase Dashboard/Billing — Option B ยังเป็นทางเลือกที่ใช้งานได้จริง เพียงต้องเข้มงวดเรื่อง table prefix + RLS policy per table + ไม่มี FK ข้ามกลุ่มตาราง

### Auth Strategy ถ้าเลือก Option A

- **แนะนำ**: League Supabase Project ยังเป็นเจ้าของ `admin_profiles` (Auth ยังคงรวมศูนย์ 1 ที่ เพื่อไม่ต้อง sync user สองที่) — Tournament Service ตรวจสอบ JWT ที่ League Supabase ออกให้ (League ยังเป็น Identity Provider เดียว) แล้วเปิด `tournament_admin_permissions` mapping table แยกใน Tournament Project เพื่อกำหนดสิทธิ์เฉพาะ Tournament โดยไม่ต้อง query ข้าม Project ใน hot path (mapping ถูก sync ครั้งเดียวตอน login/แก้สิทธิ์ ไม่ query ทุก request)
- ทางเลือกอื่น (ซับซ้อนกว่า, ไม่แนะนำในตอนนี้): สร้าง `admin_profiles` ซ้ำในทั้งสอง Project และ sync ด้วย webhook — เพิ่มความซับซ้อนโดยไม่จำเป็นสำหรับทีมขนาดเล็ก
- ต้องตัดสินใจ (ดู Open Questions): "Tournament และ League ใช้ Admin Account ชุดเดียวกันหรือไม่" และ "สิทธิ์ระดับ Module (League-only admin vs Tournament-only admin) จำเป็นหรือไม่"

---

## 6. Environment Variables

```text
# League (คงเดิม เปลี่ยนแค่ชื่อถ้าต้องการความชัดเจน — ไม่บังคับเปลี่ยนใน Phase แรก)
NEXT_PUBLIC_SUPABASE_URL              → คงชื่อเดิมไว้ก่อน (ของเดิมมีการอ้างอิงกว้างมาก เปลี่ยนชื่อเสี่ยง breaking)
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY

# Tournament V2 (ใหม่)
TOURNAMENT_SUPABASE_URL
NEXT_PUBLIC_TOURNAMENT_SUPABASE_URL   (ต้องมี NEXT_PUBLIC_ prefix เฉพาะตัวที่ client component เรียกใช้ตรง — ตรวจสอบทีละจุดว่าจำเป็นแค่ไหน เพื่อลด surface ของ anon key ฝั่ง client)
NEXT_PUBLIC_TOURNAMENT_SUPABASE_ANON_KEY
TOURNAMENT_SUPABASE_SERVICE_ROLE_KEY
```

**Guard ที่ต้องมี**: `lib/tournament/db/supabase-tournament.ts` ต้อง throw ทันทีถ้าไฟล์อื่นนอก `lib/tournament/**` หรือ `app/api/tournament/**`/`app/(tournament)/**` พยายาม import (ตรวจด้วย ESLint import boundary rule ไม่ใช่ runtime check เพียงอย่างเดียว — ดูหมวด 8)

**Vercel Deployment**:
- Production env vars: ตั้งค่า `TOURNAMENT_SUPABASE_*` ให้ชี้ Tournament Production Project
- Preview env vars: ตั้งค่าให้ชี้ **Tournament Test/Staging Project แยกต่างหาก** (ไม่ใช่ Production) — ป้องกัน Preview Deployment เขียนทับข้อมูลจริงระหว่างพัฒนา (ตรงตามข้อกำหนดในแผนต้นทาง Section 13)
- League env vars (Preview) **ต้องไม่เปลี่ยนแปลง** ตลอดการพัฒนา Tournament V2

---

## 7. Shared vs Isolated Components

### Shared (อนุญาตให้ใช้ร่วมกัน — ไม่ผูกกับ Business Data)

| Component/Module | เหตุผลที่ Share ได้ |
|---|---|
| `components/PublicChrome.tsx`, `components/AdminNav.tsx` | UI Shell/Nav ล้วนๆ ไม่แตะ Business Logic — ปรับแค่ NAV_LINKS ให้ชี้ Route ใหม่ |
| `components/TeamLogo.tsx` | Generic image component |
| `lib/csv.ts`, `lib/bulk-import-utils.ts` (cell validators ทั่วไป) | Generic CSV/Validation helper ไม่ผูก table |
| `lib/admin-middleware.ts` (auth verification pattern), `lib/admin-auth.ts` | Authentication utility — ใช้ pattern เดียวกันได้ (แต่ต้องชี้ไปยัง Supabase Project ที่ถูกต้องตาม Auth Strategy หมวด 5) |
| `lib/audit-log.ts` pattern (ไม่ใช่ instance เดียวกัน) | Logging interface — Tournament ต้องมี `logTournamentAdminAction` เขียนลง `tournament_audit_logs` ของตัวเอง แต่ใช้ pattern/signature เดียวกัน |
| Date/Time formatting (`formatTimeToThai`, `parseTaiTime`, `excelDateToISO` ใน `lib/calculations.ts`) | ควรแยกออกมาเป็น `lib/shared/datetime.ts` เพราะเป็น pure function ไม่ผูก Business Data — ปัจจุบันติดอยู่ในไฟล์ standings engine โดยไม่จำเป็น |

### ห้าม Share (ต้อง Fork หรือ Rewrite)

| Module เดิม | เหตุผลที่ต้องแยก |
|---|---|
| `lib/calculations.ts::calculateStandings` | League standings semantics ผูก `division_id`; Tournament ต้องมี tiebreak เพิ่ม (head-to-head, fair play, จับฉลาก) — Fork เป็น `lib/tournament/standings/calculateGroupStandings.ts` |
| `lib/bracket.ts`, `lib/tournament-fixtures.ts`, `lib/public-tournament.ts` | เขียนทับ table เดิม (`matches`,`tournament_groups`) — ต้อง Rewrite ให้ชี้ตารางใหม่ทั้งหมด |
| `lib/suspension-calc.ts` + 3 ไฟล์ suspension-* | แม้ปัจจุบัน "agnostic" ต่อ competition_type แต่ผูก `matches`/`cards`/`suspensions` (League table) โดยตรง — Tournament ต้อง Fork เป็น engine ของตัวเองที่ผูกกับ `tournament_match_cards`/`tournament_suspension_events` |
| `lib/public-slugs.ts` | ผูกกับ `divisions` ทั้งไฟล์ (League-only concept) — Tournament มี URL scheme ของตัวเองอยู่แล้ว ไม่ต้อง share |
| `types/db.ts` (`Team`, `Player`, `Match`, `Standing`, `Suspension`) | ต้องแยกเป็น `LeagueTeam`/`TournamentTeam` ฯลฯ ตาม Type Boundary ใหม่ (ดู `TOURNAMENT_V2_DATA_MODEL.md`) — ห้ามใช้ type กลางที่ทำให้ Tournament ต้องรองรับ nullable field ของ League (เช่น `division_id`) |

---

## 8. Runtime Guard และ Logging (ตามข้อกำหนด Section 13 ของแผนต้นทาง)

1. **Import Boundary**: เพิ่ม ESLint rule (`no-restricted-imports` หรือ custom rule) ห้ามไฟล์ใต้ `lib/league/**`, `app/api/league/**` import จาก `lib/tournament/**` และในทางกลับกัน — บังคับใช้ตอน CI ไม่ใช่แค่ runtime
2. **Runtime Guard**: `lib/tournament/db/supabase-tournament.ts` ตรวจ `process.env.TOURNAMENT_SUPABASE_URL !== process.env.NEXT_PUBLIC_SUPABASE_URL` แล้ว throw ถ้าค่าเดียวกัน (กันกรณีตั้งค่า env varผิดแล้วชี้ไป Project เดิมโดยไม่รู้ตัว)
3. **Logging**: ทุก log line จาก Tournament Service ต้องมี prefix `[TOURNAMENT]` และระบุ `database_target` (คล้ายรูปแบบ `[ADMIN_MATCHES_PAGE]` ที่ใช้อยู่แล้วใน `app/admin/matches/page.tsx:39`) เพื่อแยก log stream ได้ทันทีใน Vercel Log Drain
4. **Health Check**: เพิ่ม `/api/tournament/health` (query ตาราง `tournaments` แบบ lightweight) แยกจาก `/api/admin/version` เดิม (`app/api/admin/version`) เพื่อ monitor Tournament DB connectivity อิสระ

---

## 9. Deployment Architecture (Vercel Domain เดียว)

```text
production.<domain>/                → League (ไม่เปลี่ยน)
production.<domain>/tournament/**   → Tournament V2 (ใหม่)
production.<domain>/admin/league/** → League Admin (จัดกลุ่มใหม่ใน Phase หลัง)
production.<domain>/admin/tournament/** → Tournament Admin (คงโครงเดิม ปรับ endpoint)

preview-<hash>.vercel.app/tournament/**        → ใช้ TOURNAMENT_SUPABASE_* ที่ชี้ Staging Project เท่านั้น
preview-<hash>.vercel.app/admin/tournament/**  → เช่นเดียวกัน
```

Build เดียว (`next build`) ครอบคลุมทั้งสอง Module — ไม่ต้องแยก Vercel Project เพราะ Next.js App Router รองรับ Route Group + Middleware ตรวจ path prefix ได้ในตัว

---

## 10. Recommendation สรุป

| หัวข้อ | Recommendation |
|---|---|
| Database Isolation | **Option A** — Supabase Project แยก (ดูเหตุผลเต็มหมวด 5) — ต้องได้รับการยืนยันจากเจ้าของระบบก่อน (Open Question) |
| Auth | League Supabase เป็น Identity Provider เดียว, Tournament เก็บ permission mapping ของตัวเอง; v1.1 เพิ่มชั้น RBAC ระดับ Venue/Category/Match บน Tournament Project เอง (ดูหมวด 11.3) |
| Route | League URL คงเดิมทั้งหมด, Tournament ใช้ URL scheme ใหม่ `/tournament/**` (ไม่ reuse `/tournaments/**` เดิมเพื่อเลี่ยงความสับสนระหว่าง V1/V2 ระหว่าง Parallel Run) |
| Business Logic | Fork ทั้งหมด ไม่ share Standings/Bracket/Discipline Engine กับ League |
| Shared Infra | UI Shell, Auth utility pattern, Audit Log pattern, CSV/Date helper — share ได้ตามหลักการ "ไม่ผูกกับ Business Data" |
| Rollout | Tournament V2 พัฒนาเป็น Module คู่ขนานก่อน ไม่แตะ League Route/Table เลยจนกว่าจะถึง Phase Cutover (ดู Implementation Phases) |
| Multi-Venue (v1.1) | Venue/Court เป็น Entity จริงพร้อม RBAC Scope, ไม่ Hardcode Category↔Venue Mapping ลงโค้ด, ใช้ Two-Step Approval เป็น Default (ดูหมวด 11 เต็ม) |

---

## 11. Multi-Venue Operations Architecture (v1.1 Addendum)

> เพิ่มเข้ามาตาม `TOURNAMENT_V2_PREPARATION_PLAN.md` v1.1 — บริบทจริง: รายการกีฬานักเรียนนักศึกษาจังหวัดชลบุรี (ฟุตซอลเท่านั้น) มี 7 ประเภทการแข่งขัน (ชาย/หญิง × U12/U14/U16/U18) กระจายลง 4 สนามที่ต้องบันทึกผลพร้อมกันได้จริง รายละเอียดเต็มทุก Wireflow/State Machine/Mermaid Diagram อยู่ใน `TOURNAMENT_V2_VENUE_OPERATIONS.md` — หมวดนี้สรุปเฉพาะผลกระทบระดับ Architecture

### 11.1 Category ↔ Venue เป็น Configuration ไม่ใช่ Hardcode

Mapping เริ่มต้น (จาก v1.1):

```text
สนามที่ 1 → ชาย U12 (B-U12), หญิง U14 (G-U14)
สนามที่ 2 → ชาย U14 (B-U14), หญิง U16 (G-U16)
สนามที่ 3 → ชาย U16 (B-U16), หญิง U18 (G-U18)
สนามที่ 4 → ชาย U18 (B-U18)
```

เก็บเป็นข้อมูลในตาราง `tournament_category_venues` (many-to-many, ดู `TOURNAMENT_V2_DATA_MODEL.md`) **ไม่ hardcode ใน UI หรือ Business Logic** เพราะปีถัดไปอาจเปลี่ยนจำนวนสนาม ย้ายรุ่นอายุ หรือเพิ่ม/ลด Category — Business Logic ต้อง query mapping จาก DB เสมอ ไม่มีค่าคงที่ `SEASON1 = ['B-U12','G-U14']` ฝังในโค้ด

### 11.2 Role-Based Access Control

| Role | Scope | ความสามารถหลัก |
|---|---|---|
| `tournament_super_admin` | ทั้งรายการ | จัดการทุกอย่าง: รายการ ผู้ใช้ กติกา สนาม และข้อมูลทุกส่วน |
| `central_control` | ทั้งรายการ | ดูสถานะทั้ง 4 สนาม, ตรวจ/แก้ Conflict ข้ามสนาม, อนุมัติผลขั้นสุดท้าย (`central_review` policy) |
| `venue_manager` | สนามที่ได้รับมอบหมาย | ควบคุม Matchday Dashboard ของสนามตน, ยืนยัน/โยกย้ายตารางแข่งภายในสนาม |
| `result_operator` | สนาม + Category ที่ได้รับมอบหมาย | กรอกผลการแข่งขัน (Quick Result + Full Match Report), ประตู, ใบเหลืองแดง |
| `match_official` | เฉพาะ Match ที่ได้รับมอบหมาย | ตรวจ/ยืนยันผลและรายงานเฉพาะนัดของตัวเอง |
| `read_only` | ตาม Scope ที่กำหนด | ดูข้อมูลอย่างเดียว แก้ไขไม่ได้ |

**หลักการบังคับ**:
1. บัญชีรายบุคคลเท่านั้น ห้ามแชร์ Username/Password ร่วมกันระหว่างเจ้าหน้าที่สนาม
2. Role Assignment ผูก Scope กับ `tournament_id` + `venue_id` + `category_id` (และลึกถึง `match_id` ได้สำหรับ `match_official`) — เก็บในตาราง `tournament_role_assignments`
3. ผู้ใช้หนึ่งคนรับได้หลาย Scope พร้อมกัน (เช่น `result_operator` ของสนาม 1 และสนาม 2)
4. QR Code ใช้เป็น Shortcut เข้าหน้าสนามได้ แต่ยังต้องผ่าน Authentication ปกติเสมอ (QR ไม่ใช่ bypass token)
5. **Server ต้องตรวจ Scope ทุกครั้ง ห้ามเชื่อ `venueId`/`categoryId` ที่ Client ส่งมาเพียงอย่างเดียว** — ทุก mutation endpoint เรียก `authorizeVenueScope(user, {venueId, categoryId, matchId})` ก่อนเขียนข้อมูลเสมอ (แก้ Production Risk R7 จาก Current State Audit โดยตรง)
6. Service Role Key อยู่ฝั่ง Server เท่านั้น ไม่ bundle ไป Client
7. ทุก Mutation สำคัญ (submit/approve/correction) ต้องมี Audit Log

### 11.3 Venue-Scoped Authorization Pattern

```text
lib/tournament/services/authorizeVenueScope.ts
  → รับ (userId, { venueId?, categoryId?, matchId? })
  → query tournament_role_assignments ของ user
  → คืน { allowed: boolean, role, matchedScope }
  → ทุก API route ใต้ /api/tournament/admin/matches/[matchId]/** เรียกฟังก์ชันนี้เป็นขั้นตอนแรกก่อน handler logic ใดๆ
```

ไม่ใช้ RLS policy ตรวจ scope โดยตรง (Tournament Project ไม่มี local `admin_profiles`, ดูหมวด 5) — Authorization ทั้งหมดอยู่ที่ API layer ชั้นเดียว ตรวจสอบและทดสอบได้ง่ายกว่าการกระจาย policy ไว้หลายตาราง

### 11.4 Central Control Center

หน้า `/admin/tournament/control-center` แสดงสถานะทั้ง 4 สนามพร้อมกัน:

| สนาม | Category | เข้าแล้ว | รอผล | รอตรวจ | ขัดแย้ง | อัปเดตล่าสุด |
|---|---|---:|---:|---:|---:|---|

ต้องมี: Live Progress ต่อสนาม, Match ที่เลยเวลานัดแต่ยังไม่มีผล, Result ที่ค้างอนุมัติ/มี Conflict, Draft ที่ยังไม่ Submit, ปุ่มลิงก์เข้า Venue Dashboard ของแต่ละสนามโดยตรง, Notification เมื่อมีปัญหาโดยไม่ต้อง Refresh เอง, Audit Timeline ของเหตุการณ์สำคัญ — ดู Wireflow เต็มใน `TOURNAMENT_V2_VENUE_OPERATIONS.md`

**คำแนะนำ Realtime vs Polling (MVP)**: ใช้ **Polling ทุก 15-30 วินาที** สำหรับ MVP (เพียงพอสำหรับ 4 สนาม, ความซับซ้อนต่ำกว่า Realtime subscription มาก) — เปิดทางให้อัปเกรดเป็น Supabase Realtime ในเฟสถัดไปถ้าจำนวนสนาม/ผู้ใช้เพิ่มขึ้นมากจนต้องการ Latency ต่ำกว่านี้

### 11.5 Concurrency, Idempotency และ Data Integrity

เนื่องจากมี 4 สนามกรอกผลพร้อมกันจริง ต้องมี:

1. **Optimistic Locking** ด้วย `version` column บน `tournament_result_submissions` — ทุก Update ต้องส่ง version ปัจจุบันมาด้วย ถ้าไม่ตรง (มีคนแก้ไปแล้ว) ต้อง reject พร้อม error ชัดเจนให้ผู้ใช้ refresh
2. **Idempotency Key** บนทุก endpoint ที่เป็น mutation สำคัญ (`submit`, `approve`) — client ส่ง key เดิมซ้ำ (กรณี network retry) ต้องไม่สร้าง record ซ้ำ
3. **Unique Result Submission ต่อ Match ต่อสถานะ** — ป้องกัน Double Submit ระดับ Database constraint ไม่ใช่แค่ระดับ UI
4. **Database Transaction เมื่อ Publish** — Publish ผลแล้วต้อง trigger คำนวณ Standings/Qualification/Suspension/Bracket ในธุรกรรมเดียวกัน (all-or-nothing) ไม่ปล่อยให้ Standings อัปเดตแต่ Suspension ไม่อัปเดต
5. **Before/After Snapshot ทุก Correction** — เก็บลง `tournament_result_versions` เพื่อดูประวัติย้อนหลังได้ครบ

### 11.6 Offline / Network Resilience Strategy

| ระดับ | MVP (ต้องมี) | Future Enhancement (ยังไม่ทำในรอบนี้) |
|---|---|---|
| กลยุทธ์หลัก | Online-first + Retry Queue | PWA + Offline Draft เต็มรูปแบบ |
| Draft | Local Draft Autosave (เก็บใน localStorage/IndexedDB ฝั่ง client ชั่วคราวก่อน Submit) | Background Sync |
| การอัปโหลดรูป/ไฟล์แนบ | Retry อัตโนมัติเมื่อ Upload ล้มเหลว | Offline queue สำหรับไฟล์ใหญ่ |
| Session | ผูกกับ Browser Tab ปกติ | Device-bound Session |
| Conflict | แจ้งเตือนเมื่อพบข้อมูล Version ใหม่กว่า ให้ผู้ใช้ตัดสินใจเอง | Conflict Resolution อัตโนมัติ |

**เหตุผลที่ไม่ทำ Full PWA/Offline ใน MVP**: เพิ่มความซับซ้อนสูงมาก (Service Worker, Background Sync, Conflict Resolution แบบ Distributed) เทียบกับความเสี่ยงจริงของ Youth League ระดับจังหวัดที่สนามแข่งส่วนใหญ่ยังมีสัญญาณมือถือ/Wi-Fi ใช้ได้ — แนะนำเริ่มจาก Online-first + Retry Queue ก่อน แล้ววัดผลจริงหน้างานว่าจำเป็นต้องทำ Offline เต็มรูปแบบหรือไม่ (ใส่เป็น Open Question ให้เจ้าของระบบยืนยัน)

---

## 12. Scheduling & Import Architecture Addendum

> รายละเอียดเต็ม (Wireflow, Validation Matrix, Mermaid) อยู่ใน `TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md` — หมวดนี้สรุปเฉพาะผลกระทบระดับ Architecture

### 12.1 หลักการ: Human-Readable Reference ไม่ใช่ UUID

ทุก Excel Format (Fixture Import, Draw Assignment Import) ใช้ `match_code`/`slot_code`/`team_code`/`venue_code`/`court_code`/`group_code`/`category_code` เป็น External Reference **ไม่ใช้ UUID เลย** — Layer การ Import (`lib/tournament/scheduling/*.ts`) มีหน้าที่ resolve ค่าเหล่านี้เป็น UUID จริงตอน Save เท่านั้น ทำให้ไฟล์ Excel แก้ไขด้วยมือหรือส่งให้ผู้จัดที่ไม่ใช่โปรแกรมเมอร์ดูได้ตรงไปตรงมา

### 12.2 Placeholder Resolution Engine เป็น Cross-Cutting Service

`resolvePlaceholder.ts` ถูกเรียกจาก 3 จุดที่ต่างกัน ต้องออกแบบให้ Idempotent และเรียกซ้ำได้ปลอดภัยเสมอ:
1. **หลัง Import Draw Assignment** — resolve `group_slot` → `team_id` ทันที
2. **หลัง Publish ผลรอบก่อนหน้า** (เชื่อมกับ Result Workflow ใน `TOURNAMENT_V2_VENUE_OPERATIONS.md` หมวด 10) — resolve `match_winner`/`match_loser` → `team_id` ของนัดที่อ้างถึง
3. **หลัง Publish Group Standings ครบ** (เชื่อมกับ Standings Engine ใน Data Model หมวด 6) — resolve `group_rank`/`best_ranked` → `team_id`

ทั้ง 3 จุดเรียก Service เดียวกัน ต่างกันแค่ Trigger — ไม่ Duplicate Logic การ resolve ในหลายที่

### 12.3 Correction Workflow ครอบคลุมถึง Source Definition ด้วย

เดิม Correction Workflow (`TOURNAMENT_V2_VENUE_OPERATIONS.md` หมวด 13) ครอบคลุมแค่ "ผลการแข่งขัน" (สกอร์/ประตู/ใบโทษ) — Scheduling Addendum นี้ขยายให้ครอบคลุม **การแก้ Draw Assignment หรือ Match Source ที่กระทบ Match ซึ่ง Publish/Finished แล้ว** ด้วยกลไกเดียวกัน (`result_workflow_status → correction_requested`) ไม่ใช่กลไกแยก — ลดจำนวน State Machine ที่ทีมต้องเรียนรู้และทดสอบ

### 12.4 Import Batch Pattern (Reuse จาก League)

`tournament_schedule_batches`/`tournament_schedule_import_rows` (Data Model หมวด 2.21) ตามแนวคิดเดียวกับที่ League มีอยู่แล้วสำหรับ Match Bulk Import (`app/admin/match-bulk-import/history`, `lib/bulk-import-utils.ts::generateImportBatchNo`) — **Reuse แนวคิด/Pattern ไม่ใช่ Reuse โค้ดหรือตารางจริง** (สอดคล้องกับหลักการ "Shared Pattern ไม่ใช่ Shared Instance" ในหมวด 7)

### 12.5 อัปเดต Recommendation สรุป

| หัวข้อ | Recommendation |
|---|---|
| Scheduling Strategy | Hybrid: Group Slot + Round Robin Generate → Excel Export/Import → Draw Assignment → Auto-Resolve (ตามที่เจ้าของระบบกำหนด) |
| Auto Scheduler | ไม่ทำ Full Auto Scheduler ใน MVP รอบนี้ (ตามที่เจ้าของระบบยืนยันแล้ว) — เปิดทางไว้เป็น Future Phase |
| Placeholder Model | 8 `source_type` บน `tournament_matches` โดยตรง ไม่แยกตาราง `tournament_match_sources` |
| Bracket Structure | ยุบ `tournament_bracket_matches` เข้า `tournament_matches` + `tournament_knockout_rounds` (ดู Data Model หมวด 2.15) |
