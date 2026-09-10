import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { can, getDashboardAccess } from '../../../lib/permissions';
import DirectSettingsForm from '../../../components/DirectSettingsForm';
import LiveRefresh from '../../../components/LiveRefresh';

type BotSettings = {
  direct_mentions_enabled: boolean;
  direct_mentions_bypass_channel_mode: boolean;
  direct_mentions_use_reply_context: boolean;
  direct_mentions_use_recent_context: boolean;
  direct_mentions_context_messages: number;
  updated_at?: string;
};

type AiHealth = {
  status:string;configured:boolean;enabled:boolean;needs_attention:boolean;summary:string;
  consecutive_failures?:number;total_requests?:number;total_failures?:number;
  last_success_at?:string|null;last_failure_at?:string|null;last_error_kind?:string|null;
  last_error_message?:string|null;cooldown_remaining_seconds?:number;
};

const defaults: BotSettings = {
  direct_mentions_enabled: true,
  direct_mentions_bypass_channel_mode: true,
  direct_mentions_use_reply_context: true,
  direct_mentions_use_recent_context: true,
  direct_mentions_context_messages: 8
};

export default async function BotSettingsPage() {
  const access=await getDashboardAccess();
  if(!can(access,'settings.bot.manage')) redirect('/settings');
  let settings = defaults;
  let aiHealth:AiHealth={status:'unknown',configured:false,enabled:false,needs_attention:false,summary:'AI status is unavailable.'};
  let loadError = '';
  try {
    [settings,aiHealth] = await Promise.all([
      api<BotSettings>('/api/bot/settings'),
      api<AiHealth>('/api/ai/health')
    ]);
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Unable to load bot settings.';
  }

  return <>
    <LiveRefresh interval={30000}/>
    <header className="pageHeader">
      <div>
        <p className="eyebrow">SETTINGS</p>
        <h1>Bot Behavior</h1>
        <p>Control how Saucin AI reacts when someone directly asks it to verify or clarify something in a Discord conversation.</p>
      </div>
      <Link className="button" href="/settings/knowledge">Knowledge Settings</Link>
    </header>

    {loadError ? <div className="alert error">Could not load bot settings: {loadError}</div> : null}

    <section className="panel settingsSection">
      <div className="panelTitle">
        <div><h2>AI service health</h2><p>{aiHealth.summary}</p></div>
        <span className={`statusBadge ${aiHealth.status==='healthy'?'status-published':aiHealth.needs_attention?'severity-critical':'status-reviewing'}`}>{aiHealth.status.replaceAll('_',' ')}</span>
      </div>
      <div className="formGrid">
        <div className="lockedField"><span>Configuration</span><strong>{aiHealth.configured?'API key configured':'API key missing'}</strong><small>{aiHealth.enabled?'AI features enabled':'AI features disabled'}</small></div>
        <div className="lockedField"><span>Recent requests</span><strong>{aiHealth.total_requests??0}</strong><small>{aiHealth.total_failures??0} provider failure{aiHealth.total_failures===1?'':'s'} recorded</small></div>
        <div className="lockedField"><span>Last success</span><strong>{aiHealth.last_success_at?new Date(aiHealth.last_success_at).toLocaleString():'No successful request yet'}</strong><small>{aiHealth.cooldown_remaining_seconds?`Automatic retry in about ${aiHealth.cooldown_remaining_seconds} seconds`:'Ready for the next request'}</small></div>
      </div>
      {aiHealth.needs_attention?<div className="alert error"><strong>{aiHealth.last_error_kind?.replaceAll('_',' ')||'AI configuration'}:</strong> {aiHealth.last_error_message||'Check the OpenAI key and account quota in the Unraid .env file.'}</div>:null}
      <p className="viewOnlyNote">When AI is unavailable, Saucin AI keeps monitoring Discord and uses its conservative rule-based routing. It will not guess, auto-punish, or publish unverified knowledge.</p>
    </section>

    <section className="panel settingsSection">
      <div className="panelTitle">
        <div>
          <h2>Direct mentions & clarification</h2>
          <p>These settings apply when a member explicitly mentions @Saucin AI. Ignored channels remain hard-disabled.</p>
        </div>
      </div>

      <DirectSettingsForm
        operation="bot.update"
        className="botSettingsForm"
        idleLabel="Save bot behavior"
        pendingLabel="Saving bot behavior…"
        successMessage="Bot behavior saved."
        actionsClassName="formActions botSettingsActions"
        footer={<p>The bot still answers only from knowledge the asking member is authorized to access.</p>}
      >
        <label className="settingToggleCard">
          <input type="checkbox" name="direct_mentions_enabled" defaultChecked={settings.direct_mentions_enabled} />
          <span><strong>Respond to direct mentions</strong><small>Allows members to ping the bot for verification, clarification, or an answer.</small></span>
        </label>

        <label className="settingToggleCard">
          <input type="checkbox" name="direct_mentions_bypass_channel_mode" defaultChecked={settings.direct_mentions_bypass_channel_mode} />
          <span><strong>Bypass normal channel reply mode when mentioned</strong><small>A direct @Saucin AI request can receive an answer even in a monitor-only channel. Channels set to Ignored still stay silent.</small></span>
        </label>

        <label className="settingToggleCard">
          <input type="checkbox" name="direct_mentions_use_reply_context" defaultChecked={settings.direct_mentions_use_reply_context} />
          <span><strong>Use replied-to message as context</strong><small>If someone replies to a Discord message and pings the bot, that message becomes primary clarification context.</small></span>
        </label>

        <label className="settingToggleCard">
          <input type="checkbox" name="direct_mentions_use_recent_context" defaultChecked={settings.direct_mentions_use_recent_context} />
          <span><strong>Read recent conversation context</strong><small>Helps the bot understand phrases like “is this allowed?”, “verify this”, or “are they right?” without requiring the rule to be repeated.</small></span>
        </label>

        <label className="field botContextCount">
          <span>Recent messages to consider</span>
          <input className="input" type="number" min="0" max="25" name="direct_mentions_context_messages" defaultValue={settings.direct_mentions_context_messages} />
          <small>Recommended: 6–10. Replied-to messages are included separately.</small>
        </label>

        <div className="mentionExamples">
          <strong>Examples</strong>
          <code>@Saucin AI is this allowed?</code>
          <code>@Saucin AI verify this</code>
          <code>@Saucin AI what does the rule say here?</code>
          <code>Reply to a message → @Saucin AI clarify this</code>
        </div>
      </DirectSettingsForm>
    </section>
  </>;
}
