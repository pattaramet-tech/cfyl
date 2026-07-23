/**
 * Discord Suspension Notification — pure text formatters.
 *
 * Client-safe: no Supabase client, no process.env, no Node-only imports.
 * Kept isolated from lib/suspension-shared.ts (which admin/public pages already
 * depend on) so Discord message formatting can change without rippling into
 * those consumers.
 */

import { parseMatchdayNumber } from './suspension-shared';

const THAI_WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/**
 * Format a 'YYYY-MM-DD' date string as "วัน{weekday}ที่ {day} {month} {พ.ศ.}".
 * Parses the date via Date.UTC (never the local-timezone Date constructor) so the
 * computed weekday can never shift a day depending on the server's timezone.
 */
export function formatThaiDateWithWeekday(dateStr?: string | null): string | null {
  if (!dateStr) return null;
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const weekday = THAI_WEEKDAYS[utcDate.getUTCDay()];
  const monthShort = THAI_MONTHS_SHORT[month - 1];
  const buddhistYear = year + 543;
  return `วัน${weekday}ที่ ${day} ${monthShort} ${buddhistYear}`;
}

/**
 * Build the message title. Falls back through matchday-only / date-only / neither,
 * ending at "CFYL {year}" only when both matchday and date are unavailable.
 */
export function formatDiscordTitle(params: {
  matchday?: string | number | null;
  matchDate?: string | null;
  seasonYear: number | string;
}): string {
  const mdNum = params.matchday != null ? parseMatchdayNumber(params.matchday) : 0;
  const hasMatchday = mdNum > 0;
  const dateLabel = formatThaiDateWithWeekday(params.matchDate);

  if (hasMatchday && dateLabel) return `🚫 แจ้งโทษแบนนัดที่ ${mdNum} ${dateLabel}`;
  if (dateLabel) return `🚫 แจ้งโทษแบน ${dateLabel}`;
  if (hasMatchday) return `🚫 แจ้งโทษแบนนัดที่ ${mdNum}`;
  return `🚫 แจ้งโทษแบน CFYL ${params.seasonYear}`;
}

export interface SuspensionCauseInput {
  suspension_type?: string | null;
  accumulated_threshold?: number | null;
  suspension_reason?: string | null;
  total_points?: number | null;
  suspension_details?: {
    threshold_crossed?: number | null;
    trigger_event?: string | null;
  } | null;
}

/** One suspension record has exactly one suspension_type — never concatenate causes. */
export function formatSuspensionCause(record: SuspensionCauseInput): string {
  switch (record.suspension_type) {
    case 'accumulated_points': {
      const threshold =
        record.accumulated_threshold ??
        record.suspension_details?.threshold_crossed ??
        record.total_points ??
        0;
      return `คะแนนครบเกณฑ์ ${threshold} คะแนน (${threshold / 2} ใบเหลือง)`;
    }
    case 'direct_red':
      return 'ใบแดงตรง';
    case 'second_yellow':
      return 'ใบเหลืองที่สอง';
    case 'yellow_red':
      return 'ใบเหลือง + ใบแดง';
    default:
      // manual / legacy / null
      return (
        record.suspension_details?.trigger_event ||
        record.suspension_reason ||
        'ไม่ระบุสาเหตุ'
      );
  }
}

export interface OpponentMatchInput {
  match_time?: string | null;
  opponent_name?: string | null;
}

export function formatOpponentLine(match?: OpponentMatchInput | null): string {
  if (!match) return 'คู่แข่งขัน: ไม่พบโปรแกรมนัดถัดไป';
  const timeLabel = match.match_time ? `เวลา ${String(match.match_time).substring(0, 5)}` : 'เวลาไม่ระบุ';
  const opponent = match.opponent_name || 'ไม่ทราบทีม';
  return `คู่แข่งขัน: ${timeLabel} | พบ ${opponent}`;
}

export interface NotificationEntry {
  ageCode: string;
  fullName?: string | null;
  shirtNo?: string | number | null;
  teamName?: string | null;
  cause: string;
  opponentLine: string;
}

function formatPlayerLine(entry: NotificationEntry, index: number): string {
  const shirt = entry.shirtNo ? ` #${entry.shirtNo}` : '';
  return [
    `${index}. ${entry.fullName || 'ไม่ทราบชื่อ'}${shirt}`,
    `ทีม: ${entry.teamName || '-'}`,
    `สาเหตุ: ${entry.cause}`,
    entry.opponentLine,
  ].join('\n');
}

/**
 * Build packMessages()-ready blocks for one title group (one matchday + date).
 * "รุ่น: X" is prefixed only when ageCode changes from the previous entry — it is a
 * section header, not a per-player field, so it must never repeat before every player.
 * The player index restarts at 1 every time ageCode changes: each รุ่น section is
 * numbered on its own, never continuing the count from a previous age group.
 */
export function buildPlayerBlocks(entries: NotificationEntry[]): string[] {
  const blocks: string[] = [];
  let lastAgeCode: string | null = null;
  let indexInAgeGroup = 0;
  for (const entry of entries) {
    if (entry.ageCode !== lastAgeCode) {
      indexInAgeGroup = 1;
      lastAgeCode = entry.ageCode;
    } else {
      indexInAgeGroup += 1;
    }
    const line = formatPlayerLine(entry, indexInAgeGroup);
    blocks.push(indexInAgeGroup === 1 ? `รุ่น: ${entry.ageCode}\n${line}` : line);
  }
  return blocks;
}

export interface SuspensionNotificationInput {
  ageCode: string;
  fullName?: string | null;
  shirtNo?: string | number | null;
  teamName?: string | null;
  cause: string;
  match: OpponentMatchInput & {
    matchday?: string | number | null;
    match_date?: string | null;
  } | null;
}

export interface DiscordMessageGroup {
  title: string;
  blocks: string[];
}

/**
 * Group (player, banned-match) entries into one message per exact fixture
 * (matchday + date) — the unit a title can name. Entries with no match at all
 * (match: null) always fall into their own dedicated group, keyed separately from
 * every real fixture, and get the "CFYL {year}" fallback title: they must never be
 * merged into a message whose title names a specific matchday/date.
 */
export function groupSuspensionNotifications(
  entries: SuspensionNotificationInput[],
  seasonYear: number | string
): DiscordMessageGroup[] {
  const groupOrder: string[] = [];
  const groups = new Map<string, SuspensionNotificationInput[]>();
  for (const entry of entries) {
    const mdNum = entry.match?.matchday != null ? parseMatchdayNumber(entry.match.matchday) : 0;
    const key = `${mdNum}::${entry.match?.match_date ?? ''}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)!.push(entry);
  }

  return groupOrder.map((key) => {
    const groupEntries = groups.get(key)!;
    const firstMatch = groupEntries[0].match;
    const title = formatDiscordTitle({
      matchday: firstMatch?.matchday ?? null,
      matchDate: firstMatch?.match_date ?? null,
      seasonYear,
    });
    const notificationEntries: NotificationEntry[] = groupEntries.map((entry) => ({
      ageCode: entry.ageCode,
      fullName: entry.fullName,
      shirtNo: entry.shirtNo,
      teamName: entry.teamName,
      cause: entry.cause,
      opponentLine: formatOpponentLine(entry.match),
    }));
    return { title, blocks: buildPlayerBlocks(notificationEntries) };
  });
}
