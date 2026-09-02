'use client';
import { useFormStatus } from 'react-dom';

export default function ConfirmSubmitButton({label,confirmMessage,className='button danger'}:{label:string;confirmMessage:string;className?:string}){
  const {pending}=useFormStatus();
  return <button className={className} type="submit" disabled={pending} aria-busy={pending} onClick={event=>{
    if(!window.confirm(confirmMessage)) event.preventDefault();
  }}>{pending?'Working…':label}</button>;
}
