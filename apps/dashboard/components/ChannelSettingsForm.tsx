'use client';

import { useActionState, useEffect, useState, type ReactNode } from 'react';

export type ChannelSaveState = {
  status:'idle'|'saved'|'error';
  revision:number;
  message?:string;
};

type Props = {
  action:(previous:ChannelSaveState, formData:FormData)=>Promise<ChannelSaveState>;
  canManage:boolean;
  disabled:boolean;
  hasChannels:boolean;
  children:ReactNode;
};

const INITIAL_STATE:ChannelSaveState={status:'idle',revision:0};

export default function ChannelSettingsForm({action,canManage,disabled,hasChannels,children}:Props){
  const [state,formAction,pending]=useActionState(action,INITIAL_STATE);
  const [dirty,setDirty]=useState(false);

  useEffect(()=>{
    if(state.status==='saved') setDirty(false);
  },[state.revision,state.status]);

  const saved=state.status==='saved'&&!dirty&&!pending;
  const label=pending?'Saving settings…':saved?'Settings saved ✓':'Save All Channel Settings';

  return <form action={formAction} onChange={()=>setDirty(true)} data-dashboard-managed-state="true">
    <section className="panel">
      <div className="panelTitle">
        <div>
          <h2>Channel policies</h2>
          <p>Choose all channel modes below, then apply every change at once with the Save All button.</p>
        </div>
      </div>

      {children}

      {hasChannels?<div className="channelSaveBar">
        <div>
          <strong>{canManage?(saved?'Channel settings saved':'Apply channel settings'):'Channel settings are view only'}</strong>
          <small>
            {!canManage
              ? 'Your current Discord role can view channel policies but cannot change them.'
              : state.status==='error'&&!dirty
                ? state.message||'Channel settings could not be saved.'
                : saved
                  ? 'All channel policies are up to date. Changing any dropdown will mark them unsaved again.'
                  : dirty
                    ? 'You have unsaved channel changes.'
                    : 'Your dropdown choices stay selected until you save. One click updates every channel.'}
          </small>
        </div>
        {canManage?<button
          className={`button primary channelSaveButton${saved?' channelSaveButtonSaved':''}`}
          type="submit"
          disabled={disabled||pending}
          aria-live="polite"
        >
          {pending?<span className="channelSaveSpinner" aria-hidden="true"/>:null}
          <span>{label}</span>
        </button>:null}
      </div>:null}
    </section>
  </form>;
}
