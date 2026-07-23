import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminAuth } from '@/lib/admin-middleware';
import { getDiscordSettings, isValidDiscordWebhook, sendDiscordMessage, packMessages } from '@/lib/discord';
import { logAdminAction } from '@/lib/audit-log';
import { getSuspensionStatus, getBangkokToday, type SuspensionStatusKey } from '@/lib/suspension-status';
import {
  formatSuspensionCause,
  groupSuspensionNotifications,
  type SuspensionNotificationInput,
} from '@/lib/discord-suspension-format';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export const dynamic = 'force-dynamic';

const SENDABLE: SuspensionStatusKey[] = ['pending', 'active', 'no_next_match'];

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

  // Season (title fallback)
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

  // Collect one raw entry per (player, banned-match) pair across age groups. A player
  // with two banned matches (12+ point threshold) contributes one entry per match — each
  // entry always carries its OWN match, never a match borrowed from another player/entry.
  const rawEntries: SuspensionNotificationInput[] = [];
  let recordCount = 0;
  for (const ag of ageGroups || []) {
    const { data: suspensions } = await supabaseAdmin
      .from('suspensions')
      .select(
        'player_id, total_points, ban_matches, suspension_type, accumulated_threshold, suspension_reason, suspension_details, player:player_id(full_name, shirt_no), team:team_id(name)'
      )
      .eq('season_id', seasonId)
      .eq('age_group_id', ag.id)
      .order('total_points', { ascending: false });

    for (const rawRecord of suspensions || []) {
      const record: any = rawRecord;
      const status = getSuspensionStatus(record, today);
      if (!allowed.has(status.key)) continue;
      recordCount += 1;

      const p = record.player;
      const entryBase = {
        ageCode: ag.code,
        fullName: p?.full_name,
        shirtNo: p?.shirt_no,
        teamName: record.team?.name,
        cause: formatSuspensionCause(record),
      };

      const matches = record.suspension_details?.suspended_matches || [];
      if (matches.length === 0) {
        rawEntries.push({ ...entryBase, match: null });
      } else {
        for (const m of matches) {
          rawEntries.push({ ...entryBase, match: m });
        }
      }
    }
  }

  // Build messages. groupSuspensionNotifications() groups entries by exact fixture
  // (matchday + date) so each title names a single matchday/date, and keeps entries with
  // no next match in their own separate "CFYL {year}"-titled group — never merged into a
  // matchday-titled message. packMessages() itself is untouched.
  let messages: string[];
  if (rawEntries.length === 0) {
    messages = [`✅ ไม่มีนักกีฬาติดโทษแบนในรายการที่เลือก (CFYL ${season.year})`];
  } else {
    messages = [];
    for (const group of groupSuspensionNotifications(rawEntries, season.year)) {
      messages.push(...packMessages(group.title, group.blocks, 8));
    }
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
      sentCount: recordCount,
      messageParts: messages.length,
      messagesSent: sent,
      failedCount: failed,
      success,
      error: firstError,
    },
  });

  if (!success) {
    return NextResponse.json(
      { error: `ส่งบาง message ไม่สำเร็จ (${failed}/${messages.length}): ${firstError || ''}`, players: recordCount, messagesSent: sent, messageParts: messages.length },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    players: recordCount,
    messageParts: messages.length,
    empty: recordCount === 0,
  });
}
