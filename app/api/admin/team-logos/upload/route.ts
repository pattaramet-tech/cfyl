import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const BUCKET_NAME = 'team-logos';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function generateSlug(name?: string | null): string {
  if (!name) return 'team';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

async function ensureTeamLogosBucket() {
  try {
    const { data: buckets, error: listError } = await supabaseAdmin.storage.listBuckets();

    if (listError) {
      console.error('[TEAM_LOGO_UPLOAD] listBuckets error:', listError);
      return {
        ok: false,
        error: `ไม่สามารถตรวจสอบ Storage bucket ได้: ${listError.message}`,
      };
    }

    const exists = buckets?.some((b) => b.name === BUCKET_NAME);

    if (!exists) {
      console.log('[TEAM_LOGO_UPLOAD] Bucket does not exist, creating...');

      const { error: createError } = await supabaseAdmin.storage.createBucket(BUCKET_NAME, {
        public: true,
      });

      if (createError) {
        console.error('[TEAM_LOGO_UPLOAD] createBucket error:', createError);
        return {
          ok: false,
          error: `ไม่สามารถสร้าง bucket team-logos ได้: ${createError.message}`,
        };
      }

      console.log('[TEAM_LOGO_UPLOAD] Bucket created successfully');
      return { ok: true };
    }

    console.log('[TEAM_LOGO_UPLOAD] Bucket exists, verifying public access...');

    // Attempt to update bucket to ensure public access
    const { error: updateError } = await supabaseAdmin.storage.updateBucket(BUCKET_NAME, {
      public: true,
    });

    if (updateError) {
      console.warn('[TEAM_LOGO_UPLOAD] updateBucket warning:', updateError);
      // Don't fail - bucket might already be public
    }

    return { ok: true };
  } catch (err) {
    console.error('[TEAM_LOGO_UPLOAD] ensureTeamLogosBucket error:', err);
    return {
      ok: false,
      error: `Storage setup error: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAdminAuth(request);
    if (!authResult.authenticated) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์แอดมิน' }, { status: 401 });
    }

    const formData = await request.formData();
    const teamId = formData.get('teamId') as string;
    const file = formData.get('file') as File;

    // Validation
    if (!teamId) {
      return NextResponse.json({ error: 'ต้องเลือกทีม' }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({ error: 'ต้องเลือกไฟล์' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'รูปต้องเป็น PNG, JPG หรือ WebP เท่านั้น' },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: 'ไฟล์ใหญ่เกิน 5MB' },
        { status: 400 }
      );
    }

    // Get team data for slug
    const { data: team, error: teamError } = await supabaseAdmin
      .from('teams')
      .select('id, name, short_name')
      .eq('id', teamId)
      .maybeSingle();

    if (teamError || !team) {
      return NextResponse.json({ error: 'ไม่พบทีมนี้' }, { status: 404 });
    }

    // Ensure bucket exists and is public
    const bucketCheck = await ensureTeamLogosBucket();
    if (!bucketCheck.ok) {
      return NextResponse.json({ error: bucketCheck.error }, { status: 500 });
    }

    // Generate file path
    const slug = generateSlug(team.short_name || team.name);
    const ext = file.type === 'image/webp' ? 'webp' : file.name.split('.').pop() || 'jpg';
    const timestamp = Date.now();
    const filePath = `teams/${teamId}/${slug}-${timestamp}.${ext}`;

    console.log('[TEAM_LOGO_UPLOAD] Uploading:', {
      teamId,
      teamName: team.name,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      filePath,
    });

    // Upload to Supabase Storage
    const buffer = await file.arrayBuffer();
    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET_NAME)
      .upload(filePath, Buffer.from(buffer), {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error('[TEAM_LOGO_UPLOAD] Storage error:', {
        message: uploadError.message,
        name: uploadError.name,
        statusCode: (uploadError as any).statusCode,
        bucket: BUCKET_NAME,
        filePath,
      });

      return NextResponse.json(
        {
          error: `อัปโหลดรูปไม่สำเร็จ: ${uploadError.message}`,
          detail: {
            bucket: BUCKET_NAME,
            path: filePath,
            statusCode: (uploadError as any).statusCode,
          },
        },
        { status: 500 }
      );
    }

    // Get public URL
    const { data } = supabaseAdmin.storage.from(BUCKET_NAME).getPublicUrl(filePath);
    const publicUrl = data?.publicUrl;

    if (!publicUrl) {
      console.error('[TEAM_LOGO_UPLOAD] Failed to get public URL for:', filePath);
      return NextResponse.json(
        { error: 'ไม่สามารถสร้าง URL รูป' },
        { status: 500 }
      );
    }

    // Update teams table
    const { error: updateError } = await supabaseAdmin
      .from('teams')
      .update({ logo_url: publicUrl })
      .eq('id', teamId);

    if (updateError) {
      console.error('[TEAM_LOGO_UPLOAD] DB update error:', updateError);
      return NextResponse.json(
        { error: 'ไม่สามารถบันทึกข้อมูลได้' },
        { status: 500 }
      );
    }

    console.log('[TEAM_LOGO_UPLOAD] Success:', {
      teamId,
      teamName: team.name,
      filePath,
      publicUrl,
    });

    return NextResponse.json({
      success: true,
      logo_url: publicUrl,
      path: filePath,
      message: 'อัปโหลดโลโก้สำเร็จ',
    });
  } catch (error) {
    console.error('[TEAM_LOGO_UPLOAD] Error:', error);
    return NextResponse.json(
      {
        error: 'เกิดข้อผิดพลาด',
        detail: error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
