# Team Logos

วางไฟล์โลโก้ทีมที่ export จาก Canva ไว้ในโฟลเดอร์นี้

## วิธีใช้

1. Export โลโก้จาก Canva เป็น PNG หรือ WebP
2. ตั้งชื่อไฟล์เป็น slug ภาษาอังกฤษ เช่น:
   - `huathan-wittaya.png`
   - `nongprue-kindergarten.png`
   - `pattaya-city.png`
3. วางไฟล์ใน `/public/team-logos/`
4. อัปเดต `teams.logo_url` ในฐานข้อมูล เช่น:

```sql
UPDATE teams
SET logo_url = '/team-logos/huathan-wittaya.png'
WHERE short_name = 'HTW';
```

## หมายเหตุ

* ค่า `logo_url` ต้องขึ้นต้นด้วย `/team-logos/`
* ไม่แนะนำใช้ Canva share link โดยตรง
* ถ้าไม่มีโลโก้ ระบบจะแสดงตัวอักษรย่อทีมแทน

---

**Last Updated**: 2026-06-28
