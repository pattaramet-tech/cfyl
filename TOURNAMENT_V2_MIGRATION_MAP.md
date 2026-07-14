# Tournament V2 — Migration Map

**สถานะ**: แผนที่การย้ายข้อมูล (Mapping) เท่านั้น — **ห้ามรัน Migration จริงในรอบ Preparation นี้**
**ปรับปรุงตาม v1.1**: เพิ่มหมวด 6 (Venue/RBAC/Result-Workflow Seed Data) — entity กลุ่มนี้ไม่มี Old Source ใน V1 เลย (ดู Gap Analysis ใน `TOURNAMENT_V2_CURRENT_STATE_AUDIT.md` หมวด 13) จึงเป็นการสร้างใหม่ทั้งหมด ไม่ใช่การ Migrate
**ปรับปรุงตาม Scheduling Addendum**: แก้ไขแถว `bracket_matches` ในหมวด 1 (target เปลี่ยนจาก `tournament_bracket_matches` เป็น `tournament_matches` + `tournament_knockout_rounds` โดยตรง ตาม Data Model Correction) และเพิ่มหมวด 7 (Group Slot/Draw — ไม่มี Old Source เช่นกัน)
**Precondition**: ~~ต้องตอบ Open Question "ข้อมูล Tournament เดิมต้องย้ายทั้งหมดหรือเริ่มรายการใหม่" ก่อน~~ **ตอบแล้ว — ดู Banner ด้านล่าง**

---

## ⚠️ NOT APPLICABLE — DECISION LOCKED (D-02, 2026-07-14)

**เจ้าของระบบตัดสินใจแล้วว่า Tournament V2 เริ่มข้อมูลใหม่ทั้งหมด ไม่ Migrate ข้อมูล Tournament V1** — หมวด 1-5 ของเอกสารนี้ (Entity Mapping Table, ID Mapping, กรณีพิเศษ, Data Loss Register, Verification Checklist) **กลายเป็น Non-applicable สำหรับ Execution Plan ปัจจุบัน** เก็บเอกสารทั้งฉบับไว้เป็น **Historical Reference เท่านั้น** (ไม่ใช่ Execution Plan) เผื่อกรณีเจ้าของระบบเปลี่ยนใจในอนาคตหรือมีความจำเป็นต้อง Reverse-engineer ข้อมูลบางส่วนจาก V1

**สิ่งที่ยังใช้ได้จริง**:
- หมวด 6 (Venue/RBAC/Result-Workflow Seed Data) และหมวด 7 (Group Slot/Draw Seed Data) — ยังใช้ได้ตามเดิม เพราะเป็น **Fresh Insert ล้วนๆ ไม่ใช่ Migration** จาก League DB
- Tournament V1 (โค้ด/ข้อมูลเดิม) **เก็บไว้เป็น Reference เท่านั้น** (Read-only) — **ห้ามลบในรอบ Implementation แรก** การ Decommission ยังคงต้องรอ Phase 14 และขออนุมัติแยกต่างหากตามเดิม
- Phase 11 (`TOURNAMENT_V2_IMPLEMENTATION_PHASES.md`) เปลี่ยนชื่อ/ขอบเขตเป็น **"Fresh-data Verification / Import Rehearsal"** — ซ้อมนำเข้าข้อมูลใหม่ (ทีม/นักกีฬา/ตารางแข่ง) เข้า Tournament V2 ให้ถูกต้องก่อน Go-live แทนการย้ายข้อมูลจริงจาก League DB

ดูรายละเอียดคำตัดสินเต็มที่ `TOURNAMENT_V2_DECISION_CHECKLIST.md` (D-02)

---

**Source (V1)**: League Supabase Project ปัจจุบัน — เฉพาะ record ที่มี `seasons.competition_type IN ('tournament','mixed')` และ match ที่มี `stage IS NOT NULL` หรือ `tournament_group_id IS NOT NULL`
**Target (V2)**: Tournament Supabase Project ใหม่ (ตาม `TOURNAMENT_V2_DATA_MODEL.md`)

> **หมายเหตุ**: หมวด 1-5 ด้านล่างนี้เป็น **Historical Reference** — อ่านโดยเข้าใจว่าไม่ใช่แผนที่จะดำเนินการจริงในรอบ Implementation ปัจจุบัน (ดู Banner ด้านบน)

---

## 1. Entity Mapping Table

| Old Source | New Target | Transform | Risk | Verification |
|---|---|---|---|---|
| `seasons` (WHERE `competition_type IN ('tournament','mixed')`) | `tournaments` | 1 season → 1 tournament; `name`→`name`, `season_slug`→`slug`, `status`→`status` (map `upcoming/active/completed`→เหมือนเดิม, ไม่มี `archived` ใน V1 ต้อง derive จาก `end_date` เก่ากว่า cutoff) | **Season แบบ `mixed`** มีทั้ง League และ Tournament data ปนกัน — ต้องแยก record ระดับ `age_group`/`match` ไม่ใช่ระดับ season ทั้งก้อน (ดูหมวด 3) | นับจำนวน `seasons` ต้นทางเทียบ `tournaments` ปลายทาง ต้องเท่ากับจำนวน distinct season ที่มี tournament data จริง |
| `age_groups` (เฉพาะที่ผูกกับ tournament season, หรือเฉพาะทีมที่ `division_id IS NULL`) | `tournament_categories` | `code`→`code`, `name`→`name`; `gender` **ไม่มีใน V1** ต้อง backfill manual (ดู Open Questions) | V1 ไม่มีแนวคิด gender แยก — ทุก category ต้อง map เป็น `gender='mixed'` เป็น default แล้วให้แอดมินแก้ทีหลัง | นับจำนวน distinct `age_group_id` ที่มี tournament team/match อ้างอิงจริง เทียบจำนวน `tournament_categories` |
| `teams` (WHERE `division_id IS NULL` AND season เป็น tournament/mixed) | `tournament_teams` | `name`→`name`, `short_name`→`short_name`+derive `team_code`, `logo_url`→`logo_url` | V1 ไม่มี `team_code` แยก (ใช้ `short_name` ปนกับการอ้างอิงใน fixture import ที่ `lib/tournament-fixtures.ts:137-140`) — ต้อง derive `team_code` จาก `short_name` และตรวจ collision ภายใน category ก่อน insert | Unique constraint violation ระหว่าง insert = สัญญาณว่ามี `short_name` ซ้ำในกลุ่มเดียวกันต้อง resolve ด้วยมือ |
| `players` (WHERE `division_id IS NULL`, join ผ่าน `team_id` ที่ map แล้ว) | `tournament_players` | `player_code`→`player_code`, `full_name`, `birth_date`, `shirt_no` ตรงตัว | `unique(season_id, player_code)` เดิมเป็น scope ทั้ง season (รวม League) — ต้อง remap `player_code` ใหม่เป็น scope เฉพาะ tournament ถ้าเคยชนกับ player_code ฝั่ง league ใน season แบบ `mixed` | Foreign key integrity: ทุก `team_id` บน player ต้อง resolve เป็น `tournament_teams.id` ใหม่ได้ 100% ก่อน insert |
| `tournament_groups` (V1) | `tournament_groups` (V2, schema ใหม่) | `name`→`name`, `code`→`code`, `sort_order`→`sort_order`; เพิ่ม FK ไป `tournament_categories` ใหม่แทน `age_group_id` เดิม | ต่ำ — โครงสร้างใกล้เคียงกันมาก | นับจำนวน group ต่อ category เทียบกับต้นทาง |
| `tournament_group_teams` (V1) | `tournament_group_members` (V2) | `group_id`/`team_id` → remap ผ่าน ID Mapping table (หมวด 2) | ต่ำ | นับจำนวน membership row เทียบเท่ากัน |
| `matches` (WHERE `stage IS NOT NULL` OR `tournament_group_id IS NOT NULL`, join ผ่าน team ที่ map แล้ว) | `tournament_matches` | `match_code`→`match_code`, `stage`→`stage` (ตรง enum ยกเว้นต้องเพิ่ม `custom` ถ้าพบค่าที่ไม่ตรง 6 ค่าเดิม), `venue`(text)→ resolve เป็น `venue_id` ใหม่ผ่าน `tournament_venues` (สร้างจาก distinct venue text ก่อน), `winner_team_id`→`winner_team_id`, **ไม่มี penalty score แยกใน V1** ต้อง derive: ถ้า `home_score == away_score` และมี `winner_team_id` ให้ตั้ง `result_type='penalty_decided'` แต่ **ไม่มีข้อมูลจุดโทษจริง** (`home_penalty_score`/`away_penalty_score` จะเป็น `NULL` หลัง migrate — ข้อมูลสูญหายบางส่วน, ดูหมวด 4) | **สูง** — ตารางนี้ผูกกับ League มากที่สุด ต้อง query ให้แม่นยำว่า match ไหนเป็น tournament จริง (`stage IS NOT NULL OR tournament_group_id IS NOT NULL`, ไม่ใช่แค่ดู `season.competition_type` เพราะ season แบบ `mixed` มี match ทั้งสองแบบปนกัน) | Row count reconciliation ต่อ category + สุ่มตรวจ 10% ของ match ว่า score/status ตรงกับต้นฉบับ |
| `goals` (join ผ่าน `match_id` ที่เป็น tournament match) | `tournament_match_goals` | ตรงตัวเกือบทั้งหมด (`minute`, `is_own_goal`, `goals`) | ต่ำ-กลาง — ต้องพึ่งความถูกต้องของการแยก tournament match ก่อน (สืบเนื่องจากความเสี่ยงของ `matches`) | Sum(`goals`) ต่อ match ต้องตรงกับ `home_score`+`away_score` เดิม |
| `cards` (join ผ่าน `match_id`) | `tournament_match_cards` | `card_type`→`card_type` ('Yellow'→'yellow', 'Red'→'red', ค่า 'second_yellow' ถ้ามี) | ต่ำ-กลาง | นับจำนวน card ต่อประเภทต่อทีมเทียบต้นฉบับ |
| `suspensions` (ผูกกับ tournament player/team) | `tournament_suspension_events` + `tournament_suspension_serving_matches` | **ต้อง Rebuild ไม่ใช่ Copy ตรง** — เนื่องจาก R1 ใน Current State Audit (tournament match ไม่เคยบันทึก card ได้จริงผ่าน UI) แทบไม่มี legacy tournament suspension ให้ย้าย ในทางปฏิบัติ suspension table เดิมของ tournament records (ถ้ามี) น่าจะเป็น 0 หรือใกล้ 0 | ต่ำ (เพราะข้อมูลต้นทางแทบไม่มี) แต่ต้อง **ยืนยันด้วยการ query จริงก่อน migrate** ไม่ใช่สมมติเฉยๆ | `SELECT count(*) FROM suspensions s JOIN players p ON p.id=s.player_id WHERE p.division_id IS NULL` ก่อน migrate จริง |
| `knockout_rounds` (V1) | `tournament_knockout_rounds` (V2) | ตรงตัว, remap `age_group_id`→`category_id` | ต่ำ | นับจำนวน round เทียบต้นทาง |
| `bracket_matches` (V1) | `tournament_matches` (V2, `stage != 'group'`) + `tournament_knockout_rounds` | **เปลี่ยนจากแผนเดิม** (เดิม map ไป `tournament_bracket_matches` แยกตาราง — ตารางนั้นถูกยุบรวมแล้ว ดู Data Model หมวด 2.15) ตอนนี้ map ตรงเข้า `tournament_matches`: `bracket_position`→`match_no`, `home_source_type/ref`+`away_source_type/ref`→คอลัมน์ชื่อเดียวกันบน `tournament_matches` (ต้อง remap ค่า `'direct_team'`→`'team'` ตามชื่อใหม่), `winner_to_bracket_match_id`/`loser_to_bracket_match_id` **ไม่ต้อง map** เพราะเปลี่ยนทิศทางการอ้างอิงแล้ว (นัดปลายทางอ้างกลับมาเองผ่าน `match_code`, ดูหมวด 3.2) | กลาง — ต้องคำนวณย้อนกลับทิศทางการอ้างอิง (เดิม "ต้นทางชี้ปลายทาง" ตอนนี้ "ปลายทางอ้างต้นทาง" — ดูหมวด 3.6) เป็นจุดที่ Migration Script อาจพลาดง่ายที่สุดในเอกสารนี้ | ตรวจว่าทุกนัดที่เคยมี `winner_to_bracket_match_id` ไม่เป็น null ใน V1 ตอนนี้มีนัดปลายทางที่ `home_source_ref`/`away_source_ref` เท่ากับ `match_code` ของนัดต้นทางจริง (นับจำนวนคู่ต้อง match กัน 1:1) |
| `admin_audit_logs` (WHERE `entity_type` เกี่ยวกับ tournament) | `tournament_audit_logs` | คัดลอกเฉพาะ record ที่ entity_type ขึ้นต้นด้วย tournament-related string | ต่ำ, optional (Audit log ประวัติศาสตร์ ไม่จำเป็นต้องย้ายถ้าไม่ต้องการ) | เทียบจำนวน record ที่คัดลอกกับ query filter ต้นทาง |

---

## 2. ID Mapping

```text
old_season_id            -> tournament_id            (เฉพาะ season ที่ competition_type IN ('tournament','mixed'))
old_age_group_id         -> category_id
old_team_id               -> tournament_team_id        (เฉพาะ team ที่ division_id IS NULL)
old_player_id              -> tournament_player_id      (เฉพาะ player ที่ division_id IS NULL)
old_tournament_group_id   -> tournament_group_id_v2     (schema ใหม่ ชื่อ column ต่างกันแต่ concept เดียวกัน)
old_group_team_row_id     -> tournament_group_member_id
old_match_id               -> tournament_match_id        (เฉพาะ match ที่ stage IS NOT NULL OR tournament_group_id IS NOT NULL)
old_goal_id                 -> tournament_match_goal_id
old_card_id                 -> tournament_match_card_id
old_suspension_id           -> tournament_suspension_event_id
old_knockout_round_id      -> tournament_knockout_round_id
old_bracket_match_id        -> tournament_bracket_match_id
```

**การเก็บ ID Mapping ระหว่าง migrate**: แนะนำสร้างตาราง staging ชั่วคราว `_migration_id_map(old_id uuid, new_id uuid, entity_type text)` ใน Tournament Project (ไม่ใช่ League Project) เก็บไว้จนกว่าจะผ่านช่วง Parallel Run/Verification เสร็จสิ้น จึงลบทิ้งได้ (ดู Phase 11-12 ใน `TOURNAMENT_V2_IMPLEMENTATION_PHASES.md`)

---

## 3. กรณีพิเศษที่ต้องจัดการ (Special Cases)

### 3.1 Season แบบ `mixed`
Season ที่ `competition_type = 'mixed'` มีทั้ง League matches (`division_id IS NOT NULL`, `stage IS NULL`) และ Tournament matches (`division_id IS NULL`, `stage IS NOT NULL`) **ในตารางเดียวกัน** — Migration script ต้อง query ระดับ `match`/`team`/`player` ไม่ใช่ระดับ `season` เพื่อแยกสองส่วนออกจากกัน มิฉะนั้นจะดึง League data ปนเข้ามาโดยไม่ตั้งใจ (สร้าง `tournaments` record ที่มีทั้งทีม League และ Tournament ปนกัน)

**Query ตรวจสอบก่อน migrate**:
```sql
select s.id, s.name, s.competition_type,
  count(*) filter (where t.division_id is null) as tournament_teams,
  count(*) filter (where t.division_id is not null) as league_teams
from seasons s join teams t on t.season_id = s.id
where s.competition_type = 'mixed'
group by s.id, s.name, s.competition_type;
```

### 3.2 Match ที่ไม่มี Penalty Score แยก (V1 ไม่มี field นี้)
ตามที่ระบุใน [หมวด 1](#1-entity-mapping-table) — match ที่ตัดสินด้วยจุดโทษใน V1 มีแค่ `winner_team_id` ไม่มีสกอร์จุดโทษจริง Migration จะ set `result_type='penalty_decided'` แต่ `home_penalty_score`/`away_penalty_score` เป็น `NULL` — **ข้อมูลนี้ไม่สามารถกู้คืนย้อนหลังได้** ต้องแจ้งเจ้าของระบบว่าเป็น known data loss ที่ยอมรับได้หรือไม่ (Open Question)

### 3.3 Suspension ของ Tournament แทบไม่มีข้อมูลจริง
ตาม R1 ใน Current State Audit — Tournament match บันทึก card ไม่ได้ผ่าน UI จึงมีความเป็นไปได้สูงที่จะไม่มี `suspensions` record ของ Tournament เลยในข้อมูลจริง (ต้องตรวจสอบด้วย query ก่อนเริ่ม ไม่ใช่สันนิษฐาน) — ถ้ามี record หลงเหลือ (เช่น จากการแก้ผ่าน API ตรงหรือ SQL Editor) ต้องตรวจสอบเป็นรายตัว ไม่ migrate อัตโนมัติ

### 3.4 `team_code` ไม่มีใน V1
V1 ไม่มีคอลัมน์ `team_code` แยก — ใช้ `short_name` ปนกันทั้งเป็น "รหัสทีมสำหรับ import" (`lib/tournament-fixtures.ts:137-140` ใช้ `short_name` เป็น code) และเป็น "ชื่อย่อแสดงผล" พร้อมกัน Migration ต้อง derive `team_code` จาก `short_name` และตรวจ collision ภายใน `category_id` เดียวกันก่อน insert (ตาม unique constraint ใหม่) ถ้าชนกันต้องแก้ไขด้วยมือก่อน migrate จริง

### 3.5 Gender ไม่มีใน V1
`tournament_categories.gender` เป็น field ใหม่ทั้งหมด ไม่มีข้อมูลต้นทางให้ map — ต้อง default เป็น `'mixed'` ทุก record แล้วให้แอดมิน confirm/แก้ไขทีละ category หลัง migrate (ไม่ block migration แต่ต้องมี checklist แยกหลัง cutover)

### 3.6 ทิศทางการอ้างอิง Bracket กลับด้าน (ใหม่ Scheduling Addendum)

V1 (`bracket_matches.winner_to_bracket_match_id`) เก็บการอ้างอิงแบบ **"นัดต้นทางรู้ว่าผู้ชนะจะไปนัดไหนต่อ"** (Forward Reference) ส่วน V2 (`tournament_matches.home_source_type='match_winner'`, `home_source_ref=<match_code ต้นทาง>`) เก็บแบบ **"นัดปลายทางรู้ว่าทีมมาจากนัดไหน"** (Backward Reference) — ทิศทางตรงข้ามกันโดยสิ้นเชิง

Migration Script ต้อง:
1. อ่าน `bracket_matches` ทุกแถวที่มี `winner_to_bracket_match_id` ไม่เป็น null
2. หา `bracket_matches` ปลายทาง (แถวที่ `id = winner_to_bracket_match_id`) แล้วดูว่า `winner_to_slot` เป็น `home` หรือ `away`
3. Set `tournament_matches.home_source_type`/`away_source_type` (ตามสล็อต) ของ**นัดปลายทางที่ migrate แล้ว** ให้เป็น `'match_winner'` และ `home_source_ref`/`away_source_ref` เป็น `match_code` ของ**นัดต้นทางที่ migrate แล้ว**
4. ทำซ้ำแบบเดียวกันกับ `loser_to_bracket_match_id`/`loser_to_slot` → `source_type='match_loser'`

**ความเสี่ยง**: ถ้า Migration Script ทำสลับทิศทาง (เผลอเขียนแบบ Forward แทน Backward) ข้อมูลจะดู "ถูกต้อง" ผิวเผินแต่ Resolution Engine หา Match ไม่เจอเมื่อ Publish ผลจริง — ต้องมี Verification Test เฉพาะจุดนี้ (ดู Verification Checklist หมวด 5)

---

## 4. Data Loss / Known Limitations Register

| รายการ | ผลกระทบ | ต้องยอมรับหรือหาทางแก้ก่อน Cutover |
|---|---|---|
| Penalty score รายลูก (จุดโทษ) | สูญหาย เหลือแค่ผู้ชนะ | Open Question — ถ้าจำเป็นต้องมี ต้องขอข้อมูลจาก Admin เดิม/เอกสารกระดาษก่อน migrate |
| Gender ของแต่ละ Category | ต้อง backfill ด้วยมือหลัง migrate | ไม่ block migration แต่ต้องทำก่อนเปิด public ที่แสดงผล gender |
| Team Code | Derive อัตโนมัติจาก `short_name`, อาจชนกัน | ต้องรัน Dry Run ตรวจ collision ก่อน (Phase 11) |
| Suspension History ของ Tournament | น่าจะไม่มีข้อมูลให้ย้าย (ตาม R1) | ต้องยืนยันด้วย query จริงก่อนสรุป ไม่ใช่ assumption |
| Audit Log ประวัติศาสตร์ | Optional, ไม่กระทบ Correctness ของระบบใหม่ | ตัดสินใจได้อิสระ ไม่ block |

---

## 5. Verification Checklist (ก่อนเข้าสู่ Phase Cutover)

- [ ] Record Count ตรงกันทุกตาราง (Old filtered count == New count) สำหรับทุก entity ใน [หมวด 1](#1-entity-mapping-table)
- [ ] Foreign Key Integrity: ไม่มี dangling reference ใน `tournament_matches` (โดยเฉพาะ `round_id` → `tournament_knockout_rounds` และ self-referencing ผ่าน `home_source_ref`/`away_source_ref` ที่ต้องชี้ไปยัง `match_code` ที่มีอยู่จริงเสมอ — ไม่มีตาราง `tournament_bracket_matches` แยกแล้ว ดูหมวด 2.15 ของ Data Model)
- [ ] ID Mapping Completeness: ทุก `old_id` ใน scope มี `new_id` ตรงกันในตาราง `_migration_id_map` ไม่มีตัวไหนขาด
- [ ] Score Reconciliation: `home_score`/`away_score` ของทุก match ตรงกับต้นฉบับ 100%
- [ ] Standing Reconciliation: รัน `calculateGroupStandings()` ใหม่บนข้อมูล migrate แล้ว เทียบกับผลจาก `computeGroupStandings()` เดิม (คะแนน/GD/GF ต้องตรงกัน — ยกเว้น tiebreak ใหม่ที่อาจจัดอันดับต่างถ้ามี head-to-head เพิ่มมา ต้องระบุความต่างและอธิบายได้ทุกจุด)
- [ ] Bracket Reconciliation: จำนวน bracket match, winner/loser routing ตรงกับ V1 ทุกคู่
- [ ] Card/Suspension Reconciliation: (ตามหมวด 3.3 คาดว่าใกล้ 0 record — ต้องยืนยันด้วยตัวเลขจริง)
- [ ] Idempotency: รัน Migration Script ซ้ำสองครั้งบนข้อมูล staging เดียวกัน ต้องได้ผลลัพธ์เหมือนเดิมไม่ duplicate
- [ ] **(Scheduling Addendum) Bracket Direction Reversal**: ทุกคู่ `winner_to_bracket_match_id`/`loser_to_bracket_match_id` ใน V1 ต้อง resolve เป็น `home_source_ref`/`away_source_ref` ที่ถูกทิศทางใน V2 (ดูหมวด 3.6) — เขียน Test เฉพาะจุดนี้แยกจาก Verification ทั่วไป เพราะเป็นจุดที่ผิดง่ายที่สุด

---

## 6. Venue / RBAC / Result-Workflow — Seed Data (ใหม่ v1.1, ไม่ใช่ Migration)

ต่างจากหมวด 1-5 ที่เป็นการ **ย้าย** ข้อมูลจาก League DB เข้ามา หมวดนี้คือการ **สร้างข้อมูลตั้งต้นใหม่** ล้วนๆ เพราะ V1 ไม่มี Venue/RBAC/Result-Workflow เป็น entity อยู่แล้ว (ดู Current State Audit หมวด 13):

| ขั้นตอน | รายละเอียด | ต้องทำก่อน Phase ไหน |
|---|---|---|
| สร้าง `tournament_venues` 4 แถว | สนามที่ 1-4 ตามชื่อจริง พร้อม `slug` | Phase 2 (Core Domain) |
| สร้าง `tournament_categories` 7 แถว | B-U12, G-U14, B-U14, G-U16, B-U16, G-U18, B-U18 พร้อม `gender` ที่ถูกต้อง (ไม่ default เป็น `mixed` เหมือน migration ปกติ เพราะ v1.1 ระบุเพศชัดเจนทุกประเภท) | Phase 2 |
| Seed `tournament_category_venues` 7 แถว | ตาม mapping จริง (ดู `TOURNAMENT_V2_TARGET_ARCHITECTURE.md` หมวด 11.1) | Phase 2 |
| สร้าง `tournament_user_profiles` + `tournament_role_assignments` เริ่มต้น | อย่างน้อย 1 `tournament_super_admin` + 4 `venue_manager` (คนละสนาม) ก่อนเปิดใช้งานจริง | Phase 3 |
| ตรวจสอบว่า `matches.venue` (V1 freetext เดิม ถ้ามีการ Migrate ข้อมูลเก่าตาม Q2) resolve เข้า `tournament_venues.id` ได้ครบ ไม่มีชื่อสนามสะกดต่างกันเป็นสนามซ้ำ | เพิ่มจากหมวด 1 (`matches → tournament_matches`) — ต้องรัน distinct-value audit ก่อน (`select distinct venue from matches where ...`) แล้วให้แอดมิน map ด้วยมือทีละชื่อ | Phase 11 (ถ้าเลือก Migrate ข้อมูลเดิมตาม Q2) |

**หมายเหตุ**: ไม่มี ID Mapping (`old_x_id -> new_x_id`) สำหรับกลุ่มนี้เพิ่มจากหมวด 2 เพราะไม่มี `old_id` ต้นทางให้ map — เป็น Fresh Insert ล้วน

---

## 7. Group Slot / Draw Assignment — Seed Data (ใหม่ Scheduling Addendum, ไม่ใช่ Migration)

เช่นเดียวกับหมวด 6 — V1 ไม่มีแนวคิด Group Slot หรือ Draw Assignment เลย (ดู R8 ใน Current State Audit หมวด 13) การ "ย้าย" ข้อมูลกลุ่มนี้จึงหมายถึง **สร้างใหม่จากข้อมูลผลจับฉลากที่มีอยู่จริงในทางปฏิบัติ** (เช่น เอกสารกระดาษ/สเปรดชีตที่ผู้จัดใช้อยู่เดิม) ไม่ใช่ query จาก League DB:

| ขั้นตอน | รายละเอียด |
|---|---|
| สร้าง `tournament_group_members` แบบ Slot ว่าง | ตาม Group Slot Generation Algorithm (ดู `TOURNAMENT_V2_SCHEDULING_AND_IMPORT.md` หมวด 11) — ไม่ต้องมีข้อมูลต้นทาง เป็นการ Generate จากจำนวนทีมที่กำหนด |
| Import ผลจับฉลากที่เคยทำไปแล้ว (ถ้ามี) ผ่านไฟล์ `DRAW_ASSIGNMENTS` | ถ้าทัวร์นาเมนต์เคยจับฉลากไปแล้วก่อนเริ่มใช้ระบบ V2 (เช่น จับฉลากด้วยมือหน้างานแล้วมาบันทึกย้อนหลัง) ต้องกรอกไฟล์ `DRAW_ASSIGNMENTS` เองตามผลจริง ไม่มีระบบอัตโนมัติดึงจากที่ไหน |
| ตรวจสอบว่า V1 Tournament Fixtures ที่เคย Import (ถ้าเลือก Migrate ตาม Q2) มีทีมครบตรงกับผลจับฉลากจริงหรือไม่ | เพราะ V1 บันทึกทีมจริงตรงๆ ไม่มี Slot ไว้ก่อน (`lib/tournament-fixtures.ts::resolveTeam`) ข้อมูล "ใครแข่งกับใคร" จาก V1 fixtures ที่ finished แล้วสามารถใช้ **ย้อนสร้าง** `tournament_draw_assignments` ได้ (reverse-engineer จากผลที่เกิดขึ้นจริง) — เป็นทางเลือกเสริมถ้าไม่มีเอกสารการจับฉลากต้นฉบับเก็บไว้ |

---

## Rollback Plan

Migration Map นี้เป็นเอกสารวางแผนเท่านั้น ไม่มีการรันจริง เมื่อถึงขั้นตอน Implementation จริง (Phase 11 เป็นต้นไป) ทุก Migration Script ต้องเขียนแบบ **อ่านจาก League DB (read-only) → เขียนเข้า Tournament DB เท่านั้น** ไม่มีการเขียนกลับ League DB เลยในทุกกรณี ดังนั้น Rollback ของ Migration คือการ **ล้างข้อมูลใน Tournament DB แล้วรันใหม่** โดยไม่กระทบ League DB แต่อย่างใด — ต้องมี Dry Run บน Staging/Preview Database ก่อนรันกับ Production เสมอ (ดู Phase 11 ใน Implementation Phases)
