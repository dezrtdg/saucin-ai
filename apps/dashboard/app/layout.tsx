import './globals.css';
import './action-feedback.css';
import { Suspense } from 'react';
import { getDashboardSession, isDashboardAuthRequired } from '../lib/auth';
import SidebarNav from '../components/SidebarNav';
import DashboardActionFeedback from '../components/DashboardActionFeedback';
import { can, getDashboardAccess } from '../lib/permissions';

export const metadata = { title:'Saucin AI', description:'Saucin RP server intelligence dashboard' };

export default async function RootLayout({ children }: Readonly<{children:React.ReactNode}>){
  const authRequired=isDashboardAuthRequired();
  const session=await getDashboardSession();
  if(authRequired&&!session){
    return <html lang="en"><body><main className="loginShell"><div className="loginCard"><div className="consoleBrand loginBrand"><img className="brandLogo" src="/saucin-rp-logo.png" alt="Saucin RP"/><div><strong>Saucin AI</strong><small>server console</small></div></div><p className="eyebrow">STAFF DASHBOARD</p><h1>{process.env.SERVER_NAME||'Saucin RP'}</h1><p className="loginCopy">Sign in with an approved Discord account to access server intelligence, support operations, knowledge, and bot controls.</p><a className="discordButton" href="/api/auth/login">Continue with Discord</a><p className="loginNote">Access is limited to configured Discord users and staff roles.</p></div></main></body></html>;
  }
  let access=null;
  try{access=await getDashboardAccess();}catch{}
  if(access && !access.authorized){
    return <html lang="en"><body><main className="loginShell"><div className="loginCard"><div className="consoleBrand loginBrand"><img className="brandLogo" src="/saucin-rp-logo.png" alt="Saucin RP"/><div><strong>Saucin AI</strong><small>access control</small></div></div><p className="eyebrow">ACCESS DENIED</p><h1>Dashboard access removed</h1><p className="loginCopy">Your Discord account is signed in, but none of your current roles grant dashboard access.</p><a className="discordButton" href="/api/auth/logout">Sign out</a></div></main></body></html>;
  }
  const initials=session?.displayName.split(/\s+/).map(v=>v[0]).join('').slice(0,2).toUpperCase()||'SA';
  const permissions=access?.permissions||[];
  const ownerBypass=Boolean(access?.owner_bypass);
  return <html lang="en"><body>
    <Suspense fallback={null}><DashboardActionFeedback/></Suspense>
    <div className="consoleShell">
      <aside className="consoleSidebar">
        <div className="consoleBrand"><img className="brandLogo" src="/saucin-rp-logo.png" alt="Saucin RP"/><div><strong>Saucin AI</strong><small>{process.env.SERVER_NAME||'Saucin RP'} console</small></div></div>
        <Suspense fallback={<div className="navLoading">Loading navigation…</div>}><SidebarNav permissions={permissions} ownerBypass={ownerBypass}/></Suspense>
        <div className="sidebarStatus"><span className="onlineDot"/><div><strong>Online</strong><small>Discord + API</small></div></div>
      </aside>
      <main className="consoleMain">
        <header className="consoleTopbar">
          <div className="topbarIdentity"><strong>{process.env.SERVER_NAME||'Saucin RP'}</strong><small>operations & intelligence</small></div>
          {can(access,'knowledge.view')?<form className="topbarSearch" action="/knowledge/all" method="get"><span>⌕</span><input name="q" aria-label="Search all knowledge" placeholder="Search all knowledge"/><kbd>/</kbd></form>:<div className="topbarSpacer"/>}
          {session?<div className="topbarUser">{session.avatar?<img src={session.avatar} alt=""/>:<div className="topbarAvatar">{initials}</div>}<div><strong>{session.displayName}</strong><a href="/api/auth/logout">Sign out</a></div></div>:null}
        </header>
        <div className="consoleContent">{children}</div>
      </main>
    </div>
  </body></html>;
}
