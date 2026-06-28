-- SQL to update teams.logo_url based on existing team logo files
-- Files in public/team-logos/ (all lowercase):
-- angsila.jpg, bansri.jpg, bkms.jpg, blm.png, htw.jpg,
-- napa.jpg, nongprue.jpg, nongsak.jpg, nongsang.jpg,
-- phantong.jpg, ptltown.jpg, ptlw.jpg, sriracha.jpg,
-- takham.jpg, thadtong.jpg, watrat.jpg,
-- + LINE_ALBUM_รูปโลโก้ ตราโรงเรียน_*.jpg (Thai-named)

-- Update by short_name (preferred method)
UPDATE teams SET logo_url = '/team-logos/angsila.jpg' WHERE short_name = 'ANGSILA';
UPDATE teams SET logo_url = '/team-logos/bansri.jpg' WHERE short_name = 'BANSRI';
UPDATE teams SET logo_url = '/team-logos/bkms.jpg' WHERE short_name = 'BKMS';
UPDATE teams SET logo_url = '/team-logos/blm.png' WHERE short_name = 'BLM';
UPDATE teams SET logo_url = '/team-logos/htw.jpg' WHERE short_name = 'HTW';
UPDATE teams SET logo_url = '/team-logos/napa.jpg' WHERE short_name = 'NAPA';
UPDATE teams SET logo_url = '/team-logos/nongprue.jpg' WHERE short_name = 'NONGPRUE';
UPDATE teams SET logo_url = '/team-logos/nongsak.jpg' WHERE short_name = 'NONGSAK';
UPDATE teams SET logo_url = '/team-logos/nongsang.jpg' WHERE short_name = 'NONGSANG';
UPDATE teams SET logo_url = '/team-logos/phantong.jpg' WHERE short_name = 'PHANTONG';
UPDATE teams SET logo_url = '/team-logos/ptltown.jpg' WHERE short_name = 'PTLTOWN';
UPDATE teams SET logo_url = '/team-logos/ptlw.jpg' WHERE short_name = 'PTLW';
UPDATE teams SET logo_url = '/team-logos/sriracha.jpg' WHERE short_name = 'SRIRACHA';
UPDATE teams SET logo_url = '/team-logos/takham.jpg' WHERE short_name = 'TAKHAM';
UPDATE teams SET logo_url = '/team-logos/thadtong.jpg' WHERE short_name = 'THADTONG';
UPDATE teams SET logo_url = '/team-logos/watrat.jpg' WHERE short_name = 'WATRAT';

-- For Thai-named files (LINE_ALBUM_...), map based on team name or short_name
-- These need manual mapping based on actual team data
-- Example patterns to identify:
-- Line 260520_10.jpg, 260520_11.jpg, 260520_14.jpg, etc.

-- Verify: Check which teams still have NULL logo_url
SELECT id, name, short_name, logo_url FROM teams WHERE logo_url IS NULL ORDER BY name;

-- Verify: Check updated teams
SELECT id, name, short_name, logo_url FROM teams WHERE logo_url LIKE '/team-logos/%' ORDER BY name;
