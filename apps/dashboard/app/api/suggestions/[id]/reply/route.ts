import { NextResponse } from 'next/server';
import { api,DashboardApiError } from '../../../../../lib/api';

export const dynamic='force-dynamic';

export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  const {id}=await context.params;
  if(!/^\d+$/.test(id)) return NextResponse.json({error:'Invalid suggestion ID.'},{status:400});
  try{
    const body=await request.json();
    const result=await api(`/api/suggestions/${id}/reply`,{
      method:'POST',
      signal:AbortSignal.timeout(15000),
      body:JSON.stringify(body)
    });
    return NextResponse.json(result);
  }catch(error){
    if(error instanceof DashboardApiError) return NextResponse.json({error:error.message},{status:error.status});
    const name=error instanceof Error?error.name:'';
    if(name==='TimeoutError'||name==='AbortError') return NextResponse.json({error:'Discord did not accept the update within 15 seconds.'},{status:504});
    return NextResponse.json({error:error instanceof Error?error.message:'Unable to post suggestion update.'},{status:500});
  }
}
