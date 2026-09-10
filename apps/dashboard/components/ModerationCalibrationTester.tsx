'use client';

import { useState,type FormEvent } from 'react';

type Channel={id:string;name:string|null;mode:string;monitor_messages:boolean};
type Result={
  decision:string;label:string;reason:string;evidence?:string;rule_id?:number|null;rule_title?:string|null;
  confidence?:number|null;threshold?:number|null;context_kind?:string;harmful_targeting?:boolean;
  plausible_benign_interpretation?:boolean;creates_case:boolean;contacts_discord:boolean;applies_action:boolean;
  first_pass?:Record<string,unknown>;second_pass?:Record<string,unknown>;
};

const examples=[
  {label:'Gameplay clip',message:"I'm going to clip that",context:'Alex made a funny play in game and everyone is laughing about it.'},
  {label:'Player advice',message:"Have you tried at Lester's?",context:'A player asked where an in-game item might be available.'},
  {label:'Targeted insult',message:"You're a stupid ass bitch",context:'The recipient asked the speaker to stop insulting them, but the speaker continued.'}
];

function pct(value:number|null|undefined){return value==null?'—':`${Math.round(value*100)}%`;}
function tone(decision:string){
  if(decision==='would_create_observe_case')return 'calibrationResultFlag';
  if(decision==='analysis_error'||decision==='ai_unavailable')return 'calibrationResultError';
  if(decision==='below_threshold')return 'calibrationResultCaution';
  return 'calibrationResultSafe';
}

export default function ModerationCalibrationTester({channels}:{channels:Channel[]}){
  const [message,setMessage]=useState('');
  const [context,setContext]=useState('');
  const [channelId,setChannelId]=useState('');
  const [result,setResult]=useState<Result|null>(null);
  const [state,setState]=useState<'idle'|'running'|'error'>('idle');
  const [error,setError]=useState('');

  function loadExample(example:typeof examples[number]){
    setMessage(example.message);setContext(example.context);setResult(null);setError('');setState('idle');
  }

  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(state==='running'||message.trim().length<2)return;
    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),60000);
    setState('running');setError('');setResult(null);
    try{
      const response=await fetch('/api/moderation/calibration/test',{
        method:'POST',headers:{'content-type':'application/json'},cache:'no-store',signal:controller.signal,
        body:JSON.stringify({content:message,context,author_name:'Test member',channel_id:channelId||null})
      });
      const payload=await response.json() as Result&{error?:string};
      if(!response.ok)throw new Error(payload.error||`Request failed (${response.status}).`);
      setResult(payload);setState('idle');
    }catch(caught){
      setState('error');
      setError(controller.signal.aborted?'The test did not finish within 60 seconds.':caught instanceof Error?caught.message:'Unable to run the test.');
    }finally{window.clearTimeout(timeout);}
  }

  return <div className="calibrationTester">
    <div className="calibrationExamples"><span>Quick tests</span>{examples.map(example=><button type="button" className="button subtle" key={example.label} onClick={()=>loadExample(example)}>{example.label}</button>)}</div>
    <form className="knowledgeForm" onSubmit={submit}>
      <label className="field"><span>Target message</span><textarea className="input calibrationMessage" value={message} onChange={event=>setMessage(event.target.value)} maxLength={4000} required placeholder="Paste the exact Discord message to test…"/><small>{message.length}/4000 · This test does not create a case or contact Discord.</small></label>
      <label className="field"><span>Conversation context</span><textarea className="input calibrationContext" value={context} onChange={event=>setContext(event.target.value)} maxLength={6000} placeholder={'Add the messages immediately before it, for example:\nAlex: nice shot\nJordan: I am going to clip that'}/><small>Context matters most for banter, quoting, roleplay, and ambiguous gaming language.</small></label>
      <label className="field"><span>Channel scope</span><select className="input select" value={channelId} onChange={event=>setChannelId(event.target.value)}><option value="">All enabled moderation rules</option>{channels.filter(c=>c.monitor_messages&&c.mode!=='ignored').map(channel=><option value={channel.id} key={channel.id}>#{channel.name||channel.id}</option>)}</select><small>Optional. Selecting a channel applies rule-specific channel restrictions.</small></label>
      <div className="formActions"><div>{error?<small className="formError">{error}</small>:<small>Two independent AI passes must agree before a message can qualify.</small>}</div><button className="button primary" disabled={state==='running'||message.trim().length<2}>{state==='running'?<><span className="actionSpinner" aria-hidden="true"/> Testing safely…</>:'Run safe test'}</button></div>
    </form>

    {result?<section className={`calibrationResult ${tone(result.decision)}`} aria-live="polite">
      <div className="calibrationResultHeader"><div><span className="sectionLabel">DRY-RUN RESULT</span><h3>{result.label}</h3></div><span className="badge">{result.decision.replaceAll('_',' ')}</span></div>
      <p>{result.reason}</p>
      <div className="calibrationResultGrid">
        <div><span>Rule</span><strong>{result.rule_title||'No verified rule match'}</strong></div>
        <div><span>Final confidence</span><strong>{pct(result.confidence)}</strong></div>
        <div><span>Required threshold</span><strong>{pct(result.threshold)}</strong></div>
        <div><span>Context reading</span><strong>{result.context_kind?.replaceAll('_',' ')||'—'}</strong></div>
      </div>
      {result.evidence?<div className="calibrationEvidence"><span>Evidence considered</span><p>{result.evidence}</p></div>:null}
      <div className="calibrationGuarantee"><strong>No side effects:</strong> no case created · no Discord message · no warning · no punishment</div>
    </section>:null}
  </div>;
}
