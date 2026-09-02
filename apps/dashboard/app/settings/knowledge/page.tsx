import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { can, getDashboardAccess } from '../../../lib/permissions';
import {
  createAudienceAction,
  createCategoryAction,
  createContentTypeAction,
  deleteAudienceAction,
  deleteCategoryAction,
  deleteContentTypeAction,
  updateAudienceAction,
  updateCategoryAction,
  updateContentTypeAction
} from './actions';

type ContentType = { key: string; label: string; description: string; moderation_eligible: boolean; sort_order: number; enabled: boolean };

type Category = {
  key: string;
  label: string;
  description: string;
  sort_order: number;
  enabled: boolean;
};

type Audience = {
  key: string;
  label: string;
  description: string;
  public_access: boolean;
  sort_order: number;
  enabled: boolean;
  role_ids: string[];
};

type DiscordRole = { id: string; name: string; position: number; color: string };
type Settings = { content_types: ContentType[]; categories: Category[]; audiences: Audience[]; discord_roles: DiscordRole[] };

export default async function KnowledgeSettingsPage() {
  const access=await getDashboardAccess();
  if(!can(access,'settings.knowledge.manage')) redirect('/settings');
  let settings: Settings = { content_types: [], categories: [], audiences: [], discord_roles: [] };
  let loadError = '';
  try {
    settings = await api<Settings>('/api/knowledge/settings');
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Unable to load knowledge settings.';
  }

  return <>
    <header className="pageHeader">
      <div>
        <p className="eyebrow">SETTINGS</p>
        <h1>Knowledge Settings</h1>
        <p>Control content types, categories, audiences, and which Discord roles unlock restricted knowledge.</p>
      </div>
      <div className="headerActions"><Link className="button" href="/settings/bot">Bot Settings</Link><Link className="button" href="/knowledge">Back to Knowledge</Link></div>
    </header>

    {loadError ? <div className="alert error">Could not load settings: {loadError}</div> : null}

    <section className="panel settingsSection">
      <div className="panelTitle"><div><h2>Content types</h2><p>Separate server rules, Discord rules, guides, SOPs, and other knowledge. Discord Rules can be marked as moderation-eligible for the upcoming moderation engine.</p></div></div>
      <form action={createContentTypeAction} className="settingsCreateRow audienceCreateRow">
        <label className="field"><span>Name</span><input className="input" name="label" placeholder="Example: Training Guide" required /></label>
        <label className="field"><span>Key <small>optional</small></span><input className="input" name="key" placeholder="auto-generated" /></label>
        <label className="field"><span>Sort</span><input className="input" type="number" name="sort_order" defaultValue="100" /></label>
        <label className="field settingsDescription"><span>Description</span><input className="input" name="description" placeholder="What belongs in this content type?" /></label>
        <label className="toggleField createToggle"><input type="checkbox" name="moderation_eligible" /><span>Moderation eligible</span></label>
        <button className="button primary" type="submit">Add content type</button>
      </form>
      <div className="settingsRows">
        {settings.content_types.map(type => (
          <div className="settingsRow" key={type.key}>
            <form action={updateContentTypeAction} className="settingsEditForm">
              <input type="hidden" name="key" value={type.key} />
              <div className="settingIdentity"><strong>{type.label}</strong><code>{type.key}</code></div>
              <label className="field"><span>Name</span><input className="input" name="label" defaultValue={type.label} required /></label>
              <label className="field"><span>Description</span><input className="input" name="description" defaultValue={type.description} /></label>
              <label className="field narrowField"><span>Sort</span><input className="input" type="number" name="sort_order" defaultValue={type.sort_order} /></label>
              <label className="toggleField"><input type="checkbox" name="moderation_eligible" defaultChecked={type.moderation_eligible} /><span>Moderation</span></label>
              <label className="toggleField"><input type="checkbox" name="enabled" defaultChecked={type.enabled} /><span>Enabled</span></label>
              <button className="button" type="submit">Save</button>
            </form>
            <form action={deleteContentTypeAction} className="inlineDelete"><input type="hidden" name="key" value={type.key} /><button className="button danger subtle" type="submit">Delete</button></form>
          </div>
        ))}
      </div>
    </section>

    <section className="panel settingsSection">
      <div className="panelTitle"><div><h2>Categories</h2><p>These become the Category dropdown in every knowledge article.</p></div></div>
      <form action={createCategoryAction} className="settingsCreateRow">
        <label className="field"><span>Name</span><input className="input" name="label" placeholder="Example: Court System" required /></label>
        <label className="field"><span>Key <small>optional</small></span><input className="input" name="key" placeholder="auto-generated" /></label>
        <label className="field"><span>Sort</span><input className="input" type="number" name="sort_order" defaultValue="100" /></label>
        <label className="field settingsDescription"><span>Description</span><input className="input" name="description" placeholder="What belongs in this category?" /></label>
        <button className="button primary" type="submit">Add category</button>
      </form>

      <div className="settingsRows">
        {settings.categories.map(category => (
          <div className="settingsRow" key={category.key}>
            <form action={updateCategoryAction} className="settingsEditForm">
              <input type="hidden" name="key" value={category.key} />
              <div className="settingIdentity"><strong>{category.label}</strong><code>{category.key}</code></div>
              <label className="field"><span>Name</span><input className="input" name="label" defaultValue={category.label} required /></label>
              <label className="field"><span>Description</span><input className="input" name="description" defaultValue={category.description} /></label>
              <label className="field narrowField"><span>Sort</span><input className="input" type="number" name="sort_order" defaultValue={category.sort_order} /></label>
              <label className="toggleField"><input type="checkbox" name="enabled" defaultChecked={category.enabled} /><span>Enabled</span></label>
              <button className="button" type="submit">Save</button>
            </form>
            <form action={deleteCategoryAction} className="inlineDelete"><input type="hidden" name="key" value={category.key} /><button className="button danger subtle" type="submit">Delete</button></form>
          </div>
        ))}
      </div>
    </section>

    <section className="panel settingsSection">
      <div className="panelTitle">
        <div><h2>Audiences & Discord roles</h2><p>A member can use an audience if it is public or any of their Discord roles are mapped to it. Map the same role to multiple audiences to create inheritance.</p></div>
      </div>

      <div className="audienceExplanation">
        <strong>Example:</strong> To make Community Admins inherit Staff knowledge, select the Community Admin role under both <em>Staff</em> and <em>Admin</em>.
      </div>

      <form action={createAudienceAction} className="settingsCreateRow audienceCreateRow">
        <label className="field"><span>Name</span><input className="input" name="label" placeholder="Example: DOJ" required /></label>
        <label className="field"><span>Key <small>optional</small></span><input className="input" name="key" placeholder="auto-generated" /></label>
        <label className="field"><span>Sort</span><input className="input" type="number" name="sort_order" defaultValue="100" /></label>
        <label className="field settingsDescription"><span>Description</span><input className="input" name="description" placeholder="Who should see this knowledge?" /></label>
        <label className="toggleField createToggle"><input type="checkbox" name="public_access" /><span>Everyone</span></label>
        <button className="button primary" type="submit">Add audience</button>
      </form>

      <div className="audienceSettingsList">
        {settings.audiences.map(audience => (
          <div className="audienceSettingsCard" key={audience.key}>
            <form action={updateAudienceAction}>
              <input type="hidden" name="key" value={audience.key} />
              <div className="audienceCardHeader">
                <div className="settingIdentity"><strong>{audience.label}</strong><code>{audience.key}</code><small>{audience.role_ids.length} mapped role{audience.role_ids.length === 1 ? '' : 's'}</small></div>
                <div className="audienceToggles">
                  <label className="toggleField"><input type="checkbox" name="enabled" defaultChecked={audience.enabled} /><span>Enabled</span></label>
                  <label className="toggleField"><input type="checkbox" name="public_access" defaultChecked={audience.public_access} /><span>Available to everyone</span></label>
                </div>
              </div>

              <div className="audienceConfigGrid">
                <label className="field"><span>Name</span><input className="input" name="label" defaultValue={audience.label} required /></label>
                <label className="field"><span>Description</span><input className="input" name="description" defaultValue={audience.description} /></label>
                <label className="field narrowField"><span>Sort</span><input className="input" type="number" name="sort_order" defaultValue={audience.sort_order} /></label>
              </div>

              <fieldset className="roleMapping">
                <legend>Discord roles that unlock {audience.label}</legend>
                {settings.discord_roles.length ? (
                  <div className="roleGrid">
                    {settings.discord_roles.map(role => (
                      <label className="roleChoice" key={role.id}>
                        <input type="checkbox" name="role_ids" value={role.id} defaultChecked={audience.role_ids.includes(role.id)} />
                        <span><strong>{role.name}</strong><small>{role.id}</small></span>
                      </label>
                    ))}
                  </div>
                ) : <div className="empty smallEmpty">Discord roles could not be loaded. Make sure the bot is online, then refresh.</div>}
              </fieldset>

              <div className="audienceCardActions"><button className="button primary" type="submit">Save audience & role mapping</button></div>
            </form>
            <form action={deleteAudienceAction} className="audienceDelete"><input type="hidden" name="key" value={audience.key} /><button className="button danger subtle" type="submit">Delete audience</button></form>
          </div>
        ))}
      </div>
    </section>
  </>;
}
