# Tournament V2 — Decision Checklist

**สถานะ**: รอ Decision Lock จากเจ้าของระบบ — **ห้ามเริ่ม Implementation (Phase 1) จนกว่า Decision กลุ่ม BLOCKER ทั้งหมดจะถูกตอบ**
**วัตถุประสงค์**: รวบรวม Open Questions ทั้งหมดจากเอกสาร Preparation 9 ฉบับ (`TOURNAMENT_V2_PREPARATION_PLAN.md`, `TOURNAMENT_V2_CURRENT_STATE_AUDIT.md`, `TOURNAMENT_V2_TARGET_ARCHITECTURE.md`, `TOURNAMENT_V2_DATA_MODEL.md`, `TOURNAMENT_V2_MIGRATION_MAP.md`, `TOURNAMENT_V2_IMPLEMENTATION_PHASES.md`, `TOURNAMENT_V2_OPEN_QUESTIONS.md`, `TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md`, `TOURNAMENT_V2_VENUE_OPERATIONS.md`) มาจัดลำดับความสำคัญเป็น Checklist เดียวที่เจ้าของระบบตอบได้ทีละข้อ พร้อม Recommendation จากทีม Audit
**หลักการ**: ทีม Audit **ไม่เดาคำตอบแทนเจ้าของระบบ** — ทุก Recommendation ในเอกสารนี้เป็นข้อเสนอพร้อมเหตุผลเท่านั้น การตัดสินใจจริง (Final Decision) ต้องมาจากเจ้าของระบบ
**ขอบเขตของรอบนี้**: เอกสาร Markdown เท่านั้น **ไม่มีการสร้าง Migration, Source Code, หรือ Implementation Branch ใดๆ** ไม่แตะ Production/Supabase/Vercel Environment หรือ League

---

## วิธีอ่านเอกสารนี้

| กลุ่ม | ความหมาย | จำนวน |
|---|---|---:|
| 🔴 **BLOCKER** | ต้องตอบก่อนเริ่ม Phase 1 (Database Foundation) ทั้ง Phase — รวมถึงคำถามที่ Block เฉพาะขั้นตอน DDL ภายใน Phase 1 | 9 |
| 🟡 **REQUIRED BEFORE FEATURE PHASE** | ไม่ block Phase 1 แต่ต้องตอบก่อนถึง Phase ที่เกี่ยวข้อง (ระบุไว้ในคอลัมน์ "Blocks Phase" ของแต่ละข้อ) | 15 |
| 🟢 **CAN DEFER** | มี Recommendation ที่ปลอดภัยพอจะใช้เป็นค่าเริ่มต้นได้ ตัดสินใจภายหลังได้โดยไม่กระทบ Timeline | 1 |
| ⚪ **RESOLVED** | ตัดสินใจแล้วจากเอกสารก่อนหน้า ไม่ใช่ Open Question อีกต่อไป (เก็บไว้เพื่อบันทึกประวัติ) | 1 |

**หมายเหตุการรวมคำถาม**: บางคำถามใน `TOURNAMENT_V2_OPEN_QUESTIONS.md` ถูกรวมเป็น Decision เดียวกันในเอกสารนี้เพราะเป็นเรื่องเดียวกันจริง (เช่น Q7 เดิมกับ Q23 ใน Scheduling Addendum คือคำถามเดียวกัน) — ดูหมายเหตุในแต่ละ Decision ที่เกี่ยวข้อง

---

## Decision Summary Table

| ID | Decision | Status | Recommendation | Blocks Phase |
|---|---|---|---|---|
| D-01 | Database Isolation (Supabase แยก Project หรือไม่) | 🔴 รอตัดสินใจ | Option A — แยก Project | Phase 1 (ทั้งหมด) |
| D-02 | Existing Tournament Data Strategy (Migrate vs เริ่มใหม่) | 🔴 รอตัดสินใจ | (c) Migrate เฉพาะ Tournament ที่ Active/ใช้ฤดูกาลหน้า | Phase 1, 11, 12, 13 |
| D-03 | Authentication และ Admin Accounts (League/Tournament ใช้ร่วมกันหรือไม่) | 🔴 รอตัดสินใจ | (a) Admin เดียวกัน ใช้ Auth ร่วม | Phase 1 DDL, Phase 3 |
| D-04 | Team Master ต้องแชร์กันหรือ Import แยก | 🔴 รอตัดสินใจ | (a) Import แยกอิสระต่อ Tournament | Phase 1 DDL |
| D-05 | Player คนเดิมผูกข้ามรายการ/ข้ามรุ่นอายุได้หรือไม่ | 🔴 รอตัดสินใจ | (a) ไม่ผูก แต่ละรายการอิสระ | Phase 1 DDL |
| D-06 | Discipline / Suspension Rules ของ Tournament | 🔴 รอตัดสินใจ | ไม่มี Default ที่ปลอดภัย — ต้องขอกติกาจริงจากเจ้าของระบบ | Phase 1 DDL, Phase 8 |
| D-07 | Best Third-place Rules (เกณฑ์เทียบทีมอันดับ 3 ข้ามกลุ่ม + กลุ่มไม่เท่ากัน) | 🔴 รอตัดสินใจ | (a) เทียบตรงตามคะแนน/GD/GF (แบบง่าย) | Phase 1 DDL, Phase 6, Phase 7 |
| D-09 | Standings / Tiebreak Rules — กติกาตัดผลกับทีมอันดับสุดท้าย | 🔴 รอตัดสินใจ | ไม่มี Default ที่ปลอดภัย — ต้องขอตัวอย่างกติกาจริง | Phase 1 DDL, Phase 6 |
| D-15 | งบประมาณ Supabase Project ที่สอง (ถ้า D-01 = Option A) | 🔴 รอตัดสินใจ | Free/Small tier น่าจะเพียงพอ — ขอยืนยันงบก่อนสร้าง Project จริง | Phase 1 |
| D-10 | Public URL ใหม่ต้องเป็นรูปแบบใด | 🟡 รอตัดสินใจ | (a) URL ใหม่ทั้งหมด + Redirect จาก URL เก่า | Phase 9 |
| D-11 | Data Retention — เก็บ Tournament เก่ากี่ปี | 🟡 รอตัดสินใจ | Default 2 ปีก่อน Archive (ไม่ลบ) | Phase 9 |
| D-12 | ขอบเขตเปิดเผย Discipline/Suspension ต่อสาธารณะ | 🟡 รอตัดสินใจ | เปิดเผยผ่าน View ที่จำกัด column เท่านั้น (ไม่รวม birth_date เต็ม) | Phase 9 |
| D-13 | ระยะเวลา Parallel Run และเกณฑ์ Cutover | 🟡 รอตัดสินใจ | ไม่มี Default — ต้องตกลงเกณฑ์ร่วมกัน | Phase 13 |
| D-14 | ระยะเวลาเก็บ Tournament V1 แบบ Read-only ก่อน Decommission | 🟡 รอตัดสินใจ | อย่างน้อย 1-2 ฤดูกาลเต็ม | Phase 14 |
| D-16 | Default Result Approval Policy | 🟡 รอตัดสินใจ | (a) `two_step` ทุกนัด | Phase 4b, Phase 5c |
| D-17 | Offline / Network Scope (ต้องมี PWA เต็มรูปแบบใน MVP หรือไม่) | 🟡 รอตัดสินใจ | (a) Online-first + Retry Queue เท่านั้นใน MVP | Phase 5b |
| D-18 | Venue และ Court Assignment — RBAC ต้องแยกระดับ Court หรือพอแค่ Venue | 🟡 รอตัดสินใจ | (a) พอแค่ระดับ Venue ใน MVP | Phase 3, Phase 5 |
| D-19 | Realtime หรือ Polling สำหรับ Control Center/Venue Dashboard | 🟡 รอตัดสินใจ | (a) Polling 15-30 วินาที | Phase 5d |
| D-20 | ที่เก็บไฟล์แนบ Full Match Report + ข้อจำกัดขนาด/จำนวน | 🟡 รอตัดสินใจ | Supabase Storage ของ Tournament Project เอง (ต้องกำหนด Quota) | Phase 5c |
| D-21 | Workflow ยืนยัน/แจ้งเตือนเมื่อย้าย Category ไปสนามอื่นกลางทัวร์นาเมนต์ | 🟡 รอตัดสินใจ | ต้องกำหนดผู้อนุมัติ + วิธี Bulk Update นัดที่ตารางออกแล้ว | Phase 5a, Phase 5d |
| D-22 | เจ้าหน้าที่อาสาสมัคร (ไม่มีบัญชีล่วงหน้า) เข้าระบบผ่าน QR Code อย่างไร | 🟡 รอตัดสินใจ | QR เป็น Shortcut ไปหน้า Login ปกติ (pre-fill scope hint) | Phase 5b |
| D-24 | Minimum Rest Time & Maximum Matches per Team per Day (ค่า Threshold จริง) | 🟡 รอตัดสินใจ | ไม่มี Default ที่ปลอดภัย — ต้องได้ตัวเลขจริงจากเจ้าของระบบ | Phase 4b |
| D-25 | Import Batch Rollback Permission (ใครมีสิทธิ์) | 🟡 รอตัดสินใจ | (a) `tournament_super_admin` เท่านั้น | Phase 4b |
| D-28 | Auto-downgrade Schedule Status เมื่อแก้ไข Fixture ที่ Publish แล้ว | 🟡 รอตัดสินใจ | ต้องมีคนกดยืนยัน ไม่ Auto-downgrade เงียบๆ | Phase 4b, Phase 4c |
| D-26 | จำนวน Version ย้อนหลังของ `tournament_schedule_versions` ที่ต้องเก็บ | 🟢 Can Defer | ไม่จำกัด (Storage Cost ต่ำมาก) | ไม่ Block งานใด |
| Q27 | Full Auto Scheduler ใน MVP รอบนี้ | ⚪ ตัดสินใจแล้ว | ไม่ทำใน MVP (เก็บไว้เป็น Future Phase) | — (ปิดแล้ว) |

---

## ลำดับการประชุมแนะนำ (จากเอกสารต้นทาง)

1. **รอบที่ 1 — Architecture Lock**: D-01, D-02, D-03, D-15 (Owner: เจ้าของระบบ)
2. **รอบที่ 2 — Business Rules**: D-04, D-05, D-06, D-07, D-09 (Owner: เจ้าของระบบ + กรรมการ/สมาคมกีฬาที่เกี่ยวข้อง)
3. **รอบที่ 3 — Venue Operations**: D-16, D-17, D-18, D-19, D-20, D-21, D-22 (Owner: เจ้าของระบบ + ตัวแทนเจ้าหน้าที่สนามจริง)
4. **รอบที่ 4 — Scheduling/Draw**: D-24, D-25, D-26, D-28 (Owner: เจ้าของระบบ + ผู้จัดโปรแกรมแข่งขันจริง)
5. **รอบที่ 5 — Public/Operational**: D-10, D-11, D-12, D-13, D-14 (Owner: เจ้าของระบบ, ทำได้ทุกเมื่อก่อน Phase ที่เกี่ยวข้อง ไม่เร่งด่วนเท่ารอบ 1-4)

---

# 🔴 BLOCKER — ต้องตอบก่อนเริ่ม Phase 1

## D-01. Database Isolation — ต้องการ Supabase แยก Project หรือไม่?

- **เหตุผลที่ต้องตัดสินใจ**: กำหนด Environment Variables, Auth Strategy, RLS Strategy ทั้งหมดใน `TOURNAMENT_V2_TARGET_ARCHITECTURE.md` หมวด 5 — เปลี่ยนใจภายหลัง Phase 1 จะเสียงานสร้างใหม่ทั้งหมด (ต้องย้าย Project/Env Var/RLS ทั้งชุด)
- **ตัวเลือก**:
  - (a) **Option A** — Supabase Project แยกต่างหากสำหรับ Tournament
  - (b) **Option B** — Project เดียวกับ League แยกด้วย Schema/Table prefix (`tournament_*`)
- **Recommendation**: **Option A (แยก Project)**
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Option A**: Isolation สูงสุด (ไม่มีทาง query ข้ามระบบโดยไม่ตั้งใจ), Blast Radius จำกัดเฉพาะ Tournament DB, Backup/PITR แยกอิสระ, แต่เพิ่ม Operational Overhead (+1 Supabase Dashboard, +1 ชุด Env Var, +1 Billing line) และต้องออกแบบ Auth ข้าม Project (League เป็น Identity Provider, Tournament เก็บ permission mapping เอง)
  - **(b) Option B**: Setup เร็วกว่าเล็กน้อย ไม่ต้องเพิ่ม Env Var ใหม่ ใช้ `admin_profiles` เดิมร่วมกันได้ทันที แต่ยังมี Blast Radius ร่วมกับ League (Migration ผิดจุดอาจกระทบ League), ต้องพึ่ง "วินัยของทีม" ในการไม่ join ข้ามระบบ ซึ่งเป็นสาเหตุของปัญหาที่ V1 เจออยู่ตอนนี้ (Additive Mode)
- **Phase ที่ถูก Block**: Phase 1 ทั้ง Phase (Database Foundation) — เป็นรากฐานของทุก Phase ถัดไป
- **Owner ที่ควรตอบ**: เจ้าของระบบ
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-02. Existing Tournament Data Strategy — ข้อมูล Tournament เดิมต้องย้ายทั้งหมดหรือเริ่มรายการใหม่?

- **เหตุผลที่ต้องตัดสินใจ**: กำหนดว่าต้องทำ Phase 11 (Migration Dry Run) เต็มรูปแบบหรือข้ามไปเลย และกำหนดความเสี่ยง Data Loss ของ Phase 13 (Cutover) — ตาม Current State Audit R1, Tournament match บันทึกประตู/ใบเหลืองแดงไม่ได้ผ่าน UI ปัจจุบันเลย ข้อมูลที่มีอยู่จริงอาจสมบูรณ์แค่ระดับ Fixture + Score เท่านั้น
- **ตัวเลือก**:
  - (a) Migrate ทั้งหมดตาม Migration Map
  - (b) เริ่มรายการใหม่ทั้งหมด ไม่ Migrate อดีต
  - (c) Migrate เฉพาะ Tournament ที่ยัง Active/จะใช้ในฤดูกาลหน้า
- **Recommendation**: พิจารณา **(c)** เป็นจุดสมดุล เพราะข้อมูล Tournament เก่าตาม Audit น่าจะมีแค่ระดับ Fixture+Score (ไม่มี Goals/Cards/Suspension ให้เสียมาก) — Migrate เฉพาะที่ยังมีประโยชน์จริงลดความเสี่ยง/ต้นทุนของ Phase 11-13 โดยไม่เสียข้อมูลสำคัญ (เป็น Recommendation ให้พิจารณา ไม่ใช่คำตอบสุดท้าย)
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Migrate ทั้งหมด**: ต้องทำ Phase 11 เต็มรูปแบบ (Verification Checklist ครบทุกข้อใน Migration Map), ยอมรับ Known Data Loss บางรายการที่หลีกเลี่ยงไม่ได้ (Penalty Score รายลูก — ดูหมายเหตุด้านล่าง), ใช้เวลา/ความเสี่ยงมากที่สุดแต่รักษาประวัติครบที่สุด
  - **(b) เริ่มใหม่ทั้งหมด**: ข้าม Phase 11 ได้เกือบทั้งหมด, ลด Risk ของ Phase 13 ลงมาก, แต่เสียประวัติ Tournament เก่าทั้งหมด (รวมถึงที่อาจยังอ้างอิงอยู่ในเอกสาร/สถิติของสมาคม)
  - **(c) Migrate เฉพาะ Active**: ต้นทุน/ความเสี่ยงอยู่กึ่งกลาง แต่ต้องมีเกณฑ์ชัดเจนว่า "Active" หมายถึงอะไร (เช่น `end_date` หลังวันที่เท่าไร) ก่อนเริ่ม Phase 11
  - **หมายเหตุ Data Loss ที่ผูกกับตัวเลือกนี้** (จาก `TOURNAMENT_V2_MIGRATION_MAP.md` หมวด 3.2/4): ถ้าเลือก (a) หรือ (c) ต้องยอมรับว่า Penalty Score รายลูกของนัดที่ตัดสินด้วยจุดโทษใน V1 **กู้คืนไม่ได้** (มีแค่ `winner_team_id` ไม่มีสกอร์จุดโทษจริงเก็บอยู่) — ต้องแจ้งเจ้าของระบบแยกอีกครั้งก่อน Phase 11 ว่ายอมรับ Known Limitation นี้หรือต้องหาข้อมูลจากแหล่งอื่น (เอกสารกระดาษ) มาเสริม
- **Phase ที่ถูก Block**: Phase 1 (กำหนดขอบเขตงาน), Phase 11 (Migration Dry Run), Phase 12 (Parallel Run), Phase 13 (Cutover)
- **Owner ที่ควรตอบ**: เจ้าของระบบ
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-03. Authentication และ Admin Accounts — Tournament และ League ใช้ Admin Account ชุดเดียวกันหรือไม่?

- **เหตุผลที่ต้องตัดสินใจ**: กำหนด Auth Strategy ใน Target Architecture หมวด 5 — ถ้าใช้ร่วมกัน ต้องออกแบบ Permission Mapping ข้าม Project (กรณี D-01 = Option A); ถ้าแยกกัน ต้องมีระบบ Login สองชุด เพิ่มงาน Implementation
- **ตัวเลือก**:
  - (a) Admin คนเดียวกันจัดการทั้งสองระบบ ใช้ Auth ร่วม
  - (b) แยก Admin Account คนละชุดสมบูรณ์
  - (c) มี Admin กลางที่เห็นทั้งคู่ + Admin เฉพาะทาง Module
- **Recommendation**: **(a)** — League Supabase เป็น Identity Provider เดียว (เก็บ `admin_profiles`), Tournament Project เก็บ `tournament_admin_permissions`/`tournament_role_assignments` mapping ของตัวเอง sync ตอน login เท่านั้น ไม่ query ข้าม Project ทุก request
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Auth ร่วม**: ไม่ต้อง sync user 2 ที่, Admin สลับดู League/Tournament ไม่ต้อง login ใหม่, แต่ต้องระวังเรื่อง Permission Mapping ผิดพลาดข้าม Project
  - **(b) แยกสมบูรณ์**: Isolation สูงสุดระดับ Auth แต่เพิ่มภาระ Login/จำรหัสผ่านให้ผู้ใช้ และเพิ่มงาน Implement ระบบ Auth ที่สอง
  - **(c) Admin กลาง + เฉพาะทาง**: ยืดหยุ่นที่สุดแต่ซับซ้อนที่สุดในการออกแบบ Permission Model — เหมาะถ้าองค์กรมีคนละทีมดูแล League/Tournament จริง
- **Phase ที่ถูก Block**: Phase 1 DDL (โครงสร้างตาราง RBAC), Phase 3 (RBAC Foundation Implementation)
- **Owner ที่ควรตอบ**: เจ้าของระบบ
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-04. Team Master ต้องแชร์กันหรือ Import แยก?

- **เหตุผลที่ต้องตัดสินใจ**: กำหนดว่า `tournament_teams` ต้องมี FK ไปยัง master school/team registry ภายนอกหรือไม่ (ปัจจุบันออกแบบให้ไม่มี FK กลาง — แต่ละ Tournament import ทีมของตัวเอง) — ถ้าต้องการ Master กลาง ต้องเพิ่มตารางใหม่ (`school_master` หรือคล้ายกัน) **ก่อน Phase 1 DDL**
- **ตัวเลือก**:
  - (a) Import แยกอิสระต่อ Tournament (แผนปัจจุบันใน Data Model)
  - (b) มี School/Team Master กลางให้เลือกตอนสมัคร ลดการพิมพ์ชื่อซ้ำ
- **Recommendation**: **(a)** — ตรงกับ Data Model ปัจจุบันที่ออกแบบไว้แล้ว, ลดความซับซ้อนของ Schema ในรอบแรก
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Import แยก**: Implementation ง่ายกว่า ไม่ต้องสร้างตาราง Master เพิ่ม แต่ผู้จัดต้องพิมพ์ชื่อโรงเรียน/ทีมซ้ำทุกครั้งที่มี Tournament ใหม่ เสี่ยงพิมพ์ไม่ตรงกันระหว่างรายการ
  - **(b) Master กลาง**: ลดงานพิมพ์ซ้ำ, ข้อมูลโรงเรียนสอดคล้องกันข้าม Tournament, แต่เพิ่มตาราง+ Admin UI ใหม่ และต้อง Design Schema เพิ่มก่อนรัน DDL รอบแรก (กระทบ Timeline Phase 1)
- **Phase ที่ถูก Block**: Phase 1 DDL
- **Owner ที่ควรตอบ**: เจ้าของระบบ
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-05. Player คนเดิมสามารถผูกข้ามรายการ/ข้ามรุ่นอายุได้หรือไม่?

- **เหตุผลที่ต้องตัดสินใจ**: Data Model ปัจจุบันออกแบบให้ `tournament_players` เป็น record อิสระต่อ `team_id` (นักกีฬาคนเดียวกันที่ลงสองรุ่นอายุ = สอง record ไม่เชื่อมกัน) — ถ้าต้องการติดตามประวัตินักกีฬาข้ามรายการ (เช่น ตรวจใบเหลืองสะสมข้ามรุ่นอายุ) ต้องเพิ่ม `person_id` กลางเชื่อม record เหล่านี้ ซึ่งต้องมีระบบยืนยันตัวตน (เลขบัตรประชาชน/รหัสนักเรียน) เพิ่มความซับซ้อนมาก
- **ตัวเลือก**:
  - (a) ไม่ผูก แต่ละรายการอิสระ (แผนปัจจุบัน, ง่ายกว่า)
  - (b) ผูกด้วย `person_id` กลาง (ซับซ้อนกว่า แต่ตรวจสอบใบโทษข้ามรายการได้)
- **Recommendation**: **(a)** — เพียงพอสำหรับ Scope ปัจจุบัน (ทัวร์นาเมนต์ระดับจังหวัด, รุ่นอายุแยกชัดเจน) ลดความซับซ้อนของ Schema/Identity Verification ในรอบแรก
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) ไม่ผูก**: Schema ง่าย, ไม่ต้องมีระบบยืนยันตัวตนกลาง, แต่ตรวจสอบใบเหลืองสะสมข้ามรุ่นอายุไม่ได้ (นักกีฬาแอบลงสองรุ่นแล้วสะสมใบแยกกันจะไม่ถูกจับ)
  - **(b) ผูก person_id**: ตรวจสอบวินัยข้ามรายการได้ครบ แต่ต้องเพิ่มขั้นตอนยืนยันตัวตน (เลขบัตร/รหัสนักเรียน) ตอนสมัคร เพิ่มงาน Implementation และ UX ที่ซับซ้อนขึ้นสำหรับผู้จัด
- **Phase ที่ถูก Block**: Phase 1 DDL
- **Owner ที่ควรตอบ**: เจ้าของระบบ
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-06. Discipline / Suspension Rules ของ Tournament เป็นแบบใด?

- **เหตุผลที่ต้องตัดสินใจ**: กำหนดค่า Default ใน Discipline Rules table และ Logic ใน `lib/tournament/discipline/*.ts` (Phase 8) — League ใช้สูตร 2/4/6/8 คะแนน + Ban ที่ 6/12/18/24 (`lib/suspension-shared.ts:80-108`) แต่ Tournament อาจใช้กติกาสมาคมกีฬาที่ต่างออกไป (จบใน Tournament เดียว, ล้างใบเมื่อผ่านรอบ ฯลฯ)
- **คำถามย่อยที่ต้องตอบร่วมกัน**:
  1. มีการล้างคะแนนใบเหลืองเมื่อผ่านรอบแบ่งกลุ่มเข้าน็อกเอาต์หรือไม่
  2. ใบเหลืองที่สะสมในรอบแบ่งกลุ่มพกไปรอบน็อกเอาต์หรือไม่
  3. Bye/Postponed/Cancelled นับเป็นนัดที่ต้องพักหรือไม่
- **ตัวเลือก**: ไม่มีตัวเลือกสำเร็จรูป — ต้องขอกติกาจริงจากเจ้าของระบบ/สมาคมกีฬา (คะแนนสะสม, เกณฑ์ Ban, การล้างใบ)
- **Recommendation**: **ไม่มี Default ที่ปลอดภัยพอจะเดาแทน** — เป็นกติกาที่กระทบผลการแข่งขันโดยตรง ทีม Audit แนะนำให้ใช้สูตร League (2/4/6/8, Ban ที่ 6/12/18/24) เป็น **จุดเริ่มการสนทนาเท่านั้น** ไม่ใช่คำตอบสำเร็จรูป เพราะ Tournament อาจอยู่ภายใต้กติกาสมาคมกีฬาแห่งประเทศไทยหรือกติกาเฉพาะที่ต่างจาก League
- **ผลกระทบของแต่ละตัวเลือก**: ขึ้นกับคำตอบจริงที่ได้รับ — ถ้าใช้สูตรเดียวกับ League จะลดงาน Design แต่เสี่ยงไม่ตรงกติกาสมาคม; ถ้ากำหนดสูตรใหม่ต้องมี Unit Test ชุดใหม่ทั้งหมดใน Phase 8 (ปัจจุบันไม่มีกติกานี้อยู่ในโค้ดเลยแม้แต่น้อยตาม Current State Audit R3)
- **Phase ที่ถูก Block**: Phase 1 DDL (โครงสร้าง `tournament_standing_rules`/discipline config), Phase 8 (Discipline Engine)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + กรรมการ/สมาคมกีฬาที่เกี่ยวข้อง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-07. Best Third-place Rules — เกณฑ์เปรียบเทียบทีมอันดับ 3 ที่ดีที่สุดข้ามกลุ่ม (รวมกรณีกลุ่มไม่เท่ากัน)

> **หมายเหตุการรวมคำถาม**: Decision นี้รวม Q7 (Open Questions เดิม), Q8 (กลุ่มไม่เท่ากัน — ผลกระทบต่อ Best-Third-place), และ Q23 (Scheduling Addendum — คำถามเดียวกับ Q7 แต่ผูกกับ `source_type='best_ranked'` ใน Data Model โดยตรง) เข้าด้วยกัน เพราะเป็นการตัดสินใจเดียวกันในทางปฏิบัติ

- **เหตุผลที่ต้องตัดสินใจ**: กำหนด Logic ของ `rankBestThirdPlacedTeams()` (Phase 6) และผูกกับ `source_type='best_ranked'`/`source_ref='third_place:1'` บน `tournament_matches` โดยตรง (Phase 7) — วิธีเปรียบเทียบทีมอันดับ 3 จากกลุ่มต่างกัน (ที่อาจแข่งจำนวนนัดไม่เท่ากันถ้ากลุ่มขนาดต่างกัน) มีหลายมาตรฐานสากล
- **ตัวเลือก**:
  - (a) เทียบตรงตามคะแนน/GD/GF (แบบง่าย, ไม่ปรับ)
  - (b) ปรับสัดส่วนตามจำนวนนัดที่แข่งจริงถ้ากลุ่มไม่เท่ากัน (แบบ FIFA-like)
- **คำถามย่อยที่ต้องตอบร่วมกัน (เดิม Q8)**: ทัวร์นาเมนต์นี้จะมีกลุ่มขนาดไม่เท่ากันจริงหรือไม่ (ถ้าไม่มีเลย ตัวเลือก (a)/(b) ให้ผลเหมือนกัน ไม่ต้องตัดสินใจเรื่องการปรับสัดส่วน)
- **Recommendation**: **(a)** เป็นจุดเริ่มต้นถ้ากลุ่มมีขนาดเท่ากันทุกกลุ่มในทางปฏิบัติ (ลด Algorithm Complexity) — แต่ถ้ามีแผนให้กลุ่มขนาดต่างกันจริง (ตอบคำถามย่อยว่า "ใช่") ต้องเปลี่ยนเป็น (b) เพื่อความยุติธรรม
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) เทียบตรง**: Algorithm ง่าย, Unit Test น้อยกว่า, แต่ไม่ยุติธรรมถ้ากลุ่มขนาดต่างกันจริง (ทีมจากกลุ่มเล็กได้เปรียบ/เสียเปรียบโดยไม่ตั้งใจ)
  - **(b) ปรับสัดส่วน**: ยุติธรรมกว่าตามมาตรฐานสากล (FIFA-like) แต่ Algorithm ซับซ้อนกว่า ต้องมี Unit Test ครอบคลุมกรณีกลุ่มขนาดต่างกันหลายแบบ
- **Phase ที่ถูก Block**: Phase 1 DDL (`tournament_qualification_rules.best_third_placed_count`), Phase 6 (Standings Engine), Phase 7 (Knockout Advancement — ⛔ ระบุชัดเจนใน Implementation Phases ว่า Block Phase 7 โดยตรง)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + กรรมการ/สมาคมกีฬาที่เกี่ยวข้อง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-09. Standings / Tiebreak Rules — กติกาการตัดผลกับทีมอันดับสุดท้ายเป็นแบบใด?

- **เหตุผลที่ต้องตัดสินใจ**: แผนต้นทาง (Preparation Plan Section 6) ระบุ requirement นี้ไว้กว้างๆ โดยไม่ระบุรายละเอียด — ต้องขอตัวอย่างกติกาจริงจากเจ้าของระบบเพื่อ implement ใน `lib/tournament/standings/resolveTiebreak.ts` (Phase 6) มิฉะนั้นต้อง guess และเสี่ยงผิด
- **ตัวเลือก**: ไม่มีตัวเลือกสำเร็จรูป — ต้องได้ตัวอย่างกติกาจริง (เช่น มีการ "ตัดผล" พิเศษกับทีมท้ายตารางหรือไม่ เพื่ออะไร — cut-off กี่ทีมตกรอบ, มีนัดพิเศษหรือไม่)
- **Recommendation**: ใช้ Default `tiebreak_order` ที่ออกแบบไว้ใน `tournament_standing_rules` (`points → head_to_head → goal_diff → goals_for → fair_play → lot`) เป็นจุดเริ่มต้น แต่ **กติกาเฉพาะเรื่อง "ตัดผลกับทีมอันดับสุดท้าย"** ต้องขอตัวอย่างจริงเพิ่มเพราะไม่ใช่ tiebreak มาตรฐานทั่วไป
- **ผลกระทบของแต่ละตัวเลือก**: ถ้าไม่ตอบก่อน Phase 6 ทีม Dev ต้อง Skip กติกาข้อนี้ไว้ก่อน (Known Gap) ซึ่งอาจกระทบความถูกต้องของผลการแข่งขันเมื่อเกิดกรณีคะแนนเท่ากันที่ท้ายตารางจริง
- **Phase ที่ถูก Block**: Phase 1 DDL (`tournament_standing_rules.tiebreak_order`), Phase 6 (Standings Engine)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + กรรมการ/สมาคมกีฬาที่เกี่ยวข้อง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-15. งบประมาณ/แผนสำหรับ Supabase Project ที่สอง (เงื่อนไข: ต้องตอบถ้า D-01 = Option A)

- **เหตุผลที่ต้องตัดสินใจ**: มีผลต่อ Billing จริง — แม้ Free/Small tier น่าจะเพียงพอสำหรับ scale ของ Youth League แต่ควรยืนยันกับเจ้าของระบบเรื่องงบประมาณก่อนสร้าง Project จริงใน Phase 1
- **ตัวเลือก**:
  - (a) ใช้ Free Tier ของ Supabase สำหรับ Tournament Project
  - (b) ใช้ Paid Tier (ระบุ Tier ที่ต้องการ)
- **Recommendation**: **(a) Free/Small Tier** น่าจะเพียงพอสำหรับ scale ของ Youth League (7 ประเภท, 4 สนาม) — ยืนยันเป็นทางการก่อนสร้าง Project จริง
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Free Tier**: ไม่มีต้นทุนเพิ่ม แต่มีข้อจำกัดเรื่อง Storage/Bandwidth/Backup retention ที่ต้องตรวจสอบว่าเพียงพอสำหรับ Scale จริงหรือไม่ก่อนตัดสินใจ
  - **(b) Paid Tier**: ได้ Backup/PITR ที่ยาวขึ้นและ Storage มากขึ้น แต่มีต้นทุนต่อเนื่องรายเดือน
- **หมายเหตุความไม่สอดคล้องในเอกสารต้นฉบับ**: `TOURNAMENT_V2_OPEN_QUESTIONS.md` จัดคำถามนี้ไว้ใต้หัวข้อ "Block Operational (ควรตอบก่อน Phase 13)" แต่เนื้อหาคำถามเองระบุชัดว่า **"ควรยืนยันกับเจ้าของระบบเรื่องงบประมาณก่อนเริ่ม Phase 1"** — เอกสารนี้ยึดตามเนื้อหาคำถาม (ก่อน Phase 1) เพราะ Phase 1 คือขั้นตอนที่สร้าง Supabase Project จริงตาม D-01
- **Phase ที่ถูก Block**: Phase 1 (การสร้าง Tournament Supabase Project จริง)
- **Owner ที่ควรตอบ**: เจ้าของระบบ
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

# 🟡 REQUIRED BEFORE FEATURE PHASE

## D-16. Default Result Approval Policy ที่จะใช้จริงคือแบบใด?

- **เหตุผลที่ต้องตัดสินใจ**: กำหนด Logic ของ `lib/tournament/services/resultWorkflow.ts` (Phase 5c) — `single_step` (venue_manager กรอกแล้วมีผลทันที), `two_step` (result_operator กรอก → venue_manager/match_official ยืนยัน), หรือ `central_review` (central_control ตรวจทุกนัดก่อน publish) — ยังกำหนดค่า Default ของคอลัมน์ `tournament_matches.result_policy` ที่ใช้ตอน Import Excel ด้วย (Phase 4b)
- **ตัวเลือก**:
  - (a) `two_step` ทุกนัด (ง่ายต่อการอธิบายให้เจ้าหน้าที่เข้าใจ)
  - (b) `single_step` รอบทั่วไป + `central_review` เฉพาะรอบชิงอันดับ/ชิงชนะเลิศ
  - (c) ให้ Admin ตั้งค่าต่อ Category ได้เอง
- **Recommendation**: **(a)** เป็น Default แต่รอบชิงอันดับ 3/รอบชิงชนะเลิศควรใช้ `two_step` หรือ `central_review` เข้มกว่ารอบทั่วไป — ต้องยืนยันว่าใช้ Policy เดียวกันทั้งทัวร์นาเมนต์หรือแยกตาม Stage
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) two_step ทุกนัด**: อธิบายให้เจ้าหน้าที่เข้าใจง่ายที่สุด (กติกาเดียวทั้งทัวร์นาเมนต์) แต่อาจช้ากว่าถ้าสนามมีเจ้าหน้าที่จำกัด (ต้องมี 2 คนต่อนัดเสมอ)
  - **(b) ผสมตาม Stage**: เร็วกว่าในรอบทั่วไป (`single_step`) และเข้มงวดขึ้นในรอบสำคัญ แต่เพิ่มความซับซ้อนของ UX/การอธิบายกติกาให้เจ้าหน้าที่หน้างาน
  - **(c) Admin ตั้งค่าเอง**: ยืดหยุ่นที่สุด แต่เพิ่มพื้นผิว Config ที่ต้องทดสอบ/อธิบาย และเสี่ยง Human Error ถ้า Admin ตั้งค่าไม่สอดคล้องกัน
- **Phase ที่ถูก Block**: Phase 4b (ค่า Default ของ `result_policy` ใน Excel Import), Phase 5c (Approval Workflow State Machine ทั้ง Phase)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ตัวแทนเจ้าหน้าที่สนามจริง
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

- **เหตุผลที่ต้องตัดสินใจ**: `tournament_match_attachments` เก็บแค่ URL — ต้องตัดสินใจ Storage Provider (Supabase Storage ของ Tournament Project เอง หรือ Object Storage ภายนอก) และ Quota ก่อน Phase 5c
- **ตัวเลือก**:
  - (a) Supabase Storage ของ Tournament Project เอง
  - (b) Object Storage ภายนอก (เช่น S3-compatible)
- **Recommendation**: **(a)** เป็นจุดเริ่มต้น (ลดจำนวน External Dependency) — ต้องกำหนด Quota (ขนาดไฟล์สูงสุด, จำนวนไฟล์ต่อ Match) ร่วมด้วย
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Supabase Storage**: ตั้งค่าง่าย ผูกกับ Project เดียวกัน แต่ต้นทุน Storage ผูกกับ Supabase Tier ที่เลือกใน D-15
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

- **เหตุผลที่ต้องตัดสินใจ**: เอกสารต้นทางระบุ "เข้าหน้าสนามผ่าน QR Code ได้เพื่อเป็น Shortcut แต่ยังต้องผ่าน Authentication ปกติ" — ต้องชัดเจนว่า QR Code นำไปสู่หน้า Login ที่ pre-fill venue/category หรือมีกลไก Provisioning บัญชีชั่วคราวแบบใด (มีผลต่อ UX วันแข่งจริงมาก เพราะอาสาสมัครมักไม่มีเวลาให้ IT Setup ล่วงหน้า)
- **ตัวเลือก**:
  - (a) QR เป็น Shortcut ไปหน้า Login ปกติ (pre-fill scope hint) — ต้องมีบัญชีสร้างไว้ล่วงหน้าอยู่ดี
  - (b) Provisioning บัญชีชั่วคราวอัตโนมัติสำหรับอาสาสมัคร (Future Enhancement ตามเอกสาร Venue Operations)
- **Recommendation**: **(a)** สำหรับ MVP (ตรงกับ Venue Operations หมวด 19 ที่ระบุ (b) เป็น Future Enhancement) — ต้องยืนยันว่า Process การสร้างบัญชีอาสาสมัครล่วงหน้า (ก่อนวันแข่ง) เป็นไปได้จริงในทางปฏิบัติหรือไม่
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Shortcut ไปหน้า Login**: Implementation ง่าย ปลอดภัย (QR ไม่ใช่ Bypass Token) แต่ต้องมีกระบวนการสร้างบัญชีให้อาสาสมัครทุกคนล่วงหน้าก่อนวันแข่ง ซึ่งอาจไม่ทันในทางปฏิบัติถ้าอาสาสมัครเปลี่ยนตัวกะทันหัน
  - **(b) Provisioning อัตโนมัติ**: สะดวกกว่ามากสำหรับอาสาสมัครหน้างาน แต่เพิ่มความเสี่ยงด้าน Security (ต้องออกแบบ Token ชั่วคราวที่ปลอดภัย) และเป็นงาน Implementation ที่ใหญ่กว่ามาก ไม่เหมาะกับ MVP
- **Phase ที่ถูก Block**: Phase 5b (Venue Matchday Dashboard — จุดที่อาสาสมัครใช้งานจริง)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ตัวแทนเจ้าหน้าที่สนามจริง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-24. Minimum Rest Time & Maximum Matches per Team per Day — ค่า Default คือเท่าไร?

- **เหตุผลที่ต้องตัดสินใจ**: เป็น Warning Rule ในการนำเข้า Excel ("ระยะพักต่ำกว่าเกณฑ์" — W3, "ทีมแข่งมากกว่า 1 Match ต่อวัน" — W4) — ค่า Threshold ต้องกำหนดก่อน implement `validateScheduleImportRow.ts` (Phase 4b) มิฉะนั้นทีม Audit ต้องเดาเอง ซึ่งเสี่ยงมากในบริบทกีฬาเยาวชน (ความปลอดภัยของนักกีฬา)
- **ตัวเลือก**: ไม่มีตัวเลือกสำเร็จรูป — ต้องให้เจ้าของระบบระบุตัวเลขจริง 2 ค่า:
  1. **Minimum Rest Time**: ระยะเวลาพักขั้นต่ำระหว่างสองนัดของทีมเดียวกัน (เช่น อย่างน้อย 60 นาที)
  2. **Maximum Matches per Team per Day**: จำนวนนัดสูงสุดที่ทีมหนึ่งแข่งได้ต่อวัน (เช่น ไม่เกิน 2 นัดต่อวัน)
- **Recommendation**: **ไม่มี Default ที่ปลอดภัยพอจะเดาแทนในบริบทกีฬาเยาวชน** — ต้องได้ตัวเลขจริงจากเจ้าของระบบ/มาตรฐานสมาคมกีฬาเท่านั้น (ทั้งสองค่านี้กระทบสุขภาพ/ความปลอดภัยของนักกีฬาโดยตรง ไม่ควรเดา)
- **ผลกระทบของแต่ละตัวเลือก**: ถ้าไม่ตอบก่อน Phase 4b ต้อง**เว้น Threshold ไว้เป็น Config ว่างที่ปิดใช้งาน Warning W3/W4 ชั่วคราว** (ตามที่ Implementation Phases ระบุไว้ชัดเจนว่าเป็นทางเลือกสำรองเท่านั้น) ซึ่งหมายความว่าระบบจะไม่เตือนผู้จัดโปรแกรมเลยแม้ตารางจะจัดให้ทีมพักน้อยเกินไปหรือแข่งถี่เกินไป
- **Phase ที่ถูก Block**: Phase 4b (⛔ ระบุชัดเจนใน Implementation Phases ว่า Blocked by Open Question นี้โดยตรง)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ผู้จัดโปรแกรมแข่งขันจริง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-25. Import Batch Rollback Permission — ใครมีสิทธิ์ Rollback Import Batch?

- **เหตุผลที่ต้องตัดสินใจ**: Rollback Batch ลบ/แก้ Match จำนวนมากพร้อมกัน — ถ้าเปิดให้ `result_operator` ทำได้ก็เสี่ยงเกินไป แต่ถ้าจำกัดแค่ `tournament_super_admin` อาจช้าเกินไปเวลาแก้ปัญหาหน้างาน
- **ตัวเลือก**:
  - (a) `tournament_super_admin` เท่านั้น
  - (b) `central_control` ทำได้ด้วย
  - (c) `venue_manager` ทำได้เฉพาะ Batch ที่กระทบสนามตนเอง
- **Recommendation**: **(a)** — ปลอดภัยสุด เพราะ Rollback กระทบข้อมูลจำนวนมากพร้อมกันและอาจกระทบหลายสนาม/Category พร้อมกัน
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Super Admin เท่านั้น**: ปลอดภัยที่สุด แต่ถ้า Super Admin ไม่อยู่หน้างานตอนเกิดปัญหา การแก้ไขอาจล่าช้า
  - **(b) รวม central_control**: เร็วขึ้นเพราะมีคนตัดสินใจได้มากกว่า 1 คน แต่เพิ่มจำนวนคนที่ทำ Bulk Destructive Action ได้
  - **(c) venue_manager เฉพาะสนามตน**: กระจายอำนาจตัดสินใจไปหน้างานเร็วที่สุด แต่เพิ่มความเสี่ยง Human Error ในระดับสนาม และ Rollback อาจกระทบ Match ข้าม Venue ได้ในบาง Batch (ต้องตรวจสอบเพิ่มว่า Batch หนึ่งกระทบ Venue เดียวเสมอหรือไม่)
- **Phase ที่ถูก Block**: Phase 4b (⛔ ระบุชัดเจนใน Implementation Phases — ต้องตอบก่อน Implement RBAC check บน Route `/schedule/import/batches/[id]/rollback`)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ผู้จัดโปรแกรมแข่งขันจริง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

## D-28. เมื่อ Import Fixture ที่เคย Publish แล้ว ต้อง Reset สถานะอัตโนมัติหรือต้องมีคนกดยืนยันก่อน?

- **เหตุผลที่ต้องตัดสินใจ**: ข้อกำหนด Warning "มีการเปลี่ยนโปรแกรมที่ Publish แล้ว" (W11) บอกแค่ว่าต้องเตือน แต่ไม่ได้ระบุว่าระบบต้อง Auto-downgrade สถานะ (`published` → `revision_required`) หรือรอ Manual Action — ผูกกับ D-16 (Approval Policy) ด้วยว่าใครมีสิทธิ์กดยืนยันการเปลี่ยนแปลงนี้
- **ตัวเลือก**:
  - (a) Auto-downgrade ทันทีที่ตรวจพบการเปลี่ยนแปลง
  - (b) ต้องมีคนกดยืนยันก่อนถึงจะ Downgrade สถานะ
- **Recommendation**: **(b)** — ป้องกันการเปลี่ยนสถานะ Public-facing Schedule โดยไม่มีใครรู้ตัว (สอดคล้องกับหลักการ Correction Workflow ที่ต้องมีผู้มีสิทธิ์ระดับ venue_manager ขึ้นไปยืนยันก่อนเสมอ)
- **ผลกระทบของแต่ละตัวเลือก**:
  - **(a) Auto-downgrade**: ปลอดภัยกว่าในแง่ไม่มี Stale Published Data แต่เสี่ยง Schedule หลุดจาก Public View โดยไม่มีใครตั้งใจ (เช่น แก้ผิดพลาดเล็กน้อยแล้ว Schedule ทั้ง Category หายจาก Public ทันที)
  - **(b) รอ Manual Confirm**: ควบคุมได้มากกว่า แต่เพิ่มขั้นตอน UX อีกหนึ่งจุดที่ผู้จัดโปรแกรมต้องกดยืนยัน
- **Phase ที่ถูก Block**: Phase 4b (Excel Import), Phase 4c (Draw Assignment Import)
- **Owner ที่ควรตอบ**: เจ้าของระบบ + ผู้จัดโปรแกรมแข่งขันจริง
- **Final Decision**: _(รอตัดสินใจ)_
- **Decision Date**: _(รอตัดสินใจ)_

---

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

## Appendix — การตรวจสอบความครบถ้วน (Traceability Check)

รายการต่อไปนี้ยืนยันว่า Decision ทั้งหมดในเอกสารนี้ครอบคลุมหัวข้อบังคับ 12 ข้อที่ต้องมีตามคำสั่งงาน:

| หัวข้อบังคับ | Decision ID ที่ครอบคลุม |
|---|---|
| Database Isolation | D-01 |
| Existing Tournament Data Strategy | D-02 |
| Authentication และ Admin Accounts | D-03 |
| Result Approval Policy | D-16 |
| Standings / Tiebreak Rules | D-09 (+ เชื่อมโยง D-07) |
| Best Third-place Rules | D-07 |
| Discipline / Suspension Rules | D-06 |
| Minimum Rest Time | D-24 |
| Maximum Matches per Team per Day | D-24 |
| Import Batch Rollback Permission | D-25 |
| Offline / Network Scope | D-17 |
| Venue และ Court Assignment | D-18 (+ เชื่อมโยง D-21) |

**Open Questions ต้นฉบับทั้งหมด (Q1-Q28) ที่ถูก map เข้าเอกสารนี้**:

| Q เดิม | Decision ID ในเอกสารนี้ |
|---|---|
| Q1 | D-01 |
| Q2 | D-02 |
| Q3 | D-03 |
| Q4 | D-04 |
| Q5 | D-05 |
| Q6 | D-06 |
| Q7 | D-07 |
| Q8 | D-07 (รวมเป็นคำถามย่อย) |
| Q9 | D-09 |
| Q10 | D-10 |
| Q11 | D-11 |
| Q12 | D-12 |
| Q13 | D-13 |
| Q14 | D-14 |
| Q15 | D-15 |
| Q16 | D-16 |
| Q17 | D-17 |
| Q18 | D-18 |
| Q19 | D-19 |
| Q20 | D-20 |
| Q21 | D-21 |
| Q22 | D-22 |
| Q23 | D-07 (รวมเป็นคำถามเดียวกัน) |
| Q24 | D-24 |
| Q25 | D-25 |
| Q26 | D-26 |
| Q27 | RESOLVED (ปิดแล้ว) |
| Q28 | D-28 |

---

## Rollback Plan สำหรับเอกสารชุดนี้

เอกสารนี้เป็น Markdown ล้วน ไม่มีการแก้ไข Production/Schema/Route/Migration/Source Code ใดๆ — Rollback คือไม่ commit หรือลบไฟล์นี้ทิ้ง ไม่มีผลกระทบต่อ League หรือ Tournament V1 ที่ทำงานอยู่จริง เช่นเดียวกับเอกสารชุดอื่นในรอบ Preparation นี้
