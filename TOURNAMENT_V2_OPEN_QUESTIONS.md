# Tournament V2 — Open Questions

> ⚠️ **เอกสารประวัติศาสตร์ (Historical)** — ณ 2026-07-14 คำถาม Q1-Q9, Q15, Q16, Q23, Q24, Q27 ได้รับคำตอบจากเจ้าของระบบแล้ว **`TOURNAMENT_V2_DECISION_CHECKLIST.md` คือ Source of Truth ปัจจุบัน** สำหรับสถานะ/คำตอบของทุกคำถาม (Decision ID ตรงกันเช่น Q1→D-01) — เอกสารนี้คงไว้เพื่อบันทึกเหตุผล/ตัวเลือกที่เคยพิจารณาเท่านั้น อย่าอ้างอิงเอกสารนี้เป็นคำตอบล่าสุดอีกต่อไป คำถามที่ตอบแล้วมีเครื่องหมาย **✅ ตอบแล้ว (ดู D-xx)** กำกับไว้ที่หัวข้อ

**วัตถุประสงค์**: รวบรวมคำถามที่ **เจ้าของระบบต้องตัดสินใจก่อน** เริ่ม Implementation จริง (Phase 1 เป็นต้นไป) เรียงตามความสำคัญ/ผลกระทบต่อ Architecture
**ปรับปรุงตาม v1.1**: เพิ่ม Q16-Q22 (Block งาน Phase 5 — Venue Operations)
**ปรับปรุงตาม Scheduling Addendum**: เพิ่ม Q23-Q28 (Block งาน Phase 4/7 — Scheduling/Draw/Placeholder), ปิด Q เดิมที่ตอบแล้ว 1 ข้อ (Auto Scheduler Scope — ดูหมายเหตุท้ายหมวดใหม่)

---

## Block งานทั้งหมด (ต้องตอบก่อน Phase 1)

### Q1. ต้องการ Supabase แยก Project หรือไม่? — ✅ ตอบแล้ว (ดู D-01: Option A)
- **ทำไมสำคัญ**: กำหนด Environment Variables, Auth Strategy, RLS Strategy ทั้งหมดใน `TOURNAMENT_V2_TARGET_ARCHITECTURE.md` หมวด 5 — เปลี่ยนใจภายหลัง Phase 1 จะเสียงานสร้างใหม่ทั้งหมด
- **Recommendation ของทีม Audit**: Option A (แยก Project) ด้วยเหตุผลเรื่อง Isolation ที่แท้จริงและเป็นงาน Greenfield — ดูเหตุผลเต็มใน Target Architecture หมวด 5
- **ตัวเลือก**: (a) Option A — แยก Project (b) Option B — Project เดียว แยก Schema/Table prefix

### Q2. ข้อมูล Tournament เดิมต้องย้ายทั้งหมดหรือเริ่มรายการใหม่? — ✅ ตอบแล้ว (ดู D-02: เริ่มใหม่ทั้งหมด)
- **ทำไมสำคัญ**: กำหนดว่าต้องทำ Phase 11 (Migration Dry Run) เต็มรูปแบบหรือข้ามไปเลย และกำหนดว่า Phase 13 (Cutover) มีความเสี่ยงด้าน Data Loss มากแค่ไหน (ดู `TOURNAMENT_V2_MIGRATION_MAP.md` หมวด 4 — มี Data Loss ที่หลีกเลี่ยงไม่ได้บางรายการ เช่น Penalty Score รายลูก)
- **ข้อเท็จจริงที่ควรทราบก่อนตัดสินใจ**: ตาม Current State Audit R1 — Tournament match บันทึกประตู/ใบเหลืองแดงไม่ได้ผ่าน UI ปัจจุบันเลย ดังนั้นข้อมูล Tournament ที่มีอยู่จริงอาจ**สมบูรณ์แค่ระดับ Fixture + Score** เท่านั้น ไม่มี Goals/Cards/Suspension ให้ย้ายมากนัก — อาจทำให้ตัวเลือก "เริ่มใหม่" มีต้นทุนต่ำกว่าที่คาดเพราะไม่ได้เสียข้อมูลมากเท่าที่กลัว
- **ตัวเลือก**: (a) Migrate ทั้งหมดตาม Migration Map (b) เริ่มรายการใหม่ทั้งหมด ไม่ Migrate อดีต (c) Migrate เฉพาะ Tournament ที่ยัง Active/จะใช้ในฤดูกาลหน้า

---

## Block Data Model (ต้องตอบก่อน Phase 1 DDL)

### Q3. Tournament และ League ใช้ Admin Account ชุดเดียวกันหรือไม่? — ✅ ตอบแล้ว (ดู D-03: Dedicated Shared Result-entry Account — ขอบเขตจำกัดเฉพาะ Result-entry)
- **ทำไมสำคัญ**: กำหนด Auth Strategy ใน Target Architecture หมวด 5 — ถ้าใช้ร่วมกัน ต้องออกแบบ Permission Mapping ข้าม Project (ถ้าเลือก Q1=Option A); ถ้าแยกกัน ต้องมีระบบ Login สองชุด
- **ตัวเลือก**: (a) Admin คนเดียวกันจัดการทั้งสองระบบ ใช้ Auth ร่วม (Recommended ใน Target Architecture) (b) แยก Admin Account คนละชุดสมบูรณ์ (c) มี Admin กลางที่เห็นทั้งคู่ + Admin เฉพาะทาง Module

### Q4. Team Master ต้องแชร์กันหรือ Import แยก? — ✅ ตอบแล้ว (ดู D-04: Import แยก ไม่มี School Master)
- **ทำไมสำคัญ**: กำหนดว่า `tournament_teams` ต้องมี FK ไปยัง master school/team registry ภายนอกหรือไม่ (ปัจจุบันออกแบบให้ไม่มี FK กลาง — แต่ละ Tournament import ทีมของตัวเอง) — ถ้าต้องการ Master กลาง ต้องเพิ่มตารางใหม่ (`school_master` หรือคล้ายกัน) ก่อน Phase 1
- **ตัวเลือก**: (a) Import แยกอิสระต่อ Tournament (แผนปัจจุบันใน Data Model) (b) มี School/Team Master กลางให้เลือกตอนสมัคร ลดการพิมพ์ชื่อซ้ำ

### Q5. Player คนเดิมสามารถผูกข้ามรายการ/ข้ามรุ่นอายุได้หรือไม่? — ✅ ตอบแล้ว (ดู D-05: ไม่ผูก ไม่มี person_id กลาง)
- **ทำไมสำคัญ**: Data Model ปัจจุบันออกแบบให้ `tournament_players` เป็น record อิสระต่อ `team_id` (นักกีฬาคนเดียวกันที่ลงสองรุ่นอายุ = สอง record ไม่เชื่อมกัน) — ถ้าต้องการติดตามประวัตินักกีฬาข้ามรายการ (เช่น ตรวจสอบใบเหลืองสะสมข้ามรุ่นอายุ หรือสถิติสะสมทั้งอาชีพ) ต้องเพิ่ม `person_id` กลางเชื่อม record เหล่านี้ — เพิ่มความซับซ้อนขึ้นมาก (ต้องมีระบบยืนยันตัวตน เช่น เลขบัตรประชาชน/รหัสนักเรียน)
- **ตัวเลือก**: (a) ไม่ผูก แต่ละรายการอิสระ (แผนปัจจุบัน, ง่ายกว่า) (b) ผูกด้วย `person_id` กลาง (ซับซ้อนกว่า แต่ตรวจสอบใบโทษข้ามรายการได้)

### Q6. กติกาใบโทษ (Discipline) ของ Tournament เป็นแบบใด? — ✅ ตอบแล้ว (ดู D-06: FIFA-derived, Card-count based — ยกเว้น Bye/Postponed/Cancelled sub-question ยังเปิดอยู่)
- **ทำไมสำคัญ**: กำหนดค่า Default ใน `tournament_standing_rules`/Discipline Rules table และ Logic ใน `lib/tournament/discipline/*.ts` (Phase 8) — League ใช้สูตร 2/4/6/8 คะแนน + Ban ที่ 6/12/18/24 (`lib/suspension-shared.ts:80-108`) แต่ Tournament อาจใช้กติกาสมาคมกีฬาที่ต่างออกไป (เช่น สะสมข้ามนัดไม่ได้เพราะจบใน Tournament เดียว, ล้างใบเมื่อผ่านรอบ)
- **คำถามย่อยที่ต้องตอบ**: (1) มีการล้างคะแนนใบเหลืองเมื่อผ่านรอบแบ่งกลุ่มเข้าน็อกเอาต์หรือไม่ (2) ใบเหลืองที่สะสมในรอบแบ่งกลุ่มพกไปรอบน็อกเอาต์หรือไม่ (3) Bye/Postponed/Cancelled นับเป็นนัดที่ต้องพักหรือไม่

### Q7. ต้องรองรับทีมอันดับ 3 ที่ดีที่สุดแบบใด? — ✅ ตอบแล้ว (ดู D-07/D-29: Points→GD→GF→Fair Play→Draw + G-U16 Category Override ใช้ Draw ตรง)
- **ทำไมสำคัญ**: กำหนด Logic ของ `rankBestThirdPlacedTeams()` (Phase 6) — วิธีเปรียบเทียบทีมอันดับ 3 จากกลุ่มต่างกัน (ที่อาจแข่งจำนวนนัดไม่เท่ากันถ้ากลุ่มขนาดต่างกัน) มีหลายมาตรฐานสากล (เช่น FIFA ใช้เกณฑ์พิเศษ หรือบางรายการเทียบตรงๆ ไม่ปรับ)
- **ตัวเลือก**: (a) เทียบตรงตามคะแนน/GD/GF (แบบง่าย) (b) ปรับสัดส่วนตามจำนวนนัดที่แข่งจริงถ้ากลุ่มไม่เท่ากัน (แบบ FIFA-like)

### Q8. ต้องรองรับกลุ่มไม่เท่ากันหรือไม่ (และถ้าใช่ ผลกระทบต่อ Best-Third-Place ตาม Q7 อย่างไร)? — ✅ หลักการตอบแล้ว (ดู D-07: Configurable per Category — สูตรปรับสัดส่วนทั่วไปยังเป็น Open Sub-question, G-U16 ใช้ Draw ตาม D-29)
- **ทำไมสำคัญ**: Data Model รองรับอยู่แล้วในระดับ Schema (ไม่มี fixed-size constraint) แต่ Standings/Qualification Engine (Phase 6) ต้องรู้กติกาการเปรียบเทียบที่ชัดเจนถ้ากลุ่มมีขนาดต่างกัน (เชื่อมโยงกับ Q7)

### Q9. กติกาการตัดผลกับทีมอันดับสุดท้ายเป็นแบบใด? — 🟡 ยังเปิดอยู่ (Tiebreak หลักตอบแล้ว ดู D-09 "Standings, Tiebreak and Penalty-decided Group Matches" — แต่กติกาตัดผลกับทีมอันดับสุดท้ายโดยเฉพาะยังเป็น Open Sub-question แยกต่างหาก ห้ามเดา)
- **ทำไมสำคัญ**: แผนต้นทาง (Section 6) ระบุ requirement นี้ไว้กว้างๆ โดยไม่ระบุรายละเอียด — ต้องขอตัวอย่างกติกาจริงจากเจ้าของระบบเพื่อ implement ใน `lib/tournament/standings/resolveTiebreak.ts` (Phase 6) มิฉะนั้นจะต้อง guess และเสี่ยงผิด

---

## Block Public-Facing (ต้องตอบก่อน Phase 9)

### Q10. Public URL ใหม่ต้องเป็นรูปแบบใด?
- **ทำไมสำคัญ**: Target Architecture เสนอ `/tournament/[tournamentSlug]/[categoryCode]/**` ใหม่ทั้งหมด (ไม่ reuse `/tournaments/[seasonSlug]/[ageGroupCode]/**` เดิม) — ถ้าเจ้าของระบบต้องการคง URL เดิมไว้เพื่อ SEO/ลิงก์ที่แชร์ไปแล้ว ต้องวางแผน Redirect เพิ่มใน Phase 13
- **ตัวเลือก**: (a) URL ใหม่ทั้งหมด + Redirect จาก URL เก่า (Recommended) (b) พยายามคง URL เดิมทุกจุด (เสี่ยง Route ชนกันระหว่าง Parallel Run ใน Phase 12)

### Q11. ต้องเก็บ Tournament เก่ากี่ปี (Data Retention)?
- **ทำไมสำคัญ**: กำหนด Archival Strategy ใน `TOURNAMENT_V2_DATA_MODEL.md` หมวด 5 (ปัจจุบันเสนอ Default 2 ปีก่อน Archive แต่ไม่ลบ) — ถ้าเจ้าของระบบมีข้อกำหนดจากสมาคมกีฬา/หน่วยงานต้นสังกัดเรื่องการเก็บสถิติ ต้องปรับตาม

### Q12. Discipline/Suspension ของ Tournament ต้องแสดงต่อสาธารณะระดับใด?
- **ทำไมสำคัญ**: `tournament_players.birth_date` และรายละเอียดใบโทษเป็นข้อมูลที่อาจอ่อนไหว (นักกีฬาเยาวชน) — Data Model เสนอให้ทำ View แยกจำกัด column สำหรับ Public API (หมวด 4 RLS Strategy) แต่ต้องยืนยันขอบเขตที่ชัดเจนจากเจ้าของระบบว่าเปิดเผยอะไรได้บ้าง

---

## Block Operational (ควรตอบก่อน Phase 13, ไม่ block Phase 1-12)

### Q13. ระยะเวลา Parallel Run (Phase 12) และเกณฑ์ตัดสินใจ Cutover คือเท่าไร?
- **ทำไมสำคัญ**: กำหนดกรอบเวลาทำงานจริงของทีม และเกณฑ์ที่ชัดเจนว่า "พร้อม Cutover" คืออะไร (เช่น ผ่าน 1 ฤดูกาลเต็มบน V2 แบบคู่ขนาน หรือผ่านจำนวนนัดที่กำหนด)

### Q14. ระยะเวลาที่ต้องเก็บ Tournament V1 แบบ Read-only ก่อน Decommission (Phase 14) คือเท่าไร?
- **ทำไมสำคัญ**: Phase 14 คือ Phase เดียวที่แตะ League Production Table โดยตรง (ถอดคอลัมน์ `stage`/`tournament_group_id`/`venue`/`winner_team_id` และ DROP ตาราง tournament-only ของ V1) — ยิ่งรอนานยิ่งปลอดภัย แต่ก็ทำให้ League schema มี "ของค้าง" นานขึ้น ต้องหาจุดสมดุลร่วมกับเจ้าของระบบ

### Q15. งบประมาณ/แผนสำหรับ Supabase Project ที่สอง (ถ้าเลือก Q1 = Option A)? — ✅ ตอบแล้ว (ดู D-15: Free Tier)
- **ทำไมสำคัญ**: มีผลต่อ Billing จริง — แม้ Free/Small tier น่าจะเพียงพอสำหรับ scale ของ Youth League แต่ควรยืนยันกับเจ้าของระบบเรื่องงบประมาณก่อนเริ่ม Phase 1

---

## Block Venue Operations (ต้องตอบก่อน Phase 5, เพิ่มจาก v1.1)

### Q16. Default Result Approval Policy ที่จะใช้จริงคือแบบใด? — ✅ ตอบแล้ว (ดู D-16: Single-step with Mandatory Preview)
- **ทำไมสำคัญ**: กำหนด Logic ของ `lib/tournament/services/resultWorkflow.ts` (Phase 5c) — `single_step` (venue_manager กรอกแล้วมีผลทันที), `two_step` (result_operator กรอก → venue_manager/match_official ยืนยัน), หรือ `central_review` (central_control ตรวจทุกนัดก่อน publish)
- **Recommendation ของทีม Audit**: `two_step` เป็น Default ตามคำแนะนำในเอกสารต้นทาง แต่รอบชิงอันดับ 3/รอบชิงชนะเลิศควรใช้ `two_step` หรือ `central_review` เข้มกว่ารอบทั่วไป — ควรยืนยันว่าใช้ Policy เดียวกันทั้งทัวร์นาเมนต์หรือแยกตาม Stage
- **ตัวเลือก**: (a) `two_step` ทุกนัด (Recommended, ง่ายต่อการอธิบายให้เจ้าหน้าที่เข้าใจ) (b) `single_step` รอบทั่วไป + `central_review` เฉพาะรอบชิงอันดับ/ชิงชนะเลิศ (c) ให้ Admin ตั้งค่าต่อ Category ได้เอง

### Q17. ต้องรองรับ PWA/Offline เต็มรูปแบบใน MVP หรือไม่?
- **ทำไมสำคัญ**: กระทบขอบเขต Phase 5b อย่างมาก (Retry Queue ธรรมดา vs Service Worker + Background Sync เต็มรูปแบบ) — ทีม Audit แนะนำให้เริ่มจาก Online-first + Retry Queue ก่อน (ดู Target Architecture หมวด 11.6) แต่ต้องยืนยันว่าสภาพสัญญาณจริงหน้าสนามเพียงพอหรือไม่
- **ตัวเลือก**: (a) Online-first + Retry Queue เท่านั้นใน MVP (Recommended) (b) ต้องมี Full Offline Draft ตั้งแต่ MVP เพราะสนามบางแห่งสัญญาณไม่เสถียรจริง

### Q18. ต้องแยกสิทธิ์/ติดตามระดับ Court หรือพอแค่ระดับ Venue?
- **ทำไมสำคัญ**: `tournament_courts` ถูกออกแบบไว้ใน Data Model แล้ว แต่ RBAC (`tournament_role_assignments`) ปัจจุบันออกแบบ Scope ไว้แค่ระดับ `venue_id` ไม่ลงถึง `court_id` — ถ้าสนามหนึ่งมีหลาย Court และต้องการแยกเจ้าหน้าที่รับผิดชอบคนละ Court ต้องเพิ่ม `court_id` เข้า Role Assignment ด้วย
- **ตัวเลือก**: (a) พอแค่ระดับ Venue (คนเดียวดูแลทุก Court ในสนามตัวเอง) (b) ต้องแยกสิทธิ์ระดับ Court ด้วย

### Q19. Realtime (Supabase Realtime) หรือ Polling สำหรับ Control Center และ Venue Dashboard?
- **ทำไมสำคัญ**: กระทบความซับซ้อนของ Phase 5b/5d และ Cost ของ Supabase Project — ทีม Audit แนะนำ Polling 15-30 วินาทีสำหรับ MVP เพราะง่ายกว่ามากและเพียงพอสำหรับ 4 สนาม
- **ตัวเลือก**: (a) Polling (Recommended สำหรับ MVP) (b) Supabase Realtime Subscription ตั้งแต่ต้น

### Q20. ไฟล์แนบ/ภาพถ่ายใน Full Match Report เก็บที่ไหน และมีข้อจำกัดขนาด/จำนวนเท่าไร?
- **ทำไมสำคัญ**: `tournament_match_attachments` เก็บแค่ URL — ต้องตัดสินใจ Storage Provider (Supabase Storage ของ Tournament Project เอง หรือ Object Storage ภายนอก) และ Quota ก่อน Phase 5c

### Q21. เมื่อ Category ถูกย้ายสนามกลางทัวร์นาเมนต์ (เช่น สนาม 1 ใช้งานไม่ได้กะทันหัน) ต้องมี Workflow ยืนยัน/แจ้งเตือนระดับใด?
- **ทำไมสำคัญ**: `tournament_category_venues` รองรับการย้ายได้ในระดับ Schema แต่ผลกระทบต่อนัดที่ตารางออกไปแล้ว (มี `venue_id` ผูกอยู่ใน `tournament_matches` แต่ละนัด ไม่ได้ผูกอัตโนมัติกับ Category) ต้องมี Business Process ชัดเจนว่าใครอนุมัติการย้าย และนัดที่ตารางไปแล้วต้องอัปเดตทีละนัดหรืออัปเดตยกชุด

### Q22. เจ้าหน้าที่ที่ไม่มีบัญชี Login ล่วงหน้า (อาสาสมัครวันแข่งขัน) จะเข้าระบบผ่าน QR Code ได้อย่างไรโดยยังผ่าน Authentication?
- **ทำไมสำคัญ**: เอกสารต้นทางระบุ "เข้าหน้าสนามผ่าน QR Code ได้เพื่อเป็น Shortcut แต่ยังต้องผ่าน Authentication ปกติ" — ต้องชัดเจนว่า QR Code นำไปสู่หน้า Login ที่ pre-fill venue/category หรือมีกลไก Provisioning บัญชีชั่วคราวแบบใด (มีผลต่อ UX วันแข่งจริงมาก เพราะอาสาสมัครมักไม่มีเวลาให้ IT Setup ล่วงหน้า)

---

## Block Scheduling / Draw / Placeholder (ต้องตอบก่อน Phase 4/7, เพิ่มจาก Scheduling Addendum)

### Q23. ทีมอันดับ 3 ที่ดีที่สุดข้ามกลุ่ม (`best_ranked`) ใช้เกณฑ์เปรียบเทียบแบบใด เมื่อกลุ่มมีขนาดไม่เท่ากัน? — ✅ ตอบแล้ว (คำถามเดียวกับ Q7 — ดู D-07/D-29)
- **ทำไมสำคัญ**: ตรงกับ Open Question Q7 เดิม แต่ตอนนี้ผูกกับ `source_type='best_ranked'`/`source_ref='third_place:1'` โดยตรงในตาราง `tournament_matches` — ต้องเลือกกติกาก่อน implement `rankBestThirdPlacedTeams()` (Phase 7)
- **ตัวเลือก**: (a) เทียบตรงตามคะแนน/GD/GF ไม่ปรับ (b) ปรับสัดส่วนตามจำนวนนัดที่แข่งจริง (แบบ FIFA-like)

### Q24. ระยะพักขั้นต่ำระหว่างนัด (Rest-time) และจำนวนนัดสูงสุดต่อทีมต่อวัน ค่า Default คือเท่าไร? — ✅ ตอบแล้ว (ดู D-24: `venue_max_matches_per_day=8`, Rest-time/Team-max ไม่ Validate ใน MVP)
- **ทำไมสำคัญ**: เป็น Warning Rule ใน Import Validation Matrix ("ระยะพักต่ำกว่าเกณฑ์", "ทีมแข่งมากกว่า 1 Match ต่อวัน") — ค่า Threshold ต้องกำหนดก่อน implement `validateScheduleImportRow.ts` (Phase 4b) มิฉะนั้นทีม Audit ต้องเดาเอง
- **ตัวเลือก**: ให้เจ้าของระบบระบุตัวเลขจริง (เช่น พักอย่างน้อย 60 นาที, ไม่เกิน 2 นัดต่อทีมต่อวัน) — ไม่มี Default ที่ปลอดภัยพอจะเดาแทนในบริบทกีฬาเยาวชน

### Q25. ใครมีสิทธิ์ Rollback Import Batch?
- **ทำไมสำคัญ**: Rollback Batch ลบ/แก้ Match จำนวนมากพร้อมกัน — ถ้าเปิดให้ `result_operator` ทำได้ก็เสี่ยงเกินไป แต่ถ้าจำกัดแค่ `tournament_super_admin` อาจช้าเกินไปเวลาแก้ปัญหาหน้างาน
- **ตัวเลือก**: (a) `tournament_super_admin` เท่านั้น (Recommended, ปลอดภัยสุด) (b) `central_control` ทำได้ด้วย (c) `venue_manager` ทำได้เฉพาะ Batch ที่กระทบสนามตนเอง

### Q26. เก็บ `tournament_schedule_versions` ย้อนหลังกี่เวอร์ชัน หรือไม่จำกัด?
- **ทำไมสำคัญ**: กระทบ Storage และ UX ของหน้าประวัติ — ตารางนี้เป็น Append-only เหมือน `tournament_draw_assignments` และ `tournament_result_versions` ถ้าไม่จำกัดเลยสำหรับ Tournament ขนาดใหญ่หลายปีอาจมีจำนวนมาก (แม้ไม่ใช่ปัญหาจริงในสเกลนี้)
- **Recommendation**: ไม่จำกัด (Storage Cost ต่ำมากสำหรับ Text/JSON ขนาดนี้) — ใส่เป็นคำถามเพื่อยืนยันเท่านั้น ไม่ block งาน

### Q27. Full Auto Scheduler — ยืนยันตารางเวลาสำหรับ Future Phase หรือไม่?
- **สถานะ**: **ตัดสินใจแล้ว** จากข้อกำหนด Scheduling Addendum — MVP รอบนี้ไม่ทำ Full Auto Scheduler (Drag-and-drop, Suggest Slot, Constraint Scheduler ทั้งหมดอยู่ใน Future Phase) ไม่ใช่ Open Question ที่ต้อง Block งานอีกต่อไป — คงไว้ในเอกสารนี้เพื่อบันทึกว่าเป็นการตัดสินใจที่ชัดเจนแล้ว ไม่ใช่ค่า Default ที่ทีม Audit เดาเอง

### Q28. เมื่อ Import Fixture ที่เคย Publish แล้ว (`tournament_schedule_versions.status='published'`) ต้อง Reset กลับเป็น `revision_required` อัตโนมัติหรือต้องมีคนกดยืนยันก่อน?
- **ทำไมสำคัญ**: ข้อกำหนด Warning "มีการเปลี่ยนโปรแกรมที่ Publish แล้ว" บอกแค่ว่าต้องเตือน แต่ไม่ได้ระบุว่าระบบต้อง Auto-downgrade สถานะหรือรอ Manual Action — ผูกกับ Q16 (Approval Policy) ด้วยว่าใครมีสิทธิ์กดยืนยันการเปลี่ยนแปลงนี้

---

## สรุปคำถามที่ Block งานมากที่สุด (Top 5) — ⚠️ Historical, ดูสถานะล่าสุดที่ Decision Checklist

> **อัปเดต 2026-07-14**: ทั้ง 5 ข้อด้านล่างตอบครบแล้ว (ยกเว้นส่วนย่อยของ Q9) — คงข้อความเดิมไว้เพื่อบันทึกว่าเคย Block งานอะไรบ้าง

1. ~~**Q1** — Supabase แยก Project หรือไม่~~ **✅ ตอบแล้ว (D-01)** (กระทบทุก Phase ตั้งแต่ Phase 1)
2. ~~**Q2** — Migrate ข้อมูลเดิมหรือเริ่มใหม่~~ **✅ ตอบแล้ว (D-02: เริ่มใหม่ทั้งหมด)** (กระทบ Phase 11-13 และ Risk Assessment ทั้งหมด)
3. **Q6/Q7/Q9** (กลุ่มกติกา Standings/Tiebreak/Discipline) — **✅ ตอบแล้วเป็นส่วนใหญ่ (D-06, D-07/D-29, D-09)** ยกเว้น Sub-question 2 จุด (Bye/Postponed/Cancelled ใน D-06, Last-place cutoff ใน D-09) ที่ยังเปิดอยู่ — กระทบ Phase 6 และ 8 โดยตรง เพราะปัจจุบันไม่มีกติกาเหล่านี้อยู่ในโค้ดเลยแม้แต่น้อย (ตาม Current State Audit R3)
4. ~~**Q16** — Default Approval Policy~~ **✅ ตอบแล้ว (D-16: Single-step + Mandatory Preview)** (กระทบ Phase 5c ทั้ง Phase โดยตรง เพราะเป็นแกนของ State Machine)
5. ~~**Q24** — ค่า Default ระยะพัก/จำนวนนัดสูงสุดต่อวัน~~ **✅ ตอบแล้ว (D-24: venue_max=8, Rest-time/Team-max ไม่ Validate ใน MVP)** (กระทบ Phase 4b)

**ข้อเสนอเดิม (Historical)**: จัดประชุม 1 รอบกับเจ้าของระบบเพื่อตอบ Q1, Q2, Q3 ก่อน (ตัดสิน Architecture-level) แล้วจึงตามด้วยรอบสองสำหรับ Q6-Q9 (Business Rule), รอบสามสำหรับ Q16-Q22 (Venue Operations — ควรมีตัวแทนเจ้าหน้าที่สนามจริงร่วมด้วย), และรอบสี่สำหรับ Q23-Q28 (Scheduling/Draw — ควรมีผู้จัดโปรแกรมแข่งขันจริงร่วมด้วยเพราะเป็นคำถามเชิงปฏิบัติการจัดตาราง) — **สถานะจริง ณ 2026-07-14**: รอบที่ 1 และ 2 เสร็จสมบูรณ์, รอบที่ 3 เสร็จเฉพาะ Q16 (Q17-Q22 ยังเปิด), รอบที่ 4 เสร็จเฉพาะ Q23/Q24 (Q25/Q26/Q28 ยังเปิด) — เหลือ Q4/Q5 ที่แม้จะยังไม่ถูกกล่าวถึงใน Top 5 เดิมแต่ก็ **✅ ตอบแล้วเช่นกัน (D-04, D-05)**
