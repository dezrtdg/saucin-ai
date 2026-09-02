import { NextResponse } from 'next/server';
import { api,DashboardApiError } from '../../../../../lib/api';

export const dynamic='force-dynamic';

export async function POST(_request:Request,context:{params:Promise<{id:string}>}){
  const {id}=await context.params;
  if(!/^\d+$/.test(id)) return NextResponse.json({error:'Invalid suggestion ID.'},{status:400});
  try{
    const result=await api(`/api/suggestions/${id}/discord-post`,{
      method:'POST',
      signal:AbortSignal.timeout(15000),
      body:'{}'
    });
    return NextResponse.json(result);
  }catch(error){
    if(error instanceof DashboardApiError) return NextResponse.json({error:error.message},{status:error.status});
    const name=error instanceof Error?error.name:'';
    if(name==='TimeoutError'||name==='AbortError') return NextResponse.json({error:'Discord did not respond within 15 seconds.'},{status:504});
    return NextResponse.json({error:error instanceof Error?error.message:'Unable to create the Discord suggestion post.'},{status:500});
  }
}
