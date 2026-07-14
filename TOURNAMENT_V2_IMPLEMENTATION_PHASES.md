# Tournament V2 — Implementation Phases

**สถานะ**: แผนงานเท่านั้น — **ห้ามเริ่ม Phase ใดจนกว่า Current State Audit, Target Architecture และ Data Model จะได้รับการอนุมัติ**
**หลักการ**: ทุก Phase ต้องเป็นงานขนาดเล็ก, Rollback ได้อิสระ, ไม่แตะ League Route/Table/Business Logic จนกว่าจะถึง Phase Cutover (13) และ Legacy Decommission (14) ซึ่งต้องขออนุมัติแยกเป็นพิเศษอีกครั้งนอกเหนือจากรอบนี้
**ปรับปรุงตาม v1.1**: Phase 2, 3 และ 5 ขยายขอบเขตให้ครอบคลุม Venue/Court/RBAC/Result-Approval-Workflow ตาม `TOURNAMENT_V2_VENUE_OPERATIONS.md` — ทุก Phase ตั้งแต่ 5 เป็นต้นไปต้องผ่าน Acceptance Criteria "ใช้งานพร้อมกันได้จริงจาก 4 สนาม" ไม่ใช่แค่ single-user sequential test
**ปรับปรุงตาม Scheduling Addendum**: Phase 4 ขยายเป็น Group Slot + Round Robin + Excel Export/Import เต็มรูปแบบ, Phase 5a เพิ่ม Placeholder Resolution, Phase 7 ปรับใหม่ทั้งหมดตาม Data Model Correction (ยุบ `tournament_bracket_matches` เข้า `tournament_matches`) — รายละเอียดเต็มอยู่ใน `TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md`

---

## Phase 0 — Audit and Freeze

- **Scope**: จัดทำเอกสาร Audit ทั้ง 8 ฉบับ (รอบปัจจุบัน), Freeze ขอบเขต League ที่ห้ามแตะระหว่างพัฒนา Tournament V2
- **Files Expected to Change**: `TOURNAMENT_V2_*.md` (เอกสารเท่านั้น), ไม่มีโค้ด
- **Database Change**: ไม่มี
- **Tests**: ไม่มี (ยังไม่มีโค้ด)
- **Acceptance Criteria**: เจ้าของระบบอนุมัติเอกสารทั้ง 8 ฉบับ + ตอบ Open Questions ที่ block งาน (Database Isolation, Migrate-vs-Fresh)
- **Rollback Plan**: ลบ branch `docs/tournament-v2-preparation` หากไม่อนุมัติแนวทาง — ไม่มีผลกระทบใดๆ
- **League Regression Checklist**: N/A (ไม่มีการแก้โค้ด)

---

## Phase 1 — Database Foundation

- **Scope**: สร้าง Tournament Supabase Project ใหม่ (ตาม Recommendation Option A), ตั้งค่า Environment Variables ใน Vercel (Preview ชี้ Staging, Production ชี้ Production — ยังไม่ผูกกับ Production traffic จริง), รัน DDL จาก `TOURNAMENT_V2_DATA_MODEL.md` บน Project ใหม่เท่านั้น
- **Files Expected to Change**: ไฟล์ SQL ใหม่ใต้ `scripts/tournament-v2/001-foundation.sql` เป็นต้นไป (Draft ก่อน, รันจริงเฉพาะ Project ใหม่), `lib/tournament/db/supabase-tournament.ts` (ไฟล์ client ใหม่)
- **Database Change**: สร้างตารางทั้งหมดใน `TOURNAMENT_V2_DATA_MODEL.md` **บน Tournament Project ใหม่เท่านั้น** — League DB ไม่ถูกแตะเลย
- **Tests**: Connectivity test (`getServiceClient` เชื่อมต่อได้), Smoke test สร้าง/ลบ record ทดสอบในตารางใหม่
- **Acceptance Criteria**: ทุกตารางใน Data Model สร้างสำเร็จพร้อม RLS + Index; `npm run test` (League tests เดิม) ยังผ่านครบ 100% โดยไม่มีการแก้ไข
- **Rollback Plan**: ลบ Tournament Supabase Project ทิ้งได้ทันที (ยังไม่มีการอ้างอิงจาก Production code)
- **League Regression Checklist**: รัน `npm run test` เดิมผ่านครบ; ตรวจ Vercel env vars ของ League (`NEXT_PUBLIC_SUPABASE_URL` ฯลฯ) ไม่ถูกแก้ไข

---

## Phase 2 — Tournament Core Domain (+ Venue/Court Foundation, v1.1)

- **Scope**: Implement CRUD สำหรับ `tournaments`, `tournament_categories`, `tournament_venues`, **`tournament_courts`, `tournament_category_venues`** (ใหม่ v1.1), Seed ข้อมูลตั้งต้น 4 สนาม + 7 ประเภทตาม mapping จริง (ดู `TOURNAMENT_V2_MIGRATION_MAP.md` หมวด 6)
- **Files Expected to Change**: `app/api/tournament/admin/tournaments/**`, `/categories/**`, `/venues/**`, `/courts/**`, `/category-venues/**`, `app/admin/tournament/(setup)/**` (หน้าใหม่, รวม UI จับคู่ Category↔Venue แบบ drag-select ไม่ hardcode), `lib/tournament/services/*.ts`
- **Database Change**: ไม่มีเพิ่ม (ใช้ตารางจาก Phase 1) + รัน Seed Script สร้าง 4 venues / 7 categories / 7 category_venues mapping rows
- **Tests**: Unit test สำหรับ validation logic (slug uniqueness, category code uniqueness), Unit test ว่า mapping เปลี่ยนได้โดยไม่ต้อง deploy โค้ดใหม่ (เช่น ย้าย category ไปอีกสนามผ่าน UI แล้ว query ผลลัพธ์เปลี่ยนทันที), Integration test CRUD ผ่าน API จริงกับ Tournament DB
- **Acceptance Criteria**: สร้าง/แก้/ลบ (soft) tournament + category + venue + court ได้ผ่าน Admin UI ใหม่; ย้าย Category ไปสนามอื่นได้โดยไม่แก้โค้ด (พิสูจน์ว่าไม่ hardcode); Audit log บันทึกทุก mutation
- **Rollback Plan**: ปิด Route ใหม่ (feature flag หรือลบไฟล์ page.tsx) — ไม่กระทบ League เพราะเป็นไฟล์ใหม่ทั้งหมด
- **League Regression Checklist**: ตรวจ `app/admin/seasons/page.tsx` (League season UI เดิม) ยังทำงานปกติ, `npm run test` ผ่าน

---

## Phase 3 — Teams / Players / Staff (+ RBAC Foundation, v1.1)

- **Scope**: CRUD ทีม/นักกีฬา/สตาฟ, Bulk Import (fork จาก `lib/bulk-import.ts` เดิมแต่ตัด branch `compType==='league'` ออกเพราะไม่มี division เลยใน V2) **+ Implement RBAC เต็มรูปแบบ**: `tournament_user_profiles`, `tournament_role_assignments`, `authorizeVenueScope()`, หน้า Admin จัดการสิทธิ์ผู้ใช้ต่อสนาม/ประเภท
- **Files Expected to Change**: `app/api/tournament/admin/teams/**`, `/players/**`, `/staff/**`, `/role-assignments/**` (ใหม่), `lib/tournament/services/teamValidation.ts`, `lib/tournament/services/playerValidation.ts`, `lib/tournament/services/authorizeVenueScope.ts` (ใหม่), `app/admin/tournament/{teams,players,staff,users}/page.tsx`
- **Database Change**: ไม่มีเพิ่ม (ใช้ตารางจาก Phase 1) + สร้าง `tournament_role_assignments` เริ่มต้นตาม Seed Plan (1 super_admin + 4 venue_manager)
- **Tests**: Unit test สำหรับ `team_code` uniqueness ภายใน category, shirt number uniqueness ภายในทีม, bulk import row validation; **Unit test `authorizeVenueScope()` ครบทุก role × scope combination** (เช่น `result_operator` ของสนาม 1 พยายามเขียนข้อมูลสนาม 2 ต้องถูก reject), Integration test QR Code login ยัง require authentication ปกติ
- **Acceptance Criteria**: Import ทีม/นักกีฬาจำนวนมากผ่าน Excel ได้; ป้องกัน team_code ชนกันในกลุ่มเดียวกันได้จริง; **เจ้าหน้าที่สนาม 1 เรียก API แก้ข้อมูลสนาม 2 ต้องได้ 403 เสมอ (ปิด Production Risk R7 จาก Current State Audit ให้สมบูรณ์)**
- **Rollback Plan**: ปิด Route ใหม่, ไม่กระทบ `lib/bulk-import.ts` เดิมของ League เพราะ Fork เป็นไฟล์ใหม่
- **League Regression Checklist**: `app/admin/teams/page.tsx`, `app/admin/players/page.tsx` (League) ยังใช้งานได้ปกติ, Bulk import League ยังทำงานถูกต้อง, `lib/admin-middleware.ts` ของ League ไม่ถูกแก้ไข

---

## Phase 4 — Groups, Draw and Scheduling Foundation (ขยายเต็มรูปแบบตาม Scheduling Addendum)

แบ่งเป็น 3 Sub-phase — Rollback ได้อิสระจากกัน

### Phase 4a — Group Slot + Round Robin Generation

- **Scope**: CRUD `tournament_groups`, Generate Group Slot (`tournament_group_members.slot_code`) ตามจำนวนกลุ่ม/ทีมต่อกลุ่มที่กำหนด, Generate Round Robin Pairing (Circle Method) รองรับ 3/4/5/6 ทีม + จำนวนคี่ (Internal Bye), Preview ก่อนสร้างจริง, ป้องกันคู่ซ้ำ, Idempotent Regenerate
- **Files Expected to Change**: `app/api/tournament/admin/groups/**`, `/groups/[id]/slots`, `/groups/[id]/generate-pairings`, `app/admin/tournament/groups/page.tsx`, `lib/tournament/scheduling/generateGroupSlots.ts`, `lib/tournament/scheduling/generateRoundRobin.ts`
- **Database Change**: ไม่มีเพิ่ม (ใช้ `tournament_groups`/`tournament_group_members` จาก Phase 1)
- **Tests**: **บังคับ Unit Test ครบทุกขนาดกลุ่ม** (3/4/5/6 ทีม, จำนวนคี่ต้องมี Bye ภายใน Algorithm ที่ถูกต้อง, Home/Away Balance), Unit test Regenerate ไม่ทำลาย Match ที่มีวันเวลาแล้วโดยไม่ยืนยัน, Unit test ป้องกันคู่ซ้ำ (pairing เดียวกันสร้างสองครั้งต้อง reject หรือ idempotent)
- **Acceptance Criteria**: Generate กลุ่ม 3/4/5/6 ทีมได้ผลลัพธ์ถูกต้องตรงตามตัวอย่าง Round Robin ในเอกสารต้นทาง; Regenerate ซ้ำได้ผลเดิมทุกครั้ง (Idempotent); ป้องกันเขียนทับ Match ที่จัดวันเวลาแล้ว
- **Rollback Plan**: ปิด Route ใหม่ ไม่กระทบ League
- **League Regression Checklist**: ไม่มีผลกระทบ (League ไม่มีแนวคิด Group) — ยืนยันด้วย `npm run test`

### Phase 4b — Excel Export/Import Fixtures

- **⛔ Blocked by Open Questions**: **Q24** (ค่า Default ระยะพักขั้นต่ำระหว่างนัด และจำนวนนัดสูงสุดต่อทีมต่อวัน — ต้องได้ตัวเลขจริงจากเจ้าของระบบก่อนเขียน Warning W3/W4 ใน `validateScheduleImportRow.ts` มิฉะนั้นต้องเว้น Threshold ไว้เป็น Config ว่างที่ปิดใช้งาน Warning เหล่านี้ชั่วคราว) และ **Q25** (ใครมีสิทธิ์ Rollback Import Batch — ต้องตอบก่อน Implement RBAC check บน Route `/schedule/import/batches/[id]/rollback`)
- **Scope**: Export โปรแกรมแข่งขัน (จาก Group Slot Pairing ที่ Generate แล้ว) เป็น Excel ตาม Format ใน `TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md` หมวด 3, Import กลับเข้าระบบพร้อม Preview/Validate เต็มรูปแบบ (Error/Warning Matrix), Save เฉพาะ Valid Rows, Update ผ่าน `match_code` (ไม่สร้างซ้ำ), Diff Preview, Rollback Batch
- **Files Expected to Change**: `app/api/tournament/admin/schedule/{export,import/preview,import/save}`, `/schedule/import/batches`, `/batches/[id]/rollback`, `app/admin/tournament/schedule/import/page.tsx`, `lib/tournament/scheduling/validateScheduleImportRow.ts`, `lib/tournament/scheduling/scheduleExcelTemplate.ts`
- **Database Change**: ไม่มีเพิ่ม (ใช้ `tournament_schedule_batches`/`tournament_schedule_import_rows` จาก Phase 1)
- **Tests**: **บังคับ Unit Test ครบ Validation Matrix ทั้ง Error และ Warning ทุกข้อ** (ดู `TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md` หมวด 7), Integration test Import ไฟล์เดิมซ้ำไม่สร้าง Match ซ้ำ (Idempotency ผ่าน `match_code`), Integration test Rollback Batch ลบเฉพาะ Match ที่ Batch นั้นสร้าง ไม่กระทบ Match อื่น
- **Acceptance Criteria**: Import ไฟล์ 100+ แถวได้ถูกต้อง แสดง Preview/Diff/Error/Warning ครบ; Import ซ้ำไฟล์เดิมไม่สร้างข้อมูลซ้ำ; Rollback Batch คืนสถานะก่อน Import ได้ถูกต้อง 100%
- **Rollback Plan**: ปิด Route ใหม่, ตัว Feature เองมี Rollback Batch ในตัวอยู่แล้ว
- **League Regression Checklist**: `app/api/admin/match-bulk/**` (League bulk import เดิม) ไม่ถูกแก้ไข — ตรวจด้วย `git diff`, `npm run test` ผ่าน

### Phase 4c — Draw Assignment Import + Placeholder Resolution (Group Stage)

- **Scope**: Import ไฟล์ `DRAW_ASSIGNMENTS` (ดู `TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md` หมวด 4), เขียน `tournament_draw_assignments` (append-only) + upsert `tournament_group_members`, Trigger `resolvePlaceholder()` ให้ทุก Match ที่อ้าง `group_slot` ของกลุ่มนั้นแสดงทีมจริงทันทีโดยไม่ต้องแก้ทีละคู่
- **Files Expected to Change**: `app/api/tournament/admin/draw/{import/preview,import/save,resolve}`, `app/admin/tournament/draw/page.tsx`, `lib/tournament/scheduling/drawAssignmentService.ts`, `lib/tournament/scheduling/resolvePlaceholder.ts`
- **Database Change**: ไม่มีเพิ่ม (ใช้ `tournament_draw_assignments` จาก Phase 1)
- **Tests**: **บังคับ Unit Test `resolvePlaceholder()` ครบทั้ง 8 source_type**, Integration test "จับฉลากครั้งเดียว ทุก Match ที่อ้าง Slot นั้นแสดงทีมจริงพร้อมกัน" (Acceptance Criteria หลักของทั้งโครงการ Scheduling), Unit test แยก `group_slot` (ตำแหน่งก่อนจับฉลาก) กับ `group_rank` (อันดับหลังแข่ง) ไม่ปะปนกันแม้ Input หน้าตาคล้ายกัน (`A-S1` vs `A:1`)
- **Acceptance Criteria**: กรอก Mapping ครั้งเดียว ทุก Match แสดงทีมจริงถูกต้อง; แก้ผลจับฉลากมี Audit Log และ Version ครบ; Re-resolve ที่กระทบ Match ที่ Publish แล้วถูก Block เข้าสู่ Correction Workflow (ไม่ resolve ทับเงียบๆ)
- **Rollback Plan**: ปิด Route ใหม่ ไม่กระทบ League
- **League Regression Checklist**: N/A — `npm run test` ผ่าน

---

## Phase 5 — Fixtures and Match Operations (ขยายเต็มรูปแบบตาม v1.1 Venue Operations)

แบ่งเป็น 3 Sub-phase ย่อยเพราะขอบเขตใหญ่ขึ้นมากจาก v1.1 — แต่ละ Sub-phase Rollback ได้อิสระจากกัน

### Phase 5a — Fixtures + Venue/Court Assignment

- **Scope**: สร้าง/แก้/ลบโปรแกรมแข่งขัน (manual + import) พร้อมระบุ `venue_id`/`court_id` ต่อนัด, **แก้ปัญหา R1 จาก Current State Audit โดยตรง** — ไม่ gate ด้วย division เพราะ Tournament V2 ไม่มี division เลยตั้งแต่ระดับ schema; นัดที่ยังไม่ resolve source (Placeholder ค้าง) ต้องแสดงป้าย "TBD" ที่ชัดเจนในทุกหน้าที่เกี่ยวข้อง (Admin + Public)
- **Files Expected to Change**: `app/api/tournament/admin/matches/**`, `lib/tournament/fixtures/*.ts`
- **Database Change**: ไม่มีเพิ่ม
- **Tests**: Integration test สร้าง match พร้อม venue/court assignment ถูกต้อง, Integration test Match ที่มี Placeholder ค้าง (`home_team_id`/`away_team_id` เป็น null) แสดงผลถูกต้องโดยไม่ error
- **Acceptance Criteria**: สร้างโปรแกรมแข่งขันครบ 7 ประเภท กระจาย 4 สนามตาม mapping ได้ถูกต้อง; Match ที่ยัง TBD ไม่ทำให้หน้า Matchday Dashboard (Phase 5b) พังหรือ error
- **Rollback Plan**: ปิด Route ใหม่
- **League Regression Checklist**: `npm run test` ผ่าน

### Phase 5b — Venue Matchday Dashboard + Quick Result (Stage A)

- **Scope**: หน้า Mobile-first `/admin/tournament/venues/[venueId]/matchday` (กำลังแข่ง/คิวถัดไป/รอผลลัพธ์ list ตาม Wireflow ใน `TOURNAMENT_V2_VENUE_OPERATIONS.md`), แบบฟอร์ม Quick Result (สกอร์ + สถานะ + ผู้บันทึกเบื้องต้น เท่านั้น — ไม่รวมประตู/ใบเหลืองแดงรายละเอียด), Local Draft Autosave, Retry Queue สำหรับ Network ไม่เสถียร
- **Files Expected to Change**: `app/admin/tournament/venues/[venueId]/matchday/page.tsx`, `app/api/tournament/admin/matches/[matchId]/quick-result/route.ts`, `lib/tournament/services/localDraft.ts` (client-side autosave helper), `lib/tournament/services/retryQueue.ts`
- **Database Change**: ไม่มีเพิ่ม (ใช้ `tournament_result_submissions` จาก Phase 1, `stage='quick_result'`)
- **Tests**: Unit test Local Draft persist/restore, Unit test Retry Queue ไม่สร้าง submission ซ้ำเมื่อ retry (idempotency), Integration test บันทึกคะแนน 0-0 ได้ถูกต้อง (ไม่ถูก treat เป็นค่าว่าง), Mobile viewport smoke test (responsive จริงบนหน้าจอมือถือ)
- **Acceptance Criteria**: เจ้าหน้าที่สนาม 1 มองเห็นเฉพาะนัดของสนาม 1 เท่านั้น (ไม่เห็นสนาม 2-4); กรอกผลด่วนเสร็จภายในไม่กี่ขั้นตอนบนมือถือจริง; Draft ไม่หายเมื่อ Refresh หน้าโดยไม่ตั้งใจ
- **Rollback Plan**: หน้า/Route ใหม่ทั้งหมด ปิดได้ทันที
- **League Regression Checklist**: N/A (League ไม่มี concept นี้) — `npm run test` ผ่าน

### Phase 5c — Full Match Report + Approval + Correction Workflow

- **Scope**: แบบฟอร์ม Full Match Report (ผู้ทำประตู, ใบเหลืองแดง, เหตุการณ์เพิ่มเติม, ผู้เข้าร่วมทีม, การบาดเจ็บ/เหตุการณ์พิเศษ, แนบเอกสาร/ภาพ), Submit → Approve → Publish workflow (Default: `two_step`), Correction Request Workflow, Optimistic Locking + Idempotency Key เต็มรูปแบบ, Database Transaction เมื่อ Publish (คำนวณ Standings/Bracket/Suspension พร้อมกัน)
- **Files Expected to Change**: `app/admin/tournament/matches/[matchId]/result/page.tsx`, `app/admin/tournament/result-review/page.tsx`, `app/api/tournament/admin/matches/[matchId]/{report,submit,approve,request-correction}/route.ts`, `lib/tournament/services/resultWorkflow.ts` (state machine), `lib/tournament/services/publishResult.ts` (transaction wrapper)
- **Database Change**: ไม่มีเพิ่ม (ใช้ `tournament_result_submissions/versions/approvals`, `tournament_match_attachments` จาก Phase 1)
- **Tests**: **บังคับ Unit Test ครบ State Machine** (`not_started→draft→submitted→approved→published`, และ `published→correction_requested→corrected`), Unit test Optimistic Lock reject เมื่อ version ไม่ตรง, Unit test Idempotency Key กัน double-submit จริง (ยิง submit ซ้ำด้วย key เดิม ต้องไม่สร้าง record ซ้ำ), Integration test Publish แล้ว Standings/Bracket/Suspension อัปเดตในธุรกรรมเดียวกัน (ถ้าขั้นตอนใดพัง ต้อง rollback ทั้งหมด), Integration test 2 คนแก้ผลนัดเดียวกันพร้อมกัน (concurrent write) ต้องมีฝั่งหนึ่งถูก reject ไม่ใช่ข้อมูลเสียหาย
- **Acceptance Criteria**: ผลที่ `published` แล้วต้องแก้ผ่าน Correction Workflow เท่านั้น (แก้ตรงไม่ได้); Standings/Bracket ไม่เปลี่ยนจาก Draft ที่ยังไม่ Publish; Central Control เห็นสถานะถูกต้องทุกสนามพร้อมกัน
- **Rollback Plan**: หน้า/Route ใหม่ทั้งหมด ปิดได้ทันที ไม่กระทบข้อมูลเพราะยังไม่มี Production traffic
- **League Regression Checklist**: `lib/suspension-calc.ts`, `lib/calculations.ts` ของ League **ไม่ถูกแก้ไขแม้แต่บรรทัดเดียว** — ตรวจด้วย `git diff`; รัน League regression suite เต็มรูปแบบ

### Phase 5d — Central Control Center

- **Scope**: หน้า `/admin/tournament/control-center` แสดงสถานะ 4 สนามพร้อมกัน (Polling ทุก 15-30 วินาทีตาม MVP), Conflict Detection, Notification เมื่อพบปัญหา
- **Files Expected to Change**: `app/admin/tournament/control-center/page.tsx`, `app/api/tournament/control-center/status/route.ts`
- **Database Change**: ไม่มีเพิ่ม
- **Tests**: Integration test ดึงสถานะ 4 สนามพร้อมกันได้ถูกต้อง, Unit test Conflict Detection logic (เช่น นัดเลยเวลานัดแต่ยังไม่มีผล)
- **Acceptance Criteria**: `central_control` มองเห็นสถานะทุกสนามในหน้าเดียว อัปเดตอัตโนมัติโดยไม่ต้อง Refresh เอง
- **Rollback Plan**: หน้าใหม่ทั้งหมด ปิดได้ทันที
- **League Regression Checklist**: N/A — `npm run test` ผ่าน

---

## Phase 6 — Standings Engine

- **Scope**: Implement `calculateGroupStandings`, `resolveTournamentTiebreak`, `rankCrossGroupCandidates`, `rankBestThirdPlacedTeams`, `calculateQualificationStatus`, `applyManualQualificationOverride` (Section 7 ของแผนต้นทาง)
- **Files Expected to Change**: `lib/tournament/standings/*.ts` (ไฟล์ใหม่ทั้งหมด), `app/api/tournament/admin/groups/[id]/standings`, `app/api/tournament/public/**/standings`
- **Database Change**: ไม่มีเพิ่ม (ใช้ `tournament_standing_rules`, `tournament_qualification_rules`, `tournament_standing_overrides` จาก Phase 1)
- **Tests**: **บังคับ Unit Test ครบ** — head-to-head, goal difference, Fair Play, จับฉลาก, mini-table, cross-group ranking, best-third-place, manual override — เป็น Test Suite ที่ V1 ไม่มีเลย (แก้ R2/R3 จาก Current State Audit)
- **Acceptance Criteria**: ทุก Tiebreak rule ใน Section 7 ของแผนต้นทางมี Unit Test ผ่านอย่างน้อย 1 เคสต่อกติกา; Manual Override เขียน Audit Log ทุกครั้ง
- **Rollback Plan**: Standings Engine เป็นไฟล์ใหม่ทั้งหมด ไม่กระทบ `lib/calculations.ts` เดิม — ปิด Route ใหม่ได้ทันที
- **League Regression Checklist**: `lib/calculations.ts::calculateStandings` (League) ไม่ถูกแก้ไขแม้แต่บรรทัดเดียว — ตรวจด้วย `git diff` ก่อน merge ต้องว่างเปล่าสำหรับไฟล์นี้

---

## Phase 7 — Knockout Structure and Advancement (ปรับใหม่ตาม Data Model Correction, Scheduling Addendum)

> **เปลี่ยนจากแผนเดิม**: เดิม Phase นี้ออกแบบให้ "Generate `tournament_bracket_matches`" เป็นขั้นตอนหลัก — เนื่องจากตารางนั้นถูกยุบรวมเข้า `tournament_matches` แล้ว (ดู Data Model หมวด 2.15) Phase นี้จึงเปลี่ยนเป็น **"วาง `tournament_matches` ของรอบน็อกเอาต์ล่วงหน้าพร้อม Source Definition"** แทน — Concept เดียวกับ Phase 4b/4c (Excel Import + Placeholder) เพียงแต่เป็นรอบน็อกเอาต์

- **⛔ Blocked by Open Question Q23**: เกณฑ์เปรียบเทียบทีมอันดับ 3 ที่ดีที่สุดข้ามกลุ่ม (`best_ranked`) เมื่อกลุ่มมีขนาดไม่เท่ากัน — ต้องตอบก่อน Implement `rankBestThirdPlacedTeams()` มิฉะนั้นทีม Dev ต้องเดากติกาแทนเจ้าของระบบ ซึ่งขัดกับหลักการที่ต้องไม่เดา

- **Scope**: Generate โครงสร้างรอบน็อกเอาต์ (`tournament_knockout_rounds` + `tournament_matches` ที่มี `round_id`) รองรับ Round of 32 + Custom Round (ต่างจาก V1 ที่จำกัด 4/8/16), วาง Placeholder ล่วงหน้าด้วย `group_rank`/`match_winner`/`match_loser`/`best_ranked`/`bye`, Advancement Engine (Auto-resolve เมื่อผลนัดก่อนหน้า Publish), Penalty Winner, Manual Override, Correction Workflow เมื่อกระทบ Match ที่ Publish แล้ว
- **Files Expected to Change**: `lib/tournament/bracket/*.ts` (พอร์ตจาก `lib/bracket.ts` เดิม + เขียนใหม่ให้ใช้ `resolvePlaceholder()` จาก Phase 4c แทน logic เดิม), `app/api/tournament/admin/knockout/generate-structure`, `app/admin/tournament/bracket/page.tsx`
- **Database Change**: ไม่มีเพิ่ม (ใช้ `tournament_knockout_rounds` จาก Phase 1, เขียนลง `tournament_matches` ที่มีอยู่แล้ว)
- **Tests**: Unit test ครบ Match Status ทั้ง 9 ค่า (`scheduled/ready/in_progress/finished/postponed/cancelled/abandoned/bye/void`) รวมสถานะ "pending"/"blocked" แบบ Derived (`home_team_id IS NULL OR away_team_id IS NULL`) ไม่ใช่ Enum เก็บจริง, Unit test `decideWinner` รวมกรณี Penalty (`home_penalty_score`/`away_penalty_score`), Integration test "Publish ผลรอบก่อนหน้าแล้ว นัดถัดไป Auto-resolve ทีมถูกต้องผ่าน `resolvePlaceholder()`" (ใช้ Engine เดียวกับ Phase 4c), Integration test Best Third-place Resolution (`best_ranked` source_type) ครบตามกติกาที่เลือกใน Open Questions
- **Acceptance Criteria**: Generate bracket ขนาด 4/8/16/32 + Custom Round ได้ถูกต้อง; Advancement ทำงานอัตโนมัติเมื่อผลรอบก่อนหน้า Publish โดยไม่ต้องมีคนกดปุ่ม "Recalculate" ทีละครั้ง (ต่างจาก V1 ที่ต้องกด Manual); Re-resolve ที่กระทบ Match ที่ Publish/Finished แล้วถูก Block เข้าสู่ Correction Workflow
- **Rollback Plan**: ไฟล์ใหม่ทั้งหมด ปิด Route ได้ทันที
- **League Regression Checklist**: N/A (League ไม่มี Bracket) — ยืนยันด้วย `npm run test`

---

## Phase 8 — Discipline and Suspension

- **Scope**: Suspension Trigger/Serving/Completion Engine แยกเฉพาะ Tournament (ไม่ reuse `lib/suspension-calc.ts` ของ League)
- **Files Expected to Change**: `lib/tournament/discipline/*.ts`, `app/api/tournament/admin/suspensions/**`, `app/api/tournament/public/discipline`
- **Database Change**: ไม่มีเพิ่ม (ใช้ `tournament_suspension_events`, `tournament_suspension_serving_matches` จาก Phase 1)
- **Tests**: Unit test ครบ: ใบเหลืองสะสม, ใบเหลืองที่สอง, ใบแดงตรง, การล้างใบเมื่อผ่านรอบ (ถ้ากติกากำหนด), Bye/Postponed/Cancelled ไม่นับเป็นนัดที่ต้องพัก, Manual Suspension + Appeal
- **Acceptance Criteria**: Card ที่บันทึกใน Phase 5 trigger suspension ได้ถูกต้องอัตโนมัติ; Serving match คำนวณใหม่ถูกต้องเมื่อโปรแกรมแข่งขันเปลี่ยน (เทียบเคียง `refreshSuspensionServingMatches` ของ League แต่เป็น engine แยก)
- **Rollback Plan**: ไฟล์ใหม่ทั้งหมด ปิด Route ได้ทันที
- **League Regression Checklist**: `lib/suspension-calc.ts` และไฟล์ suspension-* ของ League **ไม่ถูกแก้ไขแม้แต่บรรทัดเดียว** — ตรวจด้วย `git diff`; รัน `lib/__tests__/suspension-*.test.ts` เดิมผ่านครบ 100%

---

## Phase 9 — Public Pages

- **Scope**: หน้า Public `/tournament/**` เต็มรูปแบบ (Overview/Groups/Standings/Schedule/Bracket/Discipline) ทดแทน `/tournaments/**` เดิม, **เพิ่ม `/tournament/venues/[venueSlug]` และ filter `?venue=&date=` ตาม v1.1** — Public ต้องเห็นเฉพาะผลที่ `result_workflow_status='published'` เท่านั้น (ผ่าน `tournament.public_matches_view` ตาม Data Model หมวด 4)
- **Files Expected to Change**: `app/(tournament)/tournament/**` (ไฟล์ใหม่ทั้งหมด), `components/tournament/*.tsx` (ใหม่, ไม่แก้ `components/TournamentSubNav.tsx` เดิม), `components/PublicChrome.tsx` (แก้แค่ NAV_LINKS ให้ชี้ path ใหม่ — จุดเดียวที่แตะไฟล์ shared)
- **Database Change**: ไม่มี
- **Tests**: E2E/Integration smoke test ต่อหน้า (โหลดสำเร็จ, แสดงข้อมูลถูกต้องจาก Tournament DB)
- **Acceptance Criteria**: ทุกหน้า Public ใหม่ทำงานได้จาก Tournament DB โดยไม่ query League DB เลย (ตรวจด้วย Network/Log inspection ตาม Runtime Guard ใน Target Architecture หมวด 8)
- **Rollback Plan**: หน้าใหม่ทั้งหมด, ปิดได้ทันทีไม่กระทบ `/tournaments/**` เดิมที่ยังทำงานคู่ขนาน
- **League Regression Checklist**: `components/PublicChrome.tsx` diff ต้องมีแค่การเพิ่ม/แก้ NAV_LINKS entry เดียว — ตรวจด้วย `git diff`; ทุกหน้า League โหลดได้ปกติ (manual smoke test ตาม `/verify` skill)

---

## Phase 10 — Import / Export / Backup

- **Scope**: Backup/Export เฉพาะ Tournament (fork จาก `lib/csv.ts` + `app/api/admin/backup/export`)
- **Files Expected to Change**: `app/api/tournament/admin/backup/export`, `app/admin/tournament/backup/page.tsx`
- **Database Change**: ไม่มี
- **Tests**: Export ไฟล์ CSV/XLSX แล้วตรวจ record count ตรงกับฐานข้อมูล
- **Acceptance Criteria**: Export ได้ครบทุก entity หลัก, กำหนดตารางเวลา Backup อัตโนมัติตาม Data Model หมวด 5
- **Rollback Plan**: ฟีเจอร์ใหม่ทั้งหมด ปิดได้ทันที
- **League Regression Checklist**: `app/api/admin/backup/export` (League) ไม่ถูกแก้ไข, `npm run test` ผ่าน

---

## Phase 11 — Migration Dry Run

- **Scope**: รัน Migration Script ตาม `TOURNAMENT_V2_MIGRATION_MAP.md` บน **Staging/Preview Database เท่านั้น** (ห้ามแตะ Production League DB หรือ Production Tournament DB จริง)
- **Files Expected to Change**: `scripts/tournament-v2/migrate-*.ts` (สร้างใหม่, dry-run mode default)
- **Database Change**: เขียนเฉพาะ Staging Tournament DB, **อ่านอย่างเดียว (read-only)** จาก League DB
- **Tests**: ทุกข้อใน Verification Checklist ของ `TOURNAMENT_V2_MIGRATION_MAP.md` หมวด 5
- **Acceptance Criteria**: Record count, FK integrity, ID mapping completeness, score/standing/bracket reconciliation ผ่านทั้งหมดบน Staging
- **Rollback Plan**: ล้างข้อมูล Staging Tournament DB แล้วรันใหม่ได้ไม่จำกัดจำนวนครั้ง — ไม่กระทบ Production ใดๆ เพราะเป็น read-only ต่อ League DB
- **League Regression Checklist**: ยืนยันว่า Migration Script ไม่มีคำสั่ง `UPDATE`/`DELETE`/`INSERT` ต่อ League DB เลยแม้แต่บรรทัดเดียว (code review บังคับ)

---

## Phase 12 — Parallel Run

- **Scope**: เปิด `/tournament-v2` (หรือ path พรีวิวที่ตกลง) ให้ผู้ใช้จริงทดสอบคู่ขนานกับ `/tournaments` (V1) โดยไม่ปิด V1
- **Files Expected to Change**: Feature flag/routing config เท่านั้น
- **Database Change**: ไม่มี (Production Tournament DB เริ่มรับข้อมูลจริงคู่ขนาน หรือ import ชุดข้อมูล mirror — ขึ้นกับ Open Question migrate-vs-fresh)
- **Tests**: User Acceptance Testing กับผู้ดูแลลีกจริง
- **Acceptance Criteria**: ผู้ใช้ยืนยันว่า V2 แสดงผลถูกต้องเทียบเท่าหรือดีกว่า V1 ในทุกฟีเจอร์หลัก
- **Rollback Plan**: ปิด `/tournament-v2` กลับไปใช้ `/tournaments` (V1) ได้ทันทีโดยไม่กระทบข้อมูลใดๆ เพราะสอง Database แยกกันอยู่แล้ว
- **League Regression Checklist**: League ไม่ถูกแตะในเฟสนี้เลย — ตรวจสอบผ่าน monitoring/log ปกติ

---

## Phase 13 — Cutover

- **Scope**: Freeze Tournament V1 ชั่วคราว, Final Migration (ใช้ script เดียวกับ Phase 11 แต่รันบน Production), Smoke Test, สลับ Route หลักไปที่ V2
- **Files Expected to Change**: Routing config, redirect จาก `/tournaments/**` (V1) ไป `/tournament/**` (V2) ถ้าต้องคง URL เดิมไว้เพื่อ SEO/bookmark
- **Database Change**: เขียนเข้า Production Tournament DB จริงเป็นครั้งแรก (อ่านอย่างเดียวจาก League Production DB)
- **Tests**: Smoke Test เต็มรูปแบบทุก Public/Admin flow หลัง Cutover
- **Acceptance Criteria**: ทุก Verification Checklist จาก Migration Map ผ่านบน Production; ไม่มี Downtime ของ League ระหว่าง Cutover
- **Rollback Plan**: **ต้องมี Rollback Switch พร้อมใช้จริง** — สลับ Route กลับไป V1 ได้ภายใน 1 ขั้นตอน (feature flag/env var) โดยไม่กระทบ League; เก็บ Tournament V1 ไว้แบบ Read-only อย่างน้อยตามช่วงเวลาที่ตกลงก่อนจะตัดสินใจ Decommission
- **League Regression Checklist**: Full regression ตาม `TOURNAMENT_V2_PREPARATION_PLAN.md` Section 12 (League Fixtures/Match Result/Standings/Goals/Cards/Suspensions/Public/Admin/Exports/Backup) — บังคับรันก่อนและหลัง Cutover เทียบผลต้องเหมือนกัน 100%
- **หมายเหตุสำคัญ**: Phase นี้ต้องขออนุมัติแยกต่างหากอย่างชัดเจนจากเจ้าของระบบ **ไม่อยู่ในขอบเขตอนุมัติของรอบ Preparation ปัจจุบัน**

---

## Phase 14 — Legacy Decommission

- **Scope**: ลบ Tournament V1 code path (`app/tournaments/**`, `app/admin/tournament-{groups,fixtures,bracket}/**`, `lib/bracket.ts`, `lib/tournament-fixtures.ts`, `lib/public-tournament.ts`, ตาราง `tournament_groups`/`tournament_group_teams`/`knockout_rounds`/`bracket_matches` และคอลัมน์ `stage`/`tournament_group_id`/`venue`/`winner_team_id` บน `matches` ของ League DB), จัดกลุ่ม League Route เป็น `app/(league)/**` ตาม Target Architecture (ถ้าต้องการ)
- **Files Expected to Change**: ลบไฟล์ V1 ทั้งหมดที่ระบุ, Migration script ถอดคอลัมน์ tournament-specific ออกจาก League `matches`/`teams`/`players`/`seasons` (คืนสภาพ League schema ให้สะอาด)
- **Database Change**: **DROP TABLE/COLUMN บน League Production DB** — ความเสี่ยงสูงสุดในทั้งแผน ต้องมี Backup เต็มรูปแบบก่อนรันทุกครั้ง
- **Tests**: Full League regression suite ผ่าน 100% หลังถอดคอลัมน์
- **Acceptance Criteria**: League ทำงานปกติทุกฟีเจอร์หลัง schema cleanup; ไม่มี dead code เหลือจาก V1
- **Rollback Plan**: ต้องมี Point-in-time Backup ของ League DB ก่อนรัน DDL ใดๆ ในเฟสนี้ — Restore จาก Backup คือ Rollback เดียวที่ทำได้เมื่อ DROP ไปแล้ว (**เหตุผลที่ต้องรอ "ช่วงเวลาตรวจสอบ" ตามข้อกำหนด Section 14 ข้อ 17 ของแผนต้นทางก่อน Decommission**)
- **League Regression Checklist**: รันครบทุกข้อใน Section 12 ของแผนต้นทางอีกครั้งหลัง Decommission
- **หมายเหตุสำคัญ**: Phase นี้แตะ League Table โดยตรงเป็นครั้งแรกในทั้งแผน **ต้องขออนุมัติแยกต่างหากเป็นพิเศษ**, ไม่อยู่ในขอบเขตของรอบ Preparation และไม่ควรเริ่มจนกว่า Phase 13 จะผ่านช่วงตรวจสอบที่ตกลงกันแล้ว (แนะนำอย่างน้อย 1-2 ฤดูกาลแข่งขันเต็ม เพื่อให้มั่นใจว่าไม่มี Edge Case ที่ต้องย้อนดู V1)

---

## สรุปข้อบังคับร่วมทุก Phase (0-14)

1. Phase 0-12 **ห้ามแก้ League Table, League API, League Business Logic, League Route** — ยืนยันด้วย `git diff` ต่อไฟล์ League ทุกครั้งก่อน merge (ต้องว่างเปล่า)
2. ทุก Phase ที่มี Database Change ต้องระบุชัดว่าเขียนเข้า Project ไหน (Tournament เท่านั้น ยกเว้น Phase 14)
3. ทุก Phase ต้องรัน `npm run test` (Vitest) ผ่านทั้งหมดก่อน merge — รวม Suite เดิมของ League และ Suite ใหม่ของ Tournament
4. Phase 13 และ 14 ต้องขออนุมัติแยกจากรอบ Preparation นี้อย่างชัดเจน ก่อนเริ่มงานใดๆ ในสองเฟสนี้
