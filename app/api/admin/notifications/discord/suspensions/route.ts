import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { getDiscordSettings, isValidDiscordWebhook, sendDiscordMessage, packMessages } from '@/lib/discord';
import { logAdminAction } from '@/lib/audit-log';
import { getSuspensionStatus, getBangkokToday, type SuspensionStatusKey } from '@/lib/suspension-status';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

const SENDABLE: SuspensionStatusKey[] = ['pending', 'active', 'no_next_match'];

function fmtDate(d?: string | null): string {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function buildBlock(index: number, ageCode: string, record: any, statusLabel: string): string {
  const p = record.player;
  const shirt = p?.shirt_no ? ` #${p.shirt_no}` : '';
  const d = record.suspension_details;
  const lines: string[] = [];
  lines.push(`รุ่น: ${ageCode}`);
  lines.push(`${index}. ${p?.full_name || 'ไม่ทราบชื่อ'}${shirt}`);
  lines.push(`   ทีม: ${record.team?.name || '-'}`);
  lines.push(`   สถานะ: ${statusLabel}`);
  if (d?.trigger_event) lines.push(`   เหตุการณ์: ${d.trigger_event}`);
  lines.push(`   คะแนนวินัย: ${record.total_points} คะแนน`);
  lines.push(`   โทษแบน: ${record.ban_matches} นัด`);

  const matches = d?.suspended_matches || [];
  if (matches.length > 0) {
    for (const m of matches) {
      const time = m.match_time ? ` เวลา ${String(m.match_time).substring(0, 5)}` : '';
      const venue = m.is_home ? 'เหย้า' : 'เยือน';
      lines.push(`   นัดที่โดนแบน: MatchDay ${m.matchday} | ${m.match_code}`);
      lines.push(`   วันที่: ${fmtDate(m.match_date)}${time} | พบ ${m.opponent_name} (${venue})`);
    }
  } else {
    lines.push(`   นัดที่โดนแบน: ไม่พบโปรแกรมนัดถัดไป`);
  }
  return lines.join('\n');
}

export async function POST(request: NextRequest) {
  const auth = await verifyAdminAuth(request);
  if (!auth.authenticated || !auth.profile) {
    return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const seasonId: string = body.seasonId;
  const ageGroupId: string = body.ageGroupId || 'all';
  const statusFilter: string = body.statusFilter || 'all';

  if (!seasonId) {
    return NextResponse.json({ error: 'seasonId is required' }, { status: 400 });
  }

  // Settings
  const settings = await getDiscordSettings();
  if (!settings || !settings.enabled) {
    return NextResponse.json({ error: 'Discord notification ถูกปิดอยู่ (Disabled)' }, { status: 400 });
  }
  if (!isValidDiscordWebhook(settings.webhook_url)) {
    return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า Discord Webhook URL ที่ถูกต้อง' }, { status: 400 });
  }

  // Season (title)
  const { data: season } = await supabaseAdmin
    .from('seasons')
    .select('id, year, name')
    .eq('id', seasonId)
    .single();
  if (!season) {
    return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  }

  // Age groups in scope
  let agQuery = supabaseAdmin
    .from('age_groups')
    .select('id, code, sort_order')
    .eq('season_id', seasonId)
    .order('sort_order', { ascending: true });
  if (ageGroupId !== 'all') agQuery = agQuery.eq('id', ageGroupId);
  const { data: ageGroups } = await agQuery;

  const today = getBangkokToday();
  const allowed = new Set<SuspensionStatusKey>(
    statusFilter === 'all' ? SENDABLE : ([statusFilter as SuspensionStatusKey].filter((k) => SENDABLE.includes(k)))
  );

  // Collect player blocks across age groups
  const blocks: string[] = [];
  let counter = 0;
  for (const ag of ageGroups || []) {
    const { data: suspensions } = await supabaseAdmin
      .from('suspensions')
      .select('player_id, total_points, ban_matches, suspension_details, player:player_id(full_name, shirt_no), team:team_id(name)')
      .eq('season_id', seasonId)
      .eq('age_group_id', ag.id)
      .order('total_points', { ascending: false });

    for (const record of suspensions || []) {
      const status = getSuspensionStatus(record as any, today);
      if (!allowed.has(status.key)) continue;
      counter += 1;
      blocks.push(buildBlock(counter, ag.code, record, status.label));
    }
  }

  const title = `🚫 แจ้งโทษแบน CFYL ${season.year}`;

  // Send
  let messages: string[];
  if (blocks.length === 0) {
    messages = [`✅ ไม่มีนักกีฬาติดโทษแบนในรายการที่เลือก (CFYL ${season.year})`];
  } else {
    messages = packMessages(title, blocks, 8);
  }

  let sent = 0;
  let failed = 0;
  let firstError: string | undefined;
  for (const msg of messages) {
    const r = await sendDiscordMessage(settings.webhook_url!, msg);
    if (r.ok) sent += 1;
    else {
      failed += 1;
      if (!firstError) firstError = `HTTP ${r.status}: ${r.error || ''}`;
    }
  }

  const success = failed === 0;

  await logAdminAction({
    admin: { id: auth.profile.id, email: auth.profile.email },
    action: 'notification.discord.suspensions_send',
    entityType: 'notification',
    entityLabel: `CFYL ${season.year}`,
    newData: {
      seasonId,
      ageGroupId,
      statusFilter,
      sentCount: blocks.length,
      messageParts: messages.length,
      messagesSent: sent,
      failedCount: failed,
      success,
      error: firstError,
    },
  });

  if (!success) {
    return NextResponse.json(
      { error: `ส่งบาง message ไม่สำเร็จ (${failed}/${messages.length}): ${firstError || ''}`, players: blocks.length, messagesSent: sent, messageParts: messages.length },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    players: blocks.length,
    messageParts: messages.length,
    empty: blocks.length === 0,
  });
}
