import Link from 'next/link';
import { redirect } from 'next/navigation';
import { api } from '../../../lib/api';
import { can,getDashboardAccess } from '../../../lib/permissions';
import DirectSettingsForm from '../../../components/DirectSettingsForm';

type Automation={
  forum_channel_id:string|null;
  auto_create_forum_posts:boolean;
  collect_thread_details:boolean;
  ai_summarize_thread:boolean;
  edit_original_status_message:boolean;
  post_status_updates_to_thread:boolean;
  include_suggestion_id:boolean;
  include_support_count:boolean;
};
type Channel={id:string;name:string;type:string;category_name:string|null;is_thread:boolean};
type Settings={automation:Automation|null;channels:Channel[]};

export default async function SuggestionSettingsPage(){
  const access=await getDashboardAccess();
  if(!can(access,'settings.suggestions.manage')) redirect('/settings');
  let data:Settings={automation:null,channels:[]};
  let loadError='';
  try{data=await api<Settings>('/api/suggestions/settings');}
  catch(error){loadError=error instanceof Error?error.message:'Unable to load suggestion settings.';}
  const a=data.automation;

  return <>
    <header className="pageHeader"><div><p className="eyebrow">COMMUNITY IDEAS</p><h1>Suggestion Settings</h1><p>Choose the Discord forum used for self-contained idea discussions and control how updates stay synchronized.</p></div><div className="headerActions"><Link className="button" href="/suggestions">Back to Suggestions</Link></div></header>
    {loadError?<div className="alert error">{loadError}</div>:null}

    <section className="panel knowledgeCreate">
      <div className="panelTitle"><div><h2>Discord suggestions forum</h2><p>Saucin AI creates or links one forum discussion for each clustered suggestion.</p></div></div>
      <DirectSettingsForm
        operation="suggestions.automation.update"
        className="knowledgeForm"
        idleLabel="Save suggestion automation"
        pendingLabel="Saving suggestion automation…"
        successMessage="Suggestion automation saved."
        footer={<p>Original submissions and forum replies stay preserved. AI summaries organize discussion but never replace the source messages.</p>}
      >
        <div className="formGrid">
          <label className="field fieldFull"><span>Suggestions forum</span><select className="input select" name="forum_channel_id" defaultValue={a?.forum_channel_id||''}><option value="">Not configured</option>{data.channels.map(channel=><option value={channel.id} key={channel.id}>{channel.category_name?`${channel.category_name} → `:''}#{channel.name} · {channel.type}</option>)}</select><small>Only Discord Forum and Media channels appear here. Refresh channels from the Channels page if your forum is missing.</small></label>
          {[
            ['auto_create_forum_posts','Create confirmed forum discussions','Confirmed Discord-detected ideas and dashboard-created ideas receive their own forum post.'],
            ['collect_thread_details','Collect discussion replies','Save added examples, links, screenshots, questions, and other community context.'],
            ['ai_summarize_thread','AI-organized community context','Maintain a concise dashboard summary of useful additions without overwriting original messages.'],
            ['edit_original_status_message','Keep the main forum post current','Update the bot’s main post when the title, summary, category, status, or support count changes.'],
            ['post_status_updates_to_thread','Post status changes','Add a visible timeline message when staff changes an idea’s status.'],
            ['include_suggestion_id','Show SUG number','Include the stable SUG-#### identifier in Discord.'],
            ['include_support_count','Show supporter count','Display the current unique supporter total in the forum post.']
          ].map(([key,title,description])=><label className="settingToggleCard" key={key}><input name={key} type="checkbox" defaultChecked={Boolean(a?.[key as keyof Automation]??true)}/><span><strong>{title}</strong><small>{description}</small></span></label>)}
        </div>
      </DirectSettingsForm>
    </section>

    <section className="panel">
      <div className="panelTitle"><div><h2>How the workflow behaves</h2><p>Each idea stays connected across Discord and the dashboard.</p></div></div>
      <div className="settingsList">
        <div className="settingsEditor"><div className="settingsKey">1 · Detect and confirm</div><p>A newly mentioned idea is clustered against existing suggestions, then the bot asks the player to confirm its summary before publishing it.</p></div>
        <div className="settingsEditor"><div className="settingsKey">2 · Discuss</div><p>Confirmation creates the forum post and reveals its link. The discussion becomes the place for examples, links, screenshots, questions, and community feedback.</p></div>
        <div className="settingsEditor"><div className="settingsKey">3 · Review</div><p>Staff can expand the idea with AI, edit the clean summary, and preserve every original message for reference.</p></div>
        <div className="settingsEditor"><div className="settingsKey">4 · Update</div><p>Status changes synchronize to the main post and leave a visible update in that suggestion’s discussion.</p></div>
      </div>
    </section>
  </>;
}
