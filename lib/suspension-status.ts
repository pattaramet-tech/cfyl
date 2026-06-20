/**
 * Suspension status — DERIVED LIVE from suspended-match dates + match status.
 *
 * No DB column, no cron: "today" advances on its own, so a ban naturally moves
 * pending → active → served without re-running recalculate. Suspension records
 * are never mutated/deleted here (history is preserved).
 *
 * A banned match counts as "played/served" when its stored status is 'finished'
 * OR its match_date is already in the past — this guards against the snapshot
 * status inside suspension_details being stale between recalcs.
 */

export type SuspensionStatusKey =
  | 'normal'        // 0 points
  | 'warning'       // has points but not yet banned (สะสมคะแนน / เฝ้าระวัง)
  | 'pending'       // banned, all banned matches still upcoming (ติดโทษแบน)
  | 'active'        // ban in effect today / in progress (ติดโทษแบนวันนี้ / กำลังรับโทษ)
  | 'served'        // all banned matches finished/past (พ้นโทษแบนแล้ว)
  | 'no_next_match'; // banned but no upcoming fixture was found

export interface SuspensionStatusInfo {
  key: SuspensionStatusKey;
  label: string;
  color: string; // tailwind badge classes
  emoji: string;
}

interface MinimalSuspendedMatch {
  match_date?: string | null; // YYYY-MM-DD
  status?: string | null;
}

export interface SuspensionStatusInput {
  total_points: number;
  ban_matches: number;
  suspension_details?: {
    suspended_matches?: MinimalSuspendedMatch[] | null;
  } | null;
}

/** Today's date as YYYY-MM-DD in Thailand time (UTC+7). */
export function getBangkokToday(): string {
  // en-CA locale yields ISO-style YYYY-MM-DD
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

function info(
  key: SuspensionStatusKey,
  emoji: string,
  label: string,
  color: string
): SuspensionStatusInfo {
  return { key, emoji, label, color };
}

export function getSuspensionStatus(
  record: SuspensionStatusInput,
  today: string = getBangkokToday()
): SuspensionStatusInfo {
  const { total_points, ban_matches } = record;

  if (total_points === 0) {
    return info('normal', '🟢', 'ปกติ', 'bg-green-100 text-green-800');
  }
  if (ban_matches === 0) {
    return info('warning', '🟡', 'สะสมคะแนน / เฝ้าระวัง', 'bg-yellow-100 text-yellow-800');
  }

  const matches = record.suspension_details?.suspended_matches ?? [];
  if (matches.length === 0) {
    return info('no_next_match', '⚪', 'ไม่พบโปรแกรมนัดถัดไป', 'bg-gray-100 text-gray-600');
  }

  let done = 0;
  let todayCount = 0;
  for (const m of matches) {
    const date = m.match_date || null;
    const played = m.status === 'finished' || (date != null && date < today);
    if (played) {
      done++;
    } else if (date != null && date === today) {
      todayCount++;
    }
    // else: upcoming (future date or unknown date) — counted implicitly
  }

  if (done === matches.length) {
    return info('served', '✅', 'พ้นโทษแบนแล้ว', 'bg-slate-100 text-slate-600');
  }
  if (todayCount > 0) {
    return info('active', '⛔', 'ติดโทษแบนวันนี้', 'bg-red-200 text-red-900');
  }
  if (done > 0) {
    // some banned matches already played, more remaining → mid-ban
    return info('active', '🔴', 'กำลังรับโทษแบน', 'bg-red-100 text-red-800');
  }
  return info('pending', '🔴', 'ติดโทษแบน', 'bg-red-100 text-red-800');
}
