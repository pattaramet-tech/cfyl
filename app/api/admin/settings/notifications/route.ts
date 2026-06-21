import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { isValidDiscordWebhook } from '@/lib/discord';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from('notification_settings')
    .select('provider, webhook_url, enabled')
    .eq('provider', 'discord')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: `Failed to load settings: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json(
    data ?? { provider: 'discord', webhook_url: '', enabled: true }
  );
}

export async function PUT(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const webhookUrl: string = (body.webhook_url ?? '').trim();
  const enabled: boolean = body.enabled !== false;

  if (webhookUrl && !isValidDiscordWebhook(webhookUrl)) {
    return NextResponse.json(
      { error: 'Discord Webhook URL ไม่ถูกต้อง (ต้องขึ้นต้นด้วย https://discord.com/api/webhooks/)' },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin
    .from('notification_settings')
    .upsert(
      {
        provider: 'discord',
        webhook_url: webhookUrl || null,
        enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'provider' }
    )
    .select('provider, webhook_url, enabled')
    .single();

  if (error) {
    return NextResponse.json({ error: `Failed to save settings: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ success: true, settings: data });
}
