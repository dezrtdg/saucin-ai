'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LiveRefresh({interval=30000}:{interval?:number}){
  const router=useRouter();
  useEffect(()=>{
    const refresh=()=>{
      if(document.visibilityState!=='visible')return;
      if(document.querySelector('form[data-dashboard-pending="true"]'))return;
      if(document.querySelector('details[open]'))return;
      const active=document.activeElement;
      if(active instanceof HTMLInputElement||active instanceof HTMLTextAreaElement||active instanceof HTMLSelectElement)return;
      router.refresh();
    };
    const timer=window.setInterval(refresh,Math.max(15000,interval));
    return()=>window.clearInterval(timer);
  },[interval,router]);
  return null;
}
