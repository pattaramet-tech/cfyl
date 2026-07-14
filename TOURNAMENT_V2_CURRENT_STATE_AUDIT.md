# Tournament V2 — Current State Audit

**Scope**: Audit เท่านั้น ไม่มีการแก้ไข Production, ไม่มีการรัน Migration, ไม่มีการเปลี่ยน League
**Repository**: `pattaramet-tech/cfyl` · **Branch ที่อ่าน**: `main` @ `72fc7d2` (2026-07-11 22:45:16 +0700)
**Branch สำหรับเอกสารชุดนี้**: `docs/tournament-v2-preparation`
**วันที่จัดทำ**: 2026-07-14 · **ปรับปรุงล่าสุด**: 2026-07-14 ตาม `TOURNAMENT_V2_PREPARATION_PLAN.md` revision `v1.1 — Multi-Venue Match Operations` + Scheduling Addendum (การจัดโปรแกรม/นำเข้า Excel/จับฉลาก/Placeholder รอบน็อกเอาต์)
**บริบทการแข่งขันจริง (v1.1)**: รายการกีฬานักเรียนนักศึกษาจังหวัดชลบุรี ประเภทฟุตซอลเท่านั้น มี 7 ประเภทการแข่งขัน (ชาย/หญิง U12/U14/U16/U18) กระจายลง 4 สนามพร้อมกัน (ดูหมวด 13)

---

## 0. Executive Summary

1. **Tournament ผูกกับ League มากน้อยเพียงใด**: ผูกลึกมาก (deep-additive, ไม่ใช่แยกโมดูล) Tournament ไม่มีตารางของตัวเองสำหรับ core entities เลย — ใช้ `seasons`, `age_groups`, `teams`, `players`, `matches`, `goals`, `cards`, `suspensions` ร่วมกับ League ทั้งหมด แยกเฉพาะที่เพิ่มเข้ามาใหม่คือ 4 ตาราง (`tournament_groups`, `tournament_group_teams`, `knockout_rounds`, `bracket_matches`) และคอลัมน์เสริมบนตารางกลาง (`seasons.competition_type`, `matches.stage/tournament_group_id/venue/winner_team_id`, `teams.division_id` nullable, `players.division_id` nullable, `matches.division_id` nullable) ดู [ตารางที่ 1](#1-current-architecture) และ [ตารางที่ 4](#4-shared-tables)
2. **จุดเสี่ยงสูงสุด 5 อันดับ** (รายละเอียดใน [หมวด 10](#10-production-risk)):
   - **R1 — Tournament matches บันทึกประตู/ใบเหลืองแดงไม่ได้ผ่าน Admin UI ปัจจุบัน** (`app/admin/goals/page.tsx:108`, `app/admin/cards/page.tsx:157`, `app/admin/matches/manage/page.tsx:360,930` ทุกหน้าบังคับเลือก `divisionId` ก่อนโหลด matches แต่ Tournament match มี `division_id = null` เสมอ)
   - **R2 — Bracket/Standings Engine ไม่มี Test Coverage เลย** (`lib/bracket.ts`, `lib/tournament-fixtures.ts`, `lib/public-tournament.ts`, `lib/calculations.ts` และทุก API ใต้ `tournament-groups/tournament-fixtures/tournament-bracket/tournaments` ไม่มีไฟล์ทดสอบอ้างอิงเลยจากทั้งหมด 5 ไฟล์ทดสอบใน repo)
   - **R3 — Standings/Tiebreak Logic ที่ Tournament ใช้จริงไม่ตรงกับกติกาที่ต้องการ** (`calculateStandings` ใน `lib/calculations.ts:4` และการ sort ใน `lib/bracket.ts:107-112` / `lib/public-tournament.ts:62-68` เรียงแค่ points → goalDiff → goalsFor → ชื่อทีม (Thai locale) ไม่มี head-to-head, Fair Play, จับฉลาก, mini-table)
   - **R4 — Single Supabase Project = Single Blast Radius** (ไฟล์ `lib/supabase.ts` มี client ตัวเดียว ใช้ env var ชุดเดียว (`NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) ทั้ง League และ Tournament schema/migration/RLS ผสมกันในฐานเดียว)
   - **R5 — Naming Collision "Phase 5"** ระหว่างงาน Tournament (`scripts/migration-phase5a*.sql`, `phase5b1*.sql`) กับงาน Suspension-system hardening ที่ไม่เกี่ยวกัน (`docs/phase-5-2a/`, `docs/phase-5-3/`, commits `5c6afbc`…`88bb33a` ลง 2026-07-11) เสี่ยงต่อการอ้างอิงผิดเอกสาร/Runbook ในทีม
   - **R8 — V1 ไม่มีแนวคิด Placeholder/Draw/Group Slot เลย** ระบบ Import Fixture ของ V1 (`lib/tournament-fixtures.ts::resolveTeam`) บังคับให้ทุกแถวใน Excel ต้องระบุ `home_team_code`/`away_team_code` ที่ตรงกับทีมที่ "มีอยู่จริงแล้ว" เท่านั้น (`lib/tournament-fixtures.ts:185-200`) — ไม่มีกลไกวางโปรแกรมล่วงหน้าด้วยตำแหน่ง (Group Slot) หรือ Placeholder รอบน็อกเอาต์ (ผู้ชนะ/แพ้จากนัดก่อนหน้า) เลย ผู้จัดต้องรู้ว่าใครแข่งกับใครก่อนสร้างโปรแกรมเสมอ ซึ่งขัดกับ Workflow จริงที่ต้องจัดตารางวัน/เวลา/สนามล่วงหน้าก่อนจับฉลาก
3. **Recommendation เรื่อง Database Isolation**: ดูรายละเอียดเหตุผลเต็มใน `TOURNAMENT_V2_TARGET_ARCHITECTURE.md` — สรุปสั้น: แนะนำ **Option A (Supabase Project แยก)** เพราะเป็นการสร้างใหม่ (greenfield, ยังไม่มีข้อมูล Tournament V2 ต้อง migrate) และเป้าหมายของโครงการคือ "Isolation" อย่างชัดเจน ต้นทุนเพิ่มที่แท้จริงมีจำกัด
4. **Recommendation เรื่อง Rewrite vs Refactor**: แนะนำ **Rewrite เฉพาะ Data Model + Tournament Business Logic** (bracket/standings/fixtures/discipline) แต่ **Reuse UI Shell, Auth, Audit Log, CSV/XLSX helper, Generic Validation** — ดูเหตุผลใน [หมวด 9](#9-technical-debt) และ Target Architecture doc
5. **Estimated Number of Phases**: 15 phases (Phase 0–14) ตามโครงที่ระบุในแผนต้นทาง ดู `TOURNAMENT_V2_IMPLEMENTATION_PHASES.md`
6. **สิ่งที่ต้องตัดสินใจก่อนเริ่ม Implementation**: ดู `TOURNAMENT_V2_OPEN_QUESTIONS.md` ทั้งหมด — ที่ block งานมากที่สุดคือ (a) Supabase แยก Project หรือไม่ (b) ต้องย้ายข้อมูล Tournament เดิมทั้งหมดหรือเริ่มรายการใหม่ (c) กติกา Tiebreak/Fair Play ที่ต้องการจริง เพราะปัจจุบันไม่มีอยู่ในโค้ดเลย

---

## 1. Current Architecture

```text
One Next.js 16 App Router application (app/)
One Vercel Project (implied — single next.config.ts, no multi-app config found)
One Supabase Project
  ├── lib/supabase.ts        → anon client (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)
  └── getServiceClient()     → service-role client (SUPABASE_SERVICE_ROLE_KEY)
One admin_profiles table shared by all admin routes (scripts/admin-schema.sql:8-19)
One PublicChrome shell (components/PublicChrome.tsx) — nav includes both League and "ทัวร์นาเมนต์" links (line 14-21)
One AdminNav shell (components/AdminNav.tsx, imported by app/admin/layout.tsx:5) for all admin pages incl. tournament-*
```

Tournament ไม่ได้ถูกสร้างเป็นโมดูลแยก แต่ถูกเพิ่มแบบ **Additive Mode** เข้าไปใน League schema เดิม โดยใช้คอลัมน์ discriminator หลักคือ `seasons.competition_type` (`'league' | 'tournament' | 'mixed'`, เพิ่มใน `scripts/migration-phase5a-tournament-foundation.sql:6-8`)

**Route ปัจจุบัน (ไม่ตรงกับ `/league/*` และ `/tournament/*` ที่ต้องการในเป้าหมายใหม่)**:

| ประเภท | League | Tournament |
|---|---|---|
| Public | `/`, `/fixtures/**`, `/standings/**`, `/top-scorers/**`, `/discipline/**`, `/teams/**`, `/matches/[matchId]` | `/tournaments`, `/tournaments/[seasonSlug]/[ageGroupCode]`, `/…/groups`, `/…/fixtures`, `/…/bracket` |
| Admin | `/admin/seasons`, `/admin/teams`, `/admin/players`, `/admin/matches`, `/admin/matches/manage`, `/admin/goals`, `/admin/cards`, `/admin/suspensions`, `/admin/staff-discipline`, `/admin/match-bulk-import`, `/admin/exports`, `/admin/backup`, `/admin/data-quality`, `/admin/dashboard` | `/admin/tournament-groups`, `/admin/tournament-fixtures`, `/admin/tournament-bracket` |
| API | `/api/public/matches`, `/standings`, `/discipline`, `/suspensions`, `/teams`, `/api/admin/{seasons,teams,players,matches,goals,cards,suspensions,age-groups,divisions}` | `/api/public/tournaments/**`, `/api/admin/tournament-{groups,fixtures,bracket}/**` |

หมายเหตุ: มีเพียง 3 หน้า Admin และ 1 กลุ่ม Public route ที่เป็น "Tournament-only" อย่างแท้จริง ส่วนที่เหลือ **ทั้งหมด** เป็นหน้า/Route ที่ League และ Tournament ใช้ร่วมกัน (บาง route มี `competition_type` branch, บาง route ไม่มีเลย)

---

## 2. Tournament Features ที่มีแล้ว

| Feature | หลักฐาน (File:Line) | สถานะ |
|---|---|---|
| Season toggle เป็น League/Tournament/Mixed | `scripts/migration-phase5a-tournament-foundation.sql:6-8`, `app/admin/seasons/page.tsx:15,414-431` | ใช้งานได้ |
| Group Stage (สร้างกลุ่ม + จัดทีมเข้ากลุ่ม) | `app/admin/tournament-groups/page.tsx` (288 lines), ตาราง `tournament_groups`/`tournament_group_teams` | ใช้งานได้ |
| Group Standings (Admin + Public) | `app/api/admin/tournament-groups/[groupId]/standings/route.ts`, `lib/public-tournament.ts:42-71` (`computeGroupStandings`) | ใช้งานได้ แต่ tiebreak จำกัด (ดู R3) |
| Tournament Fixtures — Manual + Excel Import | `app/admin/tournament-fixtures/page.tsx` (370 lines), `lib/tournament-fixtures.ts` (302 lines) | ใช้งานได้ (สร้าง/แก้/ลบ fixture, import preview/save) แต่ **แก้ผลคะแนนไม่ได้จากหน้านี้** (แสดงผลอย่างเดียว `app/admin/tournament-fixtures/page.tsx:358`) |
| Knockout Bracket — Generate/Preview/Recalculate Advancement | `app/admin/tournament-bracket/page.tsx` (270 lines), `lib/bracket.ts` (159 lines) | ใช้งานได้สำหรับขนาด 4/8/16 เท่านั้น (`BRACKET_SIZES = [4,8,16]`, `lib/bracket.ts:6`), ไม่รองรับ Round of 32 หรือ custom round |
| Public Tournament Pages (Overview/Groups/Fixtures/Bracket) | `app/tournaments/**` (5 pages), `components/TournamentSubNav.tsx` | ใช้งานได้ |
| Score entry สำหรับ Tournament match | `/admin/matches/[matchId]` (ไม่ gate ด้วย division) → `PUT /api/admin/matches/[matchId]` | ใช้งานได้ (อ้อมทาง ไม่ใช่ผ่านหน้า tournament-fixtures) |
| **Goals entry สำหรับ Tournament match** | — | **ใช้งานไม่ได้** (ดู R1) |
| **Cards entry สำหรับ Tournament match** | — | **ใช้งานไม่ได้** (ดู R1) |
| Discipline/Suspension เฉพาะ Tournament | — | **ไม่มี** — Suspension engine (`lib/suspension-calc.ts`) เป็น engine เดียวกับ League ไม่มี Tournament-specific caller เลย (ไม่มี route ใต้ `tournament-*` เรียก `suspension-calc.ts`) |
| Bye / Postponed / Cancelled handling ใน Bracket | `lib/match-utils.ts:9,14` (`isByeResult`, `getByeLabelForTeam`) ใช้ `result_type` แต่ **caller ทั้งหมดเป็นหน้า League/generic** (`app/matches/[matchId]`, `components/MatchCard.tsx`, `components/PublicDashboard.tsx`) ไม่มี caller จาก Tournament route ใดเลย | มี Field รองรับในระดับ DB/type แต่ยังไม่ได้เชื่อมกับ Bracket UI |
| Best Third-place, Fair Play, จับฉลาก, Manual Override + Audit | — | **ไม่มีเลย** ในโค้ดปัจจุบัน |

---

## 3. Dependency กับ League

Tournament พึ่งพา League ใน 3 ระดับ:

**(a) Schema ระดับ Column** — Tournament เพิ่ม column บนตารางกลางแทนที่จะสร้างตารางของตัวเอง:
- `seasons.competition_type` (`migration-phase5a-tournament-foundation.sql:6-8`)
- `seasons.season_slug` (`migration-phase5a1-season-slug.sql:7`, ใช้ร่วมกันทั้ง 2 mode)
- `age_groups.code` — CHECK constraint เดิมจำกัดแค่ `U14/U17` ถูกถอดออกเพื่อรองรับ Tournament (`migration-phase5a2-flexible-age-codes.sql:8`) กระทบ League ด้วย (ตอนนี้ League ก็สร้าง age_group code อะไรก็ได้)
- `teams.division_id`, `players.division_id`, `matches.division_id` → เปลี่ยนจาก `NOT NULL` เป็น nullable (`migration-phase5a2-teams-division-optional.sql:8`, `migration-phase5a3-players-matches-division-optional.sql:8-9`) — เป็นการ "คลาย" constraint บนตารางกลางเพื่อ Tournament แม้ League ยังใช้ค่าจริงเสมอ
- `matches.stage`, `matches.tournament_group_id`, `matches.venue`, `matches.winner_team_id` (`migration-phase5a-tournament-foundation.sql:12-13`, `migration-phase5a4-tournament-fixtures.sql:7-11`, `migration-phase5b1-knockout-bracket.sql:43`)

**(b) Business Logic ระดับ Function** — `lib/calculations.ts::calculateStandings` (pure function, league-authored) ถูก import ตรงและใช้ **โดยไม่ fork** ใน:
- `lib/bracket.ts:2,108` (จัดอันดับกลุ่มก่อนสร้างสาย)
- `lib/public-tournament.ts:3,64` (Public group standings)
- `app/api/admin/tournament-groups/[groupId]/standings/route.ts:3`

**(c) Query ระดับ Table กลาง** — `matches`, `teams`, `players`, `goals`, `cards`, `suspensions` ถูก query ร่วมกันทุก route ที่ไม่ใช่ tournament-only (ดู [หมวด 4](#4-shared-tables))

---

## 4. Shared Tables

| Table | League ใช้ | Tournament ใช้ | หมายเหตุ |
|---|---|---|---|
| `seasons` | ✅ | ✅ (ผ่าน `competition_type`) | Discriminator column เดียวแยก mode |
| `age_groups` | ✅ | ✅ | CHECK ของ code ถูกถอด (a) |
| `divisions` | ✅ (จำเป็น) | ❌ ไม่ใช้เลย (Tournament ใช้ `tournament_groups` แทน) | League-only concept แต่ยังอยู่ใน schema กลาง |
| `teams` | ✅ (`division_id` required) | ✅ (`division_id = null` เสมอ, `lib/tournament-fixtures.ts:63,286`) | Table เดียว, discriminate ด้วย `division_id IS NULL` |
| `players` | ✅ | ✅ (`division_id = null`) | เช่นเดียวกับ teams |
| `matches` | ✅ (`stage = null`) | ✅ (`stage`, `tournament_group_id`, `venue`, `winner_team_id` ใช้จริง) | ตารางที่ผูกกันแน่นที่สุดในระบบ |
| `goals` | ✅ | ⚠️ Schema รองรับ (FK ไป `matches`) แต่ **ไม่มี Admin UIที่เข้าถึง Tournament match ได้** (R1) | |
| `cards` | ✅ | ⚠️ เช่นเดียวกับ goals (R1) | |
| `suspensions` | ✅ | ⚠️ Schema/engine รองรับตาม `season_id`+`age_group_id`+`team_id` (ไม่สนใจ `competition_type`) แต่ไม่เคยถูกใช้จริงกับ Tournament เพราะ cards เข้าไม่ได้ | `lib/suspension-calc.ts` ไม่มี branch เรื่อง competition_type เลย |
| `admin_profiles` | ✅ | ✅ | Auth เดียวกันทั้งระบบ ไม่มีสิทธิ์แยกระดับ League/Tournament |
| `admin_audit_logs` | ✅ | ✅ | ใช้ฟังก์ชันเดียวกัน `lib/audit-log.ts::logAdminAction` |

**Tournament-only tables** (ไม่มี League ใช้เลย): `tournament_groups`, `tournament_group_teams` (`migration-phase5a-tournament-foundation.sql:16-39`), `knockout_rounds`, `bracket_matches` (`migration-phase5b1-knockout-bracket.sql:5-38`)

---

## 5. Shared APIs

ตาราง API Dependency แบบเต็ม (60 route files ตรวจสอบแล้ว) — สรุปเฉพาะจุดสำคัญที่นี่ ตารางเต็มอยู่ในภาคผนวก [หมวด 11](#11-api-dependency-table-ฉบับเต็ม)

| กลุ่ม | จำนวน Route | Shared กับ League? |
|---|---|---|
| `tournament-groups`, `tournament-fixtures`, `tournament-bracket` (admin) | 15 | Tournament-only endpoint แต่เขียนลงตาราง `matches`/`teams` กลาง |
| `public/tournaments/**` | 5 | Tournament-only endpoint, อ่านตาราง `matches`/`teams` กลาง |
| `admin/seasons`, `admin/teams`, `admin/teams/bulk/*` | 7 | **Shared แท้จริง** — มี `competition_type`/`compType` branch ในโค้ด (`app/api/admin/teams/route.ts:108-120`, `app/api/admin/teams/[teamId]/route.ts:120-132`, `lib/bulk-import.ts:94`) |
| `admin/matches/[matchId]` | 1 | Shared, เขียน `matches` ไม่ branch แต่ trigger `refreshSuspensionServingMatches` เสมอ (`lib/suspension-calc.ts` via `app/api/admin/matches/[matchId]/route.ts:192-204`) |
| `admin/goals`, `admin/cards` (ทั้ง bulk และเดี่ยว) | 6 | Shared table แต่ **UI เข้าไม่ถึง Tournament match** (R1) |
| `public/standings` | 1 | **League-only จริง** — บังคับ `divisionId` (`app/api/public/standings/route.ts:16-21`) |
| `public/matches` | 1 | Shared, คืนทุก match ไม่กรอง `competition_type`/`stage` เลย |
| `public/divisions` | 2 | League-only concept แต่ไม่ gate ด้วย competition_type |

---

## 6. Shared Business Logic

| Function | File:Line | Shared? |
|---|---|---|
| `calculateStandings` | `lib/calculations.ts:4` | **Shared แบบ Direct Reuse ไม่ Fork** — League (`app/api/public/standings/route.ts`, exports, backup) และ Tournament (`lib/bracket.ts:108`, `lib/public-tournament.ts:64`) เรียกฟังก์ชันเดียวกันเป๊ะ |
| `calculateDisciplinePoints`, `getDisciplineLevel` | `lib/calculations.ts:59,83` | League-only (legacy formula), Tournament ไม่มี caller |
| `extractDivisionNumber` | `lib/calculations.ts:117` | League-only helper อยู่ปนในไฟล์เดียวกับ standings engine ที่ใช้ร่วมกัน |
| `buildTemplate`, `resolveGroupRanks`, `resolveSource`, `decideWinner`, `knockoutMatchCode` | `lib/bracket.ts:29,86,121,150,64` | Tournament-only, caller เดียวคือ `tournament-bracket/*` routes |
| `buildFixtureContext`, `validateFixtureRow` | `lib/tournament-fixtures.ts:115,203` | Tournament-only |
| `resolveTournamentContext`, `computeGroupStandings` | `lib/public-tournament.ts:12,42` | Tournament-only, แต่ **โครงสร้างซ้ำกับ `resolveGroupRanks` ใน `lib/bracket.ts` เกือบทั้งหมด** (ดู [หมวด 9](#9-technical-debt) TD-1) |
| `buildTeamContext`, `validateTeamRow` | `lib/bulk-import.ts:53,74` | Shared, มี branch เดียว `compType === 'league'` ที่ `lib/bulk-import.ts:94` บังคับ division เฉพาะ league |
| `recalculatePlayerSuspensionEventBased`, `refreshSuspensionServingMatches`, ทั้งไฟล์ `suspension-calc.ts`/`suspension-shared.ts`/`suspension-status.ts`/`suspension-table-utils.ts` | `lib/suspension-calc.ts` (1096 lines) + 3 ไฟล์ | Schema/logic รองรับ Tournament ได้ในทางทฤษฎี (ไม่มี branch แยก) แต่ **ไม่มี caller จาก Tournament route ใดเลย** เพราะ R1 บล็อกอยู่ |
| `logAdminAction` | `lib/audit-log.ts:35` | Shared infra แท้จริง ใช้เหมือนกันทั้ง League/Tournament routes |
| `verifyAdminAuth`, `requireAdminAuth`, `hasPermission` | `lib/admin-middleware.ts:24,120,157` | Shared infra, ไม่มีสิทธิ์แยกระดับ module |
| Public slug/URL resolvers (`buildStandingsPath`, `resolveCurrentSeasonSlug`, ฯลฯ) | `lib/public-slugs.ts` (305 lines) | **League-only โดยโครงสร้าง** (ผูกกับ `divisions` ทั้งไฟล์) — Tournament ใช้ resolver คู่ขนานคนละชุด (`resolveTournamentContext`) ไม่มีจุดร่วมกันเลย |

---

## 7. Shared Types

ทุก type อยู่ใน `types/db.ts` ไฟล์เดียว ไม่มีการแยก `LeagueX`/`TournamentX` เลย:

- `Team`, `Player`, `Match` — nullable fields (`division_id`, `stage`, `tournament_group_id`, `venue`, `winner_team_id`) ถูกเติมเข้า type เดียวกันเพื่อรองรับทั้งสองโหมด (`types/db.ts:38,52,68,79-82`)
- `Standing` — **League-only โดย type-level**: `division_id: string` เป็น required field (`types/db.ts:202`) ดังนั้น Tournament group standings ต้องประกาศ type คู่ขนานเอง (`GroupStanding` ใน `lib/public-tournament.ts:35-40`) แทนที่จะ reuse `Standing`
- **ไม่มี type `TournamentGroup` หรือ `BracketMatch`-ทางการ** แม้จะมีตาราง `tournament_groups`/`bracket_matches` จริงในฐานข้อมูล — โค้ดใช้ inline shape/`any` แทน (`lib/public-tournament.ts:44`, `lib/bracket.ts` ทั้งไฟล์ประกาศ interface ท้องถิ่นเอง `GroupRank`, `TemplateMatch` แทนที่จะมี canonical DB type)
- `Match` type ตัวเดียวถูก import ทั้งฝั่ง League (`lib/calculations.ts:1`, `app/admin/matches/page.tsx:5` ฯลฯ) และ Tournament (`lib/bracket.ts:4`, `lib/public-tournament.ts:4`) — ไม่มี Type Boundary แยกตามที่ Section 10.5 ของแผนต้นทางต้องการ

---

## 8. Shared Admin/Public Pages

### Admin — แบ่งเป็น 4 กลุ่มตามพฤติกรรมจริง (ไม่ใช่ตามชื่อไฟล์)

1. **Tournament-only, ไม่มี League fallback**: `tournament-groups`, `tournament-fixtures`, `tournament-bracket` (3 หน้า)
2. **Shared + มี `competition_type` branch จริง**: `admin/seasons` (ตั้งค่า competition_type), `admin/teams` (`compType` ที่ `page.tsx:355-357`), `admin/matches` list (`compType`/`divisionRequired` ที่ `page.tsx:25-26,76-90`)
3. **Shared แต่ "แกล้งทำเป็น" รองรับทั้งคู่ทั้งที่ไม่ได้ทดสอบ**: `admin/matches/[matchId]` (ใช้ได้จริงเพราะไม่ gate ด้วย division)
4. **Shared แต่ Gate ด้วย Division จนใช้กับ Tournament ไม่ได้จริง (R1)**: `admin/goals`, `admin/cards`, `admin/matches/manage`, `admin/players` (ไม่ทดสอบ แต่ pattern เดียวกันน่าจะกระทบ), `admin/match-bulk-import` (ทั้งหมด `selectedDivision`-based)

### Public

- `app/tournaments/**` (5 หน้า) — Tournament-only, ใช้ `components/TournamentSubNav.tsx`
- `app/fixtures/**` — **Shared แบบไม่แยกเลย**: `components/FixturesView.tsx:57` เรียก `/api/public/matches?seasonId=&ageGroupId=` ซึ่งไม่กรอง `competition_type`/`stage` คืนทั้ง League และ Tournament matches มาปนกันในตารางเดียว ไม่มี label กลุ่ม/สาย
- `app/standings/**`, `app/top-scorers/**` — League-only โดยโครงสร้าง (ผูก `divisions`, `Standing.division_id` required) — ถ้าชี้ไปที่ Tournament season จะได้ empty-state "ไม่พบดิวิชั่นของรุ่นอายุนี้" ไม่ใช่ error ที่ชัดเจน (`app/standings/[[...slug]]/page.tsx`)
- `app/discipline/**` — ใช้ query param `divisionId` ได้แต่ไม่บังคับ, ทำงานกับ player ทุกคนได้ในทางทฤษฎี แต่ไม่มี Tournament-specific UI
- `app/matches/[matchId]` — Shared, render generic (ไม่มี bracket/group visualization พิเศษ)
- `components/PublicChrome.tsx` — Nav shell เดียวสำหรับทั้งเว็บ มีลิงก์ "ทัวร์นาเมนต์" ปนกับลิงก์ League (`PublicChrome.tsx:14-21`)

---

## 9. Technical Debt

| ID | รายละเอียด | หลักฐาน |
|---|---|---|
| TD-1 | `resolveGroupRanks` (`lib/bracket.ts:86-118`) และ `computeGroupStandings` (`lib/public-tournament.ts:42-71`) เป็น logic การจัดอันดับกลุ่มที่ **เกือบซ้ำกันทุกบรรทัด** (query ตาราง `tournament_groups`/`tournament_group_teams`/`matches` เดียวกัน, sort ด้วย condition เดียวกัน) แต่แยกไฟล์และไม่ใช้ร่วมกัน — สองจุดต้องแก้พร้อมกันทุกครั้งที่เปลี่ยนกติกา | `lib/bracket.ts:99-116` vs `lib/public-tournament.ts:55-69` |
| TD-2 | Naming collision "Phase 5" ระหว่าง Tournament feature กับ Suspension hardening effort | `scripts/migration-phase5*.sql` vs `docs/phase-5-2a/`, `docs/phase-5-3/` |
| TD-3 | ไม่มี canonical TypeScript type สำหรับ `TournamentGroup`/`BracketMatch`/`KnockoutRound` ทั้งที่มีตารางจริง ใช้ inline/`any` แทนทั้งระบบ | `lib/public-tournament.ts:44`, `lib/bracket.ts` ทั้งไฟล์ |
| TD-4 | Standings engine (`calculateStandings`) เขียนโดยมโนทัศน์ League (division-based) แต่ถูก reuse ตรงๆ ใน Tournament โดยไม่มี abstraction/interface กั้น — เปลี่ยนกติกา League standings จะกระทบ Tournament ทันทีโดยไม่ตั้งใจ | `lib/calculations.ts:4` |
| TD-5 | Bracket engine รองรับเฉพาะ single-elimination ขนาด 4/8/16 คงที่ ไม่มี custom round, ไม่รองรับ Round of 32, ไม่มี Bye-handling ที่เชื่อมกับ Bracket UI จริง (มี `lib/match-utils.ts` แต่ไม่มี Tournament caller) | `lib/bracket.ts:6,29-34` |
| TD-6 | `lib/public-slugs.ts` (League URL resolver, 305 บรรทัด) กับ `resolveTournamentContext` (Tournament URL resolver) เป็นระบบ resolve URL คู่ขนานที่ไม่มีจุดร่วมกันเลย เพิ่ม Route ใหม่ต้องรู้ว่าจะใช้ระบบไหน | `lib/public-slugs.ts` ทั้งไฟล์ vs `lib/public-tournament.ts:12-33` |
| TD-7 | Bulk import (`lib/bulk-import.ts`) มี branch เดียว (`compType === 'league'`) ฝังอยู่กลางฟังก์ชันทั่วไป แทนที่จะแยก validator คนละชุด | `lib/bulk-import.ts:94` |
| TD-8 | Zero automated test coverage สำหรับทุกไฟล์ Tournament-specific และสำหรับ `lib/calculations.ts` (League standings engine ที่ Tournament ก็พึ่งพา) | ดู [หมวด 10](#10-production-risk) R2 |

---

## 10. Production Risk

### R1 — Tournament match บันทึก Goals/Cards ไม่ได้ (Severity: สูง)
- `app/admin/goals/page.tsx:108`: `if (!seasonId || !ageGroupId || !divisionId) return;` — ไม่มี `competition_type` branch เลย (ต่างจาก `admin/matches/page.tsx:88-90` ที่มี)
- `app/admin/cards/page.tsx:157`: เงื่อนไขเดียวกัน ไม่มี branch
- `app/admin/matches/manage/page.tsx:360,930`: เงื่อนไขเดียวกัน
- ผลคือ: Tournament season ที่ไม่มี `divisions` เลย (ตามโมเดลที่ตั้งใจ) จะโหลด `divisions = []` → `divisionId` ไม่เคยถูกตั้งค่า → หน้าโหลด matches ไม่ได้ → บันทึกประตู/ใบเหลืองแดงไม่ได้เลยสำหรับนัดที่จัดผ่าน Tournament Fixtures
- **Recommendation**: ต้องแก้ก่อนใช้งานจริงหรือรับทราบเป็นข้อจำกัดที่ประกาศไว้ชัดเจน — ไม่ใช่งานของรอบ Preparation นี้ (ห้ามแก้โค้ด) แต่ต้องขึ้น Open Question และวางแผนใน Phase 5/8

### R2 — ไม่มี Automated Test สำหรับ Tournament Logic เลย (Severity: สูง)
- Repo มีไฟล์ทดสอบ 5 ไฟล์ (`lib/__tests__/*.test.ts`, รวม 1543 บรรทัด) ทั้งหมดทดสอบเฉพาะ Suspension subsystem
- `lib/bracket.ts`, `lib/tournament-fixtures.ts`, `lib/public-tournament.ts`, `lib/calculations.ts` และทุก route ใต้ `tournament-groups/tournament-fixtures/tournament-bracket/tournaments` **ไม่มีการทดสอบเลยแม้แต่ไฟล์เดียว**
- Bracket advancement (`decideWinner`, `resolveSource` ใน `lib/bracket.ts:150,121`) เป็น logic ที่กระทบผลการแข่งขันโดยตรงและไม่เคยถูกแก้ไขอีกเลยตั้งแต่ commit แรก (`36e281a`) — เสี่ยง regression เงียบ

### R3 — Tiebreak/Standings Rule ไม่ครบตามที่ต้องการ (Severity: กลาง-สูง ขึ้นกับ Requirement)
- Sort ปัจจุบัน: `points → goalDiff → goalsFor → team name (th locale)` เท่านั้น (`lib/bracket.ts:109-111`, `lib/public-tournament.ts:67`)
- ไม่มี Head-to-head, Fair Play, จับฉลาก, Mini-table, Cross-group ranking, Best-third-place — ทั้งหมดที่แผนต้นทางต้องการ (Section 6-7) **ไม่มีอยู่ในระบบปัจจุบันเลย**

### R4 — Single Supabase Project / Single Blast Radius (Severity: กลาง)
- `lib/supabase.ts:3-4,14` ใช้ env var ชุดเดียว ไม่มีการแยก connection ระหว่าง League/Tournament
- RLS policies ของทุกตาราง (League + Tournament) อยู่ในไฟล์/โปรเจกต์เดียวกัน — Migration ผิดพลาดจุดใดกระทบทั้งระบบ

### R5 — Naming/Documentation Collision (Severity: ต่ำ แต่เสี่ยง Human Error)
- ดู TD-2 — ทีมอาจหยิบ Runbook "Phase 5" ผิดชุดเมื่ออ้างอิงในอนาคต

### R6 — Public Fixtures ปนกันไม่แยก League/Tournament (Severity: ต่ำ-กลาง, UX)
- `/fixtures` แสดง match ทุกประเภทปนกันโดยไม่มี label แยก (`app/api/public/matches/route.ts` ไม่กรอง `stage`)

---

## 11. API Dependency Table (ฉบับเต็ม)

> หมายเหตุ: ตารางนี้รวบรวมจากการอ่านไฟล์ route.ts จริงทั้ง 60 ไฟล์ที่เกี่ยวข้อง (`app/api/admin/{tournament-groups,tournament-fixtures,tournament-bracket,seasons,teams,players,matches,goals,cards,suspensions,age-groups,divisions}/**`, `app/api/public/{tournaments,matches,standings,discipline,suspensions,teams,seasons,age-groups,divisions,top-scorers,dashboard}/**`)

| Route | Table อ่าน | Table เขียน | Shared กับ League | lib/ dependency |
|---|---|---|---|---|
| `/api/admin/tournament-groups` (GET/POST) | `tournament_groups`, `tournament_group_teams` | `tournament_groups` | Tournament-only | – |
| `/api/admin/tournament-groups/[groupId]` (PUT/DELETE) | `tournament_groups`, `tournament_group_teams` | `tournament_groups`, cascade `tournament_group_teams` | Tournament-only | – |
| `/api/admin/tournament-groups/[groupId]/standings` (GET) | `tournament_groups`, `tournament_group_teams`, `teams`, `matches` | – | **Shared logic** (`calculateStandings`) | `lib/calculations.ts` |
| `/api/admin/tournament-groups/[groupId]/teams` (GET/POST/DELETE) | `tournament_group_teams`, `tournament_groups`, `teams` | `tournament_group_teams` | Tournament-only | – |
| `/api/admin/tournament-fixtures` (GET/POST) | `matches` (`stage`,`tournament_group_id`), `teams`, `tournament_group_teams` | `matches` | Tournament-only path, shared table | `lib/tournament-fixtures.ts` |
| `/api/admin/tournament-fixtures/[matchId]` (PUT/DELETE) | `matches`, `goals`, `cards` | `matches` | Tournament-only path, shared table | `lib/tournament-fixtures.ts` |
| `/api/admin/tournament-fixtures/import/{preview,save}` | `seasons`, `age_groups` | `matches` (save) | Tournament-only | `lib/tournament-fixtures.ts` |
| `/api/admin/tournament-fixtures/template` (GET) | – | – | Tournament-only | `lib/tournament-fixtures.ts` |
| `/api/admin/tournament-bracket/{generate,preview,recalculate-advancement}` | `age_groups`,`knockout_rounds`,`bracket_matches`,`goals`,`cards`,`matches`,`teams` | `knockout_rounds`,`bracket_matches`,`matches` | Tournament-only | `lib/bracket.ts` |
| `/api/admin/tournament-bracket` (GET), `/[bracketMatchId]` (PUT/DELETE) | `knockout_rounds`,`bracket_matches`,`matches`,`goals`,`cards` | `bracket_matches`,`matches` | Tournament-only | – |
| `/api/public/tournaments` (GET) | `seasons`,`age_groups` | – | Tournament-only (`.in('competition_type',['tournament','mixed'])`) | – |
| `/api/public/tournaments/[seasonSlug]/[ageGroupCode]/{overview,groups,fixtures,bracket}` | `seasons`,`age_groups`,`tournament_groups`,`tournament_group_teams`,`matches`,`knockout_rounds`,`bracket_matches`,`teams` | – | Tournament-only | `lib/public-tournament.ts` |
| `/api/admin/seasons` (GET/POST), `/[seasonId]` (GET/PUT/DELETE) | `seasons`,`age_groups`,`teams`,`matches`,`players` | `seasons`,`age_groups` cascade | **Shared真** (`competition_type` validated/stored) | – |
| `/api/admin/teams` (GET/POST), `/[teamId]` | `teams`,`players`,`matches`,`goals`,`cards`,`suspensions`,`divisions` | `teams` | **Shared真** (`compType==='league'` gate) | – |
| `/api/admin/teams/bulk/{preview,save,template}` | `seasons`,`age_groups`,`teams` | `teams` | **Shared真** (`compType` threaded) | `lib/bulk-import.ts` |
| `/api/admin/players/**` | `players`,`teams` | `players` | Shared, no branch | `lib/bulk-import.ts` (bulk only) |
| `/api/admin/matches/[matchId]` (GET/PUT) | `matches`,`goals`,`cards` | `matches` | Shared, no branch, triggers suspension refresh | `lib/suspension-calc.ts` |
| `/api/admin/goals/**`, `/api/admin/cards/**` | `goals`/`cards`,`matches`,`players` | `goals`/`cards` | Shared table, **UI unreachable for tournament (R1)** | `lib/suspension-calc.ts` (cards only) |
| `/api/admin/suspensions/**` | `suspensions`,`matches`,`cards` | `suspensions` | Shared, no branch | `lib/suspension-calc.ts` |
| `/api/admin/age-groups/**`, `/api/admin/divisions/**` | `age_groups`/`divisions`,`teams`,`matches` | same | Shared (divisions = league-oriented concept, no gate) | – |
| `/api/public/matches` (GET), `/[id]` | `matches`,`teams`,`divisions`,`goals`,`cards`,`suspensions`,`staff_discipline_events` | – | Shared, no `stage`/`competition_type` filter | `lib/suspension-calc.ts` (`[id]` only) |
| `/api/public/standings` (GET) | `matches`,`teams` | – | **League-only** (`divisionId` required) | `lib/calculations.ts` |
| `/api/public/discipline`, `/api/public/suspensions` | `cards`,`players`,`suspensions` | – | Shared | `lib/suspension-calc.ts` (suspensions) |
| `/api/public/teams` (GET), `/[id]` | `teams`,`divisions`,`age_groups`,`seasons`,`players`,`matches`,`goals`,`cards`,`suspensions` | – | Shared | `lib/suspension-calc.ts` (`[id]` only) |
| `/api/public/seasons`, `/age-groups`, `/divisions` | respective tables | – | Shared, no branch | – |
| `/api/public/top-scorers`, `/api/public/dashboard` | `goals`,`players`,`teams` / multi-table summary | – | Shared | – |

---

## 12. File Reference — Consolidated

**Migration files (tournament-specific, chronological)**:
`scripts/migration-phase5a-tournament-foundation.sql` → `migration-phase5a1-season-slug.sql` → `migration-phase5a2-flexible-age-codes.sql` → `migration-phase5a2-teams-division-optional.sql` → `migration-phase5a3-players-matches-division-optional.sql` → `migration-phase5a4-tournament-fixtures.sql` → `migration-phase5b1-knockout-bracket.sql`

**Core business logic**: `lib/bracket.ts`, `lib/tournament-fixtures.ts`, `lib/public-tournament.ts`, `lib/calculations.ts` (shared), `lib/suspension-calc.ts` + `suspension-shared.ts` + `suspension-status.ts` + `suspension-table-utils.ts` (shared, schema-compatible, not yet wired to tournament UI)

**Admin pages**: `app/admin/tournament-groups/page.tsx`, `app/admin/tournament-fixtures/page.tsx`, `app/admin/tournament-bracket/page.tsx`, plus shared: `app/admin/seasons/page.tsx`, `app/admin/teams/page.tsx`, `app/admin/matches/page.tsx`, `app/admin/matches/[matchId]/page.tsx`, `app/admin/matches/manage/page.tsx`, `app/admin/goals/page.tsx`, `app/admin/cards/page.tsx`

**Public pages**: `app/tournaments/page.tsx` + `[seasonSlug]/[ageGroupCode]/{page,groups/page,fixtures/page,bracket/page}.tsx`, `components/TournamentSubNav.tsx`, `components/PublicChrome.tsx`

**Types**: `types/db.ts` (single shared file, 277 lines)

**Tests**: `lib/__tests__/{suspension-calc,suspension-public-match,suspension-serving-refresh,suspension-shared,suspension-table-utils}.test.ts` (none cover tournament code)

**Commit chronology**: `d857750` (Phase 5A foundation, 2026-06-21) → `243f43b`, `ae2e48d`, `466cc4c`, `6eb595e`, `bcab918`, `c5c42f2` (Phase 5A.1–5A.5, all 2026-06-22) → `36e281a` (Phase 5B.1 bracket, 2026-06-22) → `e0dd5ef` (fixture/badge fix, 2026-06-27) → `457679b` (admin nav redesign, 2026-06-28)

---

## 13. Gap Analysis เทียบกับข้อกำหนด Multi-Venue Operations (v1.1)

> เพิ่มเข้ามาหลัง Preparation Plan อัปเดตเป็น `v1.1 — Multi-Venue Match Operations` (บริบท: 7 ประเภทการแข่งขัน กระจายลง 4 สนาม ต้องบันทึกผลพร้อมกันได้) หมวดนี้เป็นการตรวจสอบ**ข้อเท็จจริงของ V1 เทียบกับข้อกำหนดใหม่** ไม่ใช่การแก้ไขผลตรวจสอบเดิม — ทุกข้อสรุปในหมวด 1-12 ยังคงถูกต้องตามเดิม

| ข้อกำหนดใหม่ (v1.1) | สถานะใน V1 ปัจจุบัน | หลักฐาน |
|---|---|---|
| Venue เป็น Entity ที่มี Identity/Slug/Assignment ของตัวเอง | **ไม่มี** — `venue` เป็นแค่ `TEXT` freetext บนตาราง `matches` เท่านั้น ไม่มีตาราง venue, ไม่มี unique identity, พิมพ์ชื่อสนามผิดกันคนละครั้งจะกลายเป็นสนามคนละสนามในทางข้อมูล | `migration-phase5a4-tournament-fixtures.sql:10-11` (`add column venue text`), `types/db.ts:81` (`venue?: string \| null`) |
| Category ↔ Venue Mapping (7 ประเภท → 4 สนาม, ย้ายได้) | **ไม่มีแนวคิดนี้เลย** — ไม่มี field หรือ table เชื่อม `age_groups`/category กับ venue ใดๆ การกำหนดว่า category ไหนแข่งที่สนามไหนทำได้แค่พิมพ์ `venue` freetext ซ้ำๆ ในแต่ละ match เท่านั้น | ไม่พบใน schema ใดๆ (`scripts/schema.sql`, migration ทั้งหมด) |
| Role-Based Access Control ระดับ Venue/Category/Match | **ไม่มี** — Auth มีแค่ระดับเดียวคือ `admin_profiles.role IN ('admin','superadmin')` + boolean flags 3 ตัว (`can_edit_matches`, `can_edit_goals`, `can_edit_cards`) ไม่มี Scope ผูกกับ venue/category/match เลย | `scripts/admin-schema.sql:8-19` |
| Venue-scoped Authorization (เจ้าหน้าที่สนามเห็นเฉพาะสนามตัวเอง) | **ไม่มี** — Admin ทุกคนที่ login เห็นและแก้ไขได้ทุก season/age_group/match ในระบบเดียวกันหมด ไม่มีการกรองตาม scope ใดๆ ในทุก Admin Page ที่ตรวจสอบ | `lib/admin-middleware.ts:24-118` (`verifyAdminAuth` คืนแค่ authenticated + permission flag ระดับ global ไม่มี scope filter) |
| Quick Result / Full Match Report (2-stage entry) | **ไม่มี** — มีแค่แบบฟอร์มเดียว กรอกสกอร์ + สถานะในหน้าเดียว (`/admin/matches/[matchId]`) ไม่มีการแยกกรอกผลด่วนกับรายงานเต็มรูปแบบ | `app/admin/matches/[matchId]/page.tsx` |
| Result Approval Workflow (`draft/submitted/approved/published/...`) | **ไม่มี** — บันทึกแล้ว `status='finished'` มีผลทันที ไม่มีขั้นตอนอนุมัติ ไม่มี field แยก workflow status ออกจาก match status | `scripts/schema.sql:86` (`status` มีแค่ 4 ค่า: `scheduled/finished/postponed/cancelled`) |
| Result Correction Workflow พร้อม Audit | **บางส่วน** — มี `admin_audit_logs` บันทึกการแก้ไขทั่วไป (`lib/audit-log.ts`) แต่ไม่มี workflow เฉพาะสำหรับ "ขอแก้ผลที่ Publish แล้ว" (correction_requested/corrected) และไม่มีการเก็บ Version ของผลแต่ละครั้ง | `lib/audit-log.ts:35` (log เดี่ยว ไม่ใช่ version history) |
| Optimistic Locking / Version บน Match Result | **ไม่มี** — `matches` table มีแค่ `updated_at` เฉยๆ ไม่มี `version` column, ไม่มีการเช็ค stale-write ก่อน update | `scripts/schema.sql:72-95`, `app/api/admin/matches/[matchId]/route.ts` (PUT ทับค่าตรงๆ ไม่เช็ค version) |
| Idempotency Key สำหรับ Submit | **ไม่มี** — ไม่พบการใช้ idempotency key ใน API route ใดๆ ที่ตรวจสอบ (เสี่ยง Double Submit เมื่อเน็ตหลุดแล้ว retry) | ตรวจสอบทุก `app/api/admin/matches/**`, `app/api/admin/goals/**`, `app/api/admin/cards/**` ไม่พบ idempotency handling |
| Central Control Center (ภาพรวมหลายสนามพร้อมกัน) | **ไม่มี** — `app/admin/dashboard/page.tsx` เป็น summary/KPI รวมทั้งระบบ ไม่ได้ออกแบบมาเพื่อดูสถานะแยกตาม venue/สนาม และไม่มีแนวคิด "สนาม" ให้แยกอยู่แล้ว | `app/admin/dashboard/page.tsx` (283 lines), เรียกแค่ `/api/admin/dashboard/summary` รวมทั้งระบบ |
| Network Retry / Local Draft (Mobile-first, เน็ตไม่เสถียร) | **ไม่มี** — ทุกหน้า Admin เป็น standard client-side fetch ไม่มี offline queue, ไม่มี local draft persistence, ไม่มี retry-on-failure logic ที่ตรวจพบ | ตรวจสอบ `app/admin/matches/**`, `app/admin/goals/**`, `app/admin/cards/**` ไม่พบ localStorage draft หรือ retry queue (มีแค่ `localStorage` เก็บ `admin_token` เท่านั้น) |
| Public View แยกตามสนาม/รุ่นอายุ/เพศ/วันแข่งขัน | **บางส่วน** — Public filter ได้ตาม season/age_group ผ่าน `/fixtures` (`components/FixturesView.tsx`) แต่ **ไม่มี filter ตาม venue เลย** เพราะ venue เป็น freetext ไม่ใช่ entity ที่ query ได้ | `app/api/public/matches/route.ts` ไม่มี query param `venue` |
| Group Slot / จัดโปรแกรมก่อนจับฉลาก | **ไม่มี** — `tournament_group_teams` (V1) ผูก `team_id` แบบ `NOT NULL` เสมอ (`migration-phase5a-tournament-foundation.sql:30-37`) ต้องรู้ทีมก่อนถึงจะเพิ่มเข้ากลุ่มได้ ไม่มีแนวคิด "ตำแหน่งในกลุ่ม" ที่ว่างไว้ก่อน | `scripts/migration-phase5a-tournament-foundation.sql:30-37` |
| Placeholder รอบน็อกเอาต์ (ผู้ชนะ/แพ้/อันดับ 3 ที่ดีที่สุด) | **มีบางส่วนแต่จำกัดมาก** — `bracket_matches.home_source_type` รองรับแค่ 4 ค่า (`direct_team/group_rank/match_winner/match_loser`) ไม่มี `group_slot`, `best_ranked`, `bye`, `tbd` และผูกอยู่กับตาราง `bracket_matches` แยกต่างหาก ไม่ใช่ `matches` เอง — รอบแบ่งกลุ่มไม่มี Placeholder เลย มีแต่รอบน็อกเอาต์ | `lib/bracket.ts:121-137` (`resolveSource`) |
| Excel Import พร้อม Preview/Diff/Rollback Batch | **บางส่วน** — Import Fixture มี Preview (`app/api/admin/tournament-fixtures/import/preview`) แต่ **ไม่มี Rollback Batch, ไม่มี Diff กับข้อมูลเดิม, ไม่ Update ผ่าน `match_code` (สร้างใหม่อย่างเดียว)** | `app/api/admin/tournament-fixtures/import/{preview,save}/route.ts` |

**สรุปผลกระทบ**: ข้อกำหนด Multi-Venue Operations ทั้งหมดใน v1.1 เป็น **Net-New Capability** ที่ V1 ไม่มีรากฐานให้ต่อยอดแม้แต่น้อย (ต่างจาก Group Stage/Bracket ที่ V1 มีของเดิมให้ดูเป็นแนวทาง) ดังนั้นในเชิง Data Model และ Business Logic ส่วน Venue/RBAC/Result-Workflow คือการออกแบบใหม่ทั้งหมด ไม่ใช่การ Migrate จากของเดิม — สอดคล้องกับที่ `TOURNAMENT_V2_MIGRATION_MAP.md` ระบุว่าไม่มี Old Source ให้ map สำหรับส่วนนี้

**Production Risk เพิ่มเติม (R7)**: ถ้า Tournament V2 เปิดใช้งานจริงกับ 4 สนามพร้อมกันโดยยังใช้สถาปัตยกรรม Auth แบบ V1 (global admin, ไม่มี scope) — เจ้าหน้าที่สนามหนึ่งจะสามารถเข้าไปแก้ผลของอีก 3 สนามโดยไม่ตั้งใจได้ทันที เพราะไม่มีกลไกป้องกันระดับ Authorization เลยในโค้ดปัจจุบัน (Severity: สูง หากไม่ออกแบบ RBAC ใหม่ก่อนใช้งานจริง)

---

## Rollback Plan สำหรับเอกสารชุดนี้

เอกสารนี้เป็น Markdown ล้วน ไม่มีการแก้ไข Production/Schema/Route ใดๆ Rollback คือ `git branch -D docs/tournament-v2-preparation` หรือไม่ merge branch นี้เข้า `main` — ไม่มีผลกระทบต่อระบบที่ทำงานอยู่จริง
