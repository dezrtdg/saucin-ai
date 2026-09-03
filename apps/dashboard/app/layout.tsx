import './globals.css';
import './action-feedback.css';
import './dashboard-overhaul.css';
import { Suspense } from 'react';
import { getDashboardSession, isDashboardAuthRequired } from '../lib/auth';
import DashboardShell from '../components/DashboardShell';
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
  const serverName=process.env.SERVER_NAME||'Saucin RP';
  return <html lang="en"><body>
    <Suspense fallback={null}><DashboardActionFeedback/></Suspense>
    <DashboardShell serverName={serverName} user={session?{displayName:session.displayName,avatar:session.avatar,initials}:null} permissions={permissions} ownerBypass={ownerBypass} knowledgeSearch={can(access,'knowledge.view')}>{children}</DashboardShell>
  </body></html>;
}
