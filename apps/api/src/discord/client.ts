import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  GuildBasedChannel,
  GuildTextBasedChannel,
  Message
} from 'discord.js';
import { env } from '../env.js';
import { db } from '../db.js';
import { classifyMessage } from '../services/classifier.js';
import { getChannelPolicy } from '../services/channelPolicy.js';
import { getBotBehaviorSettings } from '../services/botSettings.js';
import {
  deriveKnowledgeGapQuestion,
  generateGroundedReply,
  getAllowedKnowledgeAudiences,
  knowledgeGapReply,
  recordKnowledgeGap,
  searchKnowledge
} from '../services/knowledge.js';
import { addIssueReport, confirmIssueCandidate, findKnownIssue, getIssue, getIssueAutomationSettings, getIssuePublicMessage, processIssueThreadMessage, recordIssueCandidate } from '../services/issues.js';
import {
  addSuggestionSupport,
  getSuggestion,
  getSuggestionAutomationSettings,
  getSuggestionPublicMessage,
  processSuggestionThreadMessage,
  recordSuggestion
} from '../services/suggestions.js';
import { processModerationMessage, recordModerationIngressDiagnostic, type ModerationDetection } from '../services/moderation.js';

export const discord = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

export type DiscordChannelMetadata = {
  id: string;
  name: string;
  type: string;
  parent_name: string | null;
  category_name: string | null;
  is_thread: boolean;
};

function modeAllows(policyMode: string, intent: string) {
  if (policyMode === 'full') return true;
  if (policyMode === 'questions') return intent === 'question';
  if (policyMode === 'issues') return intent === 'issue';
  if (policyMode === 'suggestions') return intent === 'suggestion';
  return false;
}

function knownIssueButtons(issueId: number, threadId?: string | null) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`issue:me-too:${issueId}`).setLabel("I'm having this issue too").setStyle(ButtonStyle.Secondary)
  );
  if (threadId && env.DISCORD_GUILD_ID) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Open issue ticket')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${env.DISCORD_GUILD_ID}/${threadId}`)
    );
  }
  return [row];
}

function candidateButtons(candidateId: number) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`candidate:report:${candidateId}`).setLabel('Report this issue').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`candidate:same:${candidateId}`).setLabel("I'm having this too").setStyle(ButtonStyle.Secondary)
  )];
}

function suggestionConfirmationButtons(suggestionId:number){
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`suggestion:confirm:${suggestionId}`)
      .setLabel('Confirm suggestion')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Primary)
  )];
}

function suggestionButtons(suggestionId:number,threadId?:string|null) {
  const row=new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`suggestion:support:${suggestionId}`).setLabel('I support this idea').setStyle(ButtonStyle.Secondary)
  );
  if(threadId&&env.DISCORD_GUILD_ID){
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Open suggestion discussion')
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${env.DISCORD_GUILD_ID}/${threadId}`)
    );
  }
  return [row];
}

function trimContext(value: string, max = 1200) {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function isDirectMention(message: Message) {
  return Boolean(discord.user && message.mentions.users.has(discord.user.id));
}

function removeBotMention(content: string) {
  if (!discord.user) return content.trim();
  return content
    .replace(new RegExp(`<@!?${discord.user.id}>`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getChannelName(channel: unknown): string | undefined {
  if (!channel || typeof channel !== 'object' || !('name' in channel)) return undefined;
  const name = (channel as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name : undefined;
}

function messageEvidenceText(message:Message){
  const attachmentLines=[...message.attachments.values()].map(attachment=>{
    const label=attachment.name?String(attachment.name):'attachment';
    return `[${label}] ${attachment.url}`;
  });
  return [message.content.trim(),...attachmentLines].filter(Boolean).join('\n').trim();
}

function isConfigurableChannel(channel: GuildBasedChannel) {
  return channel.isTextBased()
    || channel.type === ChannelType.GuildForum
    || channel.type === ChannelType.GuildMedia;
}

function channelTypeLabel(channel: GuildBasedChannel) {
  switch (channel.type) {
    case ChannelType.GuildText: return 'Text';
    case ChannelType.GuildAnnouncement: return 'Announcement';
    case ChannelType.GuildForum: return 'Forum';
    case ChannelType.GuildMedia: return 'Media';
    case ChannelType.PublicThread: return 'Public Thread';
    case ChannelType.PrivateThread: return 'Private Thread';
    case ChannelType.AnnouncementThread: return 'Announcement Thread';
    default: return 'Text-based';
  }
}

function toChannelMetadata(channel: GuildBasedChannel): DiscordChannelMetadata {
  const typed = channel as GuildBasedChannel & {
    parent?: { name?: string; parent?: { name?: string } | null } | null;
    isThread?: () => boolean;
  };
  const isThread = typeof typed.isThread === 'function' ? typed.isThread() : false;
  const parentName = typed.parent?.name ?? null;
  const categoryName = isThread
    ? typed.parent?.parent?.name ?? null
    : typed.parent?.name ?? null;

  return {
    id: channel.id,
    name: getChannelName(channel) ?? channel.id,
    type: channelTypeLabel(channel),
    parent_name: parentName,
    category_name: categoryName,
    is_thread: isThread
  };
}

export function getCachedDiscordChannelMetadata(channelId: string): DiscordChannelMetadata | null {
  if (!env.DISCORD_GUILD_ID || !discord.isReady()) return null;
  const guild = discord.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) return null;
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !isConfigurableChannel(channel)) return null;
  return toChannelMetadata(channel);
}

export async function syncDiscordChannels() {
  if (!env.DISCORD_GUILD_ID || !discord.isReady()) {
    return { ok: false, reason: 'discord_not_ready', discovered: 0, updated: 0 };
  }
  const guild = discord.guilds.cache.get(env.DISCORD_GUILD_ID);
  if (!guild) return { ok: false, reason: 'guild_not_found', discovered: 0, updated: 0 };

  const catalog = new Map<string, GuildBasedChannel>();
  const fetched = await guild.channels.fetch();
  for (const channel of fetched.values()) {
    if (channel && isConfigurableChannel(channel)) catalog.set(channel.id, channel);
  }

  try {
    const activeThreads = await guild.channels.fetchActiveThreads();
    for (const thread of activeThreads.threads.values()) {
      if (isConfigurableChannel(thread)) catalog.set(thread.id, thread);
    }
  } catch (error) {
    console.warn('[discord] unable to fetch active threads during channel sync', error);
  }

  // Re-resolve any already-known IDs that were not returned in the regular guild channel list.
  // This is especially useful for thread IDs that were first discovered from a message.
  const existing = await db.query<{ discord_channel_id: string }>('SELECT discord_channel_id FROM channel_policies');
  for (const row of existing.rows) {
    if (catalog.has(row.discord_channel_id)) continue;
    try {
      const channel = await guild.channels.fetch(row.discord_channel_id);
      if (channel && isConfigurableChannel(channel)) catalog.set(channel.id, channel);
    } catch {
      // Deleted, inaccessible, or archived channels can remain in the policy table without breaking sync.
    }
  }

  // Safety default: channel sync must never begin monitoring a newly discovered channel automatically.
  const mode = 'ignored' as const;
  const defaultAutoReply = false;
  let updated = 0;

  for (const channel of catalog.values()) {
    const metadata = toChannelMetadata(channel);
    await db.query(
      `INSERT INTO channel_policies
        (discord_channel_id, channel_name, mode, monitor_messages, auto_reply)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (discord_channel_id) DO UPDATE SET
         channel_name = EXCLUDED.channel_name,
         updated_at = CASE
           WHEN channel_policies.channel_name IS DISTINCT FROM EXCLUDED.channel_name THEN NOW()
           ELSE channel_policies.updated_at
         END`,
      [metadata.id, metadata.name, mode, mode !== 'ignored', defaultAutoReply]
    );
    updated += 1;
  }

  return { ok: true, discovered: catalog.size, updated };
}

type ExplicitContext = {
  aiInput: string;
  answerInput: string;
  replyMessageId: string | null;
  contextMessageIds: string[];
};

async function buildExplicitContext(message: Message): Promise<ExplicitContext> {
  const settings = await getBotBehaviorSettings();
  const request = removeBotMention(message.content) || 'Please verify or clarify the situation being discussed.';
  const sections: string[] = [`CURRENT REQUEST:\n${trimContext(request, 1800)}`];
  const contextMessageIds: string[] = [];
  let replyMessageId: string | null = null;

  const channel = message.channel as GuildTextBasedChannel;
  const seen = new Set<string>();

  if (settings.direct_mentions_use_reply_context && message.reference?.messageId) {
    try {
      const replied = await channel.messages.fetch(message.reference.messageId);
      const repliedText = trimContext(replied.content, 1800);
      if (repliedText) {
        replyMessageId = replied.id;
        seen.add(replied.id);
        sections.push(`REPLIED-TO MESSAGE (${replied.author.username}):\n${repliedText}`);
      }
    } catch (error) {
      console.warn('[discord] unable to fetch replied-to context', error);
    }
  }

  if (settings.direct_mentions_use_recent_context && settings.direct_mentions_context_messages > 0) {
    try {
      const limit = Math.min(50, Math.max(settings.direct_mentions_context_messages + 8, 12));
      const fetchedMessages = await channel.messages.fetch({ limit, before: message.id });
      const recent = [...fetchedMessages.values()]
        .filter(item => !item.author.bot && item.content.trim() && !seen.has(item.id))
        .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
        .slice(-settings.direct_mentions_context_messages);

      if (recent.length) {
        for (const item of recent) contextMessageIds.push(item.id);
        const mostRecent = recent[recent.length - 1];
        sections.push(`MOST RECENT MESSAGE (${mostRecent.author.username}):\n${trimContext(mostRecent.content, 1400)}`);
        const earlier = recent.slice(0, -1);
        if (earlier.length) {
          sections.push(`EARLIER CONTEXT (oldest to newest):\n${earlier.map(item => `${item.author.username}: ${trimContext(item.content, 700)}`).join('\n')}`);
        }
      }
    } catch (error) {
      console.warn('[discord] unable to fetch recent conversation context', error);
    }
  }

  const aiInput = sections.join('\n\n').slice(0, 12_000);
  return {
    aiInput,
    answerInput: aiInput,
    replyMessageId,
    contextMessageIds
  };
}

export async function recoverDiscordConversationContext(channelId: string, messageId: string): Promise<string | null> {
  if (!discord.isReady()) return null;
  try {
    const channel = await discord.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return null;
    const message = await channel.messages.fetch(messageId);
    const context = await buildExplicitContext(message);
    return context.aiInput || null;
  } catch (error) {
    console.warn('[discord] unable to recover conversation context', error);
    return null;
  }
}

async function storeMessage(message: Message, context?: ExplicitContext) {
  const inserted = await db.query(
    `INSERT INTO discord_messages
      (guild_id, channel_id, channel_name, message_id, author_id, author_name, content, is_bot, discord_created_at, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (message_id) DO UPDATE SET content = EXCLUDED.content, channel_name = EXCLUDED.channel_name
     RETURNING id`,
    [
      message.guildId,
      message.channelId,
      getChannelName(message.channel) ?? null,
      message.id,
      message.author.id,
      message.author.username,
      message.content,
      message.author.bot,
      message.createdAt,
      JSON.stringify({
        attachments: [...message.attachments.values()].map(a => ({ name: a.name, url: a.url })),
        direct_mention: isDirectMention(message),
        replied_to_message_id: context?.replyMessageId ?? null,
        context_message_ids: context?.contextMessageIds ?? []
      })
    ]
  );
  return Number(inserted.rows[0].id);
}


export async function getIssueIdForDiscordThread(channelId: string): Promise<number | null> {
  const result = await db.query('SELECT id FROM issues WHERE discord_thread_id=$1 LIMIT 1', [channelId]);
  return result.rowCount ? Number(result.rows[0].id) : null;
}

export async function getSuggestionIdForDiscordThread(channelId:string):Promise<number|null>{
  const result=await db.query(`
    SELECT suggestion_id AS id
      FROM suggestion_discord_thread_links
     WHERE thread_id=$1
    UNION ALL
    SELECT id
      FROM suggestions
     WHERE discord_thread_id=$1
       AND NOT EXISTS (SELECT 1 FROM suggestion_discord_thread_links WHERE thread_id=$1)
    LIMIT 1`,[channelId]);
  return result.rowCount?Number(result.rows[0].id):null;
}

function suggestionThreadName(suggestion:any){
  const id=suggestion.public_id||`SUG-${suggestion.id}`;
  const status=String(suggestion.status||'candidate').replaceAll('_',' ');
  return `[${status}] ${id} · ${suggestion.title}`.slice(0,100);
}

function issueThreadPrompt(issue: any) {
  return `Use this ticket to add anything that may help staff investigate **${issue.public_id || `BUG-${issue.id}`}**.\n\nUseful details include:\n• what you were doing when it happened\n• where it happened\n• the exact error/message you saw\n• whether it happens every time\n• anything that temporarily worked around it\n\nSaucin AI will organize player-provided details for staff. Community workarounds are kept separate until staff verifies them.`;
}

export async function ensureIssueDiscordThread(issueId: number) {
  const issue = await getIssue(issueId);
  if (!issue || !discord.isReady()) return null;
  if (issue.discord_thread_id) return issue.discord_thread_id as string;
  const settings = await getIssueAutomationSettings();
  if (!settings.auto_create_threads || !settings.intake_channel_id) return null;

  const channel = await discord.channels.fetch(settings.intake_channel_id).catch(() => null);
  if (!channel) throw new Error('Configured Discord bug intake channel could not be found.');
  const content = await getIssuePublicMessage(issue);
  const name = `${issue.public_id || `BUG-${issue.id}`} • ${issue.title}`.slice(0,100);
  let thread: any = null;
  let statusChannelId: string | null = null;
  let statusMessageId: string | null = null;

  if (channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia) {
    thread = await (channel as any).threads.create({
      name,
      message: { content, components: knownIssueButtons(issueId) },
      reason: `Saucin AI issue ticket ${issue.public_id || issue.id}`
    });
    const starter = await thread.fetchStarterMessage().catch(() => null);
    statusChannelId = thread.id;
    statusMessageId = starter?.id || null;
  } else if (channel.isTextBased() && !channel.isDMBased() && !(channel as any).isThread?.()) {
    const statusMessage = await (channel as any).send({ content, components: knownIssueButtons(issueId) });
    thread = await statusMessage.startThread({
      name,
      autoArchiveDuration: 1440,
      reason: `Saucin AI issue ticket ${issue.public_id || issue.id}`
    });
    statusChannelId = channel.id;
    statusMessageId = statusMessage.id;
  } else {
    throw new Error('Bug intake must be a Discord Forum, Media, or text channel.');
  }

  await db.query(
    `UPDATE issues SET discord_thread_id=$1,discord_status_channel_id=$2,discord_status_message_id=$3,updated_at=NOW() WHERE id=$4`,
    [thread.id,statusChannelId,statusMessageId,issueId]
  );
  await thread.send({ content: issueThreadPrompt(issue), allowedMentions: { parse: [] } }).catch(() => null);
  await syncIssueDiscordPost(issueId).catch(() => null);
  return String(thread.id);
}

export async function syncIssueDiscordPost(issueId: number) {
  const issue = await getIssue(issueId);
  if (!issue || !discord.isReady() || !issue.discord_status_channel_id || !issue.discord_status_message_id) return false;
  const settings = await getIssueAutomationSettings();
  if (!settings.edit_original_status_message) return false;
  const channel = await discord.channels.fetch(String(issue.discord_status_channel_id)).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return false;
  const message = await channel.messages.fetch(String(issue.discord_status_message_id)).catch(() => null);
  if (!message) return false;
  await message.edit({
    content: await getIssuePublicMessage(issue),
    components: knownIssueButtons(issueId, issue.discord_thread_id || null),
    allowedMentions: { parse: [] }
  });
  return true;
}

export async function postIssueStatusUpdate(issueId: number, fromStatus: string, toStatus: string) {
  const issue = await getIssue(issueId);
  if (!issue?.discord_thread_id || !discord.isReady()) return false;
  const settings = await getIssueAutomationSettings();
  if (!settings.post_status_updates_to_thread) return false;
  const channel = await discord.channels.fetch(String(issue.discord_thread_id)).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased()) return false;
  await (channel as any).send({
    content: `**Status updated:** ${fromStatus.replaceAll('_',' ')} → **${toStatus.replaceAll('_',' ')}**\n\n${await getIssuePublicMessage(issue)}`,
    allowedMentions: { parse: [] }
  });
  return true;
}

export async function ensureSuggestionDiscordThread(suggestionId:number,originThreadId?:string|null){
  const suggestion=await getSuggestion(suggestionId);
  if(!suggestion||!discord.isReady()) return null;
  if(suggestion.discord_thread_id){
    if(originThreadId&&originThreadId!==String(suggestion.discord_thread_id)){
      await db.query(`
        INSERT INTO suggestion_discord_thread_links (thread_id,suggestion_id,link_type)
        VALUES ($1,$2,'source')
        ON CONFLICT (thread_id) DO UPDATE SET suggestion_id=EXCLUDED.suggestion_id`,[originThreadId,suggestionId]);
    }
    return String(suggestion.discord_thread_id);
  }
  const settings=await getSuggestionAutomationSettings();
  if(!settings.auto_create_forum_posts||!settings.forum_channel_id) return null;

  let thread:any=null;
  let statusMessage:any=null;
  if(originThreadId){
    const origin=await discord.channels.fetch(originThreadId).catch(()=>null);
    const parentId=origin&&'parentId' in origin?String((origin as any).parentId||''):'';
    if(origin&&(origin as any).isThread?.()&&parentId===settings.forum_channel_id){
      thread=origin;
      statusMessage=await (thread as any).send({
        content:await getSuggestionPublicMessage(suggestion),
        components:suggestionButtons(suggestionId,thread.id),
        allowedMentions:{parse:[]}
      });
    }
  }

  if(!thread){
    const forum=await discord.channels.fetch(settings.forum_channel_id).catch(()=>null);
    if(!forum) throw new Error('Configured Discord suggestions forum could not be found.');
    if(forum.type!==ChannelType.GuildForum&&forum.type!==ChannelType.GuildMedia){
      throw new Error('The configured suggestions destination must be a Discord Forum or Media channel.');
    }
    thread=await (forum as any).threads.create({
      name:suggestionThreadName(suggestion),
      message:{
        content:await getSuggestionPublicMessage(suggestion),
        components:suggestionButtons(suggestionId)
      },
      reason:`Saucin AI suggestion ${suggestion.public_id||suggestion.id}`
    });
    statusMessage=await thread.fetchStarterMessage().catch(()=>null);
  }

  if(!thread||!statusMessage) throw new Error('Discord created the suggestion discussion but its status message could not be found.');
  await db.query(`
    UPDATE suggestions
       SET discord_thread_id=$1,discord_status_channel_id=$2,discord_status_message_id=$3,updated_at=NOW()
     WHERE id=$4`,[String(thread.id),String(thread.id),String(statusMessage.id),suggestionId]);
  await db.query(`
    INSERT INTO suggestion_discord_thread_links (thread_id,suggestion_id,link_type)
    VALUES ($1,$2,'primary')
    ON CONFLICT (thread_id) DO UPDATE
    SET suggestion_id=EXCLUDED.suggestion_id,link_type='primary'`,[String(thread.id),suggestionId]);
  await syncSuggestionDiscordPost(suggestionId).catch(()=>false);
  return String(thread.id);
}

export async function syncSuggestionDiscordPost(suggestionId:number){
  const suggestion=await getSuggestion(suggestionId);
  if(!suggestion||!discord.isReady()||!suggestion.discord_status_channel_id||!suggestion.discord_status_message_id) return false;
  const settings=await getSuggestionAutomationSettings();
  const channel=await discord.channels.fetch(String(suggestion.discord_status_channel_id)).catch(()=>null);
  if(!channel||!channel.isTextBased()||channel.isDMBased()) return false;
  if(settings.edit_original_status_message){
    const message=await channel.messages.fetch(String(suggestion.discord_status_message_id)).catch(()=>null);
    if(message){
      await message.edit({
        content:await getSuggestionPublicMessage(suggestion),
        components:suggestionButtons(suggestionId,suggestion.discord_thread_id||null),
        allowedMentions:{parse:[]}
      });
    }
  }
  if((channel as any).isThread?.()&&typeof (channel as any).setName==='function'){
    await (channel as any).setName(suggestionThreadName(suggestion),`Saucin AI synchronized ${suggestion.public_id||suggestion.id}`).catch(()=>null);
  }
  return true;
}

export async function postSuggestionStatusUpdate(suggestionId:number,fromStatus:string,toStatus:string){
  const suggestion=await getSuggestion(suggestionId);
  if(!suggestion?.discord_thread_id||!discord.isReady()) return false;
  const settings=await getSuggestionAutomationSettings();
  if(!settings.post_status_updates_to_thread) return false;
  const channel=await discord.channels.fetch(String(suggestion.discord_thread_id)).catch(()=>null);
  if(!channel||!channel.isTextBased()||channel.isDMBased()) return false;
  await (channel as any).send({
    content:`**Suggestion status updated:** ${fromStatus.replaceAll('_',' ')} → **${toStatus.replaceAll('_',' ')}**\n\n${await getSuggestionPublicMessage(suggestion)}`,
    components:suggestionButtons(suggestionId,suggestion.discord_thread_id),
    allowedMentions:{parse:[]}
  });
  await syncSuggestionDiscordPost(suggestionId).catch(()=>false);
  return true;
}


async function postModerationAudit(detection: ModerationDetection, message: Message) {
  if (!detection.post_to_audit || !detection.audit_channel_id || !discord.isReady()) return;
  try {
    const channel = await discord.channels.fetch(detection.audit_channel_id);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return;
    const link = message.guildId ? `https://discord.com/channels/${message.guildId}/${message.channelId}/${message.id}` : '';
    const confidence = `${Math.round(detection.confidence * 100)}%`;
    await (channel as any).send({
      content: `**${detection.public_id} · Observe-only moderation detection**\n**Member:** ${message.author.username} (${message.author.id})\n**Rule:** ${detection.rule_title}\n**Confidence:** ${confidence}\n**Escalation:** offense #${detection.offense_number} (${detection.prior_confirmed_count} prior confirmed in ${detection.repeat_window_days_used} days)\n**Would recommend:** ${detection.recommended_action.replaceAll('_',' ')}${detection.delete_message_recommended?' + delete message':''}\n**Why:** ${detection.reason}\n${detection.evidence ? `**Evidence:** ${detection.evidence}\n` : ''}${link ? `**Message:** ${link}` : ''}`.slice(0,1900),
      allowedMentions: { parse: [] }
    });
  } catch (error) {
    console.warn('[moderation] unable to post observe detection to audit channel', error);
  }
}

async function handleMessage(message: Message) {
  if (!message.guildId || message.author.bot) return;
  const evidenceText=messageEvidenceText(message);
  if(!evidenceText) return;
  if (env.DISCORD_GUILD_ID && message.guildId !== env.DISCORD_GUILD_ID) return;

  // Issue ticket threads are managed independently from normal channel policies. They may remain
  // Ignored on the Channels page while still collecting player-provided evidence for the linked bug.
  const linkedIssueId = await getIssueIdForDiscordThread(message.channelId);
  if (linkedIssueId) {
    void recordModerationIngressDiagnostic({
      resultCode:'skipped_issue_thread',guildId:message.guildId,channelId:message.channelId,
      channelName:getChannelName(message.channel)||null,discordMessageId:message.id,discordUserId:message.author.id,
      authorName:message.author.username,content:message.content,details:{linked_issue_id:linkedIssueId}
    });
    const storedId = await storeMessage(message);
    await addIssueReport(linkedIssueId, storedId, message.author.id, message.content, 'issue_thread').catch(() => false);
    await processIssueThreadMessage({
      issueId: linkedIssueId,
      discordMessageDbId: storedId,
      discordUserId: message.author.id,
      authorName: message.author.username,
      content: message.content
    }).catch(error => console.error('[issues] failed to process issue-ticket message', error));
    await syncIssueDiscordPost(linkedIssueId).catch(() => null);
    return;
  }

  // Suggestion forum discussions remain linked even when their thread channel is
  // ignored in normal channel policies. Replies and attachments enrich only the
  // matching suggestion and never become verified promises.
  const linkedSuggestionId=await getSuggestionIdForDiscordThread(message.channelId);
  if(linkedSuggestionId){
    const storedId=await storeMessage(message);
    await processSuggestionThreadMessage({
      suggestionId:linkedSuggestionId,
      discordMessageDbId:storedId,
      discordUserId:message.author.id,
      authorName:message.author.username,
      content:evidenceText
    }).catch(error=>console.error('[suggestions] failed to process forum reply',error));
    await syncSuggestionDiscordPost(linkedSuggestionId).catch(()=>false);
    return;
  }

  // A player-created post inside the configured suggestions forum is itself an
  // explicit suggestion submission. It does not depend on the thread inheriting
  // a normal channel policy, which prevents newly-created forum posts from being
  // ignored before the next channel sync.
  const suggestionSettings=await getSuggestionAutomationSettings().catch(()=>null);
  const parentId=(message.channel as any).isThread?.()?String((message.channel as any).parentId||''):'';
  if(suggestionSettings?.forum_channel_id&&parentId===suggestionSettings.forum_channel_id){
    const storedId=await storeMessage(message);
    const recorded=await recordSuggestion({
      text:evidenceText,
      title:getChannelName(message.channel)||message.content,
      discordUserId:message.author.id,
      channelId:message.channelId,
      discordMessageId:storedId,
      source:'suggestion_forum_submission'
    });
    const suggestion=recorded.suggestion;
    if(suggestion){
      const threadId=await ensureSuggestionDiscordThread(Number(suggestion.id),message.channelId)
        .catch(error=>{console.warn('[suggestions] unable to link forum submission',error);return null;});
      const primary=await getSuggestion(Number(suggestion.id))||suggestion;
      if(threadId&&threadId!==message.channelId){
        await (message.channel as any).send({
          content:`This idea matches **${primary.public_id||`SUG-${primary.id}`} · ${primary.title}**. Your support and this discussion are linked to the existing suggestion.`,
          components:suggestionButtons(Number(primary.id),threadId),
          allowedMentions:{parse:[]}
        }).catch(()=>null);
      }
      await syncSuggestionDiscordPost(Number(primary.id)).catch(()=>false);
    }
    return;
  }

  const directMention = isDirectMention(message);
  const botSettings = await getBotBehaviorSettings();
  const channelName = getChannelName(message.channel);
  const policy = await getChannelPolicy(message.channelId, channelName);

  // Ignored channels remain hard-disabled even for mentions. Other channel modes can be bypassed by an explicit mention.
  if (policy.mode === 'ignored') {
    void recordModerationIngressDiagnostic({
      resultCode:'skipped_channel_ignored',guildId:message.guildId,channelId:message.channelId,channelName:channelName||null,
      discordMessageId:message.id,discordUserId:message.author.id,authorName:message.author.username,content:message.content,
      details:{channel_mode:policy.mode,monitor_messages:policy.monitor_messages}
    });
    return;
  }
  const mentionOverride = directMention && botSettings.direct_mentions_enabled && botSettings.direct_mentions_bypass_channel_mode;
  if (!policy.monitor_messages && !mentionOverride) {
    void recordModerationIngressDiagnostic({
      resultCode:'skipped_channel_not_monitored',guildId:message.guildId,channelId:message.channelId,channelName:channelName||null,
      discordMessageId:message.id,discordUserId:message.author.id,authorName:message.author.username,content:message.content,
      details:{channel_mode:policy.mode,monitor_messages:policy.monitor_messages,direct_mention:directMention,mention_override:mentionOverride}
    });
    return;
  }

  const explicitContext = directMention && botSettings.direct_mentions_enabled
    ? await buildExplicitContext(message)
    : undefined;
  const classificationInput = explicitContext?.aiInput ?? message.content;

  const storedId = await storeMessage(message, explicitContext);
  // Moderation runs independently of support replies and may enforce according to the current live-mode configuration.
  if (policy.monitor_messages) {
    const memberRoleIds = message.member ? [...message.member.roles.cache.keys()] : [];
    void processModerationMessage({
      storedMessageId: storedId,
      guildId: message.guildId,
      channelId: message.channelId,
      channelName: channelName || null,
      discordMessageId: message.id,
      discordUserId: message.author.id,
      authorName: message.author.username,
      content: message.content,
      memberRoleIds
    }).then(detection => detection ? postModerationAudit(detection, message) : undefined)
      .catch(error => console.error('[moderation] processing failed', error));
  } else {
    void recordModerationIngressDiagnostic({
      resultCode:'skipped_channel_not_monitored',guildId:message.guildId,channelId:message.channelId,channelName:channelName||null,
      discordMessageId:message.id,discordUserId:message.author.id,authorName:message.author.username,content:message.content,
      details:{channel_mode:policy.mode,monitor_messages:false,direct_mention:directMention,mention_override:mentionOverride,support_reply_may_continue:true}
    });
  }
  const classification = await classifyMessage(classificationInput);
  const effectiveIntent = directMention && botSettings.direct_mentions_enabled && !['issue', 'suggestion'].includes(classification.intent)
    ? 'question'
    : classification.intent;

  let responseText: string | null = null;
  let matchedSources: unknown[] = [];
  let responseComponents: ActionRowBuilder<ButtonBuilder>[] = [];

  const issueReplyAllowed = policy.auto_reply && modeAllows(policy.mode, 'issue');
  if (effectiveIntent === 'issue' && policy.detect_issues) {
    const issue = await findKnownIssue({
      original: classificationInput,
      normalizedQuestion: classification.normalizedQuestion,
      topic: classification.topic,
      searchTerms: classification.searchTerms,
      relatedTopics: classification.relatedTopics
    });
    if (issue) {
      const added = await addIssueReport(issue.id, storedId, message.author.id, message.content);
      matchedSources = [{
        type: 'issue', id: issue.public_id ?? issue.id, title: issue.title, status: issue.status,
        score: Number(issue.score.toFixed(4)), matchTypes: issue.match_types
      }];
      if (issueReplyAllowed || mentionOverride) {
        await ensureIssueDiscordThread(issue.id).catch(error => console.warn('[issues] unable to create Discord issue ticket', error));
        const currentIssue = await getIssue(issue.id);
        const counted = added ? `\n\nI added your report to the affected-player count.` : '';
        responseText = `${await getIssuePublicMessage(currentIssue || issue)}${counted}`;
        responseComponents = knownIssueButtons(issue.id, currentIssue?.discord_thread_id || null);
        await syncIssueDiscordPost(issue.id).catch(() => null);
      }
    } else {
      const candidate = await recordIssueCandidate({
        text: message.content,
        normalizedText: classification.normalizedQuestion,
        topic: classification.topic,
        relatedTerms: [...classification.searchTerms, ...classification.relatedTopics],
        discordUserId: message.author.id,
        channelId: message.channelId,
        discordMessageId: storedId
      });
      matchedSources = [{ type: 'issue_candidate', id: candidate.id, status: candidate.status, occurrences: candidate.occurrence_count }];
      if (issueReplyAllowed || mentionOverride) {
        responseText = `I don't see an existing known issue that clearly matches this yet. I logged it as a possible new issue for staff to review instead of guessing. If you want staff to track it as a report, use the button below.`;
        responseComponents = candidateButtons(Number(candidate.id));
      }
    }
  }

  const suggestionReplyAllowed = modeAllows(policy.mode,'suggestion') && (policy.auto_reply || policy.mode === 'suggestions');
  if (!responseText && effectiveIntent === 'suggestion' && policy.detect_suggestions) {
    const recorded = await recordSuggestion({
      text: message.content,
      normalizedText: classification.normalizedQuestion,
      title: classification.normalizedQuestion,
      topic: classification.topic,
      relatedTerms: [...classification.searchTerms,...classification.relatedTopics],
      discordUserId: message.author.id,
      channelId: message.channelId,
      discordMessageId: storedId
    });
    let suggestion = recorded.suggestion;
    if (suggestion) {
      suggestion=await getSuggestion(Number(suggestion.id))||suggestion;
      if(suggestion.discord_thread_id){
        await syncSuggestionDiscordPost(Number(suggestion.id)).catch(()=>false);
      }
      matchedSources = [{
        type:'suggestion',id:suggestion.public_id||suggestion.id,title:suggestion.title,status:suggestion.status,
        supporters:Number(suggestion.unique_supporters||suggestion.mention_count||0),
        match:recorded.match,discord_thread_id:suggestion.discord_thread_id||null,
        awaiting_confirmation:!suggestion.discord_thread_id
      }];
      if (suggestionReplyAllowed || mentionOverride) {
        const publicId=suggestion.public_id||`SUG-${String(suggestion.id).padStart(4,'0')}`;
        const status=String(suggestion.status||'candidate').replaceAll('_',' ');
        if(!suggestion.discord_thread_id){
          responseText=`Okay, this one might have some sauce 👀\n\n**${publicId} · ${suggestion.title}**\n\nDid I understand the idea correctly? Confirm it below and I’ll put it on the suggestion board so everyone can add details, examples, and links.`;
          responseComponents=suggestionConfirmationButtons(Number(suggestion.id));
        }else if (recorded.supporterAdded) {
          responseText=`This idea is already cooking 🌶️\n\nYour support was added to **${publicId} · ${suggestion.title}**. Current status: **${status}**.`;
          responseComponents=suggestionButtons(Number(suggestion.id),suggestion.discord_thread_id);
        } else {
          responseText=`You’re already backing **${publicId} · ${suggestion.title}**. Current status: **${status}**.`;
          responseComponents=suggestionButtons(Number(suggestion.id),suggestion.discord_thread_id);
        }
      }
    }
  }

  const normalQuestionReplyAllowed = policy.detect_questions && policy.auto_reply && modeAllows(policy.mode, 'question');
  const explicitQuestionReplyAllowed = directMention && botSettings.direct_mentions_enabled && (
    botSettings.direct_mentions_bypass_channel_mode || normalQuestionReplyAllowed
  );

  if (!responseText && effectiveIntent === 'question' && (normalQuestionReplyAllowed || explicitQuestionReplyAllowed)) {
    const roleIds = message.member ? [...message.member.roles.cache.keys()] : [];
    const allowedAudiences = await getAllowedKnowledgeAudiences(roleIds);
    const hits = await searchKnowledge({
      original: classificationInput,
      normalizedQuestion: classification.normalizedQuestion,
      topic: classification.topic,
      searchTerms: classification.searchTerms,
      relatedTopics: classification.relatedTopics
    }, allowedAudiences, 8);

    matchedSources = hits.map(h => ({
      type: 'knowledge',
      id: h.id,
      title: h.title,
      score: Number(h.score.toFixed(4)),
      matchTypes: h.match_types,
      audiences: h.audiences
    }));

    const groundedReply = await generateGroundedReply(explicitContext?.answerInput ?? message.content, hits);
    responseText = groundedReply?.text ?? null;

    if (!responseText || groundedReply?.coverage === 'partial') {
      const gapQuestion = await deriveKnowledgeGapQuestion({
        currentRequest: removeBotMention(message.content) || message.content,
        conversationContext: explicitContext?.aiInput ?? classificationInput,
        partialAnswer: groundedReply?.text ?? null,
        topic: classification.topic,
        matchedSources,
        fallback: classification.normalizedQuestion
      });
      await recordKnowledgeGap({
        question: message.content,
        displayQuestion: gapQuestion,
        normalizedQuestion: gapQuestion,
        topic: classification.topic,
        discordUserId: message.author.id,
        channelId: message.channelId,
        discordMessageId: storedId,
        conversationContext: explicitContext?.aiInput ?? classificationInput,
        partialAnswer: groundedReply?.text ?? null,
        matchedSources
      }).catch(error => console.error('[knowledge] failed to record gap', error));
    }
    if (!responseText) responseText = knowledgeGapReply(hits);
  }

  await db.query(
    `INSERT INTO ai_activity
      (discord_message_id, intent, confidence, should_respond, rationale, matched_sources, response_text, model_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      storedId,
      effectiveIntent,
      classification.confidence,
      Boolean(responseText) || explicitQuestionReplyAllowed,
      directMention ? `Direct bot mention. ${classification.rationale}` : classification.rationale,
      JSON.stringify(matchedSources),
      responseText,
      env.AI_CLASSIFIER_MODEL
    ]
  );

  if (responseText) {
    await message.reply({ content: responseText, components: responseComponents, allowedMentions: { parse: [], repliedUser: false } });
  }
}

export async function startDiscord() {
  if (!env.DISCORD_TOKEN) {
    console.warn('[discord] DISCORD_TOKEN is empty; Discord monitoring is disabled.');
    return;
  }
  discord.once(Events.ClientReady, (client) => {
    console.log(`[discord] logged in as ${client.user.tag}`);
    syncDiscordChannels()
      .then(result => console.log(`[discord] channel sync complete: ${result.discovered} discovered`))
      .catch(error => console.error('[discord] initial channel sync failed', error));
  });
  discord.on(Events.MessageCreate, (message) => {
    handleMessage(message).catch((error) => console.error('[discord] message handler failed', error));
  });
  discord.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isButton()) return;
    const parts = interaction.customId.split(':');
    const id = Number(parts[2]);
    if (!Number.isInteger(id) || id <= 0) return;

    if (parts[0] === 'issue' && parts[1] === 'me-too') {
      void (async () => {
        const issue = await getIssue(id);
        if (!issue) return interaction.reply({ content: 'That issue is no longer available.', ephemeral: true });
        const added = await addIssueReport(id, null, interaction.user.id, 'Confirmed via Discord issue button.', 'discord_button');
        await syncIssueDiscordPost(id).catch(() => null);
        return interaction.reply({
          content: added
            ? `Thanks — you were added to **${issue.public_id || `BUG-${id}`}**. Current status: **${String(issue.status).replaceAll('_', ' ')}**.`
            : `You're already counted on **${issue.public_id || `BUG-${id}`}**.`,
          ephemeral: true
        });
      })().catch(error => console.error('[discord] issue button failed', error));
      return;
    }

    if (parts[0] === 'candidate' && (parts[1] === 'report' || parts[1] === 'same')) {
      void (async () => {
        const result = await confirmIssueCandidate(id, interaction.user.id, parts[1]);
        if (!result.candidate) return interaction.reply({ content: 'That possible issue is no longer available.', ephemeral: true });
        return interaction.reply({
          content: result.inserted
            ? 'Thanks — staff can now see your confirmation on this possible issue.'
            : 'Your confirmation was already recorded for this possible issue.',
          ephemeral: true
        });
      })().catch(error => console.error('[discord] candidate button failed', error));
      return;
    }

    if(parts[0]==='suggestion'&&parts[1]==='confirm'){
      void (async()=>{
        const suggestion=await getSuggestion(id);
        if(!suggestion) return interaction.reply({content:'That suggestion is no longer available.',ephemeral:true});
        await interaction.deferUpdate();
        let creationError:unknown=null;
        const threadId=await ensureSuggestionDiscordThread(id).catch(error=>{
          creationError=error;
          console.warn('[suggestions] confirmation could not create forum discussion',error);
          return null;
        });
        const current=await getSuggestion(id)||suggestion;
        const publicId=current.public_id||`SUG-${id}`;
        if(!threadId){
          const settings=await getSuggestionAutomationSettings().catch(()=>null);
          const missingConfiguration=!settings?.auto_create_forum_posts||!settings?.forum_channel_id;
          const content=missingConfiguration
            ? `I saved **${publicId} · ${current.title}**, but the suggestion board isn’t set up yet. Staff can choose a Discord Forum or Media channel in **Settings → Suggestions**, then try again.`
            : `I saved **${publicId} · ${current.title}**, but Discord wouldn’t let me post it to the suggestion board yet. Staff should check my forum permissions, then try again. I need **View Channel**, **Send Messages**, **Send Messages in Threads**, **Create Public Threads**, and **Manage Threads**.`;
          if(creationError) console.warn('[suggestions] forum creation needs staff attention',creationError);
          return interaction.editReply({
            content,
            components:suggestionConfirmationButtons(id),
            allowedMentions:{parse:[]}
          });
        }
        await db.query(`
          INSERT INTO suggestion_updates (suggestion_id,update_type,note,created_by)
          VALUES ($1,'confirmed','Confirmed from the Discord suggestion prompt.',$2)`,[id,interaction.user.id]).catch(()=>null);
        return interaction.editReply({
          content:`Now we’re cooking 🌶️\n\n**${publicId} · ${current.title}** is live on the suggestion board. Open the discussion to add details, examples, links, or anything else that helps build out the idea.`,
          components:suggestionButtons(id,threadId),
          allowedMentions:{parse:[]}
        });
      })().catch(error=>console.error('[discord] suggestion confirmation button failed',error));
      return;
    }

    if (parts[0] === 'suggestion' && parts[1] === 'support') {
      void (async()=>{
        const suggestion=await getSuggestion(id);
        if(!suggestion) return interaction.reply({content:'That suggestion is no longer available.',ephemeral:true});
        const added=await addSuggestionSupport(id,interaction.user.id,{text:'Supported via Discord suggestion button.',source:'discord_button'});
        await syncSuggestionDiscordPost(id).catch(()=>false);
        return interaction.reply({
          content:added
            ? `Good call — your support is now counted on **${suggestion.public_id||`SUG-${id}`} · ${suggestion.title}**. 🌶️`
            : `You’re already backing **${suggestion.public_id||`SUG-${id}`} · ${suggestion.title}**.`,
          ephemeral:true
        });
      })().catch(error=>console.error('[discord] suggestion support button failed',error));
    }
  });
  await discord.login(env.DISCORD_TOKEN);
}