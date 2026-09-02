'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem={name:string;href?:string;disabled?:string;permission?:string};
type NavGroup={label:string;items:NavItem[]};

const groups:NavGroup[]=[
  {label:'OVERVIEW',items:[{name:'Dashboard',href:'/',permission:'dashboard.view'}]},
  {label:'SUPPORT',items:[{name:'Tickets',href:'/tickets',permission:'tickets.view'},{name:'Issues',href:'/issues',permission:'issues.view'},{name:'Suggestions',href:'/suggestions',permission:'suggestions.view'},{name:'Moderation',href:'/moderation',permission:'moderation.view'}]},
  {label:'KNOWLEDGE',items:[
    {name:'Server Rules',href:'/knowledge/server-rules',permission:'knowledge.view'},
    {name:'Discord Rules',href:'/knowledge/discord-rules',permission:'knowledge.view'},
    {name:'Guides & Knowledge',href:'/knowledge',permission:'knowledge.view'},
    {name:'Knowledge Gaps',href:'/knowledge-gaps',permission:'knowledge.gaps.view'}
  ]},
  {label:'COMMUNICATION',items:[{name:'Announcements',disabled:'planned',permission:'announcements.view'}]},
  {label:'SERVER',items:[{name:'Channels',href:'/channels',permission:'channels.view'},{name:'txAdmin',disabled:'planned',permission:'txadmin.view'}]},
  {label:'ADMIN',items:[{name:'Settings',href:'/settings',permission:'settings.view'}]}
];

function activeFor(pathname:string,href:string){
  if(href==='/') return pathname==='/';
  if(href==='/knowledge') return pathname==='/knowledge' || pathname.startsWith('/knowledge/create') || /^\/knowledge\/\d/.test(pathname);
  return pathname===href || pathname.startsWith(`${href}/`);
}

export default function SidebarNav({permissions,ownerBypass=false}:{permissions:string[];ownerBypass?:boolean}){
  const pathname=usePathname();
  const allowed=new Set(permissions);
  const can=(permission?:string)=>!permission||ownerBypass||allowed.has(permission);
  return <nav className="consoleNav">{groups.map(group=>{
    const items=group.items.filter(item=>can(item.permission));
    if(!items.length)return null;
    return <div className="navGroup" key={group.label}>
      <div className="navGroupLabel">{group.label}</div>
      {items.map(item=>{
        if(!item.href) return <span className="navItem disabledNav" key={item.name}><i/><span>{item.name}</span><small>{item.disabled}</small></span>;
        const active=activeFor(pathname,item.href);
        return <Link className={`navItem ${active?'active':''}`} href={item.href} key={item.name}><i/><span>{item.name}</span></Link>;
      })}
    </div>;
  })}</nav>;
}
