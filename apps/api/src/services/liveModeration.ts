import { PermissionFlagsBits } from 'discord.js';
import { db } from '../db.js';
import { discord } from '../discord/client.js';

export type EffectiveModerationMode = 'off'|'observe'|'live';

export type LiveModerationReadiness = {
  connected: boolean;
  guild_found: boolean;
  send_messages: boolean;
  manage_messages: boolean;
  moderate_members: boolean;
  ready: boolean;
  reason: string | null;
};

export type LiveModerationState = {
  effective_mode: EffectiveModerationMode;
  live_enabled: boolean;
  readiness: LiveModerationReadiness;
  pending_actions: number;
  failed_actions_24h: number;
};

type LiveCase = {
  id: number;
  public_id: string | null;
  guild_id: string;
  channel_id: string;
  channel_name: string | null;
  message_id: string;
  discord_user_id: string;
  author_name: string | null;
  rule_title: string;
  confidence: number | string;
  recommended_action: string;
  delete_message_recommended: boolean;
  offense_number: number;
  prior_confirmed_count: number;
  repeat_window_days_used: number | null;
  staff_review_required: boolean;
  created_at: string | Date;
};

type LiveActionStatus = 'completed'|'partial'|'failed'|'skipped';

type LiveActionResults = {
  action: string;
  offense_number: number;
  delete_message_required: boolean;
  staff_review_required: boolean;
  notice_sent?: boolean;
  notice_message_id?: string | null;
  message_deleted?: boolean;
  message_already_missing?: boolean;
  timeout_applied?: boolean;
  timeout_minutes?: number | null;
  errors: string[];
  completed_at: string;
};

const LIVE_POLL_MS = 2000;
const LIVE_CASE_MAX_AGE_MINUTES = 5;
let workerTimer: NodeJS.Timeout | null = null;
let workerRunning = false;

function cleanError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g,' ').trim().slice(0,500);
}

function actionLabel(action: string) {
  switch (action) {
    case 'reminder': return 'Reminder';
    case 'warning': return 'Warning';
    case 'timeout_10m': return '10 minute timeout';
    case 'timeout_1h': return '1 hour timeout';
    default: return action.replaceAll('_',' ');
  }
}

function expectedTimeoutMinutes(action: string): number | null {
  if (action === 'timeout_10m') return 10;
  if (action === 'timeout_1h') return 60;
  return null;
}

export async function getLiveModerationReadiness(): Promise<LiveModerationReadiness> {
  if (!discord.isReady() || !discord.user) {
    return {
      connected:false,guild_found:false,send_messages:false,manage_messages:false,moderate_members:false,
      ready:false,reason:'Discord bot is not connected.'
    };
  }

  const settings = await db.query('SELECT audit_channel_id FROM moderation_settings WHERE id=1');
  void settings; // Keeps readiness independent from whether an audit channel is configured.

  const guildIdResult = await db.query(`SELECT guild_id FROM discord_messages WHERE guild_id IS NOT NULL ORDER BY id DESC LIMIT 1`);
  let guildId = guildIdResult.rows[0]?.guild_id ? String(guildIdResult.rows[0].guild_id) : '';

  if (!guildId && discord.guilds.cache.size === 1) {
    guildId = discord.guilds.cache.first()?.id || '';
  }

  const guild = guildId ? discord.guilds.cache.get(guildId) : discord.guilds.cache.first();
  if (!guild) {
    return {
      connected:true,guild_found:false,send_messages:false,manage_messages:false,moderate_members:false,
      ready:false,reason:'Configured Discord guild is not available to the bot.'
    };
  }

  const member = guild.members.me || await guild.members.fetch(discord.user.id).catch(() => null);
  if (!member) {
    return {
      connected:true,guild_found:true,send_messages:false,manage_messages:false,moderate_members:false,
      ready:false,reason:'Unable to resolve the Saucin AI bot member in Discord.'
    };
  }

  const sendMessages = member.permissions.has(PermissionFlagsBits.SendMessages);
  const manageMessages = member.permissions.has(PermissionFlagsBits.ManageMessages);
  const moderateMembers = member.permissions.has(PermissionFlagsBits.ModerateMembers);
  const ready = sendMessages && manageMessages && moderateMembers;

  return {
    connected:true,
    guild_found:true,
    send_messages:sendMessages,
    manage_messages:manageMessages,
    moderate_members:moderateMembers,
    ready,
    reason:ready ? null : 'Live enforcement requires Send Messages, Manage Messages, and Moderate Members.'
  };
}

export async function getLiveModerationState(): Promise<LiveModerationState> {
  const [settings,pending,failed,readiness] = await Promise.all([
    db.query('SELECT mode,live_enforcement_enabled FROM moderation_settings WHERE id=1'),
    db.query(`SELECT count(*)::int AS count FROM moderation_cases WHERE live_action_status IN ('pending','processing')`),
    db.query(`SELECT count(*)::int AS count FROM moderation_cases WHERE live_action_status IN ('partial','failed') AND live_action_at>NOW()-INTERVAL '24 hours'`),
    getLiveModerationReadiness()
  ]);
  const row = settings.rows[0] || {};
  const liveEnabled = Boolean(row.live_enforcement_enabled);
  const baseMode = row.mode === 'observe' ? 'observe' : 'off';
  return {
    effective_mode: liveEnabled ? 'live' : baseMode,
    live_enabled: liveEnabled,
    readiness,
    pending_actions:Number(pending.rows[0]?.count||0),
    failed_actions_24h:Number(failed.rows[0]?.count||0)
  };
}

async function recordSkippedCases(ids: number[], reason: string) {
  for (const id of ids) {
    await db.query(
      `INSERT INTO moderation_case_events (case_id,event_type,details) VALUES ($1,'live_action_skipped',$2::jsonb)`,
      [id,JSON.stringify({reason})]
    ).catch(() => undefined);
  }
}

async function cancelPendingLiveActions(reason: string) {
  const result = await db.query(`
    UPDATE moderation_cases
       SET live_action_status='skipped',
           live_action_results=jsonb_build_object('errors',jsonb_build_array($1::text),'completed_at',NOW()),
           live_action_at=NOW(),
           updated_at=NOW()
     WHERE live_action_status='pending'
     RETURNING id`,[reason]);
  await recordSkippedCases(result.rows.map(row=>Number(row.id)),reason);
}

export async function setLiveModerationMode(mode: EffectiveModerationMode) {
  if (mode === 'live') {
    const readiness = await getLiveModerationReadiness();
    if (!readiness.ready) {
      throw new Error(readiness.reason || 'Saucin AI is not ready for live moderation actions.');
    }

    // Observe-only Discord audit posts are disabled while live enforcement is active
    // to avoid sending a misleading/duplicate "observe-only" message. The live worker
    // posts its own execution result to the configured staff audit channel.
    await db.query(`
      UPDATE moderation_settings
         SET mode='observe',live_enforcement_enabled=TRUE,post_observations_to_audit=FALSE,updated_at=NOW()
       WHERE id=1`);
  } else {
    await db.query(`
      UPDATE moderation_settings
         SET mode=$1,live_enforcement_enabled=FALSE,updated_at=NOW()
       WHERE id=1`,[mode]);
    await cancelPendingLiveActions(`Live moderation changed to ${mode} before execution.`);
  }
  return getLiveModerationState();
}

async function markStaleOrDismissedCases() {
  const stale = await db.query(`
    UPDATE moderation_cases
       SET live_action_status='skipped',
           live_action_results=jsonb_build_object('errors',jsonb_build_array('Live action expired before execution.'),'completed_at',NOW()),
           live_action_at=NOW(),
           updated_at=NOW()
     WHERE live_action_status='pending'
       AND created_at < NOW() - INTERVAL '${LIVE_CASE_MAX_AGE_MINUTES} minutes'
     RETURNING id`);
  await recordSkippedCases(stale.rows.map(row=>Number(row.id)),'Live action expired before execution.');

  const dismissed = await db.query(`
    UPDATE moderation_cases
       SET live_action_status='skipped',
           live_action_results=jsonb_build_object('errors',jsonb_build_array('Case was dismissed before live action execution.'),'completed_at',NOW()),
           live_action_at=NOW(),
           updated_at=NOW()
     WHERE live_action_status='pending'
       AND status='dismissed'
     RETURNING id`);
  await recordSkippedCases(dismissed.rows.map(row=>Number(row.id)),'Case was dismissed before live action execution.');

  const interrupted = await db.query(`
    UPDATE moderation_cases
       SET live_action_status='failed',
           live_action_results=jsonb_build_object('errors',jsonb_build_array('Live worker was interrupted after claiming this case; action was not retried for safety.'),'completed_at',NOW()),
           live_action_at=NOW(),
           updated_at=NOW()
     WHERE live_action_status='processing'
       AND live_action_started_at < NOW() - INTERVAL '${LIVE_CASE_MAX_AGE_MINUTES} minutes'
     RETURNING id`);
  for (const row of interrupted.rows) {
    await db.query(
      `INSERT INTO moderation_case_events (case_id,event_type,details) VALUES ($1,'live_action_failed',$2::jsonb)`,
      [Number(row.id),JSON.stringify({reason:'Worker interruption; no automatic retry.'})]
    ).catch(() => undefined);
  }
}

async function claimNextCase(): Promise<LiveCase | null> {
  const result = await db.query(`
    WITH next_case AS (
      SELECT c.id
        FROM moderation_cases c
       WHERE c.live_action_status='pending'
         AND c.status<>'dismissed'
         AND c.created_at >= NOW() - INTERVAL '${LIVE_CASE_MAX_AGE_MINUTES} minutes'
         AND EXISTS (SELECT 1 FROM moderation_settings s WHERE s.id=1 AND s.live_enforcement_enabled=TRUE)
       ORDER BY c.id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
    )
    UPDATE moderation_cases c
       SET live_action_status='processing',live_action_started_at=NOW(),updated_at=NOW()
      FROM next_case n
     WHERE c.id=n.id
     RETURNING c.*`);
  return result.rowCount ? result.rows[0] as LiveCase : null;
}

async function finalizeCase(caseRow: LiveCase, status: LiveActionStatus, results: LiveActionResults) {
  await db.query(`
    UPDATE moderation_cases
       SET live_action_status=$2,live_action_results=$3::jsonb,live_action_at=NOW(),updated_at=NOW()
     WHERE id=$1`,[caseRow.id,status,JSON.stringify(results)]);

  const eventType = status === 'completed'
    ? 'live_action_completed'
    : status === 'partial'
      ? 'live_action_partial'
      : status === 'failed'
        ? 'live_action_failed'
        : 'live_action_skipped';
  await db.query(
    `INSERT INTO moderation_case_events (case_id,event_type,details) VALUES ($1,$2,$3::jsonb)`,
    [caseRow.id,eventType,JSON.stringify(results)]
  );
}

async function postLiveAudit(caseRow: LiveCase, status: LiveActionStatus, results: LiveActionResults) {
  const setting = await db.query('SELECT audit_channel_id FROM moderation_settings WHERE id=1');
  const auditChannelId = setting.rows[0]?.audit_channel_id ? String(setting.rows[0].audit_channel_id) : '';
  if (!auditChannelId || !discord.isReady()) return;

  try {
    const channel = await discord.channels.fetch(auditChannelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return;
    const errors = results.errors.length ? `\n**Errors:** ${results.errors.join(' | ').slice(0,650)}` : '';
    const review = caseRow.staff_review_required ? '\n**Staff review:** REQUIRED' : '';
    const actions = [
      actionLabel(caseRow.recommended_action),
      caseRow.delete_message_recommended ? 'delete message' : '',
      caseRow.staff_review_required ? 'staff review' : ''
    ].filter(Boolean).join(' + ');
    await (channel as any).send({
      content:(`**${caseRow.public_id || `MOD-${caseRow.id}`} · Live moderation action**\n`+
        `**Member:** ${caseRow.author_name || caseRow.discord_user_id} (${caseRow.discord_user_id})\n`+
        `**Rule:** ${caseRow.rule_title}\n`+
        `**Confidence:** ${Math.round(Number(caseRow.confidence)*100)}%\n`+
        `**Escalation:** offense #${caseRow.offense_number} (${caseRow.prior_confirmed_count} prior staff-confirmed)\n`+
        `**Action:** ${actions}\n`+
        `**Execution:** ${status.toUpperCase()}${review}${errors}`).slice(0,1900),
      allowedMentions:{parse:[]}
    });
  } catch (error) {
    console.warn('[moderation] unable to post live action audit',error);
  }
}

async function executeCase(caseRow: LiveCase) {
  const errors: string[] = [];
  let noticeSent = false;
  let noticeMessageId: string | null = null;
  let messageDeleted = false;
  let messageAlreadyMissing = false;
  let timeoutApplied = false;
  const timeoutMinutes = expectedTimeoutMinutes(caseRow.recommended_action);

  const guild = discord.guilds.cache.get(caseRow.guild_id);
  if (!guild) errors.push('Discord guild is unavailable.');

  const channel = await discord.channels.fetch(caseRow.channel_id).catch(error => {
    errors.push(`Unable to fetch Discord channel: ${cleanError(error)}`);
    return null;
  });
  const textChannel = channel && channel.isTextBased() && !channel.isDMBased() ? channel as any : null;
  if (!textChannel) errors.push('Discord channel is unavailable or is not text-based.');

  let sourceMessage: any = null;
  if (textChannel) {
    sourceMessage = await textChannel.messages.fetch(caseRow.message_id).catch(() => null);
  }

  if (caseRow.delete_message_recommended) {
    if (!sourceMessage) {
      messageDeleted = true;
      messageAlreadyMissing = true;
    } else if (sourceMessage.deletable) {
      try {
        await sourceMessage.delete();
        messageDeleted = true;
      } catch (error) {
        errors.push(`Delete message failed: ${cleanError(error)}`);
      }
    } else {
      errors.push('Delete message failed: message is not deletable by Saucin AI.');
    }
  }

  if (timeoutMinutes !== null) {
    if (!guild) {
      errors.push('Timeout failed: guild is unavailable.');
    } else {
      const member = await guild.members.fetch(caseRow.discord_user_id).catch(error => {
        errors.push(`Timeout failed: unable to fetch member (${cleanError(error)}).`);
        return null;
      });
      if (member) {
        if (!member.moderatable) {
          errors.push('Timeout failed: the member is not moderatable by the Saucin AI role (check Discord role hierarchy).');
        } else {
          try {
            await member.timeout(timeoutMinutes*60_000,`${caseRow.public_id || `MOD-${caseRow.id}`} · ${caseRow.rule_title} · offense #${caseRow.offense_number}`.slice(0,500));
            timeoutApplied = true;
          } catch (error) {
            errors.push(`Timeout failed: ${cleanError(error)}`);
          }
        }
      }
    }
  }

  if (textChannel) {
    const caseId = caseRow.public_id || `MOD-${caseRow.id}`;
    let notice = '';
    if (caseRow.recommended_action === 'reminder') {
      notice = `<@${caseRow.discord_user_id}> **Reminder:** Please follow **${caseRow.rule_title}**. Continued staff-confirmed violations of this rule may escalate. \`${caseId}\``;
    } else if (caseRow.recommended_action === 'warning') {
      notice = `<@${caseRow.discord_user_id}> **Warning:** Please follow **${caseRow.rule_title}**. Continued staff-confirmed violations of this rule may result in a timeout. \`${caseId}\``;
    } else if (timeoutMinutes !== null) {
      notice = `<@${caseRow.discord_user_id}> automated moderation applied a **${timeoutMinutes === 60 ? '1 hour' : '10 minute'} timeout** under **${caseRow.rule_title}**. \`${caseId}\``;
    }

    if (notice) {
      try {
        const sent = await textChannel.send({content:notice.slice(0,1900),allowedMentions:{parse:[],users:[caseRow.discord_user_id]}});
        noticeSent = true;
        noticeMessageId = sent.id;
      } catch (error) {
        errors.push(`Moderation notice failed: ${cleanError(error)}`);
      }
    }
  }

  const requiredChecks: boolean[] = [];
  requiredChecks.push(noticeSent);
  if (caseRow.delete_message_recommended) requiredChecks.push(messageDeleted);
  if (timeoutMinutes !== null) requiredChecks.push(timeoutApplied);
  const successes = requiredChecks.filter(Boolean).length;
  const status: LiveActionStatus = errors.length === 0 && requiredChecks.every(Boolean)
    ? 'completed'
    : successes > 0
      ? 'partial'
      : 'failed';

  const results: LiveActionResults = {
    action:caseRow.recommended_action,
    offense_number:caseRow.offense_number,
    delete_message_required:Boolean(caseRow.delete_message_recommended),
    staff_review_required:Boolean(caseRow.staff_review_required),
    notice_sent:noticeSent,
    notice_message_id:noticeMessageId,
    message_deleted:messageDeleted,
    message_already_missing:messageAlreadyMissing,
    timeout_applied:timeoutApplied,
    timeout_minutes:timeoutMinutes,
    errors,
    completed_at:new Date().toISOString()
  };

  await finalizeCase(caseRow,status,results);
  await postLiveAudit(caseRow,status,results);
}

async function runWorkerTick() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const settings = await db.query('SELECT live_enforcement_enabled FROM moderation_settings WHERE id=1');
    if (!settings.rows[0]?.live_enforcement_enabled) return;
    if (!discord.isReady()) return;

    await markStaleOrDismissedCases();
    const readiness = await getLiveModerationReadiness();
    if (!readiness.ready) return;

    for (let i=0;i<10;i+=1) {
      const caseRow = await claimNextCase();
      if (!caseRow) break;
      try {
        await executeCase(caseRow);
      } catch (error) {
        const results: LiveActionResults = {
          action:caseRow.recommended_action,
          offense_number:caseRow.offense_number,
          delete_message_required:Boolean(caseRow.delete_message_recommended),
          staff_review_required:Boolean(caseRow.staff_review_required),
          errors:[`Unexpected live moderation failure: ${cleanError(error)}`],
          completed_at:new Date().toISOString()
        };
        await finalizeCase(caseRow,'failed',results).catch(() => undefined);
        await postLiveAudit(caseRow,'failed',results).catch(() => undefined);
      }
    }
  } catch (error) {
    console.error('[moderation] live worker tick failed',error);
  } finally {
    workerRunning = false;
  }
}

export function startLiveModerationWorker() {
  if (workerTimer) return;
  void runWorkerTick();
  workerTimer = setInterval(() => void runWorkerTick(),LIVE_POLL_MS);
  workerTimer.unref();
  console.log('[moderation] live enforcement worker started');
}

export function stopLiveModerationWorker() {
  if (!workerTimer) return;
  clearInterval(workerTimer);
  workerTimer = null;
}
