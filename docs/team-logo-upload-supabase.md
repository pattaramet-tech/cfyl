# Team Logo Upload System - Supabase Storage

ระบบอัปโหลดโลโก้ทีมโดยเจ้าหน้าที่ผ่าน Admin Panel ไปเก็บใน Supabase Storage

## ขั้นตอนตั้งค่า

### 1. สร้าง Supabase Storage Bucket

1. เปิด [Supabase Dashboard](https://supabase.com/dashboard)
2. ไปที่โปรเจกต์
3. ไปที่ **Storage** (ในเมนูด้านข้าง)
4. กด **Create a new bucket**
5. ตั้งชื่อ: `team-logos`
6. ตั้งค่า:
   - **Public bucket**: ✅ เปิด (เพื่อให้ public สามารถอ่านรูป)
   - **File size limit**: 10 MB (หรือมากกว่า)

### 2. ตั้งค่า RLS (Row Level Security)

Bucket `team-logos` ต้องตั้ง policy:

**สำหรับ Public Read:**
```sql
CREATE POLICY "Allow public read on team-logos" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'team-logos');
```

**สำหรับ Admin Upload:**
Admin upload ใช้ Supabase service role key (backend only)

### 3. ตั้งค่า Environment Variables

ตรวจว่าไฟล์ `.env.local` มี:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJxxx...
```

โดยต้อง:
- `NEXT_PUBLIC_SUPABASE_URL` - public URL
- `SUPABASE_SERVICE_ROLE_KEY` - secret key จาก Supabase Settings → API

⚠️ **ห้าม** expose service role key ใน browser - ใช้เฉพาะ backend API

---

## วิธีใช้งาน

### สำหรับเจ้าหน้าที่ Admin

1. เข้า `/admin/teams/logos`
2. เลือกทีมจาก dropdown
3. เห็นโลโก้ปัจจุบัน (ถ้ามี)
4. เลือกไฟล์ PNG/JPG/WebP (ไม่เกิน 5MB)
5. ดูตัวอย่างรูป (preview)
6. กด **อัปโหลดและบันทึกโลโก้**
7. รอเพิ่ม `teams.logo_url` โดยอัตโนมัติ
8. ปิด modal ที่สำเร็จ

### Public Pages

หลังอัปโหลด โลโก้จะปรากฏใน:

- `/teams` - Team cards
- `/teams/[teamId]` - Hero section
- `/fixtures` - Match cards
- `/matches/[matchId]` - Hero section
- `/standings` - Team list

ไม่ต้อง commit รูปเข้า Git - อยู่ใน Supabase Storage

---

## API Details

### POST `/api/admin/team-logos/upload`

**Request:**
```
Content-Type: multipart/form-data

teamId: "team-123"
file: <File>
```

**Response (Success):**
```json
{
  "success": true,
  "logo_url": "https://xxxxx.supabase.co/storage/v1/object/public/team-logos/teams/team-123/napa-1719567...jpg",
  "path": "teams/team-123/napa-1719567....jpg",
  "message": "อัปโหลดโลโก้สำเร็จ"
}
```

**Response (Error):**
```json
{
  "error": "ไม่พบทีมนี้"
}
```

**Validation:**
- ต้องมี admin token
- teamId ต้องมีจริงในฐานข้อมูล
- file type ต้อง PNG/JPG/JPEG/WebP
- file size ต้องไม่เกิน 5MB

---

## Database Update

หลังอัปโหลด API จะอัปเดต `teams.logo_url` เป็น public URL:

```sql
UPDATE teams
SET logo_url = 'https://xxxxx.supabase.co/storage/v1/object/public/team-logos/teams/abc-123/napa-123456.jpg'
WHERE id = 'abc-123';
```

---

## File Path Convention

โลโก้จะเก็บในรูปแบบ:

```
team-logos/teams/{teamId}/{slug}-{timestamp}.{ext}
```

**ตัวอย่าง:**
```
team-logos/teams/abc-123/napa-1719567890123.jpg
team-logos/teams/xyz-456/sriracha-1719567891234.jpg
team-logos/teams/pqr-789/huathan-wittaya-1719567892345.png
```

Slug generation:
- ใช้ `team.short_name` ถ้ามี
- ถ้าไม่มี ใช้ `team.name`
- แปลงเป็น lowercase
- แทนช่องว่างด้วย `-`
- ลบ special characters

---

## วิธีเช็กเมื่อปัญหา

### 1. โลโก้ไม่ขึ้นใน Public Pages

ตรวจ:

```sql
SELECT id, name, short_name, logo_url FROM teams WHERE logo_url IS NOT NULL LIMIT 5;
```

ถ้า `logo_url` เป็น NULL → อัปโหลดยังไม่ได้

### 2. Public URL 404

เปิด URL โดยตรง:

```
https://xxxxx.supabase.co/storage/v1/object/public/team-logos/teams/abc-123/napa-123.jpg
```

ถ้า 404 → ไฟล์ยังไม่อยู่ใน bucket หรือ path ผิด

### 3. Upload Button Disabled

- ✅ เลือกทีม
- ✅ เลือกไฟล์
- ✅ Preview ขึ้นมา

ถ้ายังปิด → ตรวจ browser console

### 4. Browser Console Errors

```
[TEAM_LOGO_UPLOAD] Storage error:
```

→ ตรวจว่า bucket `team-logos` สร้างแล้ว และ public access เปิด

```
[TEAM_LOGO_UPLOAD] Failed to get public URL
```

→ ตรวจ Supabase settings

---

## Security

### ✅ ปกป้อง Service Role Key

- Service role key อยู่ใน server API เท่านั้น (`.env.local`)
- ไม่เปิดให้ public
- Upload ต้องผ่าน backend route

### ✅ Admin Authentication

- Admin route ตรวจ token ด้วย `verifyAdminAuth()`
- ต้อง login ด้วย admin token
- ไม่มี token → 401 Unauthorized

### ✅ File Validation

- Allowed types: PNG, JPG, JPEG, WebP
- Max size: 5MB
- ตรวจ mime type + size ฝั่ง server

### ✅ Bucket Policy

- Bucket public สำหรับ read เท่านั้น
- Upload ใช้ service role (backend)
- Public ไม่สามารถ upload/delete

---

## Troubleshooting

### Service Role Key ไม่ถูกต้อง

```
Missing Supabase environment variables
```

ตรวจ:
- `.env.local` มี `SUPABASE_SERVICE_ROLE_KEY`
- Key ถูกต้อง (copy จาก Supabase Dashboard)
- ไม่มี space/newline ที่เกิน

### Bucket ยังไม่สร้าง

```
Bucket "team-logos" does not exist
```

→ สร้าง bucket ตามขั้นตอนตั้งค่า

### Upload ไม่สำเร็จ

ตรวจ browser console:
- ไฟล์ type ถูกต้องหรือไม่ (PNG/JPG/WebP)
- ไฟล์เล็กกว่า 5MB หรือไม่
- Network tab → `/api/admin/team-logos/upload` response เป็นไร

### โลโก้ขึ้นแล้วหายไป

ตรวจ `teams.logo_url` - อาจลบโลโก้เก่า

เพราะ `upsert: true` ตัวไฟล์เก่า ถ้าเก็บแยก path อาจหายไป

---

## ข้อจำกัด

- Max file size: 5MB (ตั้งค่าได้ใน Supabase)
- Allowed types: PNG, JPG, JPEG, WebP เท่านั้น
- Upload ต้องมี admin token
- ต้องสร้าง bucket `team-logos` ก่อน

---

**Last Updated**: 2026-06-28
