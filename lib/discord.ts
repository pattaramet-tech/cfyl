import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export interface NotificationSettings {
  provider: string;
  webhook_url: string | null;
  enabled: boolean;
}

const DISCORD_CONTENT_LIMIT = 2000;

/** Load the Discord notification settings row (server-side only). */
export async function getDiscordSettings(): Promise<NotificationSettings | null> {
  const { data, error } = await supabaseAdmin
    .from('notification_settings')
    .select('provider, webhook_url, enabled')
    .eq('provider', 'discord')
    .maybeSingle();
  if (error) {
    console.error('[DISCORD] settings query error:', error.message);
    return null;
  }
  return (data as NotificationSettings) ?? null;
}

/** Validate a Discord webhook URL shape. */
export function isValidDiscordWebhook(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(url.trim());
}

/** Send a single message to a Discord webhook (server-side fetch). */
export async function sendDiscordMessage(
  webhookUrl: string,
  content: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, DISCORD_CONTENT_LIMIT) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: body.slice(0, 300) || res.statusText };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'fetch failed' };
  }
}

/**
 * Pack player blocks into messages that stay under Discord's content limit.
 * Each message: header (+ Part x/y) followed by up to `maxPerMessage` blocks.
 */
export function packMessages(
  title: string,
  blocks: string[],
  maxPerMessage = 8
): string[] {
  if (blocks.length === 0) return [];
  const groups: string[][] = [];
  for (let i = 0; i < blocks.length; i += maxPerMessage) {
    groups.push(blocks.slice(i, i + maxPerMessage));
  }
  const total = groups.length;
  return groups.map((group, idx) => {
    const header = total > 1 ? `${title}  (Part ${idx + 1}/${total})` : title;
    let msg = `${header}\n\n${group.join('\n\n')}`;
    if (msg.length > DISCORD_CONTENT_LIMIT) {
      msg = msg.slice(0, DISCORD_CONTENT_LIMIT - 1) + '…';
    }
    return msg;
  });
}
