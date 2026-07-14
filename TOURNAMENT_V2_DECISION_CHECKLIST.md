# Tournament V2 — Decision Checklist

**สถานะ**: ✅ **Decision Lock สมบูรณ์สำหรับ Phase 1 — Blocker ก่อน Phase 1 เหลือ 0** — 12 Decisions ถูกล็อกโดยเจ้าของระบบแล้วเมื่อ 2026-07-14 (รวม D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-09, D-15, D-16, D-24, D-29) — เอกสาร Tournament V2 ทุกฉบับถูก Sync ให้สอดคล้องกับ Final Decisions ชุดนี้แล้วในรอบนี้ — **ยังเหลือ Decision กลุ่ม REQUIRED BEFORE FEATURE PHASE (13 ข้อ) ที่ต้องตอบก่อนถึง Phase ที่เกี่ยวข้อง แต่ไม่ Block Phase 1 อีกต่อไป**
**วัตถุประสงค์**: รวบรวม Open Questions ทั้งหมดจากเอกสาร Preparation 9 ฉบับ (`TOURNAMENT_V2_PREPARATION_PLAN.md`, `TOURNAMENT_V2_CURRENT_STATE_AUDIT.md`, `TOURNAMENT_V2_TARGET_ARCHITECTURE.md`, `TOURNAMENT_V2_DATA_MODEL.md`, `TOURNAMENT_V2_MIGRATION_MAP.md`, `TOURNAMENT_V2_IMPLEMENTATION_PHASES.md`, `TOURNAMENT_V2_OPEN_QUESTIONS.md`, `TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md`, `TOURNAMENT_V2_VENUE_OPERATIONS.md`) มาจัดลำดับความสำคัญเป็น Checklist เดียวที่เจ้าของระบบตอบได้ทีละข้อ พร้อม Recommendation จากทีม Audit
**หลักการ**: ทีม Audit **ไม่เดาคำตอบแทนเจ้าของระบบ** — ทุก Recommendation ในเอกสารนี้เป็นข้อเสนอพร้อมเหตุผลเท่านั้น การตัดสินใจจริง (Final Decision) ต้องมาจากเจ้าของระบบ
**ขอบเขตของรอบนี้ (Documentation Decision Lock)**: เอกสาร Markdown เท่านั้น **ห้ามเริ่ม Implementation, ห้ามสร้างหรือ Run Migration, ห้ามสร้าง Supabase Project จริง, ห้ามแก้ Production, ห้ามแก้ League, ห้ามแก้ Vercel Environment** — ยังไม่มีการสร้าง Source Code, Migration, หรือ Implementation Branch ใดๆ ในรอบนี้เช่นกัน

---

## วิธีอ่านเอกสารนี้

| กลุ่ม | ความหมาย | จำนวน |
|---|---|---:|
| ✅ **DECIDED** | เจ้าของระบบตัดสินใจแล้ว (2026-07-14) — พร้อมใช้เป็นข้อกำหนดใน Implementation รอบถัดไป | 12 |
| 🟡 **PARTIALLY DECIDED** | ตัดสินใจแล้วบางส่วน ยังมีค่า/ประเด็นย่อยที่ต้องตอบเพิ่มก่อนถือว่าเสร็จสมบูรณ์ | 0 |
| 🔴 **BLOCKER** | ยังไม่ตัดสินใจ ต้องตอบก่อนเริ่ม Phase 1 (Database Foundation) หรือ Phase 1 DDL | 0 |
| 🟡 **REQUIRED BEFORE FEATURE PHASE** | ยังไม่ตัดสินใจ ไม่ block Phase 1 แต่ต้องตอบก่อนถึง Phase ที่เกี่ยวข้อง | 13 |
| 🟢 **CAN DEFER** | มี Recommendation ที่ปลอดภัยพอจะใช้เป็นค่าเริ่มต้นได้ ตัดสินใจภายหลังได้โดยไม่กระทบ Timeline | 1 |
| ⚪ **RESOLVED** | ตัดสินใจแล้วจากเอกสารก่อนหน้า ไม่ใช่ Open Question อีกต่อไป (เก็บไว้เพื่อบันทึกประวัติ) | 1 |

**Blocker ก่อน Phase 1**: **0 ข้อ** — D-04 และ D-05 ถูกปิดแล้วในรอบนี้ (2026-07-14) Phase 1 DDL พร้อมเริ่มออกแบบได้เมื่อได้รับคำสั่งให้เข้าสู่รอบ Implementation

**หมายเหตุการรวมคำถาม**: บางคำถามใน `TOURNAMENT_V2_OPEN_QUESTIONS.md` ถูกรวมเป็น Decision เดียวกันในเอกสารนี้เพราะเป็นเรื่องเดียวกันจริง (เช่น Q7 เดิมกับ Q23 ใน Scheduling Addendum คือคำถามเดียวกัน) — ดูหมายเหตุในแต่ละ Decision ที่เกี่ยวข้อง
**หมายเหตุ Decision ใหม่**: D-29 ถูกเพิ่มเข้ามาในรอบนี้ตามคำสั่งเจ้าของระบบ เป็น Category-specific Override ของ D-07 สำหรับ G-U16 โดยเฉพาะ

---

## Decision Summary Table

| ID | Decision | Status | Recommendation / Final Decision | Blocks Phase |
|---|---|---|---|---|
| D-01 | Database Isolation | ✅ DECIDED (2026-07-14) | Option A — Supabase แยก Project สมบูรณ์ | Phase 1 — Isolation ปลดล็อก |
| D-02 | Existing Tournament Data Strategy | ✅ DECIDED (2026-07-14) | เริ่มข้อมูลใหม่ทั้งหมด ไม่ Migrate Tournament V1 | Phase 1/11 (scope เปลี่ยน)/12/13 ปลดล็อก |
| D-03 | Authentication และ Result-entry Account | ✅ DECIDED (2026-07-14) | Shared Dedicated Result-entry Account (ไม่ใช่ Super Admin) | Phase 1 DDL (บางส่วน)/Phase 3 — RBAC Model เปลี่ยน |
| D-04 | Team Master แชร์กันหรือ Import แยก | ✅ DECIDED (2026-07-14) | Tournament Team Data แยกอิสระ ไม่มี School Master ใน MVP | Phase 1 DDL ปลดล็อก |
| D-05 | Player เชื่อมข้าม Tournament/Category หรือไม่ | ✅ DECIDED (2026-07-14) | ไม่สร้าง person_id กลาง ไม่เชื่อมข้าม Tournament/Category | Phase 1 DDL ปลดล็อก |
| D-06 | Discipline / Suspension Rules | ✅ DECIDED (2026-07-14) | FIFA-derived Fair Play (-1/-3/-4/-5) + Card-count Suspension (ไม่ใช้สูตร League 2/4/6/8) | Phase 1 DDL/Phase 8 ปลดล็อก (Bye/Postponed/Cancelled ยังเป็น Open Sub-question) |
| D-07 | Best Third-place Rules | ✅ DECIDED WITH CATEGORY OVERRIDE (2026-07-14) | Points→GD→GF→Fair Play→Draw (ไม่ใช้ FIFA Ranking); กลุ่มไม่เท่ากัน = Configurable per Category; G-U16 = Draw (ดู D-29) | Phase 1 DDL/Phase 6/Phase 7 ปลดล็อก |
| D-09 | Standings, Tiebreak and Penalty-decided Group Matches | ✅ DECIDED (2026-07-14) | ไม่มีผลเสมอ — ตัดสินด้วย Penalty ทุกนัดที่เสมอ, H2H→GD→GF (กลุ่มพบกันเอง→ทั้งกลุ่ม)→Fair Play→Draw | Phase 1 DDL/Phase 6 ปลดล็อก (Last-place cutoff ของกลุ่มไม่เท่ากัน ยังเป็น Open Sub-question) |
| D-15 | งบประมาณ Supabase Project ที่สอง | ✅ DECIDED (2026-07-14) | Free Tier + Quota/Backup Constraints | Phase 1 ปลดล็อก |
| D-10 | Public URL ใหม่ต้องเป็นรูปแบบใด | 🟡 รอตัดสินใจ | (a) URL ใหม่ทั้งหมด + Redirect | Phase 9 |
| D-11 | Data Retention — เก็บ Tournament เก่ากี่ปี | 🟡 รอตัดสินใจ | Default 2 ปีก่อน Archive | Phase 9 |
| D-12 | ขอบเขตเปิดเผย Discipline/Suspension ต่อสาธารณะ | 🟡 รอตัดสินใจ | View จำกัด column (ไม่รวม birth_date เต็ม) | Phase 9 |
| D-13 | ระยะเวลา Parallel Run และเกณฑ์ Cutover | 🟡 รอตัดสินใจ | ไม่มี Default | Phase 13 |
| D-14 | ระยะเวลาเก็บ Tournament V1 แบบ Read-only | 🟡 รอตัดสินใจ | อย่างน้อย 1-2 ฤดูกาลเต็ม | Phase 14 |
| D-16 | Default Result Approval Policy | ✅ DECIDED (2026-07-14) | Single-step Result Submission with Mandatory Preview (ไม่มีผู้อนุมัติคนที่สอง) | Phase 4b/5c ปลดล็อก |
| D-17 | Offline / Network Scope | 🟡 รอตัดสินใจ | (a) Online-first + Retry Queue ใน MVP | Phase 5b |
| D-18 | Venue และ Court Assignment RBAC | 🟡 รอตัดสินใจ | (a) พอแค่ระดับ Venue ใน MVP | Phase 3, Phase 5 |
| D-19 | Realtime หรือ Polling | 🟡 รอตัดสินใจ | (a) Polling 15-30 วินาที | Phase 5d |
| D-20 | ที่เก็บไฟล์แนบ Full Match Report | 🟡 รอตัดสินใจ | Supabase Storage ของ Tournament Project | Phase 5c |
| D-21 | Workflow ย้าย Category ไปสนามอื่นกลางทัวร์นาเมนต์ | 🟡 รอตัดสินใจ | Super Admin เท่านั้น + Bulk Preview | Phase 5a, Phase 5d |
| D-22 | เจ้าหน้าที่อาสาสมัครเข้าระบบผ่าน QR Code | 🟡 รอตัดสินใจ | (a) Shortcut ไปหน้า Login ปกติ | Phase 5b |
| D-24 | Schedule Capacity and Rest Validation | ✅ DECIDED (2026-07-14) | `venue_max_matches_per_day = 8` (Error); `minimum_rest_minutes`/`max_matches_per_team_per_day` = ไม่ Validate ใน MVP (Future Enhancement) | Phase 4b ปลดล็อก |
| D-25 | Import Batch Rollback Permission | 🟡 รอตัดสินใจ | (a) `tournament_super_admin` เท่านั้น | Phase 4b |
| D-28 | Auto-downgrade Schedule Status | 🟡 รอตัดสินใจ | (b) ต้องมีคนกดยืนยัน | Phase 4b, Phase 4c |
| D-26 | จำนวน Version ย้อนหลังของ Schedule | 🟢 Can Defer | ไม่จำกัด | ไม่ Block งานใด |
| D-29 | G-U16 Third-place Qualification by Draw | ✅ DECIDED (2026-07-14) | จับฉลากเลือก 2 จาก 3 ทีมอันดับ 3 เข้ารอบ 8 ทีม (ไม่ใช้คะแนน/GD/GF) | Phase 6/Phase 7 — เฉพาะ Category G-U16 |
| Q27 | Full Auto Scheduler ใน MVP รอบนี้ | ⚪ RESOLVED | ไม่ทำใน MVP (เก็บไว้เป็น Future Phase) | — (ปิดแล้ว) |

---

## ลำดับการประชุมแนะนำ — สถานะล่าสุด

1. **รอบที่ 1 — Architecture Lock**: D-01, D-02, D-03, D-15 → ✅ **เสร็จสิ้นแล้ว (2026-07-14)**
2. **รอบที่ 2 — Business Rules**: D-04, D-05, D-06, D-07, D-09 → ✅ **เสร็จสิ้นแล้วทั้งหมด (2026-07-14)** (+ D-29 เพิ่มใหม่ในรอบนี้)
3. **รอบที่ 3 — Venue Operations**: D-16 → ✅ **เสร็จสิ้นแล้ว (2026-07-14)** | D-17, D-18, D-19, D-20, D-21, D-22 → 🟡 ยังไม่ตอบ (ไม่ Block Phase 1)
4. **รอบที่ 4 — Scheduling/Draw**: D-24 → ✅ **เสร็จสิ้นแล้ว (2026-07-14)** | D-25, D-26, D-28 → 🟡 ยังไม่ตอบ (ไม่ Block Phase 1)
5. **รอบที่ 5 — Public/Operational**: D-10, D-11, D-12, D-13, D-14 → 🔴 ยังไม่เริ่ม (ไม่ Block Phase 1)

**Blocker ก่อนเริ่ม Phase 1**: **ไม่มีเหลือแล้ว** — รอบที่ 1, 2 และ D-16/D-24 จากรอบที่ 3-4 เสร็จสิ้นครบถ้วน Decision ที่เหลือทั้งหมด (13 ข้อ) เป็นกลุ่ม REQUIRED BEFORE FEATURE PHASE ที่ตอบได้ระหว่างทางก่อนถึง Phase ที่เกี่ยวข้องจริง ไม่จำเป็นต้องตอบก่อนเริ่ม Phase 1

---

# ✅ DECIDED — ล็อกแล้วโดยเจ้าของระบบ (2026-07-14)

## D-01. Database Isolation — Supabase แยก Project สมบูรณ์

- **คำถาม**: ต้องการ Supabase แยก Project หรือไม่?
- **เหตุผลที่ต้องตัดสินใจ**: กำหนด Environment Variables, Auth Strategy, RLS Strategy ทั้งหมดใน `TOURNAMENT_V2_TARGET_ARCHITECTURE.md` หมวด 5 — เปลี่ยนใจภายหลัง Phase 1 จะเสียงานสร้างใหม่ทั้งหมด
- **ตัวเลือกที่เคยพิจารณา**: (a) Option A — แยก Project / (b) Option B — Project เดียว แยก Schema
- **Recommendation เดิมจากทีม Audit**: Option A (แยก Project) — **ตรงกับ Final Decision ไม่มีความขัดแย้ง**
- **Final Decision**: ใช้ **Supabase Project ใหม่แยกจาก League อย่างสมบูรณ์**
- **Implementation Constraints (ตามคำตัดสิน)**:
  - One GitHub Repository, One Next.js Application, One Vercel Project, One Production Domain
  - League Supabase และ Tournament Supabase แยก Project กันอย่างสมบูรณ์
  - Tournament Service **ห้ามใช้ League Database Client** โดยเด็ดขาด
  - Environment Variables แยกเป็น `LEAGUE_*` และ `TOURNAMENT_*` — **หมายเหตุ Cross-document Impact**: ต่างจากแผนเดิมใน Target Architecture หมวด 6 ที่เสนอให้ League คงชื่อ `NEXT_PUBLIC_SUPABASE_URL` เดิมไว้ก่อน (ไม่บังคับเปลี่ยน) — ตอนนี้ต้อง Rename เป็น `LEAGUE_*` prefix อย่างชัดเจนตามคำตัดสิน ต้องปรับปรุงหมวด 6 ของ Target Architecture ในรอบถัดไป
  - ต้องมี **Runtime Guard** ป้องกัน Tournament Service เรียก League Client โดยไม่ตั้งใจ (ตรงกับ Target Architecture หมวด 8 ที่ออกแบบไว้แล้ว)
- **Phase ที่ปลดล็อก**: Phase 1 (Database Foundation) ในส่วน Database Isolation — **Phase 1 ปลดล็อกครบทั้ง Phase แล้ว** หลัง D-04/D-05 ถูกปิดในรอบนี้ (2026-07-14)
- **Owner ที่ตัดสินใจ**: เจ้าของระบบ
- **Final Decision Date**: 2026-07-14

---

## D-02. Existing Tournament Data Strategy — เริ่มข้อมูลใหม่ทั้งหมด

- **คำถาม**: ข้อมูล Tournament เดิมต้องย้ายทั้งหมดหรือเริ่มรายการใหม่?
- **เหตุผลที่ต้องตัดสินใจ**: กำหนดว่าต้องทำ Phase 11 (Migration Dry Run) เต็มรูปแบบหรือไม่ และกำหนดความเสี่ยง Data Loss ของ Phase 13 (Cutover)
- **ตัวเลือกที่เคยพิจารณา**: (a) Migrate ทั้งหมด / (b) เริ่มใหม่ทั้งหมด ไม่ Migrate / (c) Migrate เฉพาะ Tournament ที่ Active
- **Recommendation เดิมจากทีม Audit (Superseded)**: เคยเสนอ (c) Migrate เฉพาะ Active เป็นจุดสมดุล — **เจ้าของระบบเลือกตัวเลือก (b) แทน ซึ่งต่างจาก Recommendation เดิม** ถือเป็นคำตัดสินสุดท้าย ไม่ใช้ Recommendation เดิมอีกต่อไป
- **Final Decision**: **Tournament V2 เริ่มข้อมูลใหม่ทั้งหมด ไม่ย้ายข้อมูล Tournament V1**
- **Implementation Constraints (ตามคำตัดสิน)**:
  - ไม่ต้อง Migration ข้อมูล Tournament V1 เข้า Tournament V2
  - ไม่ต้องสร้าง `old_id -> new_id` mapping สำหรับข้อมูลจริง (ตาราง `_migration_id_map` ที่เสนอไว้ใน Migration Map ไม่จำเป็นอีกต่อไปสำหรับ Data จริง)
  - **Phase 11 (Migration Dry Run) เปลี่ยนขอบเขตเป็น "Fresh-data Verification / Import Rehearsal"** — ไม่ใช่การย้ายข้อมูลจริงจาก League DB อีกต่อไป แต่เป็นการซ้อมนำเข้าข้อมูลใหม่ (ทีม/นักกีฬา/ตารางแข่ง) เข้า Tournament V2 ให้ถูกต้องก่อน Go-live
  - Tournament V1 **เก็บไว้เป็น Reference เท่านั้น** (Read-only, ไม่มีการเขียนเพิ่ม)
  - **ห้ามลบ Tournament V1 ในรอบ Implementation แรก** — การลบ/Decommission V1 ยังคงต้องรอ Phase 14 และขออนุมัติแยกต่างหากตามเดิม
- **Cross-document Impact**: `TOURNAMENT_V2_MIGRATION_MAP.md` เกือบทั้งฉบับ (หมวด 1-5) กลายเป็น Non-applicable สำหรับรอบนี้ (Entity Mapping Table, ID Mapping, Data Loss Register เช่น Penalty Score ที่กู้คืนไม่ได้ — ไม่มีผลอีกต่อไปเพราะไม่มีการย้ายข้อมูลจริง) — หมวด 6-7 (Venue/RBAC/Draw Seed Data) ยังใช้ได้เพราะเป็น Fresh Insert อยู่แล้วไม่ใช่ Migration
- **Phase ที่ปลดล็อก**: Phase 1 (กำหนดขอบเขตงานชัดเจนแล้ว), Phase 11 (เปลี่ยน scope), Phase 12, Phase 13 (ลดความเสี่ยง Data Loss ลงมาก เพราะไม่มีข้อมูลเดิมต้องย้าย)
- **Owner ที่ตัดสินใจ**: เจ้าของระบบ
- **Final Decision Date**: 2026-07-14

---

## D-03. Authentication และ Result-entry Account

- **คำถาม**: เจ้าหน้าที่/ผู้ตัดสิน/ผู้ประเมินที่กรอกผลการแข่งขันจากแต่ละสนาม เข้าระบบด้วยบัญชีแบบใด?
- **เหตุผลที่ต้องตัดสินใจ**: กำหนด Auth Strategy และ RBAC Model ของงานกรอกผลการแข่งขันหน้าสนาม ซึ่งเป็นงานที่มีผู้ใช้จำนวนมากที่สุดในระบบ (เจ้าหน้าที่/ผู้ตัดสินทุกสนามทุกนัด)
- **หมายเหตุขอบเขต**: คำถามเดิม (Q3 ใน Open Questions) ถามกว้างๆ ว่า "League และ Tournament ใช้ Admin Account ชุดเดียวกันหรือไม่" — **Final Decision นี้ตอบเฉพาะบัญชีสำหรับกรอกผลการแข่งขัน (Result-entry) เท่านั้น** ไม่ได้ระบุคำตอบแยกต่างหากว่าบัญชีระดับ `tournament_super_admin` หรือผู้ดูแลระบบ Tournament ใช้ Auth ร่วมกับ League Admin หรือไม่ — ประเด็นนั้นยังไม่ถูกปิดอย่างชัดเจน แต่ไม่ได้ถูก Block ด้วย เพราะ Target Architecture เดิมเสนอให้ League เป็น Identity Provider กลางอยู่แล้วและไม่มีคำสั่งให้เปลี่ยน
- **Final Decision**: ใช้ **บัญชีร่วมหนึ่งบัญชี (Shared Account)** สำหรับเจ้าหน้าที่ ผู้ตัดสิน หรือผู้ประเมินที่กรอกผลการแข่งขันจากแต่ละสนาม เรียกว่า **Dedicated Tournament Result-entry Account** — **ไม่ใช่** `tournament_super_admin` และไม่ควรมีสิทธิ์แก้ Configuration สำคัญ
- **สิทธิ์ที่อนุญาต**:
  - Login เข้าระบบ Tournament
  - เลือกสนาม
  - เลือกคู่แข่งขัน
  - เปิดแบบฟอร์มกรอกผล
  - Save Draft
  - Preview ผล
  - Submit ผลการแข่งขัน
  - เพิ่มรายละเอียดรายงานการแข่งขันตาม Scope ที่อนุญาต
- **สิทธิ์ที่ห้าม**:
  - สร้างหรือลบ Tournament
  - แก้กติกาตารางคะแนน
  - Import หรือ Rollback โปรแกรมแข่งขัน
  - จัดกลุ่มใหม่
  - แก้ Draw Assignment
  - จัดการผู้ใช้
  - แก้ผลที่ Published แล้วโดยตรง (ต้องผ่าน Correction Workflow เท่านั้น)
  - เข้าถึง League Administration
- **Security/Audit Limitation (บันทึกไว้อย่างชัดเจนตามคำสั่ง)**: เนื่องจากใช้บัญชีร่วม ระบบ**จะไม่สามารถระบุตัวบุคคลจาก Account ID ได้** — เป็นข้อจำกัดที่เจ้าของระบบรับทราบและยอมรับแล้ว เพื่อชดเชยต้องเก็บ Audit Trail อย่างน้อยดังนี้ทุกครั้งที่มีการกระทำผ่านบัญชีนี้:
  - `account_id`
  - `session_id`
  - `venue_id`
  - `match_id`
  - `timestamp`
  - `device/browser metadata`
  - `before/after data`
  - `IP` เมื่อเหมาะสม
- **Cross-document Impact**: การออกแบบ RBAC เดิมใน Target Architecture หมวด 11.2/11.3 และ Venue Operations หมวด 4-5 (`tournament_role_assignments`, `authorizeVenueScope()`) วางแผนไว้บนสมมติฐาน **บัญชีรายบุคคล** ต่อ `venue_manager`/`result_operator`/`match_official` (มีข้อบังคับเดิมชัดเจนว่า "ห้ามแชร์ Username/Password ร่วมกันระหว่างเจ้าหน้าที่สนาม") — **คำตัดสินนี้เปลี่ยนสมมติฐานนั้นสำหรับบทบาท Result-entry โดยตรง** ต้องออกแบบใหม่ในรอบถัดไปว่า `authorizeVenueScope()` จะบังคับ Scope ระดับสนามอย่างไรเมื่อบัญชีเดียวกันมีสิทธิ์เลือกได้ทุกสนาม (Enforcement จะย้ายไปอยู่ที่ระดับ Session/UI-selection + Audit Trail แทนที่จะเป็น Server-side per-user scope check แบบเดิม) — ดู Cross-document Update Impact ท้ายเอกสารสำหรับรายละเอียดเต็ม
- **Phase ที่ปลดล็อก**: Phase 1 DDL (โครงสร้างตาราง RBAC ต้องออกแบบใหม่บางส่วน), Phase 3 (RBAC Foundation — ขอบเขตเปลี่ยน)
- **Owner ที่ตัดสินใจ**: เจ้าของระบบ
- **Final Decision Date**: 2026-07-14

---

## D-06. Discipline / Suspension Rules ของ Tournament

- **คำถาม**: กติกาใบโทษ (Discipline/Suspension) ของ Tournament เป็นแบบใด?
- **เหตุผลที่ต้องตัดสินใจ**: กำหนดค่า Default ใน Discipline Rules table และ Logic ใน `lib/tournament/discipline/*.ts` (Phase 8)
- **Recommendation เดิมจากทีม Audit (Superseded)**: เคยเสนอสูตร League (2/4/6/8 คะแนน, Ban ที่ 6/12/18/24) เป็น "จุดเริ่มการสนทนาเท่านั้น" — **เจ้าของระบบเลือกใช้กติกาอ้างอิงจาก FIFA World Cup 2026 แทน ไม่ใช้สูตร League** ตามที่ระบุไว้ชัดเจนในคำตัดสิน
- **Final Decision**: ใช้กติกาจากไฟล์ `world-cup-2026-rules-summary-th.md` (อ้างอิงภายนอก Repository ปัจจุบันอยู่ที่ `Downloads/world-cup-2026-rules-summary-th.md` — ควรคัดลอกเข้า Repository เช่น `docs/rules/` ในรอบ Implementation ถัดไปเพื่อไม่ต้องพึ่ง Path ภายนอก) เป็นฐาน ดังนี้:

  **Fair Play (คะแนนความประพฤติ — ใช้เพื่อ Tiebreak เท่านั้น ไม่ใช่ Suspension)**:
  - ใบเหลือง = -1
  - ใบแดงจากสองใบเหลือง = -3
  - ใบแดงโดยตรง = -4
  - ใบเหลืองแล้วตามด้วยใบแดงโดยตรง = -5
  - หนึ่งคนในหนึ่ง Match ถูกหักเฉพาะเหตุการณ์ที่รุนแรงที่สุดเพียงรายการเดียว
  - ทีมที่มีคะแนนติดลบน้อยกว่ามีอันดับ Fair Play ดีกว่า

  **Suspension (การพักการแข่งขัน — Rule คนละชุดกับ Fair Play, ใช้ Card Count/Type ไม่ใช่คะแนนสะสม)**:
  - ใบเหลืองครบ 2 ใบจากคนละ Match: พัก Match ถัดไป 1 นัด
  - สองใบเหลืองใน Match เดียว: ถูกไล่ออกและพัก Match ถัดไป 1 นัด
  - ใบแดงโดยตรง: พักอย่างน้อย 1 นัด และรองรับ Manual Additional Suspension
  - ใบเหลืองเดี่ยวที่ยังไม่ครบ 2 ใบถูกล้างหลังจบรอบแบ่งกลุ่ม
  - ใบเหลืองเดี่ยวถูกล้างอีกครั้งหลังจบรอบก่อนรองชนะเลิศ
  - ใบแดงและโทษพักที่ยังรับโทษไม่ครบ**ไม่ถูกล้าง**

- **Data Model / Logic ต้องแยกเป็น** (ตามคำสั่ง):
  - Disciplinary Event
  - Fair-play Score
  - Suspension Trigger
  - Serving Match
  - Suspension Completion
  - Manual Additional Suspension
- **ข้อห้ามชัดเจน**: **ห้ามนำระบบคะแนนโทษ 2/4/6/8 ของ League มาใช้กับ Tournament** — เป็น Rule คนละชุดกันโดยเจตนา
- **Cross-document Impact**: ต่างจาก League ที่ Suspension Trigger เป็นแบบ "คะแนนสะสมข้ามเกณฑ์" (Points-threshold) Tournament ใช้แบบ "นับจำนวน/ประเภทใบ" (Card-count/type based) — เป็น Logic คนละแบบโดยสิ้นเชิง ไม่ใช่แค่ค่าตัวเลขต่างกัน ต้องออกแบบ `lib/tournament/discipline/*.ts` แยกจาก League ทั้งหมด (Data Model เดิมที่ออกแบบ `tournament_suspension_events` ไว้ก็รองรับได้อยู่แล้วในระดับ Schema เพราะเป็น Generic Column — แต่ `points_total_after`/`threshold_crossed` ต้องตีความใหม่ให้ตรงกับ Card-count Logic ไม่ใช่ Points Logic) นอกจากนี้ Fair-play Score ต้องแยกเป็นค่าคนละตัวจาก Suspension Trigger อย่างชัดเจน (ก่อนหน้านี้ Data Model ยังไม่ได้แยกสองแนวคิดนี้ออกจากกันชัดเจนพอ)
- **Open Sub-question (ยังไม่ตัดสินใจ — ห้ามเดา)**: กรณี **Bye, Postponed และ Cancelled** หากเอกสารกติกา (`world-cup-2026-rules-summary-th.md`) ยังไม่ได้ระบุชัดว่านับเป็นนัดที่ต้องพักหรือไม่ ให้**คงเป็น Open Sub-question** ต้องขอคำตอบเพิ่มจากเจ้าของระบบก่อน Implement `lib/tournament/discipline/suspensionServing.ts` (Phase 8) — ห้ามเดาคำตอบ
- **Phase ที่ปลดล็อก**: Phase 1 DDL (โครงสร้าง Discipline Config), Phase 8 (Discipline Engine) — **ยกเว้นส่วน Bye/Postponed/Cancelled ที่ยังรอคำตอบ**
- **Owner ที่ตัดสินใจ**: เจ้าของระบบ
- **Final Decision Date**: 2026-07-14

---

## D-07. Best Third-place Rules (รวม Q7/Q8/Q23 เดิม) — Decided with Category-specific Override

- **คำถาม**: เกณฑ์เปรียบเทียบทีมอันดับ 3 ที่ดีที่สุดข้ามกลุ่มเป็นแบบใด และกลุ่มที่มีจำนวนทีมไม่เท่ากันจัดการอย่างไร?
- **Recommendation เดิมจากทีม Audit**: เคยเสนอ (a) เทียบตรงตามคะแนน/GD/GF เป็นจุดเริ่มต้น — **สอดคล้องกับ Final Decision ในหลักการทั่วไป** (ไม่ขัดแย้ง) แต่ Final Decision เพิ่มรายละเอียดลำดับเกณฑ์และ Category Override ที่ทีม Audit ไม่ได้เดาไว้ล่วงหน้า
- **Final Decision — กติกาทั่วไป (เกณฑ์เปรียบเทียบอันดับ 3 ข้ามกลุ่ม)**:
  1. คะแนนรวม
  2. ผลต่างประตูได้เสีย
  3. จำนวนประตูที่ยิงได้
  4. Fair Play
  5. จับฉลาก
  - **ไม่ใช้อันดับโลก FIFA** เพราะทีมโรงเรียนไม่มี FIFA Ranking (แตกต่างจากเอกสารต้นฉบับ FIFA World Cup 2026 ที่ใช้ Ranking เป็นเกณฑ์ข้อ 5-6)
- **กรณีกลุ่มมีจำนวนทีมไม่เท่ากัน (เดิม Q8) — ยังไม่ตัดสินใจวิธีคำนวณ**: **ห้ามเดาวิธีตัดผลเอง** — ให้ระบบรองรับ **Qualification Rule แบบ Configurable ต่อ Category** แทนการ Hardcode สูตรเดียวตายตัว (เช่น จะปรับสัดส่วนตามจำนวนนัดที่แข่งจริงหรือไม่ ยังต้องรอคำตอบเพิ่มถ้ามีกลุ่มขนาดต่างกันในรายการอื่นที่ไม่ใช่ G-U16)
- **Category-specific Override**: ดู **D-29 (G-U16 Third-place Qualification by Draw)** ด้านล่าง — ใช้วิธีจับฉลากแทนการจัดอันดับด้วยคะแนน/GD/GF สำหรับ Category นี้โดยเฉพาะ
- **Cross-document Impact**: `tournament_qualification_rules` (Data Model หมวด 2.14) ต้องขยายให้รองรับ Category Override แบบ "จับฉลาก" ไม่ใช่แค่ตัวเลข `best_third_placed_count` เฉยๆ — ต้องมีกลไก Configuration ต่อ Category ว่าใช้วิธี "จัดอันดับด้วยกติกาทั่วไป" หรือ "จับฉลาก" (ดู D-29 สำหรับรายละเอียด Data ที่ต้องเก็บ)
- **Phase ที่ปลดล็อก**: Phase 1 DDL (`tournament_qualification_rules`), Phase 6 (Standings Engine — กติกาทั่วไปพร้อม Implement), Phase 7 (Knockout Advancement — ปลดบล็อกที่เคยระบุไว้ใน Implementation Phases โดยตรง)
- **Owner ที่ตัดสินใจ**: เจ้าของระบบ
- **Final Decision Date**: 2026-07-14

---

## D-29. G-U16 Third-place Qualification by Draw (Decision ใหม่ — Category Override ของ D-07)

- **คำถาม**: หญิง U16 (G-U16) มี 10 ทีม แบ่ง 3 กลุ่ม (4/3/3 ทีม) — ทีมอันดับ 3 ทั้ง 3 กลุ่มที่มีสิทธิ์ผ่านเข้ารอบ 8 ทีมบางส่วน จะคัดเลือกด้วยวิธีใด?
- **เหตุผลที่ต้องตัดสินใจ**: ทีม Audit ไม่ควรเดากติกาคัดเลือกเฉพาะ Category ที่มีจำนวนกลุ่ม/ทีมไม่เท่ากันแบบนี้ — เจ้าของระบบระบุวิธีคัดเลือกที่ต่างจากกติกาทั่วไปใน D-07 อย่างชัดเจน
- **Final Decision**:
  - อันดับ 1 และ 2 ของแต่ละกลุ่มผ่านเข้ารอบ 8 ทีม (รวม 6 ทีม)
  - ทีมอันดับ 3 ทั้ง 3 กลุ่มเข้าสู่กระบวนการจับฉลาก
  - **จับฉลากเลือก 2 ทีมจาก 3 ทีม** เข้าสู่รอบ 8 ทีม
  - **ไม่ใช้การจัดอันดับ Best Third-place ด้วยคะแนน/GD/GF สำหรับ Category นี้** (ต่างจากกติกาทั่วไปใน D-07 โดยเจตนา)
- **การจัดเก็บข้อมูล**: ให้สร้างหรือบันทึกเป็น **Category Qualification Override** — **ห้าม Hardcode ใน Engine กลาง** (`rankBestThirdPlacedTeams()`) ระบบต้องเก็บ:
  - รายชื่อทีมที่มีสิทธิ์จับฉลาก
  - ทีมที่จับได้
  - ผู้ดำเนินการ
  - วันที่และเวลา
  - Draw Version
  - หมายเหตุหรือหลักฐาน
  - Audit Log
- **Cross-document Impact**: Data Model ต้องเพิ่มโครงสร้างสำหรับ "Qualification Draw" (แยกจาก `tournament_draw_assignments` เดิมที่ออกแบบไว้สำหรับ Group Slot → Team Resolution เท่านั้น) — แนะนำให้ใช้ Pattern เดียวกัน (Append-only + Version) แต่เป็นตารางคนละบทบาท เพราะ Group Slot Draw คือ "ทีมไหนอยู่ตำแหน่งไหนในกลุ่ม" ในขณะที่ Qualification Draw คือ "ทีมไหนได้สิทธิ์ผ่านเข้ารอบถัดไป" ซึ่งเป็นคนละขั้นตอนของ Lifecycle
- **Phase ที่ถูก Block/ปลดล็อก**: Phase 6 (Standings/Qualification Engine), Phase 7 (Knockout Structure Generation) — เฉพาะ Category G-U16 เท่านั้น Category อื่นยังใช้กติกาทั่วไปของ D-07
- **Owner ที่ตัดสินใจ**: เจ้าของระบบ
- **Final Decision Date**: 2026-07-14

---

## D-09. Standings, Tiebreak and Penalty-decided Group Matches (เดิมชื่อ "ตัดผลกับทีมอันดับสุดท้าย" — เปลี่ยนชื่อตามคำสั่ง)

- **คำถาม**: กติกาผลการแข่งขัน (แพ้/ชนะ/เสมอ), การจัดอันดับกลุ่ม, และ Tiebreak ของ Tournament เป็นแบบใด?
- **Recommendation เดิมจากทีม Audit (Superseded บางส่วน)**: เคยเสนอใช้ Default `tiebreak_order` ทั่วไป (`points → head_to_head → goal_diff → goals_for → fair_play → lot`) — **Final Decision ให้รายละเอียดเพิ่มเติมและเปลี่ยนกติกาการให้คะแนนพื้นฐานจากที่เคยรองรับผลเสมอ เป็นไม่มีผลเสมอเลย** ซึ่งเป็นการเปลี่ยนที่มีนัยสำคัญต่อ Requirement เดิมใน Preparation Plan (ที่เคยขอให้ "รองรับผลเสมอในรอบแบ่งกลุ่ม")

- **Final Decision — Match Result Rule**:
  - เวลาแข่งขันปกติ 40 นาที
  - หากคะแนนเสมอหลังครบ 40 นาที ให้ตัดสินด้วยการยิงจุดโทษ
  - ผู้ชนะได้ 3 คะแนน, ผู้แพ้ได้ 0 คะแนน
  - **Completed Match จะไม่มีผลเสมอในตารางคะแนน** — กติกานี้เป็นกติกาเฉพาะ Tournament และ**แทนที่สูตร FIFA 3/1/0** จากไฟล์อ้างอิงโดยเจตนา (ไม่ใช้ 1 แต้มสำหรับผลเสมอ)

- **Final Decision — Penalty Shootout Storage**: ต้องเก็บแยกคอลัมน์:
  - `regulation_home_score`
  - `regulation_away_score`
  - `penalty_home_score`
  - `penalty_away_score`
  - `winner_team_id`
  - `decided_by`
  - **ประตูจาก Penalty Shootout ไม่นำไปรวมใน**: `goals_for`, `goals_against`, `goal_difference`, `top scorer`

- **Final Decision — Group Ranking**: ทีมที่มีคะแนนมากที่สุดเป็นแชมป์กลุ่ม เมื่อคะแนนเท่ากัน ให้เรียงตามลำดับ:
  1. คะแนนจาก Match ที่พบกันเอง (Head-to-head)
  2. ผลต่างประตูได้เสียจาก Match ที่พบกันเอง
  3. จำนวนประตูที่ยิงได้จาก Match ที่พบกันเอง
  4. ผลต่างประตูได้เสียจากทุก Match ในกลุ่ม
  5. จำนวนประตูที่ยิงได้จากทุก Match ในกลุ่ม
  6. Fair Play
  7. จับฉลาก
  - หากมีหลายทีมคะแนนเท่ากัน และเกณฑ์ Head-to-head แยกบางทีมออกได้แล้ว **ให้เริ่มคำนวณ Head-to-head ใหม่เฉพาะทีมที่ยังเท่ากัน** (Mini-league Recursion แบบมาตรฐาน)
  - **ไม่ใช้อันดับโลก FIFA** เพราะไม่มี FIFA Ranking สำหรับทีมโรงเรียน

- **Open Sub-question (ยังไม่ตัดสินใจ — แยกออกจาก Tiebreak ที่ตัดสินแล้ว ห้ามเดา)**: กติกาการ**ตัดผลกับทีมอันดับสุดท้ายสำหรับกลุ่มขนาดต่างกัน** (คำถามเดิมของ D-09 ก่อนหน้านี้) **ยังไม่ได้รับคำตอบ** — ไม่ปะปนกับ Tiebreak ข้างต้นที่ตัดสินใจแล้ว ต้องขอตัวอย่างกติกาเพิ่มจากเจ้าของระบบก่อน Implement ส่วนนี้ใน `resolveTiebreak.ts` (Phase 6)

- **Cross-document Impact**:
  - Data Model `tournament_matches`: ต้องแยก `regulation_home_score`/`regulation_away_score` ออกจาก `home_score`/`away_score` เดิมที่ยังกำกวม (เดิมไม่ชัดว่ารวม Penalty หรือไม่) และเพิ่ม `decided_by` — ต้อง**ปรับ CHECK constraint** ให้ไม่อนุญาตผลเสมอในสถานะ `finished` ของ Match ปกติอีกต่อไป (เดิม Data Model หมวด 2.8 มี comment ระบุชัดว่า "ไม่มี constraint บังคับ winner ในสถานะ `stage='group'`" เพื่อรองรับผลเสมอ — ตอนนี้ต้องกลับกัน คือ **ต้องบังคับมี `winner_team_id` เสมอสำหรับนัดที่จบแล้ว** ไม่ว่ารอบแบ่งกลุ่มหรือน็อกเอาต์)
  - `tournament_standing_rules.points_draw` กลายเป็น**ค่าที่ไม่ถูกใช้งาน** (Unused) เพราะไม่มีผลเสมอเกิดขึ้นจริงในระบบ — ควรพิจารณาลบหรือทำเครื่องหมายว่าไม่ใช้ในรอบถัดไป
  - Standings Engine (`calculateGroupStandings.ts`) ไม่ต้องมี Branch สำหรับผลเสมออีกต่อไป ลดความซับซ้อนของ Algorithm ลงจริง
- **Phase ที่ปลดล็อก**: Phase 1 DDL (`tournament_matches` schema เปลี่ยน, `tournament_standing_rules.tiebreak_order`), Phase 6 (Standings Engine) — **ยกเว้น Last-place cutoff rule ที่ยังรอคำตอบ**
- **Owner ที่ตัดสินใจ**: เจ้าของระบบ
- **Final Decision Date**: 2026-07-14

---

## D-15. งบประมาณ Supabase Project ที่สอง — Free Tier

- **คำถาม**: งบประมาณ/แผนสำหรับ Supabase Project ที่สอง (ถ้า D-01 = Option A) เป็นอย่างไร?
- **Recommendation เดิมจากทีม Audit**: Free/Small Tier น่าจะเพียงพอ — **ตรงกับ Final Decision ไม่มีความขัดแย้ง**
- **Final Decision**: ใช้ **Supabase Free Tier** สำหรับ Tournament Project
- **Implementation Constraints (ตามคำตัดสิน)**:
  - ต้องตรวจ Free-tier quota ก่อนเปิดใช้จริง
  - จำกัด Attachment Size/Count ให้เหมาะสม (เชื่อมโยงกับ D-20 ที่ยังไม่ตัดสินใจ — ต้องกำหนด Quota จริงตอนตอบ D-20)
  - หลีกเลี่ยงการพึ่ง PITR (Point-in-time Recovery) ที่ไม่มีใน Free Tier
  - ต้องมี **Manual Export/Backup Strategy** ทดแทน PITR
  - หากใกล้เกิน Storage/Bandwidth/Database quota **ให้แจ้งก่อน Upgrade**
  - **ห้าม Upgrade เป็น Paid Tier โดยไม่ได้รับอนุมัติ**
- **Phase ที่ปลดล็อก**: Phase 1 (การสร้าง Tournament Supabase Project จริง — เมื่อถึงรอบ Implementation)
- **Owner ที่ตัดสินใจ**: เจ้าของระบบ
- **Final Decision Date**: 2026-07-14

---

## D-16. Default Result Approval Policy — Single-step Submission with Mandatory Preview

- **คำถาม**: Workflow การอนุมัติผลการแข่งขันเป็นแบบใด?
- **Recommendation เดิมจากทีม Audit (Superseded)**: เคยเสนอ `two_step` (มีผู้ยืนยันคนที่สอง) เป็น Default — **เจ้าของระบบเลือกไม่ใช้ผู้อนุมัติคนที่สองเลย** ใช้ Mandatory Preview แทนการมีคนที่สองตรวจสอบ ถือเป็นการเปลี่ยนแนวทางทั้งหมด ไม่ใช้ Recommendation เดิมอีกต่อไป
- **Final Decision**: ใช้ **Single-step Result Submission with Mandatory Preview**
- **Workflow (ตามคำตัดสิน)**:
  1. เจ้าหน้าที่ Login ด้วย Dedicated Result-entry Account (ดู D-03)
  2. เลือกสนาม
  3. เลือก Match
  4. กรอกผลการแข่งขัน
  5. กด Preview
  6. ตรวจข้อมูลในหน้าสรุป
  7. กด Submit Result
  8. ระบบ Validate ฝั่ง Server
  9. บันทึกผลและ Publish ตาม Policy
  - **ไม่มีผู้อนุมัติคนที่สองใน Workflow ปกติ**
- **State Machine ที่เสนอ (แทนที่ State Machine เดิมใน Venue Operations หมวด 10.2)**:
  - `not_started` → `draft` → `previewed` → `submitted` → `published` → `correction_requested` → `corrected`
  - **หมายเหตุ**: State `approved`/`rejected` ในเวอร์ชันเดิม (สำหรับผู้อนุมัติคนที่สอง) **ไม่มีในโมเดลใหม่** เพราะไม่มีขั้นตอนอนุมัติแยกอีกต่อไป
- **ข้อกำหนด**:
  - Submit ไม่ได้หากยังไม่ผ่าน Preview ของข้อมูล Version ล่าสุด
  - หากแก้ค่าใดหลัง Preview ต้อง Preview ใหม่
  - Published Result แก้ตรงไม่ได้ ต้องใช้ Correction Workflow (สอดคล้องกับสิทธิ์ที่ห้ามใน D-03)
  - ต้องมี Confirmation ก่อน Submit
  - ต้องป้องกัน Double Submit ด้วย Idempotency Key
- **หมายเหตุสำคัญ**: Final Decision **ไม่ได้ระบุข้อยกเว้นสำหรับรอบชิงอันดับ 3/ชิงชนะเลิศ** (ต่างจาก Recommendation เดิมที่เคยเสนอให้รอบสำคัญใช้ `central_review` เข้มกว่า) — Workflow เดียวใช้ทุกนัดเท่าเทียมกันตามที่ระบุ ไม่มี Stage-based Policy Variation ในคำตัดสินนี้
- **Cross-document Impact**:
  - `tournament_result_submissions.status` enum ต้องปรับจาก `draft/submitted/approved/published/correction_requested/corrected/rejected` เป็น `not_started/draft/previewed/submitted/published/correction_requested/corrected`
  - `tournament_result_approvals` table เดิมออกแบบไว้เพื่อ Log การ approve/reject ของผู้อนุมัติคนที่สอง — บทบาทลดลงเหลือแค่ Correction Workflow เท่านั้น (ไม่มีการ approve ผลปกติทุกนัดอีกต่อไป)
  - Venue Operations หมวด 4.2 (Permission Matrix) แถว "Approve ผล (`two_step`)" ไม่มีความหมายอีกต่อไปสำหรับ Workflow ปกติ ต้องปรับปรุงตารางในรอบถัดไป
  - `tournament_matches.result_policy` (single_step/two_step/central_review) มีแนวโน้มไม่จำเป็นต้องตั้งค่าต่อนัดอีกต่อไปเพราะ Workflow เดียวใช้ทุกนัด — ยังไม่ยกเลิก Column นี้ (ทีม Audit เสนอให้คงไว้เพื่อความยืดหยุ่นในอนาคต แต่ Default ทุกนัด = `single_step` ตาม Final Decision) ต้องยืนยันกับเจ้าของระบบอีกครั้งว่ายกเลิก Column นี้ไปเลยหรือคงไว้เผื่ออนาคต
- **Phase ที่ปลดล็อก**: Phase 4b (ค่า Default ของ `result_policy`), Phase 5c (Approval Workflow State Machine ทั้ง Phase — ขอบเขตเล็กลงกว่าเดิมเพราะไม่มีผู้อนุมัติคนที่สอง)
- **Owner ที่ตัดสินใจ**: เจ้าของระบบ
- **Final Decision Date**: 2026-07-14

---

## D-04. Team Master — Tournament Team Data แยกอิสระ ไม่มี School Master ใน MVP

- **คำถาม**: Team Master ต้องแชร์กับ League หรือ Import แยกต่อ Tournament?
- **Recommendation เดิมจากทีม Audit**: (a) Import แยกอิสระต่อ Tournament — **ตรงกับ Final Decision ไม่มีความขัดแย้ง**
- **Final Decision**: ใช้ **Tournament Team Data แยกอิสระต่อ Tournament และ Category — ไม่ใช้ Team หรือ School Master ร่วมกับ League ใน MVP**
- **Implementation Constraints (ตามคำตัดสิน)**:
  - `tournament_teams` อยู่ใน Tournament Supabase เท่านั้น
  - **ไม่มี Foreign Key ไปยัง League `teams`**
  - Import ทีมใหม่สำหรับแต่ละ Tournament
  - โรงเรียนเดียวกันที่ลงหลาย Category มี Tournament Team Record แยกกัน
  - `team_code` ต้อง Unique ภายใน `tournament_id + category_id`
  - สามารถมี `school_name` เหมือนกันข้าม Category ได้ (ไม่ unique)
  - **ไม่สร้าง `school_master` ใน MVP**
  - สามารถเพิ่ม `school_master` เป็น **Future Enhancement** ได้ โดยไม่เปลี่ยน Match History เดิม
- **Decision Rationale**: ตรงกับเป้าหมาย Database Isolation (D-01), Tournament V2 เริ่มข้อมูลใหม่ทั้งหมด (D-02), ลด Scope และไม่ทำให้ Tournament กลับไปผูกกับ League
- **Cross-document Impact**: Data Model หมวด 2.4 (`tournament_teams`) เดิมออกแบบไว้สอดคล้องกับคำตัดสินนี้อยู่แล้ว (ไม่มี FK ไป Master กลาง) — เพิ่มเติมแค่ Comment ยืนยันคำตัดสินนี้อย่างชัดเจนในรอบถัดไป
- **Phase ที่ปลดล็อก**: Phase 1 DDL ในส่วน Team Model
- **Owner ที่ตัดสินใจ**: เจ้าของระบบ
- **Final Decision Date**: 2026-07-14

---

## D-05. Player Linking — ไม่สร้าง person_id กลาง ไม่เชื่อมข้าม Tournament/Category

- **คำถาม**: Player คนเดิมสามารถผูกข้ามรายการ/ข้ามรุ่นอายุได้หรือไม่?
- **Recommendation เดิมจากทีม Audit**: (a) ไม่ผูก แต่ละรายการอิสระ — **ตรงกับ Final Decision ไม่มีความขัดแย้ง**
- **Final Decision**: **นักกีฬาเป็นข้อมูลอิสระต่อ Tournament Team และ Category — ไม่สร้าง `person_id` กลางใน MVP ไม่เชื่อมนักกีฬาข้าม Tournament หรือข้าม Category**
- **Implementation Constraints (ตามคำตัดสิน)**:
  - `tournament_players` อ้าง `tournament_team_id`
  - Player Record ใช้ได้เฉพาะ Tournament/Category ที่ลงทะเบียน
  - Discipline และ Suspension **ไม่สะสมข้าม Tournament**
  - Discipline และ Suspension **ไม่สะสมข้าม Category**
  - นักกีฬาคนเดียวกันที่ลงหลาย Category จะมีหลาย Record
  - **ไม่ใช้เลขบัตรประชาชนเป็น Global Identity ใน MVP**
  - **ห้าม Join หรือ Sync กับ League `players`**
- **Decision Rationale**: ลดความซับซ้อนด้าน Identity และข้อมูลเยาวชน, ตรงกับการเริ่มข้อมูล Tournament ใหม่ (D-02), เพียงพอสำหรับรายการปัจจุบัน
- **Cross-document Impact**: Data Model หมวด 2.5 (`tournament_players`) เดิมออกแบบไว้สอดคล้องกับคำตัดสินนี้อยู่แล้ว (ไม่มี `person_id`) — เพิ่มเติมแค่ Comment ยืนยันคำตัดสินนี้อย่างชัดเจนในรอบถัดไป
- **Phase ที่ปลดล็อก**: Phase 1 DDL ในส่วน Player Model
- **Owner ที่ตัดสินใจ**: เจ้าของระบบ
- **Final Decision Date**: 2026-07-14

---

## D-24. Schedule Capacity and Rest Validation — Venue Limit ตัดสินแล้ว, Team-level Threshold ไม่ Validate ใน MVP

- **คำถาม**: ระยะพักขั้นต่ำระหว่างนัด (Rest-time) และจำนวนนัดสูงสุดต่อทีมต่อวัน ค่า Default คือเท่าไร?
- **Recommendation เดิมจากทีม Audit**: ไม่มี Default ที่ปลอดภัยพอจะเดา ต้องได้ตัวเลขจริง — **Final Decision ยืนยันแนวทางนี้: ไม่เดาค่า และเลือกไม่ Validate Team-level Threshold เลยใน MVP แทนการเดา**
- **Final Decision**: **ไฟล์โปรแกรมแข่งขันที่ Import และผ่าน Preview เป็น Source of Truth สำหรับวันที่ เวลา สนาม Court และลำดับ Match**
- **Configuration สำหรับ MVP**:
  - `venue_max_matches_per_day = 8`
  - `minimum_rest_minutes = null`
  - `max_matches_per_team_per_day = null`
  - `schedule_import_is_source_of_truth = true`
- **Validation ที่ต้องใช้ (ERROR — Block การบันทึก)**:
  - ทีมเดียวกันมี Match เวลาเดียวกัน
  - Venue/Court เดียวกันมี Match เวลาเดียวกัน
  - **Venue มีมากกว่า 8 Match ในวันเดียวกัน**
  - Match Date/Time/Venue/Court ไม่ถูกต้อง
  - Match ซ้ำตาม `match_code`
- **ไม่ใช้ Validation ต่อไปนี้ใน MVP**:
  - Minimum Rest Time
  - Maximum Matches per Team per Day
- **เหตุผล**: เจ้าของระบบจะจัดโปรแกรมและตรวจความเหมาะสมในไฟล์ก่อน Import เอง, ยังไม่มี Threshold ที่ต้องการให้ระบบบังคับ, **ห้ามเดาค่าเพื่อกีฬาเยาวชน**
- **Future Enhancement**: รองรับ Config ระดับ Tournament/Category/Stage สำหรับ `minimum_rest_minutes`, `max_matches_per_team_per_day`, และเปลี่ยน Venue-day-limit ระหว่าง Error/Warning ได้
- **หมายเหตุ**: กติกานี้เป็นเรื่อง **Schedule Validation** เท่านั้น ไม่เกี่ยวกับ Suspension — การพักจากใบโทษยังคงเป็น "Match ถัดไป" ตาม D-06 เสมอ ไม่ผูกกับ `minimum_rest_minutes` แต่อย่างใด
- **Cross-document Impact**: `TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md` หมวด 7.2/7.3 (Validation Matrix) ต้องเพิ่ม Error Rule ใหม่สำหรับ `venue_max_matches_per_day = 8` และปิดใช้งาน W3 (Rest-time)/W4 (Max Matches per Team) พร้อมทำเครื่องหมายเป็น Future Enhancement
- **Phase ที่ปลดล็อก**: Phase 4b (Excel Import Validation) — ปลดล็อกเต็มรูปแบบ ไม่มีส่วนใดค้างอีกต่อไป
- **Owner ที่ตัดสินใจ**: เจ้าของระบบ
- **Final Decision Date**: 2026-07-14

---

# 🟡 REQUIRED BEFORE FEATURE PHASE — ยังไม่ตัดสินใจ (ไม่ Block Phase 1)

## D-10. Public URL ใหม่ต้องเป็นรูปแบบใด?

- **เหตุผลที่ต้องตัดสินใจ**: Target Architecture เสนอ `/tournament/[tournamentSlug]/[categoryCode]/**` ใหม่ทั้งหมด (ไม่ reuse `/tournaments/[seasonSlug]/[ageGroupCode]/**` เดิม) — ถ้าเจ้าของระบบต้องการคง URL เดิมไว้เพื่อ SEO/ลิงก์ที่แชร์ไปแล้ว ต้องวางแผน Redirect เพิ่มใน Phase 13
- **ตัวเลือก**:
  - (a) URL ใหม่ทั้งหมด + Redirect จาก URL เก่า
  - (b) พยายามคง URL เดิมทุกจุด (เสี่ยง Route ชนกันระหว่าง Parallel Run ใน Phase 12)
- **Recommendation**: **(a)** — ปลอดภัยกว่าสำหรับ Parallel Run (Phase 12) เพราะ V1/V2 ใช้ Route คนละชุดพร้อมกันได้โดยไม่ชนกัน
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) URL ใหม่ + Redirect**: Parallel Run ปลอดภัย, ต้องทำ Redirect Map ใน Phase 13 สำหรับลิงก์เก่าที่เคยแชร์ไป
  - **(b) คง URL เดิม**: รักษา SEO/ลิงก์เดิมได้ตรงที่สุด แต่เสี่ยง Route ชนกันระหว่าง V1/V2 ทำงานคู่ขนานใน Phase 12 (ต้องออกแบบ Routing พิเศษเพื่อเลี่ยง)
- **Phase ที่ถูก Block**: Phase 9 (Public Pages)
- **Owner ที่ควรตอบ**: เจ้าของระบบ
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-11. Data Retention — ต้องเก็บ Tournament เก่ากี่ปี?

- **เหตุผลที่ต้องตัดสินใจ**: กำหนด Archival Strategy ใน Data Model หมวด 5 (ปัจจุบันเสนอ Default 2 ปีก่อน Archive แต่ไม่ลบ) — ถ้าเจ้าของระบบมีข้อกำหนดจากสมาคมกีฬา/หน่วยงานต้นสังกัดเรื่องการเก็บสถิติ ต้องปรับตาม
- **ตัวเลือก**: ระบุจำนวนปีที่ต้องการ (Default ที่เสนอ: 2 ปีก่อนเปลี่ยนสถานะเป็น `archived` แต่ไม่ลบข้อมูล)
- **Recommendation**: **Default 2 ปี** ก่อน Archive (ไม่ลบข้อมูลจริง เพียงไม่แสดงใน public listing default)
- **ผลกระทบของแต่ละตัวเลือก**: ถ้าไม่ตอบ ใช้ Default 2 ปีไปพลางก่อนได้ (Low Risk เพราะ Archive ไม่ใช่ Delete) — แต่ถ้าสมาคมกีฬามีข้อกำหนดเก็บสถิติยาวกว่านี้ (เช่น สถิตินักกีฬาดาวรุ่งเก็บถาวร) ต้องปรับ Threshold ก่อน Phase 9
- **Phase ที่ถูก Block**: Phase 9 (Public Pages — Archival Display Logic)
- **Owner ที่ควรตอบ**: เจ้าของระบบ
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-12. Discipline/Suspension ของ Tournament ต้องแสดงต่อสาธารณะระดับใด?

- **เหตุผลที่ต้องตัดสินใจ**: `tournament_players.birth_date` และรายละเอียดใบโทษเป็นข้อมูลที่อาจอ่อนไหว (นักกีฬาเยาวชน) — Data Model เสนอให้ทำ View แยกจำกัด column สำหรับ Public API แต่ต้องยืนยันขอบเขตที่ชัดเจนจากเจ้าของระบบว่าเปิดเผยอะไรได้บ้าง
- **ตัวเลือก**: ต้องระบุร่วมกับเจ้าของระบบว่า field ใดเปิดเผยได้ (เช่น ชื่อ-สกุลนักกีฬา, จำนวนใบเหลือง/แดงสะสม) และ field ใดต้องปิด (เช่น `birth_date` เต็ม, เลขบัตรประชาชน/รหัสนักเรียนถ้ามีในอนาคต)
- **Recommendation**: เปิดเผยผ่าน `tournament.public_players_view` ที่จำกัด column เท่านั้น (ไม่รวม `birth_date` เต็มรูปแบบ — ถ้าจำเป็นต้องแสดงอายุ ให้แสดงเป็นรุ่นอายุ/ปีเกิดเท่านั้นไม่ใช่วันเกิดเต็ม)
- **ผลกระทบของแต่ละตัวเลือก**: ถ้าไม่ตอบก่อน Phase 9 ทีม Dev ต้องใช้แนวทางระมัดระวังที่สุด (ปิดข้อมูลอ่อนไหวทั้งหมด) ซึ่งอาจ Conservative เกินความจำเป็นเทียบกับสิ่งที่เจ้าของระบบต้องการแสดงจริง
- **Phase ที่ถูก Block**: Phase 9 (Public Pages)
- **Owner ที่ควรตอบ**: เจ้าของระบบ
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-13. ระยะเวลา Parallel Run (Phase 12) และเกณฑ์ตัดสินใจ Cutover คือเท่าไร?

- **เหตุผลที่ต้องตัดสินใจ**: กำหนดกรอบเวลาทำงานจริงของทีม และเกณฑ์ที่ชัดเจนว่า "พร้อม Cutover" คืออะไร (เช่น ผ่าน 1 ฤดูกาลเต็มบน V2 แบบคู่ขนาน หรือผ่านจำนวนนัดที่กำหนด)
- **ตัวเลือก**: ไม่มีตัวเลือกสำเร็จรูป — ต้องตกลงเกณฑ์เชิงปริมาณร่วมกับเจ้าของระบบ (เช่น จำนวนนัด, ระยะเวลาเป็นสัปดาห์/เดือน, หรือจำนวนฤดูกาล)
- **Recommendation**: ไม่มี Default — เป็นการตัดสินใจเชิง Business/Operational ล้วนๆ ที่ทีม Audit ไม่ควรเสนอตัวเลขแทน
- **ผลกระทบของแต่ละตัวเลือก**: Parallel Run สั้นเกินไปเสี่ยง Edge Case ที่ยังไม่เจอตอน Cutover จริง; ยาวเกินไปทำให้ทีมต้องดูแลระบบคู่ขนาน (V1+V2) นานโดยไม่จำเป็น เพิ่มภาระ Operational
- **Phase ที่ถูก Block**: Phase 13 (Cutover — ต้องขออนุมัติแยกต่างหากอยู่แล้วนอกเหนือจากรอบ Preparation นี้)
- **Owner ที่ควรตอบ**: เจ้าของระบบ
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-14. ระยะเวลาที่ต้องเก็บ Tournament V1 แบบ Read-only ก่อน Decommission (Phase 14) คือเท่าไร?

- **เหตุผลที่ต้องตัดสินใจ**: Phase 14 คือ Phase เดียวที่แตะ League Production Table โดยตรง (ถอดคอลัมน์ `stage`/`tournament_group_id`/`venue`/`winner_team_id` และ DROP ตาราง tournament-only ของ V1) — ยิ่งรอนานยิ่งปลอดภัย แต่ก็ทำให้ League schema มี "ของค้าง" นานขึ้น ต้องหาจุดสมดุลร่วมกับเจ้าของระบบ
- **ตัวเลือก**: ระบุจำนวนฤดูกาล/เดือนที่ต้องการเก็บ V1 แบบ Read-only ก่อนลบจริง
- **Recommendation**: **อย่างน้อย 1-2 ฤดูกาลแข่งขันเต็ม** เพื่อให้มั่นใจว่าไม่มี Edge Case ที่ต้องย้อนดู V1 (ตามที่ Implementation Phases ระบุไว้)
- **ผลกระทบของแต่ละตัวเลือก**: สั้นเกินไปเสี่ยงไม่มีข้อมูลอ้างอิงย้อนหลังถ้าพบปัญหาหลัง Cutover; ยาวเกินไปทำให้ League Schema มีคอลัมน์ Tournament-only ค้างอยู่นาน (Technical Debt สะสม)
- **Phase ที่ถูก Block**: Phase 14 (Legacy Decommission — ต้องขออนุมัติแยกต่างหากอยู่แล้ว)
- **Owner ที่ควรตอบ**: เจ้าของระบบ
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-17. Offline / Network Scope — ต้องรองรับ PWA/Offline เต็มรูปแบบใน MVP หรือไม่?

- **เหตุผลที่ต้องตัดสินใจ**: กระทบขอบเขต Phase 5b อย่างมาก (Retry Queue ธรรมดา vs Service Worker + Background Sync เต็มรูปแบบ)
- **ตัวเลือก**:
  - (a) Online-first + Retry Queue เท่านั้นใน MVP
  - (b) ต้องมี Full Offline Draft ตั้งแต่ MVP เพราะสนามบางแห่งสัญญาณไม่เสถียรจริง
- **Recommendation**: **(a)** — เริ่มจาก Online-first + Retry Queue ก่อน (ดู Target Architecture หมวด 11.6) แต่ต้องยืนยันว่าสภาพสัญญาณจริงหน้าสนามเพียงพอหรือไม่จากผู้ที่เคยไปหน้างานจริง
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Online-first**: ลด Complexity มาก (ไม่ต้องมี Service Worker/Background Sync/Conflict Resolution แบบ Distributed) ความเสี่ยง: ถ้าสัญญาณหน้าสนามแย่จริง เจ้าหน้าที่จะกรอกผลไม่ได้จนกว่าเน็ตกลับมา (มี Local Draft กันข้อมูลหายแต่ Submit ไม่ได้จนกว่าจะออนไลน์)
  - **(b) Full Offline**: ใช้งานได้แม้ไม่มีสัญญาณเลย แต่เพิ่มงาน Implementation มหาศาล (Service Worker, Background Sync, Conflict Resolution แบบ Distributed) เกินความจำเป็นถ้าสัญญาณจริงหน้าสนามใช้ได้
- **Phase ที่ถูก Block**: Phase 5b (Venue Matchday Dashboard + Quick Result)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ตัวแทนเจ้าหน้าที่สนามจริง (ควรมีคนที่เคยไปหน้างานจริงยืนยันสภาพสัญญาณ)
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-18. Venue และ Court Assignment — ต้องแยกสิทธิ์/ติดตามระดับ Court หรือพอแค่ระดับ Venue?

- **เหตุผลที่ต้องตัดสินใจ**: `tournament_courts` ถูกออกแบบไว้ใน Data Model แล้ว แต่ RBAC (`tournament_role_assignments`) ปัจจุบันออกแบบ Scope ไว้แค่ระดับ `venue_id` ไม่ลงถึง `court_id` — ถ้าสนามหนึ่งมีหลาย Court และต้องการแยกเจ้าหน้าที่รับผิดชอบคนละ Court ต้องเพิ่ม `court_id` เข้า Role Assignment ด้วย
- **หมายเหตุ**: คำถามนี้ต้องพิจารณาร่วมกับ D-03 (Shared Result-entry Account) เพราะถ้าบัญชี Result-entry เป็นบัญชีร่วมที่เลือกสนาม/นัดได้เองอยู่แล้ว การแยกสิทธิ์ระดับ Court อาจมีความหมายต่างไปจากที่ออกแบบไว้เดิม
- **ตัวเลือก**:
  - (a) พอแค่ระดับ Venue (คนเดียวดูแลทุก Court ในสนามตัวเอง)
  - (b) ต้องแยกสิทธิ์ระดับ Court ด้วย
- **Recommendation**: **(a)** ใน MVP — เพียงพอสำหรับ Scale ปัจจุบัน (4 สนาม), เก็บ (b) ไว้เป็น Future Enhancement ถ้าจำเป็นจริง
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) ระดับ Venue**: RBAC Model ง่ายกว่า, Implementation เร็วกว่า, แต่ถ้าสนามหนึ่งมีคอร์ตคู่ขนานจริงและต้องการแยกทีมงานคนละคอร์ต จะทำไม่ได้ในรอบแรก
  - **(b) ระดับ Court**: ควบคุมสิทธิ์ละเอียดขึ้น เหมาะกับสนามที่มีหลายคอร์ตพร้อมกันจริง แต่เพิ่มความซับซ้อนของ `authorizeVenueScope()` และ UI จัดการสิทธิ์
- **Phase ที่ถูก Block**: Phase 3 (RBAC Foundation), Phase 5 (Venue/Match Operations)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ตัวแทนเจ้าหน้าที่สนามจริง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-19. Realtime (Supabase Realtime) หรือ Polling สำหรับ Control Center และ Venue Dashboard?

- **เหตุผลที่ต้องตัดสินใจ**: กระทบความซับซ้อนของ Phase 5b/5d และ Cost ของ Supabase Project
- **ตัวเลือก**:
  - (a) Polling (แนะนำสำหรับ MVP)
  - (b) Supabase Realtime Subscription ตั้งแต่ต้น
- **Recommendation**: **(a) Polling 15-30 วินาที** — ง่ายกว่ามากและเพียงพอสำหรับ 4 สนาม เปิดทางอัปเกรดเป็น Realtime ในเฟสถัดไปถ้าจำเป็น
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Polling**: Implementation ง่าย, Cost ต่ำ, Latency 15-30 วินาทีซึ่งเพียงพอสำหรับ Use Case นี้ (ไม่ใช่ Live Score แบบ Real-time Broadcast)
  - **(b) Realtime**: Latency ต่ำกว่ามาก แต่เพิ่ม Complexity ของ Subscription Management และอาจเพิ่ม Cost ของ Supabase ตาม Concurrent Connection
- **Phase ที่ถูก Block**: Phase 5d (Central Control Center)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ตัวแทนเจ้าหน้าที่สนามจริง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-20. ไฟล์แนบ/ภาพถ่ายใน Full Match Report เก็บที่ไหน และมีข้อจำกัดขนาด/จำนวนเท่าไร?

- **เหตุผลที่ต้องตัดสินใจ**: `tournament_match_attachments` เก็บแค่ URL — ต้องตัดสินใจ Storage Provider (Supabase Storage ของ Tournament Project เอง หรือ Object Storage ภายนอก) และ Quota ก่อน Phase 5c — เชื่อมโยงกับ D-15 (Free Tier ตัดสินแล้ว) ที่ระบุว่าต้องจำกัด Attachment Size/Count ให้เหมาะสมกับ Free Tier
- **ตัวเลือก**:
  - (a) Supabase Storage ของ Tournament Project เอง
  - (b) Object Storage ภายนอก (เช่น S3-compatible)
- **Recommendation**: **(a)** เป็นจุดเริ่มต้น (ลดจำนวน External Dependency) — ต้องกำหนด Quota (ขนาดไฟล์สูงสุด, จำนวนไฟล์ต่อ Match) ร่วมด้วย โดยต้องพิจารณาข้อจำกัดของ Free Tier ตาม D-15
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Supabase Storage**: ตั้งค่าง่าย ผูกกับ Project เดียวกัน แต่ต้นทุน Storage ผูกกับ Supabase Free Tier ที่เลือกใน D-15 (ต้องระวัง Quota)
  - **(b) Object Storage ภายนอก**: แยก Cost/Scale อิสระจาก Database แต่เพิ่ม Complexity ของการจัดการ Credential/CORS อีกชุด
- **Phase ที่ถูก Block**: Phase 5c (Full Match Report + Attachment Upload)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ตัวแทนเจ้าหน้าที่สนามจริง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-21. เมื่อ Category ถูกย้ายสนามกลางทัวร์นาเมนต์ ต้องมี Workflow ยืนยัน/แจ้งเตือนระดับใด?

- **เหตุผลที่ต้องตัดสินใจ**: `tournament_category_venues` รองรับการย้ายได้ในระดับ Schema แต่ผลกระทบต่อนัดที่ตารางออกไปแล้ว (มี `venue_id` ผูกอยู่ใน `tournament_matches` แต่ละนัด ไม่ได้ผูกอัตโนมัติกับ Category) ต้องมี Business Process ชัดเจนว่าใครอนุมัติการย้าย และนัดที่ตารางไปแล้วต้องอัปเดตทีละนัดหรือยกชุด
- **ตัวเลือก**: ไม่มีตัวเลือกสำเร็จรูปในเอกสาร — ต้องออกแบบร่วมกับเจ้าของระบบ (เช่น ต้องมี Bulk Reassign Action ที่ต้องยืนยันก่อนหรือไม่, ใครมีสิทธิ์อนุมัติ)
- **Recommendation**: จำกัดสิทธิ์แก้ Mapping ไว้ที่ `tournament_super_admin` เท่านั้น (สอดคล้องกับ Venue Operations หมวด 3), การย้ายนัดที่ตารางออกแล้วควรผ่าน Bulk Action ที่แสดง Preview ก่อนยืนยันเสมอ (Pattern เดียวกับ Schedule Import Preview)
- **ผลกระทบของแต่ละตัวเลือก**: ถ้าไม่ตอบก่อน Phase 5a/5d ทีม Dev ต้องออกแบบ Workflow เองโดยไม่มีการยืนยันจากเจ้าของระบบ เสี่ยงไม่ตรงกับ Business Process จริงหน้างาน (เช่น กรณีฉุกเฉินสนามใช้งานไม่ได้กะทันหันต้องการความเร็วมากกว่าขั้นตอนอนุมัติหลายชั้น)
- **Phase ที่ถูก Block**: Phase 5a (Fixtures + Venue/Court Assignment), Phase 5d (Central Control Center — ต้องแสดง Conflict จากการย้ายนี้)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ตัวแทนเจ้าหน้าที่สนามจริง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-22. เจ้าหน้าที่ที่ไม่มีบัญชี Login ล่วงหน้า (อาสาสมัครวันแข่งขัน) จะเข้าระบบผ่าน QR Code ได้อย่างไรโดยยังผ่าน Authentication?

- **เหตุผลที่ต้องตัดสินใจ**: เอกสารต้นทางระบุ "เข้าหน้าสนามผ่าน QR Code ได้เพื่อเป็น Shortcut แต่ยังต้องผ่าน Authentication ปกติ" — ต้องชัดเจนว่า QR Code นำไปสู่หน้า Login ที่ pre-fill venue/category หรือมีกลไก Provisioning บัญชีชั่วคราวแบบใด — เชื่อมโยงกับ D-03 (Shared Result-entry Account) เพราะถ้าใช้บัญชีร่วมอยู่แล้ว QR Code อาจแค่นำไปสู่หน้า Login ของบัญชีร่วมนั้นโดยไม่ต้องมีบัญชีเฉพาะบุคคล
- **ตัวเลือก**:
  - (a) QR เป็น Shortcut ไปหน้า Login ปกติ (pre-fill scope hint) — ต้องมีบัญชีสร้างไว้ล่วงหน้าอยู่ดี
  - (b) Provisioning บัญชีชั่วคราวอัตโนมัติสำหรับอาสาสมัคร (Future Enhancement ตามเอกสาร Venue Operations)
- **Recommendation**: **(a)** สำหรับ MVP (ตรงกับ Venue Operations หมวด 19 ที่ระบุ (b) เป็น Future Enhancement) — ยิ่งสอดคล้องง่ายขึ้นหลัง D-03 เพราะบัญชี Result-entry เป็นบัญชีร่วมอยู่แล้ว ไม่จำเป็นต้องสร้างบัญชีแยกรายบุคคลให้อาสาสมัครแต่ละคน (QR อาจแค่ pre-fill venue ให้กับบัญชีร่วมที่มีอยู่แล้ว)
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Shortcut ไปหน้า Login**: Implementation ง่าย ปลอดภัย (QR ไม่ใช่ Bypass Token) — หลัง D-03 ยิ่งง่ายขึ้นเพราะไม่ต้องสร้างบัญชีรายบุคคลให้อาสาสมัครทุกคน เพียงแจก QR/รหัสผ่านของบัญชีร่วมให้อาสาสมัครแต่ละสนามใช้ร่วมกัน
  - **(b) Provisioning อัตโนมัติ**: สะดวกกว่ามากสำหรับอาสาสมัครหน้างาน แต่เพิ่มความเสี่ยงด้าน Security และเป็นงาน Implementation ที่ใหญ่กว่ามาก ไม่เหมาะกับ MVP โดยเฉพาะเมื่อ D-03 เลือกใช้บัญชีร่วมอยู่แล้ว (ลดความจำเป็นของ (b) ลงไปอีก)
- **Phase ที่ถูก Block**: Phase 5b (Venue Matchday Dashboard — จุดที่อาสาสมัครใช้งานจริง)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ตัวแทนเจ้าหน้าที่สนามจริง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-25. Import Batch Rollback Permission — ใครมีสิทธิ์ Rollback Import Batch?

- **เหตุผลที่ต้องตัดสินใจ**: Rollback Batch ลบ/แก้ Match จำนวนมากพร้อมกัน — ถ้าเปิดให้ Result-entry Account ทำได้ก็เสี่ยงเกินไป (สอดคล้องกับ D-03 ที่ห้ามบัญชีนี้ Import/Rollback โปรแกรมแข่งขันอยู่แล้ว) แต่ถ้าจำกัดแค่ `tournament_super_admin` อาจช้าเกินไปเวลาแก้ปัญหาหน้างาน
- **ตัวเลือก**:
  - (a) `tournament_super_admin` เท่านั้น
  - (b) `central_control` ทำได้ด้วย
  - (c) `venue_manager` ทำได้เฉพาะ Batch ที่กระทบสนามตนเอง
- **Recommendation**: **(a)** — ปลอดภัยสุด เพราะ Rollback กระทบข้อมูลจำนวนมากพร้อมกันและอาจกระทบหลายสนาม/Category พร้อมกัน (ยิ่งสอดคล้องกับ D-03 ที่ยืนยันแล้วว่า Result-entry Account ห้าม Rollback โดยเด็ดขาด)
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Super Admin เท่านั้น**: ปลอดภัยที่สุด แต่ถ้า Super Admin ไม่อยู่หน้างานตอนเกิดปัญหา การแก้ไขอาจล่าช้า
  - **(b) รวม central_control**: เร็วขึ้นเพราะมีคนตัดสินใจได้มากกว่า 1 คน แต่เพิ่มจำนวนคนที่ทำ Bulk Destructive Action ได้
  - **(c) venue_manager เฉพาะสนามตน**: กระจายอำนาจตัดสินใจไปหน้างานเร็วที่สุด แต่เพิ่มความเสี่ยง Human Error ในระดับสนาม และ Rollback อาจกระทบ Match ข้าม Venue ได้ในบาง Batch
- **Phase ที่ถูก Block**: Phase 4b (⛔ ระบุชัดเจนใน Implementation Phases — ต้องตอบก่อน Implement RBAC check บน Route `/schedule/import/batches/[id]/rollback`)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ผู้จัดโปรแกรมแข่งขันจริง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-28. เมื่อ Import Fixture ที่เคย Publish แล้ว ต้อง Reset สถานะอัตโนมัติหรือต้องมีคนกดยืนยันก่อน?

- **เหตุผลที่ต้องตัดสินใจ**: ข้อกำหนด Warning "มีการเปลี่ยนโปรแกรมที่ Publish แล้ว" (W11) บอกแค่ว่าต้องเตือน แต่ไม่ได้ระบุว่าระบบต้อง Auto-downgrade สถานะ (`published` → `revision_required`) หรือรอ Manual Action — เดิมผูกกับ D-16 (Approval Policy) ด้วยว่าใครมีสิทธิ์กดยืนยันการเปลี่ยนแปลงนี้ ตอนนี้ D-16 ตัดสินใจแล้วเป็น Single-step แต่คำถามนี้เกี่ยวกับ **Schedule Status** (มิติที่ 3 แยกจาก Result Workflow Status) ยังคงเป็นคำถามอิสระที่ต้องตอบแยก
- **ตัวเลือก**:
  - (a) Auto-downgrade ทันทีที่ตรวจพบการเปลี่ยนแปลง
  - (b) ต้องมีคนกดยืนยันก่อนถึงจะ Downgrade สถานะ
- **Recommendation**: **(b)** — ป้องกันการเปลี่ยนสถานะ Public-facing Schedule โดยไม่มีใครรู้ตัว
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Auto-downgrade**: ปลอดภัยกว่าในแง่ไม่มี Stale Published Data แต่เสี่ยง Schedule หลุดจาก Public View โดยไม่มีใครตั้งใจ
  - **(b) รอ Manual Confirm**: ควบคุมได้มากกว่า แต่เพิ่มขั้นตอน UX อีกหนึ่งจุดที่ผู้จัดโปรแกรมต้องกดยืนยัน
- **Phase ที่ถูก Block**: Phase 4b (Excel Import), Phase 4c (Draw Assignment Import)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ผู้จัดโปรแกรมแข่งขันจริง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

# 🟢 CAN DEFER

## D-26. เก็บ `tournament_schedule_versions` ย้อนหลังกี่เวอร์ชัน หรือไม่จำกัด?

- **เหตุผลที่ต้องตัดสินใจ**: กระทบ Storage และ UX ของหน้าประวัติ — ตารางนี้เป็น Append-only เหมือน `tournament_draw_assignments` และ `tournament_result_versions` ถ้าไม่จำกัดเลยสำหรับ Tournament ขนาดใหญ่หลายปีอาจมีจำนวนมาก (แม้ไม่ใช่ปัญหาจริงในสเกลนี้)
- **ตัวเลือก**:
  - (a) ไม่จำกัด (เก็บทุก Version ตลอดไป)
  - (b) จำกัดจำนวน Version ย้อนหลัง (ระบุจำนวน)
- **Recommendation**: **(a) ไม่จำกัด** — Storage Cost ต่ำมากสำหรับ Text/JSON ขนาดนี้ในสเกลของทัวร์นาเมนต์ระดับจังหวัด
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) ไม่จำกัด**: เก็บประวัติครบทุกครั้ง ไม่มีความเสี่ยงข้อมูลหาย, Storage Cost แทบไม่มีนัยสำคัญในสเกลนี้
  - **(b) จำกัดจำนวน**: ประหยัด Storage เล็กน้อยแต่ไม่จำเป็นในสเกลนี้ และเพิ่มความซับซ้อนของ Pruning Logic โดยไม่ได้ประโยชน์ชัดเจน
- **Phase ที่ถูก Block**: ไม่ Block งานใดจริงจัง — ใส่เป็นคำถามเพื่อยืนยัน Recommendation เท่านั้น ตัดสินใจได้ทุกเมื่อก่อน Phase 4b โดยไม่กระทบ Timeline
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ผู้จัดโปรแกรมแข่งขันจริง (ตอบพร้อมกับรอบ Scheduling ได้เลย)
- **Final Decision**: _(รอตัดสินใจ — ใช้ Recommendation เป็นค่าเริ่มต้นได้ถ้าไม่มีข้อขัดแย้ง)_
- **Decision Date**: _(รอตัดสินใจ)_

---

# ⚪ RESOLVED — ปิดแล้ว ไม่ใช่ Open Question อีกต่อไป

## Q27. Full Auto Scheduler — ยืนยันตารางเวลาสำหรับ Future Phase หรือไม่?

- **สถานะ**: **ตัดสินใจแล้ว** จากข้อกำหนด Scheduling Addendum — MVP รอบนี้ไม่ทำ Full Auto Scheduler (Drag-and-drop, Suggest Slot, Constraint Scheduler ทั้งหมดอยู่ใน Future Phase)
- **เก็บไว้ในเอกสารนี้เพื่อ**: บันทึกว่าเป็นการตัดสินใจที่ชัดเจนแล้ว ไม่ใช่ค่า Default ที่ทีม Audit เดาเอง — ป้องกันไม่ให้ถูกหยิบขึ้นมาถามซ้ำโดยไม่จำเป็น
- **ไม่ต้อง Action เพิ่มเติม**

---

## Cross-document Update Impact

> **สถานะ**: Sync แล้วในรอบนี้ (2026-07-14) — เอกสารทั้ง 7 ฉบับด้านล่างถูกอัปเดตให้สอดคล้องกับ Final Decisions ทั้งหมดแล้ว (Targeted Edit เก็บเนื้อหาเดิมที่ยังถูกต้องไว้) รายการด้านล่างสรุปการเปลี่ยนแปลงที่ทำจริงในแต่ละเอกสาร

### `TOURNAMENT_V2_DATA_MODEL.md` — Synced
- **`tournament_teams`**: เพิ่ม Comment ยืนยัน D-04 (ไม่มี School Master, ไม่มี FK ไป League)
- **`tournament_players`**: เพิ่ม Comment ยืนยัน D-05 (ไม่มี `person_id` กลาง, ไม่เชื่อมข้าม Tournament/Category)
- **`tournament_matches`**: แยก `regulation_home_score`/`regulation_away_score` ออกจาก `home_score`/`away_score` เดิม, เปลี่ยนชื่อ `home_penalty_score`/`away_penalty_score` เป็น `penalty_home_score`/`penalty_away_score`, เพิ่ม `decided_by`; ปรับ CHECK constraint ให้บังคับมี `winner_team_id` เสมอสำหรับนัดที่ `finished` (ไม่มีผลเสมออีกต่อไปตาม D-09)
- **`tournament_standing_rules`**: ปรับ `tiebreak_order` Default ให้ตรงลำดับ D-09 (7 ขั้น), ทำเครื่องหมาย `points_draw` เป็น Unused
- **`tournament_suspension_events`**: ปรับ `event_type` เป็น Card-count/type based (`accumulated_two_yellow`/`second_yellow_same_match`/`direct_red`/`manual`), เอา `points_added`/`points_total_after`/`threshold_crossed` ออก (League-specific concept)
- **Fair-play Score**: เพิ่มเป็น Computed Value ผ่าน `calculateFairPlayScore()` (Code) อ่านจาก `tournament_match_cards` โดยตรง ไม่ใช่ Stored Column — บันทึกในหมวด 6 (Rule ใดอยู่ Database vs Code)
- **Qualification Draw**: เพิ่มตาราง `tournament_qualification_draws` + `tournament_qualification_draw_candidates` ใหม่ (หมวด 2.14b) รองรับ D-29
- **Result Workflow**: ปรับ `tournament_result_submissions.status` enum เป็น `not_started/draft/previewed/submitted/published/correction_requested/corrected` ตาม D-16
- **RBAC**: เพิ่มหมายเหตุ Shared Result-entry Account ในหมวด 2.17
- **Environment Variables**: ไม่มีในเอกสารนี้ (อยู่ใน Target Architecture) — ไม่ต้องแก้
- **ERD (Mermaid)**: เพิ่มความสัมพันธ์ `tournament_qualification_draws`

### `TOURNAMENT_V2_TARGET_ARCHITECTURE.md` — Synced
- หมวด 5 (Auth Strategy): เพิ่ม Shared Result-entry Account Model (D-03) คู่กับ Auth เดิมของ Role ระดับสูง
- หมวด 6 (Environment Variables): เปลี่ยนชื่อ Prefix เป็น `LEAGUE_*`/`TOURNAMENT_*` ตาม D-01
- หมวด 11.2 (RBAC Roles table): เพิ่มคอลัมน์ Account Model ระบุ Individual vs Shared
- หมวด 11.3 (`authorizeVenueScope()`): ปรับให้ตรวจ Match/Venue Scope แบบ Validation (ไม่ใช่ Restriction) สำหรับ Result-entry Role

### `TOURNAMENT_V2_VENUE_OPERATIONS.md` — Synced
- หมวด 4.1/4.2 (Roles, Permission Matrix): เพิ่มแถว Result-entry Account, ปรับ "Approve ผล" ให้สะท้อน Single-step Workflow (D-16)
- หมวด 5 (RBAC หลักการบังคับ): ปรับข้อ 1 ("ห้ามแชร์บัญชี") ให้มีข้อยกเว้นสำหรับ Result-entry Role ตาม D-03
- หมวด 9 (Result Approval Policies): แทนที่ด้วย Single-step + Mandatory Preview
- หมวด 10.2 (Result Workflow State Machine): ปรับ State ตาม D-16 พร้อม Correction Loop
- หมวด 15 (Public Views): ไม่กระทบ

### `TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md` — Synced
- หมวด 7.2 (Validation Matrix — Error): เพิ่ม E18 (`venue_max_matches_per_day` เกิน 8)
- หมวด 7.3 (Validation Matrix — Warning): ปิดใช้งาน W3/W4 พร้อมทำเครื่องหมาย Future Enhancement ตาม D-24
- หมวด 3 (Fixture Excel Format): เพิ่มหมายเหตุ `result_policy` column ว่า Default = `single_step` เสมอตาม D-16

### `TOURNAMENT_V2_MIGRATION_MAP.md` — Synced
- เพิ่ม Header Banner ระบุ **NOT APPLICABLE — ตัดสินใจแล้วว่าไม่ Migrate ข้อมูล Tournament V1 (D-02)** เก็บเอกสารไว้เป็น Historical Reference เท่านั้น
- หมวด 6-7 (Venue/RBAC/Draw Seed Data): คงไว้ตามเดิม (ยังใช้ได้ เป็น Fresh Insert)

### `TOURNAMENT_V2_IMPLEMENTATION_PHASES.md` — Synced
- **Phase 0**: อัปเดต Acceptance Criteria — Blocker ปิดครบแล้ว
- **Phase 1**: อัปเดตให้สะท้อนว่า D-01/D-04/D-05 ปลดล็อกครบ พร้อมเริ่ม DDL
- **Phase 3**: ปรับขอบเขต RBAC ให้รองรับ Shared Result-entry Account (D-03)
- **Phase 4b**: เอา ⛔ Blocked by Q24 ออก (D-24 DECIDED แล้ว), คง ⛔ Blocked by Q25 ไว้
- **Phase 5c**: ปรับขอบเขตให้เล็กลงตาม D-16 (ไม่มี Approval Step แยก)
- **Phase 7**: เอา ⛔ Blocked by Q23 ออก (D-07 DECIDED แล้ว)
- **Phase 8**: พร้อม Implement ตาม D-06 ยกเว้นส่วน Bye/Postponed/Cancelled
- **Phase 11**: เปลี่ยนชื่อ/ขอบเขตจาก "Migration Dry Run" เป็น **"Fresh-data Verification / Import Rehearsal"** ตาม D-02

### `TOURNAMENT_V2_OPEN_QUESTIONS.md` — Synced
- เพิ่ม Banner ต้นเอกสารชี้ไปยัง `TOURNAMENT_V2_DECISION_CHECKLIST.md` เป็น Source of Truth ปัจจุบัน
- ทำเครื่องหมาย Q1-Q9, Q15, Q16, Q23, Q24, Q27 ว่า "ตอบแล้ว" พร้อมอ้างอิง Decision ID

### อื่นๆ
- **ไฟล์อ้างอิงกติกา `world-cup-2026-rules-summary-th.md`**: ยังอยู่นอก Repository (`Downloads/`) — คำแนะนำคัดลอกเข้า `docs/rules/` ยังไม่ถูกดำเนินการในรอบนี้ (ไม่ใช่คำสั่งที่ได้รับ) คงเป็นข้อเสนอสำหรับรอบ Implementation

---

## Appendix — การตรวจสอบความครบถ้วน (Traceability Check)

| Q เดิม | Decision ID ในเอกสารนี้ | สถานะล่าสุด |
|---|---|---|
| Q1 | D-01 | ✅ DECIDED |
| Q2 | D-02 | ✅ DECIDED |
| Q3 | D-03 | ✅ DECIDED (ขอบเขตจำกัดเฉพาะ Result-entry Account) |
| Q4 | D-04 | ✅ DECIDED |
| Q5 | D-05 | ✅ DECIDED |
| Q6 | D-06 | ✅ DECIDED (ยกเว้น Bye/Postponed/Cancelled sub-question) |
| Q7 | D-07 | ✅ DECIDED WITH CATEGORY OVERRIDE |
| Q8 | D-07 (รวมเป็นคำถามย่อย) | ✅ หลักการตัดสินแล้ว (Configurable per Category) — สูตรปรับสัดส่วนยังไม่ระบุ |
| Q9 | D-09 | ✅ DECIDED (ยกเว้น Last-place cutoff sub-question) |
| Q10 | D-10 | 🟡 รอตัดสินใจ |
| Q11 | D-11 | 🟡 รอตัดสินใจ |
| Q12 | D-12 | 🟡 รอตัดสินใจ |
| Q13 | D-13 | 🟡 รอตัดสินใจ |
| Q14 | D-14 | 🟡 รอตัดสินใจ |
| Q15 | D-15 | ✅ DECIDED |
| Q16 | D-16 | ✅ DECIDED |
| Q17 | D-17 | 🟡 รอตัดสินใจ |
| Q18 | D-18 | 🟡 รอตัดสินใจ |
| Q19 | D-19 | 🟡 รอตัดสินใจ |
| Q20 | D-20 | 🟡 รอตัดสินใจ |
| Q21 | D-21 | 🟡 รอตัดสินใจ |
| Q22 | D-22 | 🟡 รอตัดสินใจ |
| Q23 | D-07 (รวมเป็นคำถามเดียวกัน) | ✅ DECIDED |
| Q24 | D-24 | ✅ DECIDED |
| Q25 | D-25 | 🟡 รอตัดสินใจ |
| Q26 | D-26 | 🟢 Can Defer |
| Q27 | RESOLVED (ปิดแล้ว) | ⚪ RESOLVED |
| Q28 | D-28 | 🟡 รอตัดสินใจ |
| — | D-29 (ใหม่) | ✅ DECIDED |

**หัวข้อบังคับ 12 ข้อจากคำสั่งงานรอบก่อนหน้า — ยังครอบคลุมครบถ้วน**:

| หัวข้อบังคับ | Decision ID | สถานะ |
|---|---|---|
| Database Isolation | D-01 | ✅ DECIDED |
| Existing Tournament Data Strategy | D-02 | ✅ DECIDED |
| Authentication และ Admin Accounts | D-03 | ✅ DECIDED (ขอบเขตจำกัด) |
| Result Approval Policy | D-16 | ✅ DECIDED |
| Standings / Tiebreak Rules | D-09 | ✅ DECIDED (ยกเว้น sub-question) |
| Best Third-place Rules | D-07 / D-29 | ✅ DECIDED WITH OVERRIDE |
| Discipline / Suspension Rules | D-06 | ✅ DECIDED (ยกเว้น sub-question) |
| Minimum Rest Time | D-24 | ✅ DECIDED (ไม่ Validate ใน MVP) |
| Maximum Matches per Team per Day | D-24 | ✅ DECIDED (ไม่ Validate ใน MVP) |
| Import Batch Rollback Permission | D-25 | 🟡 รอตัดสินใจ |
| Offline / Network Scope | D-17 | 🟡 รอตัดสินใจ |
| Venue และ Court Assignment | D-18 | 🟡 รอตัดสินใจ |

**หมายเหตุ Decision ที่ปิดในรอบนี้ (2026-07-14)**: D-04, D-05, D-24 — Blocker ก่อน Phase 1 เหลือ **0 ข้อ**

---

## Rollback Plan สำหรับเอกสารชุดนี้

เอกสารนี้เป็น Markdown ล้วน ไม่มีการแก้ไข Production/Schema/Route/Migration/Source Code ใดๆ — Rollback คือไม่ commit หรือย้อนกลับไฟล์นี้ด้วย `git checkout`/`git revert` ไม่มีผลกระทบต่อ League หรือ Tournament V1 ที่ทำงานอยู่จริง เช่นเดียวกับเอกสารชุดอื่นในรอบ Preparation นี้ — รอบนี้ (Documentation Decision Lock) ไม่มีการสร้าง Migration, Source Code, Supabase Project จริง, หรือแตะ Production/League/Vercel Environment ใดๆ ทั้งสิ้น
