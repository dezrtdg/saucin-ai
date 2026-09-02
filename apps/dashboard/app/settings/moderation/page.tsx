import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { can, getDashboardAccess } from '../../../lib/permissions';
import PendingActionButton from '../../../components/PendingActionButton';
import { saveModerationRuleAction, saveModerationSettingsAction } from './actions';
import styles from '../../moderation/moderation.module.css';

type Role={id:string;name:string;color:string};
type Channel={id:string;name:string|null;mode:string;monitor_messages:boolean};
type Rule={
  id:number;
  title:string;
  category:string;
  moderation_enabled:boolean;
  minimum_confidence:number|string|null;
  repeat_window_days:number|null;
  exempt_role_ids:string[];
  channel_ids:string[];
};
type Settings={mode:'off'|'observe';minimum_confidence:number;repeat_window_days:number;audit_channel_id:string|null;post_observations_to_audit:boolean;exempt_role_ids:string[];diagnostics_enabled:boolean};
type Data={settings:Settings;roles:Role[];rules:Rule[];channels:Channel[]};
type LiveState={
  effective_mode:'off'|'observe'|'live';
  live_enabled:boolean;
  readiness:{connected:boolean;guild_found:boolean;send_messages:boolean;manage_messages:boolean;moderate_members:boolean;ready:boolean;reason:string|null};
  pending_actions:number;
  failed_actions_24h:number;
};

function readyLabel(value:boolean){return value?'✓ Ready':'✕ Missing'}

export default async function ModerationSettingsPage(){
  const access=await getDashboardAccess();
  if(!can(access,'moderation.configure')) redirect('/settings');
  const [data,live]=await Promise.all([
    api<Data>('/api/moderation/settings'),
    api<LiveState>('/api/moderation/live')
  ]);
  const s=data.settings;
  const monitored=data.channels.filter(c=>c.monitor_messages&&c.mode!=='ignored');
  const canTakeActions=can(access,'moderation.actions');
  const canEnableLive=live.readiness.ready&&canTakeActions;

  return <>
    <header className="pageHeader">
      <div>
        <p className="eyebrow">MODERATION</p>
        <h1>Moderation Settings</h1>
        <p>Run Saucin AI in Observe Mode for review-only detection or enable Live Enforcement when Discord permissions and staff controls are ready.</p>
      </div>
      <div className={styles.headerActions}>
        <Link className="button" href="/settings/moderation/diagnostics">Diagnostics</Link>
        <Link className="button" href="/moderation">Open Moderation Queue</Link>
      </div>
    </header>

    <div className={styles.info}><strong>v1.4 progression:</strong> Observe Mode requires staff confirmation. In Live Enforcement, a successful primary action automatically confirms the case and advances future escalation. Staff can dismiss an auto-confirmed case to correct the history.</div>

    <section className="panel settingsSection">
      <div className="panelTitle"><div><h2>Global moderation</h2><p>Moderation only evaluates Discord channels already enabled for monitoring on the Channels page.</p></div><span className="badge">{live.effective_mode.toUpperCase()}</span></div>
      <form action={saveModerationSettingsAction} className="knowledgeForm">
        <div className={styles.settingsGrid}>
          <label className="field"><span>Mode</span><select className="input select" name="mode" defaultValue={live.effective_mode}><option value="off">Off</option><option value="observe">Observe only</option><option value="live" disabled={!canEnableLive&&live.effective_mode!=='live'}>Live enforcement</option></select><small>{canTakeActions?(live.readiness.ready?'Live enforcement is available.':'Live is locked until the Discord permission check passes.'):'Your dashboard role does not have the Take Moderation Actions permission.'}</small></label>
          <label className="field"><span>Minimum AI confidence</span><input className="input" type="number" min="0.50" max="0.99" step="0.01" name="minimum_confidence" defaultValue={Number(s.minimum_confidence).toFixed(2)}/><small>Recommended starting point: 0.90.</small></label>
          <label className="field"><span>Repeat-offense window</span><input className="input" type="number" min="1" max="90" name="repeat_window_days" defaultValue={s.repeat_window_days}/><small>Observe cases count after staff confirmation. Successful Live actions count automatically. Dismissed cases never count.</small></label>
          <label className="field"><span>Staff audit channel</span><select className="input select" name="audit_channel_id" defaultValue={s.audit_channel_id||''}><option value="">Dashboard only</option>{data.channels.map(c=><option key={c.id} value={c.id}>#{c.name||c.id}</option>)}</select><small>In Live mode, completed/failed actions are posted here automatically when a channel is configured.</small></label>
          <label className="settingToggleCard"><input type="checkbox" name="post_observations_to_audit" defaultChecked={s.post_observations_to_audit} disabled={live.effective_mode==='live'}/><span><strong>Post Observe detections to audit channel</strong><small>Used only in Observe Mode. Live mode posts action results instead to avoid duplicate audit messages.</small></span></label>
          <label className="settingToggleCard"><input type="checkbox" name="diagnostics_enabled" defaultChecked={s.diagnostics_enabled}/><span><strong>Enable moderation diagnostics</strong><small>Temporarily record why each Discord message was processed or skipped. Keep this off when you are done tuning.</small></span></label>
          <div className={`${styles.full}`}><div className="settingsSubsection"><h3>Globally exempt Discord roles</h3><p>Members with any selected role are skipped before AI analysis.</p></div><div className={styles.checkGrid}>{data.roles.map(r=><label className={styles.check} key={r.id}><input type="checkbox" name="exempt_role_ids" value={r.id} defaultChecked={s.exempt_role_ids.includes(r.id)}/><span>{r.name}</span></label>)}</div></div>
        </div>
        <div className="formActions"><p>Switching away from Live mode cancels any live actions that have not started yet.</p><PendingActionButton idleLabel="Save moderation settings" pendingLabel="Saving moderation settings…" className="button primary"/></div>
      </form>
    </section>

    <section className="panel">
      <div className="panelTitle"><div><h2>Live enforcement readiness</h2><p>Saucin AI will refuse to enable Live mode until all required Discord permissions are present.</p></div><span className="badge">{live.readiness.ready?'READY':'NOT READY'}</span></div>
      <div className={styles.ladderGrid}>
        <div className={styles.ladderStep}><span>Discord connection</span><strong>{readyLabel(live.readiness.connected&&live.readiness.guild_found)}</strong><small>Bot connected and Saucin RP guild available.</small></div>
        <div className={styles.ladderStep}><span>Send Messages</span><strong>{readyLabel(live.readiness.send_messages)}</strong><small>Required for reminders, warnings, timeout notices, and audit messages.</small></div>
        <div className={styles.ladderStep}><span>Manage Messages</span><strong>{readyLabel(live.readiness.manage_messages)}</strong><small>Required to delete offending messages at 3rd+ offense.</small></div>
        <div className={styles.ladderStep}><span>Moderate Members</span><strong>{readyLabel(live.readiness.moderate_members)}</strong><small>Required to apply Discord communication timeouts.</small></div>
      </div>
      <div className={styles.ladderNote}>{live.readiness.reason||'Permission preflight passed.'} The Saucin AI Discord role must also be above any member roles it needs to timeout; Discord role hierarchy is checked again when each action runs.</div>
    </section>

    <section className="panel">
      <div className="panelTitle"><div><h2>Standard escalation ladder</h2><p>This ladder is fixed across every moderation-eligible rule so enforcement remains consistent.</p></div><span className="badge">ALL RULES</span></div>
      <div className={styles.ladderGrid}>
        <div className={styles.ladderStep}><span>1st offense</span><strong>Reminder</strong><small>No message deletion. No timeout.</small></div>
        <div className={styles.ladderStep}><span>2nd offense</span><strong>Warning</strong><small>No message deletion. No timeout.</small></div>
        <div className={styles.ladderStep}><span>3rd offense</span><strong>10 minute timeout</strong><small>Delete offending message.</small></div>
        <div className={styles.ladderStep}><span>4th+ offense</span><strong>1 hour timeout</strong><small>Delete offending message · Flag for staff follow-up. Live enforcement does not wait for approval.</small></div>
      </div>
      <div className={styles.ladderNote}>Observe Mode advances only after staff confirmation. In Live mode, a successful reminder, warning, or timeout auto-confirms the case. Staff can dismiss it later to correct future escalation.</div>
    </section>

    <section className="panel">
      <div className="panelTitle"><div><h2>Published moderation rules</h2><p>Rules share the standard ladder above. Configure only rule-specific detection scope and thresholds here.</p></div><span className="badge">{data.rules.length} rules</span></div>
      {data.rules.length?data.rules.map(rule=><details className={styles.ruleConfig} key={rule.id}>
        <summary><strong>{rule.title}</strong><span>{rule.moderation_enabled?'Enabled':'Disabled'} · {rule.minimum_confidence==null?'global confidence':`${Math.round(Number(rule.minimum_confidence)*100)}%`} · standard ladder</span></summary>
        <div className={styles.ruleBody}>
          <form action={saveModerationRuleAction.bind(null,String(rule.id))} className="knowledgeForm">
            <div className={styles.settingsGrid}>
              <label className="settingToggleCard"><input type="checkbox" name="enabled" defaultChecked={rule.moderation_enabled}/><span><strong>Detect this rule</strong><small>Disabled rules are not considered by moderation AI.</small></span></label>
              <label className="field"><span>Confidence override</span><input className="input" type="number" min="0.50" max="0.99" step="0.01" name="minimum_confidence" defaultValue={rule.minimum_confidence==null?'':Number(rule.minimum_confidence).toFixed(2)} placeholder={String(s.minimum_confidence)}/><small>Blank uses the global threshold.</small></label>
              <label className="field"><span>Repeat window override</span><input className="input" type="number" min="1" max="90" name="repeat_window_days" defaultValue={rule.repeat_window_days??''} placeholder={String(s.repeat_window_days)}/><small>Blank uses the global window. The escalation actions themselves are fixed.</small></label>
              <div className={styles.full}><div className="settingsSubsection"><h3>Channel scope</h3><p>Leave all unchecked to use every monitored channel.</p></div><div className={styles.checkGrid}>{monitored.length?monitored.map(c=><label className={styles.check} key={c.id}><input type="checkbox" name="channel_ids" value={c.id} defaultChecked={rule.channel_ids.includes(c.id)}/><span>#{c.name||c.id}</span></label>):<span>No monitored channels yet.</span>}</div></div>
              <div className={styles.full}><div className="settingsSubsection"><h3>Additional exempt roles</h3><p>These apply only to this rule and are combined with global exemptions.</p></div><div className={styles.checkGrid}>{data.roles.map(r=><label className={styles.check} key={r.id}><input type="checkbox" name="exempt_role_ids" value={r.id} defaultChecked={rule.exempt_role_ids.includes(r.id)}/><span>{r.name}</span></label>)}</div></div>
            </div>
            <div className="formActions"><p>The verified rule text remains in the Knowledge Library; moderation settings do not rewrite policy or the standard ladder.</p><PendingActionButton idleLabel="Save rule settings" pendingLabel="Saving rule settings…" className="button primary"/></div>
          </form>
        </div>
      </details>):<div className={styles.empty}>Publish a Discord Rule before configuring moderation detection.</div>}
    </section>
  </>;
}
