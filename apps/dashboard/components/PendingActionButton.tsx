'use client';

import { useFormStatus } from 'react-dom';

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

  return <button className={`${className}${pending ? ' isPending' : ''}`} type="submit" disabled={pending} aria-busy={pending}>
    {pending ? <><span className="actionSpinner" aria-hidden="true"/><span>{pendingLabel}</span></> : <span>{idleLabel}</span>}
  </button>;
}
