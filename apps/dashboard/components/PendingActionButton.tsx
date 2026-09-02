'use client';

import { useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';

const ACTION_STATE_EVENT='saucin-dashboard-action-state';

export default function PendingActionButton({
  idleLabel,
  pendingLabel,
  className = 'button primary largeButton'
}: {
  idleLabel:string;
  pendingLabel:string;
  className?:string;
}) {
  const { pending } = useFormStatus();
  const previous=useRef(pending);

  useEffect(()=>{
    if(previous.current===pending) return;
    previous.current=pending;
    window.dispatchEvent(new CustomEvent(ACTION_STATE_EVENT,{detail:{pending,message:pending?pendingLabel:idleLabel}}));
  },[pending,pendingLabel,idleLabel]);

  return <button className={`${className}${pending ? ' isPending' : ''}`} type="submit" disabled={pending} aria-busy={pending} data-pending-label={pendingLabel}>
    {pending ? <><span className="actionSpinner" aria-hidden="true"/><span>{pendingLabel}</span></> : <span>{idleLabel}</span>}
  </button>;
}
