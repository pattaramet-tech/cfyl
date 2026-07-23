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

interface SuspendedMatch {
  matchday?: string | number | null;
  match_date?: string | null;
  match_time?: string | null;
  opponent_name?: string | null;
  status?: string | null;
}

interface NotificationGroup {
  ageCode: string;
  match: SuspendedMatch | null;
  players: any[];
}

const THAI_WEEKDAYS = [
  'วันอาทิตย์',
  'วันจันทร์',
  'วันอังคาร',
  'วันพุธ',
  'วันพฤหัสบดี',
  'วันศุกร์',
  'วันเสาร์',
];

const THAI_MONTHS_SHORT = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
];

function formatMatchday(value?: string | number | null): string {
  if (value == null) return '';
  const match = String(value).match(/\d+/);
  return match?.[0] || String(value).trim();
}

function formatThaiDate(value?: string | null): string {
  if (!value) return '';

  const isoDate = String(value).slice(0, 10);
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return '';
  }

  return `${THAI_WEEKDAYS[date.getUTCDay()]}ที่ ${day} ${THAI_MONTHS_SHORT[month - 1]} ${year + 543}`;
}

function formatSuspensionCause(record: any): string {
  const details = record.suspension_details;
  const type = record.suspension_type as string | null | undefined;

  if (type === 'direct_red') return 'ใบแดงตรง';
  if (type === 'second_yellow') return 'ใบเหลืองที่สอง';
  if (type === 'yellow_red') return 'ใบเหลือง + ใบแดง';

  const threshold = Number(
    record.accumulated_threshold ?? details?.threshold_crossed ?? 0
  );

  if (type === 'accumulated_points' || threshold > 0) {
    const yellowCount = threshold > 0 && threshold % 2 === 0 ? threshold / 2 : null;
    return yellowCount
      ? `คะแนนครบเกณฑ์ ${threshold} คะแนน (${yellowCount} ใบเหลือง)`
      : `คะแนนครบเกณฑ์ ${threshold} คะแนน`;
  }

  return details?.trigger_event || record.suspension_reason || 'ไม่ระบุสาเหตุ';
}

function buildPlayerBlock(index: number, record: any, match: SuspendedMatch | null): string {
  const player = record.player;
  const shirt = player?.shirt_no ? ` #${player.shirt_no}` : '';
  const lines: string[] = [];

  lines.push(`${index}. ${player?.full_name || 'ไม่ทราบชื่อ'}${shirt}`);
  lines.push(`ทีม: ${record.team?.name || '-'}`);
  lines.push(`สาเหตุ: ${formatSuspensionCause(record)}`);

  if (match) {
    const time = match.match_time
      ? String(match.match_time).substring(0, 5)
      : 'ไม่ระบุ';
    lines.push(`คู่แข่งขัน: เวลา ${time} | พบ ${match.opponent_name || 'ไม่ทราบทีม'}`);
  } else {
    lines.push('คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป');
  }

  return lines.join('\n');
}

function buildTitle(match: SuspendedMatch | null, seasonYear: string | number): string {
  if (!match) return `🚫 แจ้งโทษแบน CFYL ${seasonYear}`;

  const matchday = formatMatchday(match.matchday);
  const thaiDate = formatThaiDate(match.match_date);
  const matchdayText = matchday ? `นัดที่ ${matchday}` : '';
  const dateText = thaiDate ? ` ${thaiDate}` : '';

  return `🚫 แจ้งโทษแบน${matchdayText}${dateText}`;
}

function isRemainingBanMatch(match: SuspendedMatch, today: string): boolean {
  const played =
    match.status === 'finished' ||
    (match.match_date != null && match.match_date < today);
  return !played;
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

  const settings = await getDiscordSettings();
  if (!settings || !settings.enabled) {
    return NextResponse.json({ error: 'Discord notification ถูกปิดอยู่ (Disabled)' }, { status: 400 });
  }
  if (!isValidDiscordWebhook(settings.webhook_url)) {
    return NextResponse.json({ error: 'ยังไม่ได้ตั้งค่า Discord Webhook URL ที่ถูกต้อง' }, { status: 400 });
  }

  const { data: season } = await supabaseAdmin
    .from('seasons')
    .select('id, year, name')
    .eq('id', seasonId)
    .single();
  if (!season) {
    return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  }

  let ageGroupQuery = supabaseAdmin
    .from('age_groups')
    .select('id, code, sort_order')
    .eq('season_id', seasonId)
    .order('sort_order', { ascending: true });
  if (ageGroupId !== 'all') ageGroupQuery = ageGroupQuery.eq('id', ageGroupId);
  const { data: ageGroups } = await ageGroupQuery;

  const today = getBangkokToday();
  const allowed = new Set<SuspensionStatusKey>(
    statusFilter === 'all'
      ? SENDABLE
      : ([statusFilter as SuspensionStatusKey].filter((key) => SENDABLE.includes(key)))
  );

  const groups = new Map<string, NotificationGroup>();
  let playerCount = 0;

  for (const ageGroup of ageGroups || []) {
    const { data: suspensions } = await supabaseAdmin
      .from('suspensions')
      .select(
        'player_id, total_points, ban_matches, suspension_type, accumulated_threshold, suspension_reason, suspension_details, player:player_id(full_name, shirt_no), team:team_id(name)'
      )
      .eq('season_id', seasonId)
      .eq('age_group_id', ageGroup.id)
      .order('total_points', { ascending: false });

    for (const record of suspensions || []) {
      const status = getSuspensionStatus(record as any, today);
      if (!allowed.has(status.key)) continue;

      playerCount += 1;
      const allMatches = (record.suspension_details?.suspended_matches || []) as SuspendedMatch[];
      const remainingMatches = allMatches.filter((match) => isRemainingBanMatch(match, today));
      const targetMatches: Array<SuspendedMatch | null> =
        remainingMatches.length > 0 ? remainingMatches : allMatches.length > 0 ? allMatches : [null];

      for (const match of targetMatches) {
        const groupKey = match
          ? `${ageGroup.code}::${formatMatchday(match.matchday)}::${match.match_date || ''}`
          : `${ageGroup.code}::no-next-match`;
        const existing = groups.get(groupKey);
        if (existing) {
          existing.players.push(record);
        } else {
          groups.set(groupKey, {
            ageCode: ageGroup.code,
            match,
            players: [record],
          });
        }
      }
    }
  }

  let messages: string[];
  if (groups.size === 0) {
    messages = [`✅ ไม่มีนักกีฬาติดโทษแบนในรายการที่เลือก (CFYL ${season.year})`];
  } else {
    messages = [];
    for (const group of groups.values()) {
      const title = `${buildTitle(group.match, season.year)}\n\nรุ่น: ${group.ageCode}`;
      const blocks = group.players.map((record, index) =>
        buildPlayerBlock(index + 1, record, group.match)
      );
      messages.push(...packMessages(title, blocks, 8));
    }
  }

  let sent = 0;
  let failed = 0;
  let firstError: string | undefined;
  for (const message of messages) {
    const result = await sendDiscordMessage(settings.webhook_url!, message);
    if (result.ok) sent += 1;
    else {
      failed += 1;
      if (!firstError) firstError = `HTTP ${result.status}: ${result.error || ''}`;
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
      sentCount: playerCount,
      messageParts: messages.length,
      messagesSent: sent,
      failedCount: failed,
      success,
      error: firstError,
    },
  });

  if (!success) {
    return NextResponse.json(
      {
        error: `ส่งบาง message ไม่สำเร็จ (${failed}/${messages.length}): ${firstError || ''}`,
        players: playerCount,
        messagesSent: sent,
        messageParts: messages.length,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    players: playerCount,
    messageParts: messages.length,
    empty: groups.size === 0,
  });
}
