import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { can, getDashboardAccess } from '../../../lib/permissions';
import DirectSettingsForm from '../../../components/DirectSettingsForm';

type Permission={key:string;label:string;description:string};
type Group={key:string;label:string;permissions:Permission[]};
type Role={id:string;name:string;position:number;color:string;permissions:string[]};
type Data={configured:boolean;bootstrap_mode:boolean;catalog:Group[];permissions:string[];current:{owner_bypass:boolean};current_role_ids:string[];roles:Role[]};
type Params=Promise<{role?:string}>;

export default async function PermissionsPage({searchParams}:{searchParams:Params}){
  const params=await searchParams;
  const access=await getDashboardAccess();
  if(!can(access,'settings.permissions.manage')) redirect('/settings');
  const data=await api<Data>('/api/permissions/roles');
  const selected=data.roles.find(role=>role.id===params.role) || data.roles.find(role=>data.current_role_ids.includes(role.id)) || data.roles.find(role=>role.permissions.length) || data.roles[0];
  const selectedPermissions=new Set(selected?.permissions||[]);
  const selectedAccess=selectedPermissions.has('dashboard.access');
  return <>
    <header className="pageHeader compactPageHeader"><div><p className="eyebrow">ACCESS CONTROL</p><h1>Permissions</h1><p>Choose exactly what each Discord role can view and change inside Saucin AI.</p></div></header>

    {data.bootstrap_mode?<div className="permissionBootstrapNotice"><div><strong>Legacy access mode is still active.</strong><p>Your existing dashboard role allowlist currently has full access. The first permission change will copy those roles into this managed permission system, then Settings becomes the source of truth for role access.</p></div></div>:null}
    {data.current.owner_bypass?<div className="permissionOwnerNotice"><strong>Direct owner access is active for your account.</strong><span>Your direct user allowlist remains an emergency full-access path so a role mistake cannot lock the owner out.</span></div>:null}

    <div className="permissionsLayout">
      <aside className="permissionRolesPanel">
        <div className="permissionPanelTitle"><div><span className="sectionLabel">DISCORD ROLES</span><h2>Role access</h2></div><span>{data.roles.length}</span></div>
        <div className="permissionRoleList">
          {data.roles.map(role=>{const active=selected?.id===role.id;const access=role.permissions.includes('dashboard.access');return <Link className={`permissionRole ${active?'active':''}`} href={`/settings/permissions?role=${encodeURIComponent(role.id)}`} key={role.id}><i style={{background:role.color && role.color!=='#000000'?role.color:undefined}}/><div><strong>{role.name}</strong><small>{access?`${role.permissions.length} permissions`:'No dashboard access'}</small></div>{data.current_role_ids.includes(role.id)?<span className="yourRoleTag">YOU</span>:null}</Link>})}
          {!data.roles.length?<div className="emptyLibrary"><strong>No Discord roles available.</strong><span>Make sure the bot is connected to the configured guild.</span></div>:null}
        </div>
      </aside>

      <section className="permissionMatrixPanel">
        {selected?<DirectSettingsForm
          operation="permissions.role.update"
          resourceId={selected.id}
          idleLabel="Save role permissions"
          pendingLabel="Saving role permissions…"
          successMessage="Role permissions saved. Changes apply immediately."
          buttonClassName="button primary largeButton"
          actionsClassName="permissionSaveBar"
          refreshOnSuccess
          footer={<><strong>Effective access updates immediately</strong><span>Removing Dashboard access prevents this role from signing in unless the member has another allowed role.</span></>}
        >
          <div className="permissionRoleHeader"><div><span className="sectionLabel">EDIT ROLE</span><h2>{selected.name}</h2><p>Permissions from multiple Discord roles are combined. Saucin AI uses grants only—there are no hidden deny rules.</p></div><div className={`roleAccessState ${selectedAccess?'enabled':'disabled'}`}><span/>{selectedAccess?'Dashboard access':'No access'}</div></div>

          {data.catalog.map(group=><fieldset className="permissionGroup" key={group.key}><legend>{group.label}</legend><div className="permissionChecks">{group.permissions.map(permission=>{
            const dangerous=permission.key==='settings.permissions.manage'||permission.key.endsWith('.delete')||permission.key==='moderation.actions';
            return <label className={`permissionCheck ${dangerous?'sensitivePermission':''}`} key={permission.key}><input type="checkbox" name="permissions" value={permission.key} defaultChecked={selectedPermissions.has(permission.key)}/><span><strong>{permission.label}</strong><small>{permission.description}</small><code>{permission.key}</code></span></label>
          })}</div></fieldset>)}
        </DirectSettingsForm>:<div className="emptyLibrary"><strong>Select a Discord role.</strong><span>Choose a role on the left to configure its dashboard access.</span></div>}
      </section>
    </div>
  </>;
}
