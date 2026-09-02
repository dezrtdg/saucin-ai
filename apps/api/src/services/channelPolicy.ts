import { db } from '../db.js';

export type ChannelMode = 'monitor' | 'questions' | 'issues' | 'suggestions' | 'full' | 'ignored';
export type ChannelPolicy = {
  discord_channel_id: string;
  channel_name: string | null;
  mode: ChannelMode;
  monitor_messages: boolean;
  auto_reply: boolean;
  detect_questions: boolean;
  detect_issues: boolean;
  detect_suggestions: boolean;
};

export async function getChannelPolicy(channelId: string, channelName?: string): Promise<ChannelPolicy> {
  const found = await db.query('SELECT * FROM channel_policies WHERE discord_channel_id = $1', [channelId]);
  if (found.rows[0]) {
    if (channelName && found.rows[0].channel_name !== channelName) {
      const updated = await db.query(
        'UPDATE channel_policies SET channel_name=$1, updated_at=NOW() WHERE discord_channel_id=$2 RETURNING *',
        [channelName, channelId]
      );
      return updated.rows[0];
    }
    return found.rows[0];
  }

  // Safety default: newly discovered channels are ignored until staff explicitly enable them.
  const mode: ChannelMode = 'ignored';
  const autoReply = ['questions', 'issues', 'full'].includes(mode);
  const inserted = await db.query(
    `INSERT INTO channel_policies
      (discord_channel_id, channel_name, mode, monitor_messages, auto_reply)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (discord_channel_id) DO UPDATE SET channel_name = EXCLUDED.channel_name
     RETURNING *`,
    [channelId, channelName ?? null, mode, mode !== 'ignored', autoReply]
  );
  return inserted.rows[0];
}
