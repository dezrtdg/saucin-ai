import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  GuildBasedChannel,
  GuildTextBasedChannel,
  Message,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
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
import { addIssueReport, confirmIssueCandidate, dismissIssueCandidate, findKnownIssue, getIssue, getIssueAutomationSettings, getIssuePublicMessage, processIssueThreadMessage, promoteConfirmedIssueCandidate, recordIssueCandidate } from '../services/issues.js';
import {
  addSuggestionSupport,
  dismissSuggestionCandidate,
  getSuggestion,
  getSuggestionAutomationSettings,
  getSuggestionPublicMessage,
  processSuggestionThreadMessage,
  refineSuggestionForPublishing,
  recordSuggestion
} from '../services/suggestions.js';
import { processModerationMessage, recordModerationIngressDiagnostic, type ModerationDetection } from '../services/moderation.js';
import {
  activateTicket,
  buildTicketTranscript,
  claimTicket,
  closeTicketRecord,
  countOpenTicketsForUser,
  createPunishmentRecord,
  createTicketRecord,
  expiringPunishments,
  failTicketCreation,
  getPunishment,
  getTicket,
  getTicketByChannel,
  getTicketSettings,
  getTicketType,
  listTicketTypes,
  markPunishmentFailed,
  markPunishmentReversed,
  markTicketChannelDeleted,
  releaseTicket,
  reopenTicketRecord,
  saveTicketMessage,
  setTicketPanelMessage,
  setTicketStatus,
  updatePunishmentApplied,
  type TicketPunishmentAction
} from '../services/tickets.js';

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

export type DiscordForumTagMetadata = {
  id: string;
  name: string;
  emoji: string | null;
  moderated: boolean;
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

function issueConfirmationButtons(issueId:number,submitterId:string,threadId?:string|null){
  const row=new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`issue:report:${issueId}:${submitterId}`).setLabel('Report this issue').setEmoji('🐛').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`issue:ignore:${issueId}:${submitterId}`).setLabel('Ignore issue').setStyle(ButtonStyle.Secondary)
  );
  if(threadId&&env.DISCORD_GUILD_ID) row.addComponents(
    new ButtonBuilder().setLabel('View known issue').setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${env.DISCORD_GUILD_ID}/${threadId}`)
  );
  return [row];
}

function candidateButtons(candidateId:number,submitterId:string) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`candidate:report:${candidateId}:${submitterId}`).setLabel('Report this issue').setEmoji('🐛').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`candidate:ignore:${candidateId}:${submitterId}`).setLabel('Ignore issue').setStyle(ButtonStyle.Secondary)
  )];
}

function suggestionConfirmationButtons(suggestionId:number,submitterId:string){
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`suggestion:confirm:${suggestionId}:${submitterId}`)
      .setLabel('Confirm suggestion')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`suggestion:ignore:${suggestionId}:${submitterId}`)
      .setLabel('Ignore suggestion')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Secondary)
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

export function getCachedDiscordForumTags(channelId: string): DiscordForumTagMetadata[] {
  if (!env.DISCORD_GUILD_ID || !discord.isReady()) return [];
  const guild = discord.guilds.cache.get(env.DISCORD_GUILD_ID);
  const channel = guild?.channels.cache.get(channelId) as any;
  if (!channel || (channel.type !== ChannelType.GuildForum && channel.type !== ChannelType.GuildMedia)) return [];
  return (Array.isArray(channel.availableTags) ? channel.availableTags : []).map((tag:any) => ({
    id:String(tag.id),
    name:String(tag.name),
    emoji:tag.emoji?.name ? String(tag.emoji.name) : tag.emoji?.id ? String(tag.emoji.id) : null,
    moderated:Boolean(tag.moderated)
  }));
}

function normalizeForumTag(value:unknown){
  return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}

const suggestionStatusTags:Record<string,string[]>={
  candidate:['new idea','new','submitted'],
  reviewing:['under review','reviewing','review'],
  accepted:['accepted','approved'],
  planned:['planned','roadmap'],
  shipped:['released','shipped','live'],
  declined:['declined','not planned'],
  duplicate:['duplicate']
};

const suggestionCategoryTags=[
  {key:'roleplay',signals:['roleplay','rp','character'],tags:['roleplay','rp']},
  {key:'jobs-economy',signals:['job','career','business','economy','pay','builder','construction'],tags:['jobs economy','jobs','economy','business']},
  {key:'vehicles',signals:['vehicle','car','truck','motorcycle','garage','dealership'],tags:['vehicles','vehicle','cars']},
  {key:'housing-map',signals:['house','housing','apartment','building','map','interior','location'],tags:['housing map','housing','map']},
  {key:'police-ems',signals:['police','leo','ems','fire','medical','law enforcement'],tags:['police ems','police','ems','leo']},
  {key:'crime',signals:['crime','criminal','robbery','heist','gang','drug'],tags:['crime','criminal']},
  {key:'items-inventory',signals:['item','inventory','weapon','equipment','storage'],tags:['items inventory','items','inventory']},
  {key:'quality-of-life',signals:['quality of life','qol','convenience','ui','menu'],tags:['quality of life','qol']},
  {key:'community',signals:['community','event','contest','discord'],tags:['community','events']},
  {key:'general',signals:[],tags:['general']}
];

function suggestionAppliedTagIds(
  suggestion:any,
  forum:any,
  settings:Awaited<ReturnType<typeof getSuggestionAutomationSettings>>
){
  const tags:{id:string;name:string}[]=(Array.isArray(forum?.availableTags)?forum.availableTags:[]).map((tag:any)=>({
    id:String(tag.id),name:normalizeForumTag(tag.name)
  }));
  if(!tags.length) return [];
  const chosen:string[]=[];
  const configured=settings.forum_tag_id&&tags.some(tag=>tag.id===settings.forum_tag_id)
    ? settings.forum_tag_id
    : null;
  const status=String(suggestion.status||'candidate');
  const statusAliases=suggestionStatusTags[status]||[];
  const statusTag=tags.find(tag=>statusAliases.some(alias=>tag.name===alias||tag.name.includes(alias)));
  if(status==='candidate'&&configured) chosen.push(configured);
  else if(statusTag) chosen.push(statusTag.id);

  const category=normalizeForumTag(suggestion.category);
  const context=normalizeForumTag([
    suggestion.title,suggestion.summary,suggestion.community_context,...(suggestion.related_terms||[])
  ].filter(Boolean).join(' '));
  let rule=suggestionCategoryTags.find(item=>normalizeForumTag(item.key)===category||item.tags.some(tag=>category.includes(tag)));
  if(!rule){
    const scored=suggestionCategoryTags
      .map(item=>({...item,score:item.signals.filter(signal=>context.includes(signal)).length}))
      .sort((a,b)=>b.score-a.score)[0];
    rule=scored&&scored.score>0?scored:suggestionCategoryTags.find(item=>item.key==='general');
  }
  const categoryTag=rule
    ? tags.find(tag=>rule!.tags.some(alias=>tag.name===alias||tag.name.includes(alias)))
    : null;
  if(categoryTag&&!chosen.includes(categoryTag.id)) chosen.push(categoryTag.id);
  if(!chosen.length) chosen.push(configured||tags[0].id);
  return chosen.slice(0,5);
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
    content: `**Status updated:** ${fromStatus.replaceAll('_',' ')} → **${toStatus.replaceAll('_',' ')}**\n\n${await getIssuePublicMessage(issue)}${toStatus==='resolved'?'\n\n🔒 This discussion is now locked. It will be removed from Discord in **7 days**, while the complete issue record remains available to staff.':''}`,
    allowedMentions: { parse: [] }
  });
  return true;
}

async function setIssueThreadLocked(issue:any,locked:boolean){
  if(!issue?.discord_thread_id||!discord.isReady()) return false;
  const channel=await discord.channels.fetch(String(issue.discord_thread_id)).catch(()=>null) as any;
  if(!channel){
    await db.query(`UPDATE issues SET discord_thread_id=NULL,discord_status_channel_id=NULL,discord_status_message_id=NULL,discord_cleanup_at=NULL,discord_locked_at=NULL,updated_at=NOW() WHERE id=$1`,[issue.id]);
    return false;
  }
  if(!channel.isThread?.()) return false;
  if(locked){
    try{
      await channel.setLocked(true,`Resolved ${issue.public_id||`BUG-${issue.id}`} retention period`);
      await channel.setArchived(true,`Resolved ${issue.public_id||`BUG-${issue.id}`} retention period`);
    }catch{return false;}
    await db.query('UPDATE issues SET discord_locked_at=NOW(),updated_at=NOW() WHERE id=$1',[issue.id]);
  }else{
    const reason=`Reopened ${issue.public_id||`BUG-${issue.id}`}`;
    await channel.setArchived(false,reason).catch(()=>null);
    await channel.setLocked(false,reason).catch(()=>null);
  }
  return true;
}

export async function applyIssueDiscordLifecycle(issueId:number,status:string){
  const issue=await getIssue(issueId);
  if(!issue) return false;
  if(status==='resolved'){
    const scheduled=await db.query(`
      UPDATE issues SET discord_cleanup_at=NOW()+INTERVAL '7 days',discord_locked_at=NULL,updated_at=NOW()
       WHERE id=$1 RETURNING *`,[issueId]);
    return setIssueThreadLocked(scheduled.rows[0],true);
  }
  await db.query('UPDATE issues SET discord_cleanup_at=NULL,discord_locked_at=NULL,updated_at=NOW() WHERE id=$1',[issueId]);
  return setIssueThreadLocked(issue,false);
}

async function runIssueDiscordCleanup(){
  const result=await db.query(`
    SELECT id,public_id,discord_thread_id,discord_status_channel_id,discord_status_message_id,
           discord_cleanup_at,discord_locked_at
      FROM issues
     WHERE status='resolved' AND discord_cleanup_at IS NOT NULL
     ORDER BY discord_cleanup_at ASC LIMIT 100`);
  for(const issue of result.rows){
    if(!issue.discord_thread_id){
      await db.query('UPDATE issues SET discord_cleanup_at=NULL,discord_locked_at=NULL WHERE id=$1',[issue.id]);
      continue;
    }
    if(new Date(issue.discord_cleanup_at).getTime()>Date.now()){
      if(!issue.discord_locked_at) await setIssueThreadLocked(issue,true).catch(error=>console.error('[issues] unable to lock resolved discussion',error));
      continue;
    }
    const thread=await discord.channels.fetch(String(issue.discord_thread_id)).catch(()=>null) as any;
    let removed=!thread;
    if(thread) removed=await thread.delete(`Seven-day retention completed for ${issue.public_id||`BUG-${issue.id}`}`).then(()=>true).catch(()=>false);
    if(!removed) continue;
    if(issue.discord_status_channel_id&&String(issue.discord_status_channel_id)!==String(issue.discord_thread_id)&&issue.discord_status_message_id){
      const parent=await discord.channels.fetch(String(issue.discord_status_channel_id)).catch(()=>null) as any;
      if(parent?.isTextBased?.()){
        const message=await parent.messages.fetch(String(issue.discord_status_message_id)).catch(()=>null);
        if(message) await message.delete().catch(()=>null);
      }
    }
    await db.query(`
      UPDATE issues
         SET discord_thread_id=NULL,discord_status_channel_id=NULL,discord_status_message_id=NULL,
             discord_cleanup_at=NULL,discord_locked_at=NULL,updated_at=NOW()
       WHERE id=$1`,[issue.id]);
    await db.query(`INSERT INTO issue_updates (issue_id,update_type,from_value,to_value,note,created_by)
      VALUES ($1,'discord_cleanup',$2,NULL,'Resolved Discord discussion removed after the seven-day retention period.','Saucin AI')`,[issue.id,String(issue.discord_thread_id)]);
  }
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
    const appliedTags=suggestionAppliedTagIds(suggestion,forum,settings);
    if((forum as any).flags?.has?.('RequireTag')&&!appliedTags.length){
      throw new Error('Discord requires a tag for this forum, but the channel has no available tags.');
    }
    thread=await (forum as any).threads.create({
      name:suggestionThreadName(suggestion),
      appliedTags,
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
    const parent=(channel as any).parent||(
      (channel as any).parentId
        ? await discord.channels.fetch(String((channel as any).parentId)).catch(()=>null)
        : null
    );
    const appliedTags=suggestionAppliedTagIds(suggestion,parent,settings);
    if(appliedTags.length&&typeof (channel as any).setAppliedTags==='function'){
      await (channel as any).setAppliedTags(appliedTags,`Saucin AI categorized ${suggestion.public_id||suggestion.id}`).catch((error:unknown)=>
        console.warn('[suggestions] unable to synchronize forum tags',error)
      );
    }
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

function ticketPanelComponents(types:Awaited<ReturnType<typeof listTicketTypes>>){
  const menu=new StringSelectMenuBuilder()
    .setCustomId('ticket:create')
    .setPlaceholder('What can we help you with?')
    .addOptions(types.slice(0,25).map(type=>({
      label:type.label.slice(0,100),
      value:type.key,
      description:(type.description||type.intake_prompt||'Open a private support ticket.').slice(0,100),
      ...(type.emoji?{emoji:type.emoji}:{})
    })));
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

function ticketControlComponents(ticket:any){
  const first=new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ticket:claim:${ticket.id}`).setLabel('Claim ticket').setEmoji('🙋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`ticket:release:${ticket.id}`).setLabel('Release').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:waiting:${ticket.id}`).setLabel('Waiting on user').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ticket:close:${ticket.id}`).setLabel('Close ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
  if(ticket.allow_punishments){
    first.addComponents(new ButtonBuilder().setCustomId(`ticket:punish:${ticket.id}`).setLabel('Issue punishment').setEmoji('🛡️').setStyle(ButtonStyle.Secondary));
  }
  return [first];
}

function punishmentReverseComponents(punishmentId:number,contextTicketId?:number){
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`ticket:reverse:${punishmentId}${contextTicketId?`:${contextTicketId}`:''}`).setLabel('Reverse punishment').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
  )];
}

function punishmentAppealComponents(punishmentId:number){
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`punishment:appeal:${punishmentId}`).setLabel('Appeal this punishment').setEmoji('⚖️').setStyle(ButtonStyle.Secondary)
  )];
}

function ticketChannelName(publicId:string,subject:string){
  const slug=subject.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,55)||'support';
  return `${publicId.toLowerCase()}-${slug}`.slice(0,100);
}

function cleanDiscordError(error:unknown){
  return (error instanceof Error?error.message:String(error)).replace(/\s+/g,' ').trim().slice(0,1000);
}

function ticketActor(interaction:any){
  return {userId:String(interaction.user.id),name:String(interaction.user.globalName||interaction.user.username||interaction.user.id)};
}

function interactionRoleIds(interaction:any){
  const member=interaction.member;
  const roleIds=new Set<string>();
  const rawRoles=member?.roles;
  if(rawRoles?.cache) for(const id of rawRoles.cache.keys()) roleIds.add(String(id));
  else if(Array.isArray(rawRoles)) for(const id of rawRoles) roleIds.add(String(id));
  return roleIds;
}

function interactionIsTicketAdmin(interaction:any){
  const permissions=interaction.memberPermissions;
  return Boolean(permissions?.has?.(PermissionFlagsBits.ManageGuild)||permissions?.has?.(PermissionFlagsBits.Administrator));
}

async function interactionCanManageTicket(interaction:any,ticket:any){
  const roleIds=interactionRoleIds(interaction);
  const hasSupport=(ticket.support_role_ids||[]).some((id:string)=>roleIds.has(String(id)));
  return Boolean(hasSupport||interactionIsTicketAdmin(interaction));
}

async function interactionCanUsePunishment(interaction:any,ticket:any,action:TicketPunishmentAction|'reverse'){
  if(!(await interactionCanManageTicket(interaction,ticket))) return false;
  if(interactionIsTicketAdmin(interaction)) return true;
  const settings=await getTicketSettings();
  const allowed=action==='warning'?settings.warning_role_ids
    :action==='timeout'?settings.timeout_role_ids
      :action==='kick'?settings.kick_role_ids
        :action==='reverse'?settings.reversal_role_ids
          :settings.ban_role_ids;
  if(!allowed.length) return true;
  const roles=interactionRoleIds(interaction);
  return allowed.some(id=>roles.has(id));
}

export async function publishTicketPanel(){
  if(!discord.isReady()) throw new Error('Discord is not connected yet.');
  const settings=await getTicketSettings();
  if(!settings.enabled) throw new Error('Private tickets are currently disabled.');
  if(!settings.panel_channel_id) throw new Error('Choose a ticket panel channel first.');
  if(!settings.open_category_id) throw new Error('Choose an open-ticket category first.');
  const types=await listTicketTypes(false);
  if(!types.length) throw new Error('Enable at least one ticket type before publishing the panel.');
  const channel=await discord.channels.fetch(settings.panel_channel_id).catch(()=>null);
  if(!channel||!channel.isTextBased()||channel.isDMBased()||(channel as any).isThread?.()){
    throw new Error('The ticket panel destination must be a regular Discord text channel.');
  }
  const payload={
    content:[
      '**Need a hand? Open a private ticket 🎫**',
      '',
      'Choose the option that best matches what you need. Saucin AI will open a private channel and get the right staff team involved.',
      '',
      'Please include the important details up front. Screenshots, clips, message links, and case numbers help us move faster. One issue per ticket keeps the sauce from getting messy. 🌶️'
    ].join('\n'),
    components:ticketPanelComponents(types),
    allowedMentions:{parse:[] as string[]}
  };
  let message:any=null;
  if(settings.panel_message_id){
    message=await (channel as any).messages.fetch(settings.panel_message_id).catch(()=>null);
    if(message) await message.edit(payload);
  }
  if(!message) message=await (channel as any).send(payload);
  await setTicketPanelMessage(channel.id,message.id);
  return {channel_id:channel.id,message_id:message.id};
}

async function createPrivateTicketChannel(interaction:any,typeKey:string,input:{subject:string;description:string;involvedUserId?:string;evidenceLinks?:string}){
  if(!interaction.guildId||!interaction.guild) throw new Error('Tickets can only be created inside the Saucin RP Discord server.');
  const [settings,type]=await Promise.all([getTicketSettings(),getTicketType(typeKey)]);
  if(!settings.enabled) throw new Error('Ticket creation is currently disabled.');
  if(!type?.enabled) throw new Error('That ticket type is no longer available.');
  const categoryId=type.category_override_id||settings.open_category_id;
  if(!categoryId) throw new Error('Staff have not configured an open-ticket category yet.');
  const openCount=await countOpenTicketsForUser(interaction.guildId,interaction.user.id);
  if(openCount>=settings.max_open_per_user){
    throw new Error(`You already have ${openCount} open ticket${openCount===1?'':'s'}. Please use or close an existing ticket before opening another.`);
  }
  let appealedPunishment:any=null;
  if(typeKey==='punishment-appeal'){
    const caseNumber=[input.subject,input.description,input.evidenceLinks||''].join(' ').match(/\bPUN-0*(\d+)\b/i);
    if(caseNumber){
      const found=await getPunishment(Number(caseNumber[1]));
      if(found&&String(found.target_user_id)===String(interaction.user.id)) appealedPunishment=found;
    }
  }
  const record=await createTicketRecord({
    typeKey,guildId:interaction.guildId,openerUserId:interaction.user.id,
    openerName:interaction.user.globalName||interaction.user.username,
    subject:input.subject,description:input.description,involvedUserId:input.involvedUserId||appealedPunishment?.target_user_id||null,evidenceLinks:input.evidenceLinks||'',
    appealedPunishmentId:appealedPunishment?Number(appealedPunishment.id):null
  });
  try{
    const botId=discord.user?.id;
    if(!botId) throw new Error('Saucin AI is not connected to Discord.');
    const overwrites:any[]=[
      {id:interaction.guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},
      {id:interaction.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]},
      {id:botId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageMessages,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]}
    ];
    for(const roleId of type.support_role_ids){
      overwrites.push({id:roleId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]});
    }
    const channel=await interaction.guild.channels.create({
      name:ticketChannelName(record.public_id,input.subject),
      type:ChannelType.GuildText,
      parent:categoryId,
      permissionOverwrites:overwrites,
      reason:`Saucin AI private ticket ${record.public_id}`
    });
    const supportMentions=type.support_role_ids.map(id=>settings.hide_staff_mentions?`||<@&${id}>||`:`<@&${id}>`).join(' ');
    let intro=[
      `${type.emoji||'🎫'} **${record.public_id} · ${type.label}**`,
      `**Opened by:** <@${interaction.user.id}>`,
      `**Subject:** ${input.subject}`,
      input.involvedUserId?`**Involved member:** <@${input.involvedUserId}>`:'',
      '',
      input.description,
      input.evidenceLinks?`\n**Initial links / evidence:**\n${input.evidenceLinks}`:'',
      '',
      `**What happens next:** ${type.intake_prompt||'Add any details that will help staff understand the request.'}`,
      '',
      supportMentions?`${supportMentions}\nThe staff team has been notified. A new ticket is ready for review.`:'Staff can claim this ticket when they begin reviewing it.'
    ].filter(Boolean).join('\n');
    if(appealedPunishment){
      intro+=`\n\n**Linked punishment:** ${appealedPunishment.public_id} · ${punishmentLabel(appealedPunishment.action_type,appealedPunishment.duration_seconds)}\n**Original reason:** ${appealedPunishment.reason}`;
    }
    const components=[...ticketControlComponents({...record,...type}),...(appealedPunishment?punishmentReverseComponents(Number(appealedPunishment.id),Number(record.id)):[])];
    const control=await channel.send({content:intro.slice(0,1950),components,allowedMentions:{roles:type.support_role_ids,users:[interaction.user.id,input.involvedUserId].filter(Boolean)}});
    await activateTicket(Number(record.id),channel.id,control.id);
    return {...record,status:'open',channel_id:channel.id,control_message_id:control.id,type_label:type.label};
  }catch(error){
    await failTicketCreation(Number(record.id),cleanDiscordError(error));
    throw error;
  }
}

async function createPunishmentAppealTicket(interaction:any,punishment:any,input:{reason:string;evidenceLinks?:string}){
  if(interaction.user.id!==String(punishment.target_user_id)) throw new Error('Only the member who received this punishment can appeal it from this notice.');
  const existing=await db.query(`
    SELECT id,public_id,channel_id,status FROM tickets
     WHERE appealed_punishment_id=$1 AND status IN ('creating','open','claimed','awaiting_user')
     ORDER BY created_at DESC LIMIT 1`,[punishment.id]);
  if(existing.rowCount){
    const existingGuild=discord.guilds.cache.get(String(punishment.guild_id));
    const memberStillPresent=existingGuild?await existingGuild.members.fetch(interaction.user.id).catch(()=>null):null;
    return {...existing.rows[0],existing:true,member_can_access:Boolean(existing.rows[0].channel_id&&memberStillPresent)};
  }
  const [settings,type]=await Promise.all([getTicketSettings(),getTicketType('punishment-appeal')]);
  if(!settings.enabled||!type?.enabled) throw new Error('Punishment appeals are not currently available.');
  const guild=discord.guilds.cache.get(String(punishment.guild_id));
  if(!guild) throw new Error('The Saucin RP Discord server is unavailable.');
  const categoryId=type.category_override_id||settings.open_category_id;
  if(!categoryId) throw new Error('Staff have not configured the punishment-appeal category yet.');
  const record=await createTicketRecord({
    typeKey:type.key,guildId:guild.id,openerUserId:interaction.user.id,openerName:interaction.user.globalName||interaction.user.username,
    subject:`Appeal ${punishment.public_id}`,description:input.reason,involvedUserId:interaction.user.id,
    evidenceLinks:input.evidenceLinks||'',appealedPunishmentId:Number(punishment.id)
  });
  try{
    const botId=discord.user?.id;if(!botId) throw new Error('Saucin AI is not connected.');
    const overwrites:any[]=[
      {id:guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},
      {id:interaction.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]},
      {id:botId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageMessages,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]}
    ];
    for(const roleId of type.support_role_ids){
      overwrites.push({id:roleId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]});
    }
    const channel=await guild.channels.create({
      name:ticketChannelName(record.public_id,`appeal-${punishment.public_id}`),type:ChannelType.GuildText,parent:categoryId,
      permissionOverwrites:overwrites,reason:`Saucin AI punishment appeal ${punishment.public_id}`
    });
    const memberStillPresent=await guild.members.fetch(interaction.user.id).catch(()=>null);
    const supportMentions=type.support_role_ids.map(id=>settings.hide_staff_mentions?`||<@&${id}>||`:`<@&${id}>`).join(' ');
    const control=await channel.send({
      content:[
        `⚖️ **${record.public_id} · Appeal of ${punishment.public_id}**`,
        `**Member:** <@${punishment.target_user_id}> (${punishment.target_user_id})`,
        `**Original action:** ${punishmentLabel(punishment.action_type,punishment.duration_seconds)}`,
        `**Original reason:** ${punishment.reason}`,
        '',
        '**Appeal statement:**',input.reason,
        input.evidenceLinks?`\n**New evidence / links:**\n${input.evidenceLinks}`:'',
        '',
        memberStillPresent?'The member can continue the appeal in this private channel.':'The member is not currently in the server. This appeal was accepted through their direct-message notice; staff can review and reverse the action here.',
        supportMentions?`\n${supportMentions}`:''
      ].filter(Boolean).join('\n').slice(0,1950),
      components:[...ticketControlComponents({...record,...type}),...punishmentReverseComponents(Number(punishment.id),Number(record.id))],
      allowedMentions:{roles:type.support_role_ids,users:memberStillPresent?[interaction.user.id]:[]}
    });
    await activateTicket(Number(record.id),channel.id,control.id);
    return {...record,status:'open',channel_id:channel.id,existing:false,member_can_access:Boolean(memberStillPresent)};
  }catch(error){await failTicketCreation(Number(record.id),cleanDiscordError(error));throw error;}
}

export async function reopenDiscordTicket(ticketId:number,actor:{userId:string;name:string}){
  if(!discord.isReady()) throw new Error('Discord is not connected yet.');
  const [settings,ticket]=await Promise.all([getTicketSettings(),getTicket(ticketId)]);
  if(!ticket) throw new Error('That ticket no longer exists.');
  if(ticket.status!=='closed') throw new Error(`${ticket.public_id} is not closed.`);
  const guild=discord.guilds.cache.get(String(ticket.guild_id));
  if(!guild) throw new Error('The Discord server is unavailable.');
  const categoryId=ticket.category_override_id||settings.open_category_id;
  if(!categoryId) throw new Error('Staff have not configured an open-ticket category.');
  const botId=discord.user?.id;
  if(!botId) throw new Error('Saucin AI is not connected.');
  const opener=await guild.members.fetch(String(ticket.opener_user_id)).catch(()=>null);
  const overwrites:any[]=[
    {id:guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},
    {id:botId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageMessages,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]}
  ];
  if(opener) overwrites.push({id:ticket.opener_user_id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]});
  for(const roleId of ticket.support_role_ids||[]){
    overwrites.push({id:roleId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]});
  }
  const channel=await guild.channels.create({
    name:ticketChannelName(ticket.public_id,ticket.subject),type:ChannelType.GuildText,parent:categoryId,
    permissionOverwrites:overwrites,reason:`Reopened ${ticket.public_id} by ${actor.name}`
  });
  try{
    const supportMentions=(ticket.support_role_ids||[]).map((id:string)=>settings.hide_staff_mentions?`||<@&${id}>||`:`<@&${id}>`).join(' ');
    const control=await channel.send({
      content:[
        `🔓 **${ticket.public_id} reopened**`,
        `**Reopened by:** ${actor.name}`,
        `**Opened for:** <@${ticket.opener_user_id}>`,
        `**Subject:** ${ticket.subject}`,
        ticket.close_reason?`**Previous closing reason:** ${ticket.close_reason}`:'',
        '',
        'This is the continuation of the original ticket. Its earlier conversation and audit history remain preserved in the dashboard.',
        opener?'Add any new details here so staff can continue the review.':'The original member is no longer in the server, so this channel is available to staff only.',
        supportMentions?`\n${supportMentions}\nThe staff team has been notified.`:''
      ].filter(Boolean).join('\n').slice(0,1950),
      components:ticketControlComponents(ticket),
      allowedMentions:{roles:ticket.support_role_ids||[],users:opener?[ticket.opener_user_id]:[]}
    });
    const reopened=await reopenTicketRecord(ticketId,channel.id,control.id,actor);
    if(!reopened) throw new Error('The ticket changed while it was being reopened.');
    return {...reopened,channel_id:channel.id};
  }catch(error){
    await channel.delete('Reopen failed; removing incomplete ticket channel.').catch(()=>null);
    throw error;
  }
}

async function captureTicketMessage(message:Message,ticket:any){
  await saveTicketMessage(Number(ticket.id),{
    messageId:message.id,userId:message.author.id,authorName:message.author.globalName||message.author.username,
    content:message.content,attachments:[...message.attachments.values()].map(item=>({name:item.name,url:item.url,content_type:item.contentType||null,size:item.size})),
    isBot:message.author.bot,createdAt:message.createdAt
  });
}

async function closeDiscordTicket(ticketId:number,interaction:any,reason:string){
  const ticket=await getTicket(ticketId);
  if(!ticket) throw new Error('That ticket no longer exists.');
  if(ticket.status==='closed') return ticket;
  const settings=await getTicketSettings();
  const actor=ticketActor(interaction);
  const transcript=await buildTicketTranscript(ticketId);
  let transcriptMessage:any=null;
  if(settings.transcript_channel_id){
    const destination=await discord.channels.fetch(settings.transcript_channel_id).catch(()=>null);
    if(destination&&destination.isTextBased()&&!destination.isDMBased()){
      const attachment=new AttachmentBuilder(Buffer.from(transcript,'utf8'),{name:`${String(ticket.public_id).toLowerCase()}-transcript.txt`});
      transcriptMessage=await (destination as any).send({
        content:`**${ticket.public_id} closed**\n**Type:** ${ticket.type_label}\n**Opened by:** ${ticket.opener_name||ticket.opener_user_id}\n**Closed by:** ${actor.name}\n**Reason:** ${reason}`.slice(0,1900),
        files:[attachment],allowedMentions:{parse:[]}
      }).catch(()=>null);
    }
  }
  const closed=await closeTicketRecord(ticketId,actor,reason,{
    text:transcript,channelId:transcriptMessage?.channelId||null,messageId:transcriptMessage?.id||null
  });
  if(ticket.channel_id){
    const channel=await discord.channels.fetch(String(ticket.channel_id)).catch(()=>null) as any;
    if(channel&&channel.type===ChannelType.GuildText){
      await channel.send({content:`🔒 **Ticket closed by ${actor.name}.**\n**Reason:** ${reason}\n\nThe complete transcript has been preserved.`,allowedMentions:{parse:[]}}).catch(()=>null);
      if(settings.delete_closed_channels){
        const deleted=await channel.delete(`Closed ${ticket.public_id}; transcript preserved by Saucin AI`).then(()=>true).catch(()=>false);
        if(deleted) await markTicketChannelDeleted(ticketId,String(ticket.channel_id));
      }else{
        await channel.permissionOverwrites.edit(ticket.opener_user_id,{SendMessages:false}).catch(()=>null);
        if(settings.closed_category_id) await channel.setParent(settings.closed_category_id,{lockPermissions:false,reason:`Closed ${ticket.public_id}`}).catch(()=>null);
        await channel.setName(`closed-${String(ticket.public_id).toLowerCase()}`).catch(()=>null);
      }
    }
  }
  return closed;
}

const punishmentOptions=[
  {label:'Warning',value:'warning',description:'Send and record an official warning.',emoji:'⚠️'},
  {label:'Timeout · 10 minutes',value:'timeout-600',description:'Prevent communication for 10 minutes.',emoji:'⏱️'},
  {label:'Timeout · 1 hour',value:'timeout-3600',description:'Prevent communication for 1 hour.',emoji:'⏱️'},
  {label:'Timeout · 1 day',value:'timeout-86400',description:'Prevent communication for 24 hours.',emoji:'⏱️'},
  {label:'Timeout · 7 days',value:'timeout-604800',description:'Prevent communication for 7 days.',emoji:'⏱️'},
  {label:'Kick',value:'kick',description:'Remove the member from the server.',emoji:'🚪'},
  {label:'Temporary ban · 1 day',value:'temporary_ban-86400',description:'Ban the member for 24 hours.',emoji:'🔨'},
  {label:'Temporary ban · 7 days',value:'temporary_ban-604800',description:'Ban the member for 7 days.',emoji:'🔨'},
  {label:'Temporary ban · 30 days',value:'temporary_ban-2592000',description:'Ban the member for 30 days.',emoji:'🔨'},
  {label:'Permanent ban',value:'permanent_ban',description:'Ban until an authorized reversal.',emoji:'🛑'}
];

function parsePunishmentSelection(value:string):{action:TicketPunishmentAction;durationSeconds:number|null}{
  const [raw,duration]=value.split('-');
  const action=(raw==='temporary_ban'?'temporary_ban':raw) as TicketPunishmentAction;
  if(!['warning','timeout','kick','temporary_ban','permanent_ban'].includes(action)) throw new Error('Unsupported punishment type.');
  const seconds=duration?Number(duration):null;
  return {action,durationSeconds:Number.isFinite(seconds)&&seconds!>0?seconds:null};
}

function punishmentLabel(action:string,durationSeconds?:number|null){
  const duration=durationSeconds?durationSeconds>=86400?`${Math.round(durationSeconds/86400)} day${durationSeconds===86400?'':'s'}`:durationSeconds>=3600?`${Math.round(durationSeconds/3600)} hour${durationSeconds===3600?'':'s'}`:`${Math.round(durationSeconds/60)} minutes`:'';
  if(action==='temporary_ban') return `${duration} temporary ban`;
  if(action==='timeout') return `${duration} timeout`;
  return action.replaceAll('_',' ');
}

export async function applyTicketPunishment(input:{
  ticketId?:number|null;guildId:string;targetUserId:string;action:TicketPunishmentAction;durationSeconds?:number|null;
  reason:string;internalNotes?:string;actor:{userId:string;name:string};sourceModerationCaseId?:number|null;
}){
  if(!discord.isReady()) throw new Error('Discord is not connected.');
  if((input.action==='timeout'||input.action==='temporary_ban')&&!input.durationSeconds){
    throw new Error(`${input.action==='timeout'?'Timeout':'Temporary ban'} requires a duration.`);
  }
  const guild=discord.guilds.cache.get(input.guildId);
  if(!guild) throw new Error('The configured Discord server is unavailable.');
  const ticket=input.ticketId?await getTicket(input.ticketId):null;
  const evidence=ticket?await buildTicketTranscript(Number(ticket.id)):'';
  const user=await discord.users.fetch(input.targetUserId).catch(()=>null);
  const record=await createPunishmentRecord({
    ticketId:input.ticketId||null,sourceModerationCaseId:input.sourceModerationCaseId||null,guildId:input.guildId,
    targetUserId:input.targetUserId,targetName:user?.globalName||user?.username||null,actionType:input.action,
    durationSeconds:input.durationSeconds||null,reason:input.reason,internalNotes:input.internalNotes||'',
    evidenceSnapshot:evidence,issuedByUserId:input.actor.userId,issuedByName:input.actor.name
  });
  const auditReason=`${record.public_id} · ${input.reason}`.slice(0,500);
  try{
    const label=punishmentLabel(input.action,input.durationSeconds);
    const externalState:Record<string,unknown>={notice_sent:false};
    if(user){
      const notice=await user.send({
        content:[
          `**Saucin RP moderation notice · ${record.public_id}**`,
          `**Action:** ${label}`,
          `**Reason:** ${input.reason}`,
          input.durationSeconds?`**Duration:** ${label.replace(/^(.*?)( timeout| temporary ban)$/,'$1')}`:'',
          '',
          'If you believe this was issued incorrectly, use the appeal button below. It still works from this DM if the action removes you from the server.'
        ].filter(Boolean).join('\n'),components:punishmentAppealComponents(Number(record.id)),allowedMentions:{parse:[]}
      }).catch(()=>null);
      externalState.notice_sent=Boolean(notice);
    }
    let status:'active'|'completed'='active';
    let expiresAt:Date|null=null;
    if(input.action==='warning'){
      status='completed';
    }else if(input.action==='timeout'){
      if(!input.durationSeconds) throw new Error('A timeout duration is required.');
      const member=await guild.members.fetch(input.targetUserId);
      await member.timeout(input.durationSeconds*1000,auditReason);
      expiresAt=new Date(Date.now()+input.durationSeconds*1000);
      externalState.timeout_until=expiresAt.toISOString();
    }else if(input.action==='kick'){
      const member=await guild.members.fetch(input.targetUserId);
      await member.kick(auditReason);
      status='completed';
    }else if(input.action==='temporary_ban'){
      if(!input.durationSeconds) throw new Error('A temporary-ban duration is required.');
      await guild.members.ban(input.targetUserId,{deleteMessageSeconds:0,reason:auditReason});
      expiresAt=new Date(Date.now()+input.durationSeconds*1000);
      externalState.ban_expires_at=expiresAt.toISOString();
    }else if(input.action==='permanent_ban'){
      await guild.members.ban(input.targetUserId,{deleteMessageSeconds:0,reason:auditReason});
    }
    return await updatePunishmentApplied(Number(record.id),{status,targetName:user?.globalName||user?.username||null,externalState,expiresAt});
  }catch(error){
    await markPunishmentFailed(Number(record.id),cleanDiscordError(error));
    if(user){
      await user.send({content:`**Update for ${record.public_id}:** Discord did not apply the action. Staff can see the failure and must review it before taking any further action.`,allowedMentions:{parse:[]}}).catch(()=>null);
    }
    throw new Error(`${record.public_id} was recorded, but Discord did not apply it: ${cleanDiscordError(error)}`);
  }
}

export async function reverseTicketPunishment(punishmentId:number,actor:{userId:string;name:string},reason:string,status:'reversed'|'expired'='reversed'){
  const punishment=await getPunishment(punishmentId);
  if(!punishment) throw new Error('Punishment not found.');
  if(!['active','completed'].includes(String(punishment.status))) throw new Error(`This punishment is already ${punishment.status}.`);
  const guild=discord.guilds.cache.get(String(punishment.guild_id));
  if(!guild) throw new Error('The Discord server is unavailable, so the reversal was not recorded.');
  const auditReason=`${punishment.public_id} ${status==='expired'?'expired':'reversed'} · ${reason}`.slice(0,500);
  try{
    if(punishment.action_type==='timeout'){
      const member=await guild.members.fetch(String(punishment.target_user_id)).catch(()=>null);
      if(member) await member.timeout(null,auditReason);
    }else if(['temporary_ban','permanent_ban'].includes(String(punishment.action_type))){
      const ban=await guild.bans.fetch(String(punishment.target_user_id)).catch(()=>null);
      if(ban) await guild.members.unban(String(punishment.target_user_id),auditReason);
    }
    const updated=await markPunishmentReversed(punishmentId,actor,reason,status);
    const user=await discord.users.fetch(String(punishment.target_user_id)).catch(()=>null);
    if(user&&status==='reversed'){
      await user.send({content:`**${punishment.public_id} has been reversed.**\n**Reason:** ${reason}\n\nThe original action remains in the audit history as reversed.`,allowedMentions:{parse:[]}}).catch(()=>null);
    }
    return updated;
  }catch(error){
    throw new Error(`Discord could not reverse ${punishment.public_id}: ${cleanDiscordError(error)}`);
  }
}

let ticketMaintenanceTimer:NodeJS.Timeout|null=null;
let ticketMaintenanceRunning=false;

async function runTicketMaintenance(){
  if(ticketMaintenanceRunning||!discord.isReady()) return;
  ticketMaintenanceRunning=true;
  try{
    const expired=await expiringPunishments(100);
    for(const punishment of expired){
      await reverseTicketPunishment(Number(punishment.id),{userId:'saucin-ai-expiry',name:'Saucin AI'},'Scheduled punishment duration completed.','expired')
        .catch(error=>console.error('[tickets] automatic punishment expiry failed',error));
    }
    await runIssueDiscordCleanup().catch(error=>console.error('[issues] resolved discussion cleanup failed',error));
  }finally{ticketMaintenanceRunning=false;}
}

export function startTicketMaintenanceWorker(){
  if(ticketMaintenanceTimer) return;
  ticketMaintenanceTimer=setInterval(()=>void runTicketMaintenance(),30_000);
  void runTicketMaintenance();
}

export function stopTicketMaintenanceWorker(){
  if(ticketMaintenanceTimer) clearInterval(ticketMaintenanceTimer);
  ticketMaintenanceTimer=null;
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

  // Private support tickets are self-contained conversations. Capture their
  // messages for the case transcript, then stop normal question/issue/moderation
  // classification from treating sensitive ticket content as public channel data.
  const linkedTicket=await getTicketByChannel(message.channelId);
  if(linkedTicket){
    await captureTicketMessage(message,linkedTicket).catch(error=>console.error('[tickets] failed to capture ticket message',error));
    return;
  }

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
      await refineSuggestionForPublishing(Number(suggestion.id));
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
      matchedSources = [{
        type: 'issue', id: issue.public_id ?? issue.id, title: issue.title, status: issue.status,
        score: Number(issue.score.toFixed(4)), matchTypes: issue.match_types
      }];
      if (issueReplyAllowed || mentionOverride) {
        const currentIssue = await getIssue(issue.id);
        responseText = `${await getIssuePublicMessage(currentIssue || issue)}\n\nThis looks like it may match what you described. Want me to add your report?`;
        responseComponents = issueConfirmationButtons(issue.id,message.author.id,currentIssue?.discord_thread_id||null);
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
        responseText = `I don’t see a known issue that clearly matches this yet. If you confirm it, I’ll organize the report and open a dedicated issue discussion for details, screenshots, links, and anyone else having the same problem. 🐛`;
        responseComponents = candidateButtons(Number(candidate.id),message.author.id);
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
          responseText=`Okay, this one might have some sauce 👀\n\n**${publicId} · ${suggestion.title}**\n\nDid I understand the idea correctly? Confirm it and I’ll organize it on the suggestion board, or ignore it if I read the room wrong.`;
          responseComponents=suggestionConfirmationButtons(Number(suggestion.id),message.author.id);
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
    if(interaction.isStringSelectMenu()&&interaction.customId==='ticket:create'){
      void (async()=>{
        const typeKey=interaction.values[0];
        const type=await getTicketType(typeKey);
        if(!type?.enabled) return interaction.reply({content:'That ticket option is no longer available.',ephemeral:true});
        const modal=new ModalBuilder().setCustomId(`ticket:submit:${typeKey}`).setTitle(type.label.slice(0,45));
        const subject=new TextInputBuilder().setCustomId('subject').setLabel('Short subject').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder('What do you need help with?');
        const details=new TextInputBuilder().setCustomId('description').setLabel('Explain what happened or what you need').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setPlaceholder(type.intake_prompt.slice(0,100));
        const involved=new TextInputBuilder().setCustomId('involved_user_id').setLabel('Involved Discord user ID (optional)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(32).setPlaceholder('Example: 123456789012345678');
        const evidence=new TextInputBuilder().setCustomId('evidence_links').setLabel('Evidence or links (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setPlaceholder('Message links, clips, screenshots, case numbers, etc.');
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(subject),
          new ActionRowBuilder<TextInputBuilder>().addComponents(details),
          new ActionRowBuilder<TextInputBuilder>().addComponents(involved),
          new ActionRowBuilder<TextInputBuilder>().addComponents(evidence)
        );
        await interaction.showModal(modal);
      })().catch(error=>console.error('[tickets] ticket modal failed',error));
      return;
    }

    if(interaction.isStringSelectMenu()&&interaction.customId.startsWith('ticket:punishment:')){
      void (async()=>{
        const ticketId=Number(interaction.customId.split(':')[2]);
        const ticket=await getTicket(ticketId);
        if(!ticket) return interaction.reply({content:'That ticket no longer exists.',ephemeral:true});
        if(!(await interactionCanManageTicket(interaction,ticket))) return interaction.reply({content:'Only the assigned staff team can issue a punishment from this ticket.',ephemeral:true});
        const selection=interaction.values[0];
        const parsed=parsePunishmentSelection(selection);
        if(!(await interactionCanUsePunishment(interaction,ticket,parsed.action))) return interaction.reply({content:'Your Discord role is not authorized to use that punishment level.',ephemeral:true});
        const modal=new ModalBuilder().setCustomId(`ticket:punishment-submit:${ticketId}:${selection}`).setTitle('Issue Discord punishment');
        const target=new TextInputBuilder().setCustomId('target_user_id').setLabel('Discord user ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32).setPlaceholder('The member receiving the punishment');
        if(ticket.involved_user_id) target.setValue(String(ticket.involved_user_id).slice(0,32));
        const reason=new TextInputBuilder().setCustomId('reason').setLabel('Rule and user-facing reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setPlaceholder('State the rule and clearly explain the decision.');
        const notes=new TextInputBuilder().setCustomId('internal_notes').setLabel('Internal staff notes (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setPlaceholder('Private context, deliberation, or follow-up notes.');
        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(target),
          new ActionRowBuilder<TextInputBuilder>().addComponents(reason),
          new ActionRowBuilder<TextInputBuilder>().addComponents(notes)
        );
        await interaction.showModal(modal);
      })().catch(error=>console.error('[tickets] punishment selection failed',error));
      return;
    }

    if(interaction.isModalSubmit()&&interaction.customId.startsWith('ticket:submit:')){
      void (async()=>{
        const typeKey=interaction.customId.split(':')[2];
        const involved=interaction.fields.getTextInputValue('involved_user_id').trim().replace(/[<@!>]/g,'');
        if(involved&&!/^\d{15,22}$/.test(involved)) return interaction.reply({content:'The involved member must be a Discord user ID. You can leave it blank if you do not know it.',ephemeral:true});
        await interaction.deferReply({ephemeral:true});
        try{
          const ticket=await createPrivateTicketChannel(interaction,typeKey,{
            subject:interaction.fields.getTextInputValue('subject'),
            description:interaction.fields.getTextInputValue('description'),
            involvedUserId:involved||undefined,
            evidenceLinks:interaction.fields.getTextInputValue('evidence_links')
          });
          return interaction.editReply({content:`Ticket created — <#${ticket.channel_id}>\n\nI’ve got the room ready. Add any screenshots, clips, or details there and the right staff team can take it from here. 🌶️`});
        }catch(error){
          return interaction.editReply({content:`I couldn’t open that ticket yet: ${cleanDiscordError(error)}`});
        }
      })().catch(error=>console.error('[tickets] ticket submission failed',error));
      return;
    }

    if(interaction.isModalSubmit()&&interaction.customId.startsWith('ticket:close-submit:')){
      void (async()=>{
        const ticketId=Number(interaction.customId.split(':')[2]);
        const ticket=await getTicket(ticketId);
        if(!ticket) return interaction.reply({content:'That ticket no longer exists.',ephemeral:true});
        const settings=await getTicketSettings();
        const isOpener=interaction.user.id===ticket.opener_user_id;
        if(!(await interactionCanManageTicket(interaction,ticket))&&!(settings.allow_user_close&&isOpener)){
          return interaction.reply({content:'You do not have permission to close this ticket.',ephemeral:true});
        }
        await interaction.deferReply({ephemeral:true});
        try{
          await closeDiscordTicket(ticketId,interaction,interaction.fields.getTextInputValue('reason'));
          return interaction.editReply({content:settings.delete_closed_channels
            ?`${ticket.public_id} is closed, its Discord channel was removed, and its full history was preserved in the dashboard.`
            :`${ticket.public_id} is closed and its transcript was preserved.`});
        }catch(error){return interaction.editReply({content:`I couldn’t close the ticket: ${cleanDiscordError(error)}`});}
      })().catch(error=>console.error('[tickets] close submission failed',error));
      return;
    }

    if(interaction.isModalSubmit()&&interaction.customId.startsWith('ticket:punishment-submit:')){
      void (async()=>{
        const parts=interaction.customId.split(':');
        const ticketId=Number(parts[2]);
        const selection=parts[3];
        const ticket=await getTicket(ticketId);
        if(!ticket) return interaction.reply({content:'That ticket no longer exists.',ephemeral:true});
        if(!(await interactionCanManageTicket(interaction,ticket))) return interaction.reply({content:'Only the assigned staff team can issue a punishment.',ephemeral:true});
        const targetUserId=interaction.fields.getTextInputValue('target_user_id').trim().replace(/[<@!>]/g,'');
        if(!/^\d{15,22}$/.test(targetUserId)) return interaction.reply({content:'Enter the member’s numeric Discord user ID.',ephemeral:true});
        const parsed=parsePunishmentSelection(selection);
        if(!(await interactionCanUsePunishment(interaction,ticket,parsed.action))) return interaction.reply({content:'Your Discord role is not authorized to use that punishment level.',ephemeral:true});
        await interaction.deferReply({ephemeral:true});
        try{
          const punishment=await applyTicketPunishment({
            ticketId,guildId:String(interaction.guildId),targetUserId,action:parsed.action,durationSeconds:parsed.durationSeconds,
            reason:interaction.fields.getTextInputValue('reason'),internalNotes:interaction.fields.getTextInputValue('internal_notes'),actor:ticketActor(interaction)
          });
          const ticketChannel=ticket.channel_id?await discord.channels.fetch(String(ticket.channel_id)).catch(()=>null):null;
          if(ticketChannel&&ticketChannel.isTextBased()&&!ticketChannel.isDMBased()){
            await (ticketChannel as any).send({
              content:`🛡️ **${punishment.public_id} applied**\n**Member:** <@${punishment.target_user_id}>\n**Action:** ${punishmentLabel(punishment.action_type,punishment.duration_seconds)}\n**Reason:** ${punishment.reason}\n**Issued by:** ${punishment.issued_by_name||punishment.issued_by_user_id}\n\nThis action remains in the audit history even if it is later reversed.`,
              components:punishmentReverseComponents(Number(punishment.id)),allowedMentions:{parse:[]}
            }).catch(()=>null);
          }
          return interaction.editReply({content:`${punishment.public_id} was successfully applied and added to the permanent case history.`});
        }catch(error){return interaction.editReply({content:cleanDiscordError(error)});}
      })().catch(error=>console.error('[tickets] punishment submission failed',error));
      return;
    }

    if(interaction.isModalSubmit()&&interaction.customId.startsWith('ticket:reverse-submit:')){
      void (async()=>{
        const customParts=interaction.customId.split(':');
        const punishmentId=Number(customParts[2]);
        const punishment=await getPunishment(punishmentId);
        if(!punishment) return interaction.reply({content:'That punishment no longer exists.',ephemeral:true});
        const authorizationTicketId=Number(customParts[3]||punishment.ticket_id||0);
        const ticket=authorizationTicketId?await getTicket(authorizationTicketId):null;
        if(!ticket||!(await interactionCanUsePunishment(interaction,ticket,'reverse'))) return interaction.reply({content:'Your Discord role is not authorized to reverse this punishment.',ephemeral:true});
        await interaction.deferReply({ephemeral:true});
        try{
          const reason=interaction.fields.getTextInputValue('reason');
          const updated=await reverseTicketPunishment(punishmentId,ticketActor(interaction),reason);
          const channel=ticket.channel_id?await discord.channels.fetch(String(ticket.channel_id)).catch(()=>null):null;
          if(channel&&channel.isTextBased()&&!channel.isDMBased()){
            await (channel as any).send({content:`↩️ **${punishment.public_id} reversed**\n**Reversed by:** ${updated.reversed_by_name||updated.reversed_by_user_id}\n**Reason:** ${reason}\n\nThe original action remains preserved in the audit history as reversed.`,allowedMentions:{parse:[]}}).catch(()=>null);
          }
          return interaction.editReply({content:`${punishment.public_id} was reversed successfully.`});
        }catch(error){return interaction.editReply({content:cleanDiscordError(error)});}
      })().catch(error=>console.error('[tickets] punishment reversal failed',error));
      return;
    }

    if(interaction.isModalSubmit()&&interaction.customId.startsWith('punishment:appeal-submit:')){
      void (async()=>{
        const punishmentId=Number(interaction.customId.split(':')[2]);
        const punishment=await getPunishment(punishmentId);
        if(!punishment) return interaction.reply({content:'That punishment is no longer available.',ephemeral:true});
        if(interaction.user.id!==String(punishment.target_user_id)) return interaction.reply({content:'Only the member who received this punishment can appeal it.',ephemeral:true});
        if(!['active','completed'].includes(String(punishment.status))) return interaction.reply({content:`This punishment is already ${punishment.status}; there is no active action to appeal.`,ephemeral:true});
        await interaction.deferReply({ephemeral:true});
        try{
          const ticket=await createPunishmentAppealTicket(interaction,punishment,{
            reason:interaction.fields.getTextInputValue('appeal_reason'),evidenceLinks:interaction.fields.getTextInputValue('appeal_evidence')
          });
          const access=ticket.member_can_access&&ticket.channel_id?` You can continue in <#${ticket.channel_id}>.`:'';
          return interaction.editReply({content:ticket.existing?`An active appeal already exists as **${ticket.public_id}**.${access}`:`Your appeal was submitted as **${ticket.public_id}**.${access} Staff can review the original action, your explanation, and reverse it without erasing the audit history.`});
        }catch(error){return interaction.editReply({content:`I couldn’t open the appeal: ${cleanDiscordError(error)}`});}
      })().catch(error=>console.error('[tickets] punishment appeal submission failed',error));
      return;
    }

    if (!interaction.isButton()) return;
    const parts = interaction.customId.split(':');
    const id = Number(parts[2]);
    if (!Number.isInteger(id) || id <= 0) return;

    if(parts[0]==='punishment'&&parts[1]==='appeal'){
      void (async()=>{
        const punishment=await getPunishment(id);
        if(!punishment) return interaction.reply({content:'That punishment is no longer available.',ephemeral:true});
        if(interaction.user.id!==String(punishment.target_user_id)) return interaction.reply({content:'Only the member who received this punishment can appeal it.',ephemeral:true});
        if(!['active','completed'].includes(String(punishment.status))) return interaction.reply({content:`This punishment is already ${punishment.status}; there is no active action to appeal.`,ephemeral:true});
        const modal=new ModalBuilder().setCustomId(`punishment:appeal-submit:${id}`).setTitle(`Appeal ${punishment.public_id}`.slice(0,45));
        const reason=new TextInputBuilder().setCustomId('appeal_reason').setLabel('Why should staff review this action?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setPlaceholder('Explain what you believe was missed or incorrect.');
        const evidence=new TextInputBuilder().setCustomId('appeal_evidence').setLabel('New evidence or links (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setPlaceholder('Message links, clips, screenshots, or other context.');
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reason),new ActionRowBuilder<TextInputBuilder>().addComponents(evidence));
        await interaction.showModal(modal);
      })().catch(error=>console.error('[tickets] punishment appeal modal failed',error));
      return;
    }

    if(parts[0]==='ticket'&&parts[1]==='claim'){
      void (async()=>{
        const ticket=await getTicket(id);
        if(!ticket) return interaction.reply({content:'That ticket no longer exists.',ephemeral:true});
        if(!(await interactionCanManageTicket(interaction,ticket))) return interaction.reply({content:'Only the assigned staff team can claim this ticket.',ephemeral:true});
        const actor=ticketActor(interaction);
        await claimTicket(id,actor);
        await interaction.reply({content:`🙋 **${actor.name} claimed ${ticket.public_id}.**`,allowedMentions:{parse:[]}});
      })().catch(error=>console.error('[tickets] claim failed',error));
      return;
    }

    if(parts[0]==='ticket'&&parts[1]==='release'){
      void (async()=>{
        const ticket=await getTicket(id);
        if(!ticket) return interaction.reply({content:'That ticket no longer exists.',ephemeral:true});
        if(!(await interactionCanManageTicket(interaction,ticket))) return interaction.reply({content:'Only the assigned staff team can release this ticket.',ephemeral:true});
        if(ticket.status==='open'&&!ticket.claimed_by_user_id) return interaction.reply({content:`${ticket.public_id} is already unclaimed and available to the staff team.`,ephemeral:true});
        const actor=ticketActor(interaction);
        await releaseTicket(id,actor);
        await interaction.reply({content:`↩️ **${actor.name} released ${ticket.public_id} back to the open queue.** Another staff member can claim it.`,allowedMentions:{parse:[]}});
      })().catch(error=>console.error('[tickets] release failed',error));
      return;
    }

    if(parts[0]==='ticket'&&parts[1]==='waiting'){
      void (async()=>{
        const ticket=await getTicket(id);
        if(!ticket) return interaction.reply({content:'That ticket no longer exists.',ephemeral:true});
        if(!(await interactionCanManageTicket(interaction,ticket))) return interaction.reply({content:'Only the assigned staff team can change this ticket status.',ephemeral:true});
        const actor=ticketActor(interaction);
        await setTicketStatus(id,'awaiting_user',actor);
        await interaction.reply({content:`⏳ **Waiting on <@${ticket.opener_user_id}>.** Add the requested information here when you’re ready.`,allowedMentions:{users:[ticket.opener_user_id]}});
      })().catch(error=>console.error('[tickets] waiting status failed',error));
      return;
    }

    if(parts[0]==='ticket'&&parts[1]==='close'){
      void (async()=>{
        const ticket=await getTicket(id);
        if(!ticket) return interaction.reply({content:'That ticket no longer exists.',ephemeral:true});
        const settings=await getTicketSettings();
        const allowed=await interactionCanManageTicket(interaction,ticket)||settings.allow_user_close&&interaction.user.id===ticket.opener_user_id;
        if(!allowed) return interaction.reply({content:'You do not have permission to close this ticket.',ephemeral:true});
        const modal=new ModalBuilder().setCustomId(`ticket:close-submit:${id}`).setTitle(`Close ${ticket.public_id}`.slice(0,45));
        const reason=new TextInputBuilder().setCustomId('reason').setLabel('Closing reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setPlaceholder('Summarize the outcome or why the ticket is being closed.');
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reason));
        await interaction.showModal(modal);
      })().catch(error=>console.error('[tickets] close modal failed',error));
      return;
    }

    if(parts[0]==='ticket'&&parts[1]==='punish'){
      void (async()=>{
        const ticket=await getTicket(id);
        if(!ticket) return interaction.reply({content:'That ticket no longer exists.',ephemeral:true});
        if(!ticket.allow_punishments) return interaction.reply({content:'Punishment controls are not enabled for this ticket type.',ephemeral:true});
        if(!(await interactionCanManageTicket(interaction,ticket))) return interaction.reply({content:'Only the assigned staff team can issue a punishment.',ephemeral:true});
        const allowedOptions=[];
        for(const option of punishmentOptions){
          const parsed=parsePunishmentSelection(option.value);
          if(await interactionCanUsePunishment(interaction,ticket,parsed.action)) allowedOptions.push(option);
        }
        if(!allowedOptions.length) return interaction.reply({content:'Your Discord role can access this ticket but has not been authorized for any punishment level.',ephemeral:true});
        const menu=new StringSelectMenuBuilder().setCustomId(`ticket:punishment:${id}`).setPlaceholder('Choose a Discord punishment').addOptions(allowedOptions);
        await interaction.reply({content:'Choose the action to apply. You will review the member ID and reason before anything happens.',components:[new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],ephemeral:true});
      })().catch(error=>console.error('[tickets] punishment menu failed',error));
      return;
    }

    if(parts[0]==='ticket'&&parts[1]==='reverse'){
      void (async()=>{
        const punishment=await getPunishment(id);
        if(!punishment) return interaction.reply({content:'That punishment no longer exists.',ephemeral:true});
        const authorizationTicketId=Number(parts[3]||punishment.ticket_id||0);
        const ticket=authorizationTicketId?await getTicket(authorizationTicketId):null;
        if(!ticket||!(await interactionCanUsePunishment(interaction,ticket,'reverse'))) return interaction.reply({content:'Your Discord role is not authorized to reverse this punishment.',ephemeral:true});
        if(!['active','completed'].includes(String(punishment.status))) return interaction.reply({content:`${punishment.public_id} is already ${punishment.status}.`,ephemeral:true});
        const modal=new ModalBuilder().setCustomId(`ticket:reverse-submit:${id}${authorizationTicketId?`:${authorizationTicketId}`:''}`).setTitle(`Reverse ${punishment.public_id}`.slice(0,45));
        const reason=new TextInputBuilder().setCustomId('reason').setLabel('Required reversal reason').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setPlaceholder('Explain why the punishment is being reversed.');
        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reason));
        await interaction.showModal(modal);
      })().catch(error=>console.error('[tickets] reversal modal failed',error));
      return;
    }

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

    if(parts[0]==='issue'&&parts[1]==='ignore'){
      void (async()=>{
        const submitterId=parts[3]||'';
        if(submitterId&&interaction.user.id!==submitterId) return interaction.reply({content:'This decision belongs to the person who reported the problem.',ephemeral:true});
        await interaction.deferUpdate();
        await interaction.message.delete().catch(async()=>{
          await interaction.editReply({content:'Got it — I’ll leave this one alone. 🤐',components:[],allowedMentions:{parse:[]}});
        });
      })().catch(error=>console.error('[discord] known issue ignore failed',error));
      return;
    }

    if(parts[0]==='issue'&&parts[1]==='report'){
      void (async()=>{
        const submitterId=parts[3]||'';
        if(submitterId&&interaction.user.id!==submitterId) return interaction.reply({content:'This decision belongs to the person who reported the problem.',ephemeral:true});
        const issue=await getIssue(id);
        if(!issue) return interaction.reply({content:'That issue is no longer available.',ephemeral:true});
        await interaction.deferUpdate();
        const added=await addIssueReport(id,null,interaction.user.id,'Confirmed from an automatic Discord issue detection.','discord_confirmation');
        const threadId=await ensureIssueDiscordThread(id).catch(error=>{console.warn('[issues] unable to create confirmed issue discussion',error);return null;});
        await syncIssueDiscordPost(id).catch(()=>null);
        await interaction.editReply({
          content:added?`Now we’re debugging 🐛 Your report was added to **${issue.public_id||`BUG-${id}`}**.`:`You’re already counted on **${issue.public_id||`BUG-${id}`}**.`,
          components:knownIssueButtons(id,threadId||issue.discord_thread_id||null),allowedMentions:{parse:[]}
        });
      })().catch(error=>console.error('[discord] known issue confirmation failed',error));
      return;
    }

    if(parts[0]==='candidate'&&parts[1]==='ignore'){
      void (async()=>{
        const submitterId=parts[3]||'';
        if(submitterId&&interaction.user.id!==submitterId) return interaction.reply({content:'This decision belongs to the person who reported the problem.',ephemeral:true});
        await interaction.deferUpdate();
        await dismissIssueCandidate(id,interaction.user.id).catch(error=>console.warn('[issues] unable to dismiss issue candidate',error));
        await interaction.message.delete().catch(async()=>{
          await interaction.editReply({content:'Got it — I’ll leave this one alone. 🤐',components:[],allowedMentions:{parse:[]}});
        });
      })().catch(error=>console.error('[discord] candidate ignore failed',error));
      return;
    }

    if (parts[0] === 'candidate' && parts[1] === 'report') {
      void (async () => {
        const submitterId=parts[3]||'';
        if(submitterId&&interaction.user.id!==submitterId) return interaction.reply({content:'This decision belongs to the person who reported the problem.',ephemeral:true});
        await interaction.deferUpdate();
        const result = await confirmIssueCandidate(id, interaction.user.id, 'report');
        if (!result.candidate) return interaction.editReply({ content: 'That possible issue is no longer available.', components: [] });
        const issue=await promoteConfirmedIssueCandidate(id);
        if(!issue) return interaction.editReply({content:'I saved the report, but couldn’t create its issue record yet. Staff can still see it in the dashboard.',components:[]});
        const threadId=await ensureIssueDiscordThread(Number(issue.id)).catch(error=>{console.warn('[issues] unable to publish confirmed issue discussion',error);return null;});
        await syncIssueDiscordPost(Number(issue.id)).catch(()=>null);
        return interaction.editReply({
          content:`Now we’re debugging 🐛 I created **${issue.public_id||`BUG-${issue.id}`} · ${issue.title}**.${threadId?' Add the details, screenshots, clips, or links in its discussion so we can narrow this down.':' Staff can see it in the dashboard; the Discord issue destination still needs to be configured.'}`,
          components:knownIssueButtons(Number(issue.id),threadId),allowedMentions:{parse:[]}
        });
      })().catch(error => console.error('[discord] candidate button failed', error));
      return;
    }

    if(parts[0]==='suggestion'&&parts[1]==='ignore'){
      void (async()=>{
        const submitterId=parts[3]||'';
        if(submitterId&&interaction.user.id!==submitterId){
          return interaction.reply({content:'This decision belongs to the person who shared the idea.',ephemeral:true});
        }
        await interaction.deferUpdate();
        await dismissSuggestionCandidate(id,interaction.user.id).catch(error=>
          console.warn('[suggestions] unable to dismiss suggestion candidate',error)
        );
        await interaction.message.delete().catch(async()=>{
          await interaction.editReply({content:'No worries — I’ll leave this one alone. 🤐',components:[],allowedMentions:{parse:[]}});
        });
      })().catch(error=>console.error('[discord] suggestion ignore button failed',error));
      return;
    }

    if(parts[0]==='suggestion'&&parts[1]==='confirm'){
      void (async()=>{
        const submitterId=parts[3]||'';
        if(submitterId&&interaction.user.id!==submitterId){
          return interaction.reply({content:'This decision belongs to the person who shared the idea.',ephemeral:true});
        }
        const suggestion=await getSuggestion(id);
        if(!suggestion) return interaction.reply({content:'That suggestion is no longer available.',ephemeral:true});
        await interaction.deferUpdate();
        await refineSuggestionForPublishing(id);
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
            components:suggestionConfirmationButtons(id,submitterId||interaction.user.id),
            allowedMentions:{parse:[]}
          });
        }
        await db.query(`
          INSERT INTO suggestion_updates (suggestion_id,update_type,note,created_by)
          VALUES ($1,'confirmed','Confirmed from the Discord suggestion prompt.',$2)`,[id,interaction.user.id]).catch(()=>null);
        return interaction.editReply({
          content:`Now we’re cooking 🌶️\n\n**${publicId} · ${current.title}** is live on the suggestion board. Open the discussion and tell me how you picture it working. Add examples, links, screenshots, or anything else that helps explain the idea — I’ll keep the dashboard organized as the details develop.`,
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
