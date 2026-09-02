import { NextResponse } from 'next/server';
import { api, DashboardApiError } from '../../../../../lib/api';

export const dynamic = 'force-dynamic';

const standardActionLadder = {
  first: { action: 'reminder', delete_message: false },
  second: { action: 'warning', delete_message: false },
  third: { action: 'timeout_10m', delete_message: true },
  fourth_plus: { action: 'timeout_1h', delete_message: true }
} as const;

function value(formData:FormData,key:string){
  return String(formData.get(key)||'').trim();
}

function checked(formData:FormData,key:string){
  return formData.get(key)==='on' || formData.get(key)==='true';
}

export async function PUT(
  request:Request,
  context:{params:Promise<{articleId:string}>}
){
  const {articleId}=await context.params;
  if(!/^\d+$/.test(articleId)){
    return NextResponse.json({error:'Invalid moderation rule ID.'},{status:400});
  }

  try{
    const formData=await request.formData();
    const minimumConfidence=value(formData,'minimum_confidence');
    const repeatWindow=value(formData,'repeat_window_days');

    const result=await api(`/api/moderation/rules/${articleId}`,{
      method:'PUT',
      signal:AbortSignal.timeout(10000),
      body:JSON.stringify({
        enabled:checked(formData,'enabled'),
        minimum_confidence:minimumConfidence?Number(minimumConfidence):null,
        recommended_action:'reminder',
        action_ladder:standardActionLadder,
        repeat_window_days:repeatWindow?Number(repeatWindow):null,
        exempt_role_ids:[...new Set(formData.getAll('exempt_role_ids').map(String).filter(Boolean))],
        channel_ids:[...new Set(formData.getAll('channel_ids').map(String).filter(Boolean))]
      })
    });

    return NextResponse.json({ok:true,rule:result});
  }catch(error){
    if(error instanceof DashboardApiError){
      return NextResponse.json({error:error.message},{status:error.status>=400&&error.status<600?error.status:500});
    }
    const name=error instanceof Error?error.name:'';
    if(name==='TimeoutError'||name==='AbortError'){
      return NextResponse.json({error:'The moderation API did not respond within 10 seconds.'},{status:504});
    }
    return NextResponse.json({error:error instanceof Error?error.message:'Unable to save moderation rule settings.'},{status:500});
  }
}
