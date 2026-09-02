import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { can, getDashboardAccess } from '../../../lib/permissions';
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

export default async function ModerationSettingsPage(){
  const access=await getDashboardAccess();
  if(!can(access,'moderation.configure')) redirect('/settings');
  const data=await api<Data>('/api/moderation/settings');
  const s=data.settings;
  const monitored=data.channels.filter(c=>c.monitor_messages&&c.mode!=='ignored');

  return <>
    <header className="pageHeader">
      <div>
        <p className="eyebrow">MODERATION</p>
        <h1>Observe Mode Settings</h1>
        <p>Configure how Saucin AI detects possible Discord-rule violations before live enforcement is introduced.</p>
      </div>
      <div className={styles.headerActions}>
        <Link className="button" href="/settings/moderation/diagnostics">Diagnostics</Link>
        <Link className="button" href="/moderation">Open Moderation Queue</Link>
      </div>
    </header>

    <div className={styles.info}>v1.3 is detection-only. The standard escalation ladder below is simulated for staff review — the bot cannot warn, delete messages, or timeout anyone yet.</div>

    <section className="panel settingsSection">
      <div className="panelTitle"><div><h2>Global moderation</h2><p>Observe only runs in Discord channels that are already enabled for monitoring on the Channels page.</p></div></div>
      <form action={saveModerationSettingsAction} className="knowledgeForm">
        <div className={styles.settingsGrid}>
          <label className="field"><span>Mode</span><select className="input select" name="mode" defaultValue={s.mode}><option value="off">Off</option><option value="observe">Observe only</option></select><small>Start with Observe Only and review false positives before live actions are enabled.</small></label>
          <label className="field"><span>Minimum AI confidence</span><input className="input" type="number" min="0.50" max="0.99" step="0.01" name="minimum_confidence" defaultValue={Number(s.minimum_confidence).toFixed(2)}/><small>Recommended starting point: 0.90.</small></label>
          <label className="field"><span>Repeat-offense window</span><input className="input" type="number" min="1" max="90" name="repeat_window_days" defaultValue={s.repeat_window_days}/><small>Only staff-confirmed cases for the same rule advance the ladder.</small></label>
          <label className="field"><span>Staff audit channel</span><select className="input select" name="audit_channel_id" defaultValue={s.audit_channel_id||''}><option value="">Dashboard only</option>{data.channels.map(c=><option key={c.id} value={c.id}>#{c.name||c.id}</option>)}</select><small>Optional staff-only channel for observe detections.</small></label>
          <label className="settingToggleCard"><input type="checkbox" name="post_observations_to_audit" defaultChecked={s.post_observations_to_audit}/><span><strong>Post detections to audit channel</strong><small>Only staff notifications; no player-facing action.</small></span></label>
          <label className="settingToggleCard"><input type="checkbox" name="diagnostics_enabled" defaultChecked={s.diagnostics_enabled}/><span><strong>Enable moderation diagnostics</strong><small>Temporarily record why each Discord message was processed or skipped. Keep this off when you are done tuning.</small></span></label>
          <div className={styles.full}><div className="settingsSubsection"><h3>Globally exempt Discord roles</h3><p>Members with any selected role are skipped before AI analysis.</p></div><div className={styles.checkGrid}>{data.roles.map(r=><label className={styles.check} key={r.id}><input type="checkbox" name="exempt_role_ids" value={r.id} defaultChecked={s.exempt_role_ids.includes(r.id)}/><span>{r.name}</span></label>)}</div></div>
        </div>
        <div className="formActions"><p>Changes take effect on new Discord messages immediately after save.</p><button className="button primary" type="submit">Save moderation settings</button></div>
      </form>
    </section>

    <section className="panel">
      <div className="panelTitle"><div><h2>Standard escalation ladder</h2><p>This ladder is fixed across every moderation-eligible rule so enforcement remains consistent.</p></div><span className="badge">ALL RULES</span></div>
      <div className={styles.ladderGrid}>
        <div className={styles.ladderStep}><span>1st offense</span><strong>Reminder</strong><small>No message deletion. No timeout.</small></div>
        <div className={styles.ladderStep}><span>2nd offense</span><strong>Warning</strong><small>No message deletion. No timeout.</small></div>
        <div className={styles.ladderStep}><span>3rd offense</span><strong>10 minute timeout</strong><small>Delete offending message.</small></div>
        <div className={styles.ladderStep}><span>4th+ offense</span><strong>1 hour timeout</strong><small>Delete offending message · Staff review required.</small></div>
      </div>
      <div className={styles.ladderNote}>Only staff-confirmed prior cases for the same rule within the configured repeat window count toward escalation. Pending and dismissed cases do not advance the ladder.</div>
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
            <div className="formActions"><p>The verified rule text remains in the Knowledge Library; moderation settings do not rewrite policy or the standard ladder.</p><button className="button primary" type="submit">Save rule settings</button></div>
          </form>
        </div>
      </details>):<div className={styles.empty}>Publish a Discord Rule before configuring moderation detection.</div>}
    </section>
  </>;
}
