import { NextResponse } from 'next/server';
import { api,DashboardApiError } from '../../../lib/api';

export const dynamic='force-dynamic';

export async function POST(request:Request){
  try{
    const body=await request.json();
    const suggestion=await api('/api/suggestions',{
      method:'POST',
      signal:AbortSignal.timeout(10000),
      body:JSON.stringify(body)
    });
    return NextResponse.json(suggestion,{status:201});
  }catch(error){
    if(error instanceof DashboardApiError) return NextResponse.json({error:error.message},{status:error.status});
    const name=error instanceof Error?error.name:'';
    if(name==='TimeoutError'||name==='AbortError') return NextResponse.json({error:'The suggestions API did not respond within 10 seconds.'},{status:504});
    return NextResponse.json({error:error instanceof Error?error.message:'Unable to create suggestion.'},{status:500});
  }
}
