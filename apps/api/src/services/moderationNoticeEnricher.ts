import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  Events,
  Message
} from 'discord.js';
import { db } from '../db.js';
import { discord } from '../discord/client.js';
import { recordModerationPlayerFeedback } from './moderationFeedback.js';

type NoticeCase = {
  id: number;
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
  if (row.recommended_action === 'reminder' || row.recommended_action === 'warning') {
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
  const ruleSection = rule ? `\n\n**What this rule means:**\n${rule}` : '';
  const progression = actionResultText(row);

  return (`<@${row.discord_user_id}> **${actionHeading(row.recommended_action)} — ${row.rule_title}**`+
    `${ruleSection}\n\n${progression}\n\nUse **I understand** to acknowledge this notice, or **Incorrect** if you believe the surrounding conversation changes how the message should be interpreted. Staff can review contested cases. \`${row.public_id}\``)
    .slice(0, 1900);
}

function feedbackButtons(caseId:number) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`moderation:understood:${caseId}`)
      .setLabel('I understand')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`moderation:incorrect:${caseId}`)
      .setLabel('Incorrect')
      .setStyle(ButtonStyle.Secondary)
  )];
}

async function enrichModerationNotice(message: Message) {
  if (!discord.user || message.author.id !== discord.user.id) return;
  const content = String(message.content || '');

  // Only rewrite player-facing live moderation notices. Staff audit posts also contain
  // MOD case IDs, but they do not begin with a member mention and must remain untouched.
  if (!/^<@\d+>\s/.test(content)) return;
  if (!/(?:\*\*Reminder:|\*\*Warning:|automated moderation applied|\*\*Reminder —|\*\*Warning —|\*\*10 Minute Timeout —|\*\*1 Hour Timeout —)/i.test(content)) return;

  const match = content.match(/`(MOD-\d+)`/i);
  if (!match) return;
  const publicId = match[1].toUpperCase();

  const result = await db.query<NoticeCase>(`
    SELECT c.id,c.public_id,c.discord_user_id,c.rule_title,c.recommended_action,c.offense_number,
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

  await message.edit({
    content: expanded || content,
    components: feedbackButtons(row.id),
    allowedMentions: { parse: [], users: [row.discord_user_id] }
  });
}

async function handleModerationFeedbackButton(interaction:ButtonInteraction) {
  const parts=interaction.customId.split(':');
  if (parts[0]!=='moderation' || !['understood','incorrect'].includes(parts[1])) return;
  const caseId=Number(parts[2]);
  if (!Number.isInteger(caseId) || caseId<=0) return;

  await interaction.deferReply({ephemeral:true});
  const feedbackType=parts[1] as 'understood'|'incorrect';
  const result=await recordModerationPlayerFeedback(caseId,interaction.user.id,feedbackType);

  if (!result.ok && result.reason==='not_owner') {
    await interaction.editReply('Only the member named in this moderation notice can use these buttons.');
    return;
  }
  if (!result.ok) {
    await interaction.editReply('That moderation case is no longer available.');
    return;
  }
  if (result.already_recorded) {
    await interaction.editReply(feedbackType==='understood'
      ? 'Your acknowledgement was already recorded.'
      : 'You already marked this moderation notice as incorrect. It remains flagged for staff review.');
    return;
  }

  if (feedbackType==='understood') {
    await interaction.editReply('Acknowledged. This records that you received and understood the moderation notice.');
    return;
  }

  const secondPass=(result as any).reanalysis;
  const recheck = secondPass?.available
    ? ` A second-pass context check was also saved for staff review (${Math.round(Number(secondPass.confidence||0)*100)}% ${secondPass.matched?'match':'no match'}).`
    : '';
  await interaction.editReply(`Your disagreement was recorded and this case is now flagged for staff review.${recheck} The action is not automatically removed; staff can dismiss the case if the original detection was incorrect.`);
}

export function startModerationNoticeEnricher() {
  if (installed) return;
  installed = true;
  discord.on(Events.MessageCreate, message => {
    void enrichModerationNotice(message).catch(error => {
      console.warn('[moderation] unable to enrich live moderation notice', error);
    });
  });
  discord.on(Events.InteractionCreate, interaction => {
    if (!interaction.isButton() || !interaction.customId.startsWith('moderation:')) return;
    void handleModerationFeedbackButton(interaction).catch(async error => {
      console.warn('[moderation] feedback button failed',error);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('Unable to record moderation feedback right now. Staff can still review the case from the dashboard.').catch(()=>undefined);
      } else {
        await interaction.reply({content:'Unable to record moderation feedback right now.',ephemeral:true}).catch(()=>undefined);
      }
    });
  });
  console.log('[moderation] detailed rule notices and player feedback buttons installed');
}
