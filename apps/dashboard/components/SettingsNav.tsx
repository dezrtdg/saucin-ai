'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
const links=[
  ['/settings','Overview','settings.view'],
  ['/settings/bot','Bot & AI','settings.bot.manage'],
  ['/settings/knowledge','Knowledge','settings.knowledge.manage'],
  ['/settings/issues','Issues & Tickets','settings.issues.manage'],
  ['/settings/moderation','Moderation','moderation.configure'],
  ['/settings/permissions','Permissions','settings.permissions.manage']
] as const;
export default function SettingsNav({permissions,ownerBypass=false}:{permissions:string[];ownerBypass?:boolean}){const path=usePathname();const allowed=new Set(permissions);return <nav className="settingsTabs" aria-label="Settings sections">{links.filter(([, ,permission])=>ownerBypass||allowed.has(permission)).map(([href,label])=><Link key={href} className={(href==='/settings'?path===href:path.startsWith(href))?'active':''} href={href}>{label}</Link>)}</nav>}
