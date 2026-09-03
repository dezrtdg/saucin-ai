'use client';

import { useFormStatus } from 'react-dom';

type Variant='default'|'primary'|'danger'|'subtle';

export default function ActionButton({label,pendingLabel,confirmMessage,variant='default',className='',formAction,disabled=false}:{
  label:string;pendingLabel?:string;confirmMessage?:string;variant?:Variant;className?:string;
  formAction?:(formData:FormData)=>void|Promise<void>;disabled?:boolean;
}){
  const {pending}=useFormStatus();
  const variantClass=variant==='default'?'':` ${variant}`;
  return <button type="submit" formAction={formAction}
    className={`button${variantClass}${pending?' isPending':''}${className?` ${className}`:''}`}
    disabled={pending||disabled} aria-busy={pending}
    onClick={confirmMessage?event=>{if(!window.confirm(confirmMessage))event.preventDefault();}:undefined}
  >{pending?<><span className="actionSpinner" aria-hidden="true"/><span>{pendingLabel||`${label}…`}</span></>:label}</button>;
}
