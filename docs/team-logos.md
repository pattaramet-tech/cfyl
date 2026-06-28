# วิธีเพิ่มโลโก้ทีม

## ภาพรวม

ระบบรองรับโลโก้ทีมจากไฟล์ static ใน `/public/team-logos/`

หากทีมไม่มีโลโก้ ระบบจะแสดงตัวอักษรย่อทีมแทน เช่น:
- `โรงเรียนหัวถนน` → `โร`
- `Chonburi A` → `CA`
- `U14 Samui` → `US`

---

## ขั้นตอนเพิ่มโลโก้

### 1. Export โลโก้จาก Canva

1. เปิด Canva project
2. Select design ที่ต้องการ
3. Click **Share** → **Download**
4. เลือก format: **PNG** หรือ **WebP** (แนะนำ PNG เพื่อ compatibility)
5. คลิก **Download**

### 2. ตั้งชื่อไฟล์

ใช้รูปแบบ **slug** (อักษรลาติน + lowercase + dash):

```
❌ ผิด: โรงเรียนหัวถนน.png, Team A - Final.png
✅ ถูก: huathan.png, chonburi-a.png, team-001.png
```

**Naming convention**:
- ใช้ `short_name` ของทีมถ้าเป็นภาษาอังกฤษ
- ใช้ school abbreviation
- ใช้ team-id ถ้าหากไม่มีชื่อที่ชัด

ตัวอย่าง:
```
chiang-mai-a.png    (Chiang Mai School - Team A)
huathan.png         (Huathan School)
u14-samui.png       (U14 Samui)
team-001.png        (Generic Team 001)
```

### 3. วางไฟล์ลงในโปรเจกต์

```
cfyl-web/
└── public/
    └── team-logos/
        ├── chonburi-a.png
        ├── huathan.png
        ├── u14-samui.png
        └── team-001.png
```

ตรวจสอบว่าไฟล์อยู่ที่ `/public/team-logos/` ในโปรเจกต์

### 4. อัปเดตฐานข้อมูล

ใส่ค่า `logo_url` ในตาราง `teams` field:

```sql
UPDATE teams
SET logo_url = '/team-logos/chonburi-a.png'
WHERE name = 'ชลบุรี ทีม A' AND short_name = 'CHON-A';
```

**Format**:
```
/team-logos/{filename}.png
/team-logos/{filename}.webp
```

### 5. ทดสอบ

1. เปิด `/teams` ควรเห็นโลโก้ทีม
2. เปิด `/teams/[teamId]` ควรเห็นโลโก้ใหญ่ในหัวข้อ
3. เปิด `/matches/[matchId]` ควรเห็นโลโก้ทีมเหย้า/เยือน
4. เปิด `/fixtures` ควรเห็นโลโก้ใน match card

---

## ตัวอย่างการใช้

### Example 1: Team with Logo

Database:
```sql
INSERT INTO teams (name, short_name, logo_url)
VALUES ('โรงเรียนหัวถนน', 'HUATHAN', '/team-logos/huathan.png');
```

Result: โลโก้ทีมแสดง

### Example 2: Team without Logo

Database:
```sql
INSERT INTO teams (name, short_name, logo_url)
VALUES ('ทีมใหม่', 'NEW', NULL);
```

Result: แสดง `TN` (initials)

### Example 3: Logo File Not Found

Database:
```sql
UPDATE teams SET logo_url = '/team-logos/not-found.png' WHERE id = 'team-123';
```

Result: ระบบ fallback เป็น initials โดยอัตโนมัติ

---

## Fallback Logic

```
ถ้ามี logo_url → แสดง image
    ↓
ถ้ารูปโหลดไม่ได้ → fallback initials
    ↓
ถ้าไม่มี logo_url → แสดง initials
    ↓
ถ้าไม่มี shortName → ใช้ name
    ↓
ถ้าไม่มี name → แสดง "?"
```

---

## Initials Rule

ตัวอักษรย่อจะหยิบมาจาก:

1. **`short_name`** ก่อน (ถ้ามี)
   - `CHON-A` → `CA`
   - `TEAM-B` → `TB`

2. ถ้าไม่มี ใช้ **`name`**
   - `โรงเรียนหัวถนน` → `โร`
   - `Chiang Mai School` → `CM`

3. ถ้าทั้งคู่ไม่มี → `?`

**กฎการหยิบอักษร**:
- หยิบตัวแรกของแต่ละคำ
- เปลี่ยนเป็นตัวพิมพ์ใหญ่ (สำหรับภาษาอังกฤษ)
- ใช้ 2 อักษรแรก

ตัวอย่าง:
```
"Chonburi FC" → C + F → "CF"
"U14 Samui" → U + S → "US"
"โรงเรียนหัวถนน" → โ + ร → "โร"
```

---

## Tips

### ขนาดรูปที่ดี
- PNG/WebP: 200x200 px ขึ้นไป
- ถ้าต่ำกว่า จะเบลอ

### การออกแบบโลโก้
- ใช้ **square** ไม่ใช่ rectangle (ระบบจะวาด circular)
- ใช้ **background ที่ contrast** กับสีทีม
- ลองทำให้ **เป็นสัญลักษณ์** ที่จำได้ง่าย

### Version Control
- Commit `/public/team-logos/` เข้า Git
- หรือเพิ่ม `.gitignore` ถ้าสินค้า

```gitignore
# Option 1: ไม่ commit รูป (ขนาดใหญ่)
public/team-logos/*.png
public/team-logos/*.webp

# Option 2: Commit ให้ (small files)
# (ปล่อยให้เพิ่มได้)
```

---

## Mapping Reference

ดูตัวอย่าง CSV mapping ที่:

```
docs/team-logo-mapping-example.csv
```

---

## Support

หากโลโก้ไม่แสดง:

1. ตรวจว่าไฟล์อยู่ใน `/public/team-logos/`
2. ตรวจ `logo_url` ใน DB เป็น `/team-logos/...` แน่นอน
3. ตรวจว่า filename ตรงกับไฟล์จริง (case-sensitive)
4. ลอง refresh browser หรือ clear cache
5. ตรวจ console error ถ้า image fail

---

**Last Updated**: 2026-06-28
