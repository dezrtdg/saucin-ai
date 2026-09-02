import { revalidatePath } from 'next/cache';
import { api } from '../../lib/api';
import { can, getDashboardAccess } from '../../lib/permissions';
import { runDashboardAction } from '../../lib/actionFeedback';
import ChannelSettingsForm, { type ChannelSaveState } from '../../components/ChannelSettingsForm';

const MODES = ['ignored','monitor','questions','issues','suggestions','full'] as const;
type Mode = typeof MODES[number];
type Channel = {
  discord_channel_id: string;
  channel_name: string | null;
  channel_type: string | null;
  parent_name: string | null;
  category_name: string | null;
  is_thread: boolean;
  discord_resolved: boolean;
  mode: Mode;
  auto_reply: boolean;
  monitor_messages: boolean;
  detect_questions: boolean;
  detect_issues: boolean;
  detect_suggestions: boolean;
};

const MODE_LABELS: Record<Mode, string> = {
  ignored: 'Ignored',
  monitor: 'Monitor only',
  questions: 'Questions',
  issues: 'Issues',
  suggestions: 'Suggestions',
  full: 'Full'
};

async function saveAllChannels(previous: ChannelSaveState, formData: FormData): Promise<ChannelSaveState> {
  'use server';

  const channels: Array<{ id: string; mode: Mode }> = [];
  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith('mode:')) continue;
    const id = key.slice('mode:'.length).trim();
    const mode = String(rawValue) as Mode;
    if (!id || !MODES.includes(mode)) continue;
    channels.push({ id, mode });
  }

  if (!channels.length) {
    return { status:'error', revision:previous.revision + 1, message:'No channel settings were found to save.' };
  }

  try {
    await api('/api/channels', {
      method: 'PUT',
      body: JSON.stringify({ channels })
    });
    revalidatePath('/channels');
    return { status:'saved', revision:previous.revision + 1 };
  } catch (error) {
    return {
      status:'error',
      revision:previous.revision + 1,
      message:error instanceof Error ? error.message : 'Channel settings could not be saved.'
    };
  }
}

async function syncChannels() {
  'use server';
  return runDashboardAction({fallbackPath:'/channels',successMessage:'Discord channels refreshed.'},async()=>{
    await api('/api/channels/sync', { method: 'POST' });
    revalidatePath('/channels');
    return null;
  });
}

function channelLocation(channel: Channel) {
  const parts: string[] = [];
  if (channel.category_name) parts.push(channel.category_name);
  if (channel.is_thread && channel.parent_name && channel.parent_name !== channel.category_name) parts.push(`#${channel.parent_name}`);
  if (channel.channel_type) parts.push(channel.channel_type);
  return parts.join(' • ');
}

export default async function ChannelsPage() {
  let channels: Channel[] = [];
  let offline = false;
  let access=null;
  try { [channels,access] = await Promise.all([api<Channel[]>('/api/channels'),getDashboardAccess()]); } catch { offline = true; }
  const canManage=can(access,'channels.manage');

  const unresolved = channels.filter(channel => !channel.discord_resolved).length;
  const enabled = channels.filter(channel => channel.mode !== 'ignored').length;

  return (
    <>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">DISCORD CONTROL</p>
          <h1>Channels</h1>
          <p>Newly discovered channels are ignored by default. Enable only the channels where Saucin AI should listen or respond.</p>
        </div>
        <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',justifyContent:'flex-end'}}>
          {canManage?<form action={syncChannels}>
            <button className="button" type="submit" disabled={offline}>Refresh Discord Channels</button>
          </form>:null}
          <div className={offline ? 'status offline' : 'status'}><span />{offline ? 'API Offline' : `${channels.length} discovered • ${enabled} enabled`}</div>
        </div>
      </header>

      {unresolved > 0 && !offline ? (
        <section className="panel" style={{marginBottom:16}}>
          <div className="panelTitle">
            <div>
              <h2>{unresolved} channel{unresolved === 1 ? '' : 's'} could not be resolved</h2>
              <p>Use Refresh Discord Channels to re-check names. Unresolved IDs are usually deleted, archived, or inaccessible threads.</p>
            </div>
          </div>
        </section>
      ) : null}

      <ChannelSettingsForm action={saveAllChannels} canManage={canManage} disabled={offline} hasChannels={channels.length > 0}>
          <div className="table">
            <div className="tr th channelBulkRow"><span>Channel</span><span>Mode</span></div>
            {channels.length === 0 ? (
              <div className="empty">No eligible Discord channels found yet. Make sure the bot can view the server, then use Refresh Discord Channels.</div>
            ) : channels.map(channel => {
              const name = channel.channel_name || channel.discord_channel_id;
              const location = channelLocation(channel);
              return (
                <div className="tr channelBulkRow" key={channel.discord_channel_id}>
                  <span>
                    <strong>#{name}</strong>
                    {location ? <small>{location}</small> : null}
                    <small>{channel.discord_channel_id}{channel.discord_resolved ? '' : ' • unresolved'}</small>
                  </span>
                  <span>
                    <select className="select channelModeSelect" name={`mode:${channel.discord_channel_id}`} defaultValue={channel.mode} disabled={!canManage}>
                      {MODES.map(mode => <option key={mode} value={mode}>{MODE_LABELS[mode]}</option>)}
                    </select>
                  </span>
                </div>
              );
            })}
          </div>
      </ChannelSettingsForm>

      <section className="panel" style={{marginTop:16}}>
        <div className="panelTitle"><div><h2>Mode behavior</h2><p>Ignored is the safe default for every newly discovered channel.</p></div></div>
        <div className="table">
          <div className="tr"><strong>ignored</strong><span>Do not store or process messages, including direct mentions.</span><span></span><span></span></div>
          <div className="tr"><strong>monitor</strong><span>Store and classify messages; never reply unless directly mentioned and mention override is enabled. Suggestions are still collected silently.</span><span></span><span></span></div>
          <div className="tr"><strong>questions</strong><span>Answer verified questions from approved knowledge. Other detected support signals can still be collected without a reply.</span><span></span><span></span></div>
          <div className="tr"><strong>issues</strong><span>Detect and respond to matching known issues. Suggestions can still be collected silently.</span><span></span><span></span></div>
          <div className="tr"><strong>suggestions</strong><span>Detect community ideas, cluster duplicates, count supporters, and acknowledge the suggestion with a support button.</span><span></span><span></span></div>
          <div className="tr"><strong>full</strong><span>Questions, issues, and suggestions are all handled with their normal response behavior.</span><span></span><span></span></div>
        </div>
      </section>
    </>
  );
}