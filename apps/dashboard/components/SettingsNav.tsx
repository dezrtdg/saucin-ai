'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
const links=[
  ['/settings','Overview','settings.view'],
  ['/settings/bot','Bot & AI','settings.bot.manage'],
  ['/settings/knowledge','Knowledge','settings.knowledge.manage'],
  ['/settings/issues','Issues & Tickets','settings.issues.manage'],
  ['/settings/tickets','Private Tickets','settings.tickets.manage'],
  ['/settings/suggestions','Suggestions','settings.suggestions.manage'],
  ['/settings/moderation','Moderation','moderation.configure'],
  ['/settings/permissions','Permissions','settings.permissions.manage']
] as const;
export default function SettingsNav({permissions,ownerBypass=false}:{permissions:string[];ownerBypass?:boolean}){
  const path=usePathname();
  const allowed=new Set(permissions);
  return <nav className="settingsTabs" aria-label="Settings sections">{links.filter(([, ,permission])=>ownerBypass||allowed.has(permission)).map(([href,label])=>{
    const active=href==='/settings'?path===href:path.startsWith(href);
    // Moderation uses a full navigation intentionally. The page performs live Discord/API
    // readiness work and a hard navigation avoids a stale App Router transition leaving
    // the Settings screen looking unresponsive.
    if(href==='/settings/moderation') return <a key={href} className={active?'active':''} href={href}>{label}</a>;
    return <Link key={href} className={active?'active':''} href={href}>{label}</Link>;
  })}</nav>;
}
