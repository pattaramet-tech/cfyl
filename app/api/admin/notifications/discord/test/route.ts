import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { getDiscordSettings, isValidDiscordWebhook, sendDiscordMessage } from '@/lib/discord';
import { logAdminAction } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const settings = await getDiscordSettings();
  if (!settings || !settings.enabled) {
    return NextResponse.json({ error: 'Discord notification ถูกปิดอยู่ (Disabled)' }, { status: 400 });
  }
  if (!isValidDiscordWebhook(settings.webhook_url)) {
    return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า Discord Webhook URL ที่ถูกต้อง' }, { status: 400 });
  }

  const result = await sendDiscordMessage(
    settings.webhook_url!,
    `✅ ทดสอบการแจ้งเตือนจากระบบ CFYL — ${new Date().toLocaleString('th-TH')}`
  );

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'notification.discord.test',
    entityType: 'notification',
    newData: { success: result.ok, status: result.status, error: result.error },
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: `ส่งไป Discord ไม่สำเร็จ (HTTP ${result.status}): ${result.error || ''}` },
      { status: 502 }
    );
  }

  return NextResponse.json({ success: true, message: 'ส่งข้อความทดสอบไป Discord สำเร็จ' });
}
