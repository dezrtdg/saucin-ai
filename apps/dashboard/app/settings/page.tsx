import Link from 'next/link';
import { can, getDashboardAccess } from '../../lib/permissions';

export default async function SettingsPage(){
  const access=await getDashboardAccess();
  const sections=[
    {href:'/settings/bot',permission:'settings.bot.manage',eyebrow:'BOT & AI',title:'Bot behavior',description:'Direct mentions, recent conversation context, AI behavior, and bot response controls.',status:'Active'},
    {href:'/settings/knowledge',permission:'settings.knowledge.manage',eyebrow:'KNOWLEDGE',title:'Knowledge system',description:'Content types, categories, audiences, and Discord role mappings.',status:'Active'},
    {href:'/settings/issues',permission:'settings.issues.manage',eyebrow:'ISSUES & TICKETS',title:'Bug operations',description:'Issue categories, Discord ticket intake, evidence extraction, and public response templates.',status:'Active'},
    {href:'/settings/tickets',permission:'settings.tickets.manage',eyebrow:'PRIVATE SUPPORT',title:'Private tickets',description:'Ticket panel, private categories, transcripts, staff routing, and moderation case controls.',status:'Configure'},
    {href:'/settings/suggestions',permission:'settings.suggestions.manage',eyebrow:'COMMUNITY IDEAS',title:'Suggestions',description:'AI idea development, linked Discord forum discussions, community context, and status synchronization.',status:'Configure'},
    {href:'/settings/moderation',permission:'moderation.configure',eyebrow:'MODERATION',title:'Moderation',description:'Configure live or observe moderation, rule detection, confidence thresholds, exemptions, and audit behavior.',status:'Configure'},
    {href:'/settings/permissions',permission:'settings.permissions.manage',eyebrow:'ACCESS CONTROL',title:'Permissions',description:'Choose which Discord roles can view, create, edit, publish, moderate, or change settings.',status:'Manage Roles'},
    {href:'/channels',permission:'channels.manage',eyebrow:'DISCORD',title:'Channel policies',description:'Choose where Saucin AI is ignored, monitors, answers questions, or handles issues.',status:'Open Channels'},
  ].filter(section=>can(access,section.permission));
  return <>
    <header className="pageHeader compactPageHeader"><div><p className="eyebrow">ADMIN</p><h1>Settings</h1><p>Configure Saucin AI from one place. What appears here depends on your effective Discord-role permissions.</p></div></header>
    <div className="settingsHubGrid">{sections.map(section=>section.href==='/settings/moderation'
      ? <a className="settingsHubCard" href={section.href} key={section.href}><div><span className="sectionLabel">{section.eyebrow}</span><h2>{section.title}</h2><p>{section.description}</p></div><span className="settingsHubAction">{section.status} →</span></a>
      : <Link className="settingsHubCard" href={section.href} key={section.href}><div><span className="sectionLabel">{section.eyebrow}</span><h2>{section.title}</h2><p>{section.description}</p></div><span className="settingsHubAction">{section.status} →</span></Link>)}</div>
    <section className="settingsComingSoon"><div><span className="sectionLabel">COMING NEXT</span><h2>More controls will use the same permission system</h2><p>Announcements, integrations, and txAdmin permissions are already reserved so those modules can plug into the same role matrix as they are built.</p></div></section>
  </>;
}
