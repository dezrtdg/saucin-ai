import { Events, Message } from 'discord.js';
import { db } from '../db.js';
import { discord } from '../discord/client.js';

type NoticeCase = {
  public_id: string;
  discord_user_id: string;
  rule_title: string;
  recommended_action: string;
  offense_number: number;
  repeat_window_days_used: number | null;
  delete_message_recommended: boolean;
  staff_review_required: boolean;
  rule_body: string | null;
};

let installed = false;

function cleanRuleBody(body: string, title: string) {
  let value = String(body || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/\[(.*?)\]\([^)]+\)/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const lines = value.split('\n');
  if (lines[0]?.trim().toLowerCase() === title.trim().toLowerCase()) {
    value = lines.slice(1).join('\n').trim();
  }

  const max = 720;
  if (value.length <= max) return value;
  const clipped = value.slice(0, max);
  const sentence = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '), clipped.lastIndexOf('\n'));
  return `${(sentence > 420 ? clipped.slice(0, sentence + 1) : clipped).trim()}…`;
}

function nextStepText(offenseNumber: number) {
  if (offenseNumber <= 1) return 'Another violation of this same rule within the repeat window will move to a warning.';
  if (offenseNumber === 2) return 'Another violation of this same rule within the repeat window may result in a 10 minute timeout and removal of the offending message.';
  if (offenseNumber === 3) return 'Another violation of this same rule within the repeat window may result in a 1 hour timeout, message removal, and staff follow-up.';
  return 'Additional violations of this same rule remain at the 1 hour timeout level and are flagged for staff follow-up.';
}

function actionHeading(action: string) {
  if (action === 'reminder') return 'Reminder';
  if (action === 'warning') return 'Warning';
  if (action === 'timeout_10m') return '10 Minute Timeout';
  if (action === 'timeout_1h') return '1 Hour Timeout';
  return 'Moderation Notice';
}

function actionResultText(row: NoticeCase) {
  if (row.recommended_action === 'reminder') {
    return `This is offense #${row.offense_number} for this rule. ${nextStepText(row.offense_number)}`;
  }
  if (row.recommended_action === 'warning') {
    return `This is offense #${row.offense_number} for this rule. ${nextStepText(row.offense_number)}`;
  }
  if (row.recommended_action === 'timeout_10m') {
    return `A 10 minute Discord timeout was applied for this repeat violation${row.delete_message_recommended ? ', and the offending message is subject to removal' : ''}. ${nextStepText(row.offense_number)}`;
  }
  if (row.recommended_action === 'timeout_1h') {
    return `A 1 hour Discord timeout was applied for this repeat violation${row.delete_message_recommended ? ', and the offending message is subject to removal' : ''}.${row.staff_review_required ? ' This escalation level is also flagged for staff follow-up.' : ''}`;
  }
  return nextStepText(row.offense_number);
}

function buildNotice(row: NoticeCase) {
  const rule = row.rule_body ? cleanRuleBody(row.rule_body, row.rule_title) : '';
  const ruleSection = rule
    ? `\n\n**What this rule means:**\n${rule}`
    : '';
  const progression = actionResultText(row);

  return (`<@${row.discord_user_id}> **${actionHeading(row.recommended_action)} — ${row.rule_title}**`+
    `${ruleSection}\n\n${progression}\n\nIf this detection was incorrect, staff can review and dismiss the case so it no longer counts toward escalation. \`${row.public_id}\``)
    .slice(0, 1900);
}

async function enrichModerationNotice(message: Message) {
  if (!discord.user || message.author.id !== discord.user.id) return;
  const content = String(message.content || '');

  // Only rewrite player-facing live moderation notices. Staff audit posts also contain
  // MOD case IDs, but they do not begin with a member mention and must remain untouched.
  if (!/^<@\d+>\s/.test(content)) return;
  if (!/(?:\*\*Reminder:|\*\*Warning:|automated moderation applied)/i.test(content)) return;

  const match = content.match(/`(MOD-\d+)`/i);
  if (!match) return;
  const publicId = match[1].toUpperCase();

  const result = await db.query<NoticeCase>(`
    SELECT c.public_id,c.discord_user_id,c.rule_title,c.recommended_action,c.offense_number,
           c.repeat_window_days_used,c.delete_message_recommended,c.staff_review_required,
           CASE
             WHEN a.status='published' AND a.content_type='discord_rule' THEN a.body
             ELSE NULL
           END AS rule_body
      FROM moderation_cases c
      LEFT JOIN knowledge_articles a ON a.id=c.rule_article_id
     WHERE c.public_id=$1
     LIMIT 1`,[publicId]);

  const row = result.rows[0];
  if (!row) return;
  const expanded = buildNotice(row);
  if (!expanded || expanded === content) return;

  await message.edit({ content: expanded, allowedMentions: { parse: [], users: [row.discord_user_id] } });
}

export function startModerationNoticeEnricher() {
  if (installed) return;
  installed = true;
  discord.on(Events.MessageCreate, message => {
    void enrichModerationNotice(message).catch(error => {
      console.warn('[moderation] unable to enrich live moderation notice', error);
    });
  });
  console.log('[moderation] detailed rule notice enricher installed');
}
