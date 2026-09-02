import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { can,getDashboardAccess } from '../../../lib/permissions';
import DirectSettingsForm from '../../../components/DirectSettingsForm';

type Settings={enabled:boolean;panel_channel_id:string|null;panel_message_id:string|null;open_category_id:string|null;closed_category_id:string|null;transcript_channel_id:string|null;max_open_per_user:number;allow_user_close:boolean;hide_staff_mentions:boolean;delete_closed_channels:boolean;warning_role_ids:string[];timeout_role_ids:string[];kick_role_ids:string[];ban_role_ids:string[];reversal_role_ids:string[]};
type TicketType={key:string;label:string;description:string;emoji:string|null;intake_prompt:string;support_role_ids:string[];category_override_id:string|null;allow_punishments:boolean;enabled:boolean;sort_order:number};
type Role={id:string;name:string;color:string;position:number};
type TextChannel={id:string;name:string;category_id:string|null;category_name:string|null};
type Category={id:string;name:string;position:number};
type Data={settings:Settings;types:TicketType[];roles:Role[];text_channels:TextChannel[];categories:Category[]};

function RoleChoices({name,selected,roles}:{name:string;selected:string[];roles:Role[]}){
  return <div className="roleCheckGrid">{roles.map(role=><label className="roleCheck" key={`${name}-${role.id}`}><input type="checkbox" name={name} value={role.id} defaultChecked={selected.includes(role.id)}/><i style={{background:role.color}}/><span>{role.name}</span></label>)}</div>;
}

export default async function TicketSettingsPage(){
  const access=await getDashboardAccess();if(!can(access,'settings.tickets.manage'))redirect('/settings');
  const data=await api<Data>('/api/tickets/settings');
  const s=data.settings;
  return <>
    <header className="pageHeader"><div><p className="eyebrow">PRIVATE SUPPORT</p><h1>Ticket Settings</h1><p>Configure one private ticket panel, channel routing, transcripts, staff access, and moderation-enabled report types.</p></div><div className="headerActions"><Link className="button" href="/tickets">Back to Tickets</Link></div></header>

    <section className="panel knowledgeCreate" style={{marginBottom:18}}><div className="panelTitle"><div><h2>Ticket panel and channel lifecycle</h2><p>New tickets open as private text channels. Closed tickets are locked and moved without erasing their case history.</p></div><span className="badge">{s.panel_message_id?'PANEL PUBLISHED':'NOT PUBLISHED'}</span></div>
      <DirectSettingsForm operation="tickets.settings.update" className="knowledgeForm" idleLabel="Save ticket settings" pendingLabel="Saving ticket settings…" successMessage="Ticket settings saved." refreshOnSuccess>
        <div className="formGrid">
          <label className="field fieldFull"><span>Ticket panel channel</span><select className="input select" name="panel_channel_id" defaultValue={s.panel_channel_id||''}><option value="">Not configured</option>{data.text_channels.map(channel=><option value={channel.id} key={channel.id}>{channel.category_name?`${channel.category_name} → `:''}#{channel.name}</option>)}</select><small>Saucin AI posts or updates the single Start a Ticket menu here.</small></label>
          <label className="field"><span>Open-ticket category</span><select className="input select" name="open_category_id" defaultValue={s.open_category_id||''}><option value="">Not configured</option>{data.categories.map(category=><option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
          <label className="field"><span>Closed-ticket category</span><select className="input select" name="closed_category_id" defaultValue={s.closed_category_id||''}><option value="">Keep in open category</option>{data.categories.map(category=><option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
          <label className="field"><span>Transcript channel</span><select className="input select" name="transcript_channel_id" defaultValue={s.transcript_channel_id||''}><option value="">Store in dashboard only</option>{data.text_channels.map(channel=><option value={channel.id} key={channel.id}>{channel.category_name?`${channel.category_name} → `:''}#{channel.name}</option>)}</select></label>
          <label className="field"><span>Maximum open tickets per member</span><input className="input" name="max_open_per_user" type="number" min="1" max="10" defaultValue={s.max_open_per_user}/></label>
          <label className="settingToggleCard"><input name="enabled" type="checkbox" defaultChecked={s.enabled}/><span><strong>Ticket creation enabled</strong><small>Allow members to use the published panel.</small></span></label>
          <label className="settingToggleCard"><input name="allow_user_close" type="checkbox" defaultChecked={s.allow_user_close}/><span><strong>Allow members to close their own tickets</strong><small>Staff can always close tickets assigned to their routing role.</small></span></label>
          <label className="settingToggleCard"><input name="hide_staff_mentions" type="checkbox" defaultChecked={s.hide_staff_mentions}/><span><strong>Hide routed staff role names</strong><small>Staff roles are still notified, but their mentions are concealed behind Discord spoiler blocks.</small></span></label>
          <label className="settingToggleCard"><input name="delete_closed_channels" type="checkbox" defaultChecked={s.delete_closed_channels}/><span><strong>Delete Discord channel when closed</strong><small>The complete case stays in the dashboard and authorized staff can reopen it into a new private channel.</small></span></label>
        </div>
        <div className="settingsSubsection"><h3>Discord punishment authority</h3><p>These role lists limit what staff can apply from Discord ticket buttons. When a list is blank, any staff role assigned to that ticket type may use that action.</p></div>
        <div className="formGrid">
          <div className="field fieldFull"><span>Official warnings</span><RoleChoices name="warning_role_ids" selected={s.warning_role_ids||[]} roles={data.roles}/></div>
          <div className="field fieldFull"><span>Timeouts</span><RoleChoices name="timeout_role_ids" selected={s.timeout_role_ids||[]} roles={data.roles}/></div>
          <div className="field fieldFull"><span>Kicks</span><RoleChoices name="kick_role_ids" selected={s.kick_role_ids||[]} roles={data.roles}/></div>
          <div className="field fieldFull"><span>Temporary and permanent bans</span><RoleChoices name="ban_role_ids" selected={s.ban_role_ids||[]} roles={data.roles}/></div>
          <div className="field fieldFull"><span>Punishment reversals</span><RoleChoices name="reversal_role_ids" selected={s.reversal_role_ids||[]} roles={data.roles}/></div>
        </div>
      </DirectSettingsForm>
      <div className="articleFooter"><div><strong>Publish after saving</strong><span>This updates the existing panel instead of posting duplicates.</span></div><DirectSettingsForm operation="tickets.panel.publish" idleLabel={s.panel_message_id?'Update ticket panel':'Publish ticket panel'} pendingLabel="Publishing…" successMessage="Ticket panel published." layout="button" buttonClassName="button primary" refreshOnSuccess/></div>
    </section>

    <section className="panel"><div className="panelTitle"><div><h2>Ticket types and staff routing</h2><p>Each ticket type can notify different roles and optionally open in its own category. Player and staff reports can expose punishment controls.</p></div><span className="badge">{data.types.length} TYPES</span></div>
      <div className="settingsList">{data.types.map(type=><div className="settingsEditor" key={type.key}><DirectSettingsForm operation="tickets.type.update" resourceId={type.key} className="knowledgeForm" idleLabel="Save ticket type" pendingLabel="Saving…" successMessage={`${type.label} routing saved.`} actionsClassName="articleFooter" refreshOnSuccess>
        <div className="settingsKey">{type.key}</div><div className="formGrid">
          <label className="field"><span>Display name</span><input className="input" name="label" defaultValue={type.label} required/></label>
          <label className="field"><span>Emoji</span><input className="input" name="emoji" defaultValue={type.emoji||''} maxLength={40}/></label>
          <label className="field"><span>Sort order</span><input className="input" name="sort_order" type="number" defaultValue={type.sort_order}/></label>
          <label className="field"><span>Category override</span><select className="input select" name="category_override_id" defaultValue={type.category_override_id||''}><option value="">Use default open category</option>{data.categories.map(category=><option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
          <label className="field fieldFull"><span>Panel description</span><input className="input" name="description" defaultValue={type.description} maxLength={300}/></label>
          <label className="field fieldFull"><span>Intake guidance</span><textarea className="textarea" name="intake_prompt" defaultValue={type.intake_prompt} rows={3} required/></label>
          <label className="settingToggleCard"><input name="enabled" type="checkbox" defaultChecked={type.enabled}/><span><strong>Enabled on panel</strong><small>Members can select this ticket type.</small></span></label>
          <label className="settingToggleCard"><input name="allow_punishments" type="checkbox" defaultChecked={type.allow_punishments}/><span><strong>Allow punishment controls</strong><small>Assigned staff can warn, timeout, kick, or ban from this ticket.</small></span></label>
          <div className="field fieldFull"><span>Staff roles with private access</span><div className="roleCheckGrid">{data.roles.map(role=><label className="roleCheck" key={role.id}><input type="checkbox" name="support_role_ids" value={role.id} defaultChecked={type.support_role_ids.includes(role.id)}/><i style={{background:role.color}}/><span>{role.name}</span></label>)}</div><small>Select at least one routing role. Only these roles, the opener, and Saucin AI can see new channels.</small></div>
        </div>
      </DirectSettingsForm></div>)}</div>
    </section>
  </>;
}
