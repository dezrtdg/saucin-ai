import { db } from '../db.js';

export type BotBehaviorSettings = {
  direct_mentions_enabled: boolean;
  direct_mentions_bypass_channel_mode: boolean;
  direct_mentions_use_reply_context: boolean;
  direct_mentions_use_recent_context: boolean;
  direct_mentions_context_messages: number;
};

const defaults: BotBehaviorSettings = {
  direct_mentions_enabled: true,
  direct_mentions_bypass_channel_mode: true,
  direct_mentions_use_reply_context: true,
  direct_mentions_use_recent_context: true,
  direct_mentions_context_messages: 8
};

let cache: { value: BotBehaviorSettings; expiresAt: number } | null = null;

export async function getBotBehaviorSettings(): Promise<BotBehaviorSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const result = await db.query(`
    SELECT direct_mentions_enabled, direct_mentions_bypass_channel_mode,
           direct_mentions_use_reply_context, direct_mentions_use_recent_context,
           direct_mentions_context_messages
      FROM bot_settings WHERE id=1`);
  const row = result.rows[0] ?? defaults;
  const value: BotBehaviorSettings = {
    direct_mentions_enabled: Boolean(row.direct_mentions_enabled ?? defaults.direct_mentions_enabled),
    direct_mentions_bypass_channel_mode: Boolean(row.direct_mentions_bypass_channel_mode ?? defaults.direct_mentions_bypass_channel_mode),
    direct_mentions_use_reply_context: Boolean(row.direct_mentions_use_reply_context ?? defaults.direct_mentions_use_reply_context),
    direct_mentions_use_recent_context: Boolean(row.direct_mentions_use_recent_context ?? defaults.direct_mentions_use_recent_context),
    direct_mentions_context_messages: Math.max(0, Math.min(25, Number(row.direct_mentions_context_messages ?? defaults.direct_mentions_context_messages)))
  };
  cache = { value, expiresAt: Date.now() + 15_000 };
  return value;
}

export function invalidateBotBehaviorSettingsCache() {
  cache = null;
}
