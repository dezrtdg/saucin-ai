import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { can, getDashboardAccess } from '../../../lib/permissions';
import DirectSettingsForm from '../../../components/DirectSettingsForm';

type Category = { key:string; label:string; description:string; sort_order:number; enabled:boolean };
type Automation = {
  intake_channel_id:string|null; auto_create_threads:boolean; allow_player_details:boolean; auto_summarize_thread:boolean;
  auto_update_symptoms:boolean; auto_collect_workarounds:boolean; auto_collect_reproduction:boolean; auto_collect_locations:boolean;
  edit_original_status_message:boolean; post_status_updates_to_thread:boolean; auto_public_response:boolean; include_bug_id:boolean;
  include_workaround:boolean; include_affected_count:boolean;
};
type Template = { status:string; template:string; enabled:boolean };
type Channel = { id:string; name:string; type:string; category_name:string|null; is_thread:boolean };
type Settings = { categories:Category[]; automation:Automation|null; templates:Template[]; channels:Channel[] };

function pretty(value:string) { return value.replaceAll('_',' '); }

export default async function IssueSettingsPage() {
  const access=await getDashboardAccess();
  if(!can(access,'settings.issues.manage')) redirect('/settings');
  let data: Settings = { categories: [], automation: null, templates: [], channels: [] };
  let loadError = '';
  try { data = await api<Settings>('/api/issues/settings'); }
  catch (error) { loadError = error instanceof Error ? error.message : 'Unable to load issue settings.'; }
  const a = data.automation;

  return <>
    <header className="pageHeader"><div><p className="eyebrow">BUG INTELLIGENCE</p><h1>Issue Settings</h1><p>Manage Discord issue tickets, automated public responses, evidence extraction, and issue categories.</p></div><div className="headerActions"><Link className="button" href="/issues">Back to Issues</Link></div></header>
    {loadError ? <div className="alert error">{loadError}</div> : null}

    <section className="panel knowledgeCreate">
      <div className="panelTitle"><div><h2>Discord bug intake</h2><p>Choose where Saucin AI creates one ticket thread or forum post per known issue.</p></div></div>
      <DirectSettingsForm
        operation="issues.automation.update"
        className="knowledgeForm"
        idleLabel="Save bug automation"
        pendingLabel="Saving bug automation…"
        successMessage="Bug automation saved."
        footer={<p>Players can talk naturally in the issue ticket; Saucin AI organizes their evidence without treating community claims as verified fixes.</p>}
      >
        <div className="formGrid">
          <label className="field fieldFull"><span>Bug ticket channel</span><select className="input select" name="intake_channel_id" defaultValue={a?.intake_channel_id || ''}><option value="">Not configured</option>{data.channels.map(channel => <option value={channel.id} key={channel.id}>{channel.category_name ? `${channel.category_name} → ` : ''}#{channel.name} · {channel.type}</option>)}</select><small>Forum is recommended. A normal text channel also works; each bug becomes a thread.</small></label>
          {[
            ['auto_create_threads','Automatically create issue tickets','Create a Discord ticket whenever a known issue is created or promoted.'],
            ['allow_player_details','Collect player replies','Messages in issue ticket threads are saved as investigation evidence.'],
            ['auto_summarize_thread','AI community summary','Maintain a concise summary of useful information players add.'],
            ['auto_update_symptoms','Extract symptoms','Add newly reported symptoms to matching and staff review.'],
            ['auto_collect_workarounds','Collect possible workarounds','Keep community-reported workarounds separate until staff verifies them.'],
            ['auto_collect_reproduction','Extract reproduction clues','Capture useful steps or conditions that seem related to reproducing the issue.'],
            ['auto_collect_locations','Extract locations','Capture garages, areas, buildings, or other locations players mention.'],
            ['edit_original_status_message','Update original Discord post','Keep the main issue post current when status, workaround, or counts change.'],
            ['post_status_updates_to_thread','Post status changes in ticket','Leave a readable timeline whenever staff changes an issue status.'],
          ].map(([key,title,description]) => <label className="settingToggleCard" key={key}><input name={key} type="checkbox" defaultChecked={Boolean(a?.[key as keyof Automation] ?? true)}/><span><strong>{title}</strong><small>{description}</small></span></label>)}
        </div>

        <div className="settingsSubsection"><h3>Public response behavior</h3><p>Blank per-issue Public Response fields use the status templates below automatically.</p></div>
        <div className="formGrid">
          {[
            ['auto_public_response','Use automatic status responses','Generate the player-facing response from the issue status when staff has not entered an override.'],
            ['include_bug_id','Include BUG number','Show BUG-#### in Discord responses.'],
            ['include_workaround','Include verified workaround','Automatically append the staff-verified workaround when one exists.'],
            ['include_affected_count','Include affected-player count','Show the current unique reporter count publicly.'],
          ].map(([key,title,description]) => <label className="settingToggleCard" key={key}><input name={key} type="checkbox" defaultChecked={key==='include_affected_count' ? Boolean(a?.include_affected_count) : Boolean(a?.[key as keyof Automation] ?? true)}/><span><strong>{title}</strong><small>{description}</small></span></label>)}
        </div>
      </DirectSettingsForm>
    </section>

    <section className="panel">
      <div className="panelTitle"><div><h2>Status-based public responses</h2><p>Edit what players are told as an issue moves through its lifecycle.</p></div><span className="badge">{data.templates.length} statuses</span></div>
      <div className="settingsList">{data.templates.map(template => <div className="settingsEditor" key={template.status}>
        <DirectSettingsForm
          operation="issues.template.update"
          resourceId={template.status}
          className="knowledgeForm"
          idleLabel="Save template"
          pendingLabel="Saving template…"
          successMessage={`${pretty(template.status)} template saved.`}
          actionsClassName="articleFooter"
        >
          <div className="settingsKey">{pretty(template.status)}</div>
          <label className="field fieldFull"><span>Response template</span><textarea className="textarea compactTextarea" name="template" rows={4} defaultValue={template.template}/><small>Available placeholders: {'{{title}}'}, {'{{bug_id}}'}, {'{{status}}'}, {'{{description}}'}, {'{{workaround}}'}, {'{{affected_count}}'}, {'{{resource}}'}</small></label>
          <label className="settingToggleCard"><input name="enabled" type="checkbox" defaultChecked={template.enabled}/><span><strong>Enabled</strong><small>Use this template when no per-issue public response override exists.</small></span></label>
        </DirectSettingsForm>
      </div>)}</div>
    </section>

    <section className="panel knowledgeCreate">
      <div className="panelTitle"><div><h2>Add issue category</h2><p>Categories are dashboard-managed so you can change them without touching code.</p></div></div>
      <DirectSettingsForm
        operation="issues.category.create"
        className="knowledgeForm"
        idleLabel="Add category"
        pendingLabel="Adding category…"
        successMessage="Issue category created."
        refreshOnSuccess
        resetOnSuccess
        footer={<p>The key stays stable for existing issues; the display label and description can be changed anytime.</p>}
      >
        <div className="formGrid"><label className="field"><span>Key</span><input className="input" name="key" required pattern="[a-z0-9][a-z0-9_-]*" placeholder="vehicles-garages"/></label><label className="field"><span>Label</span><input className="input" name="label" required placeholder="Vehicles & Garages"/></label><label className="field"><span>Sort order</span><input className="input" name="sort_order" type="number" defaultValue="100"/></label><label className="settingToggleCard"><input name="enabled" type="checkbox" defaultChecked/><span><strong>Enabled</strong><small>Show this category in issue forms and filters.</small></span></label><label className="field fieldFull"><span>Description</span><input className="input" name="description" placeholder="What belongs in this issue category?"/></label></div>
      </DirectSettingsForm>
    </section>

    <section className="panel"><div className="panelTitle"><div><h2>Issue categories</h2><p>{data.categories.length} configured categories.</p></div></div><div className="settingsList">{data.categories.map(category => <div className="settingsEditor" key={category.key}>
      <DirectSettingsForm
        operation="issues.category.update"
        resourceId={category.key}
        className="knowledgeForm"
        idleLabel="Save category"
        pendingLabel="Saving category…"
        successMessage="Issue category saved."
        actionsClassName="articleFooter"
        refreshOnSuccess
      >
        <div className="settingsKey">{category.key}</div><div className="formGrid"><label className="field fieldWide"><span>Label</span><input className="input" name="label" defaultValue={category.label} required/></label><label className="field"><span>Sort order</span><input className="input" name="sort_order" type="number" defaultValue={category.sort_order}/></label><label className="settingToggleCard"><input name="enabled" type="checkbox" defaultChecked={category.enabled}/><span><strong>Enabled</strong><small>Disabled categories remain valid for existing issues.</small></span></label><label className="field fieldFull"><span>Description</span><input className="input" name="description" defaultValue={category.description}/></label></div>
      </DirectSettingsForm>
      <div className="dangerZone"><div><strong>Delete category</strong><p>Deletion is blocked while a known issue still uses this category.</p></div>
        <DirectSettingsForm
          operation="issues.category.delete"
          resourceId={category.key}
          idleLabel="Delete"
          pendingLabel="Deleting…"
          successMessage="Issue category deleted."
          buttonClassName="button danger"
          layout="button"
          refreshOnSuccess
          confirmMessage={`Delete the ${category.label} issue category?`}
        />
      </div>
    </div>)}</div></section>
  </>;
}
