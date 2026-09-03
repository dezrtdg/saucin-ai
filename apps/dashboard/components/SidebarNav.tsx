'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type BadgeKey='tickets'|'issues'|'suggestions'|'knowledgeGaps'|'moderation';
type NavItem={name:string;href:string;permission?:string;icon:string;badge?:BadgeKey};
type NavGroup={label:string;items:NavItem[]};

const groups:NavGroup[]=[
  {label:'WORKSPACE',items:[
    {name:'Overview',href:'/',permission:'dashboard.view',icon:'⌂'},
    {name:'Tickets',href:'/tickets',permission:'tickets.view',icon:'▣',badge:'tickets'},
    {name:'Issues',href:'/issues',permission:'issues.view',icon:'!',badge:'issues'},
    {name:'Suggestions',href:'/suggestions',permission:'suggestions.view',icon:'◇',badge:'suggestions'},
    {name:'Moderation',href:'/moderation',permission:'moderation.view',icon:'◆',badge:'moderation'}
  ]},
  {label:'KNOWLEDGE',items:[
    {name:'Library',href:'/knowledge',permission:'knowledge.view',icon:'≡'},
    {name:'Knowledge gaps',href:'/knowledge-gaps',permission:'knowledge.gaps.view',icon:'?',badge:'knowledgeGaps'}
  ]},
  {label:'SYSTEM',items:[
    {name:'Channels',href:'/channels',permission:'channels.view',icon:'#'},
    {name:'Settings',href:'/settings',permission:'settings.view',icon:'⚙'}
  ]}
];

function activeFor(pathname:string,href:string){
  if(href==='/') return pathname==='/';
  if(href==='/knowledge') return pathname==='/knowledge' || pathname.startsWith('/knowledge/create') || /^\/knowledge\/\d/.test(pathname);
  return pathname===href || pathname.startsWith(`${href}/`);
}

export default function SidebarNav({permissions,ownerBypass=false,badges}:{permissions:string[];ownerBypass?:boolean;badges:Record<BadgeKey,number>}){
  const pathname=usePathname();
  const allowed=new Set(permissions);
  const can=(permission?:string)=>!permission||ownerBypass||allowed.has(permission);
  return <nav className="consoleNav">{groups.map(group=>{
    const items=group.items.filter(item=>can(item.permission));
    if(!items.length)return null;
    return <div className="navGroup" key={group.label}>
      <div className="navGroupLabel">{group.label}</div>
      {items.map(item=>{
        const active=activeFor(pathname,item.href);
        const count=item.badge?Number(badges[item.badge]||0):0;
        return <Link className={`navItem ${active?'active':''}`} href={item.href} key={item.name}><i aria-hidden="true">{item.icon}</i><span>{item.name}</span>{count?<b className="navBadge">{count>99?'99+':count}</b>:null}</Link>;
      })}
    </div>;
  })}</nav>;
}
