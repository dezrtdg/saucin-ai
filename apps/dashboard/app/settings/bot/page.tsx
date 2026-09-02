import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { can, getDashboardAccess } from '../../../lib/permissions';
import DirectSettingsForm from '../../../components/DirectSettingsForm';

type BotSettings = {
  direct_mentions_enabled: boolean;
  direct_mentions_bypass_channel_mode: boolean;
  direct_mentions_use_reply_context: boolean;
  direct_mentions_use_recent_context: boolean;
  direct_mentions_context_messages: number;
  updated_at?: string;
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
  let loadError = '';
  try {
    settings = await api<BotSettings>('/api/bot/settings');
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Unable to load bot settings.';
  }

  return <>
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
