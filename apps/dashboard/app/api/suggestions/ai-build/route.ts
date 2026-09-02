import { NextResponse } from 'next/server';
import { api,DashboardApiError } from '../../../../lib/api';

export const dynamic='force-dynamic';

export async function POST(request:Request){
  try{
    const body=await request.json();
    const draft=await api('/api/suggestions/ai-build',{
      method:'POST',
      signal:AbortSignal.timeout(45000),
      body:JSON.stringify(body)
    });
    return NextResponse.json(draft);
  }catch(error){
    if(error instanceof DashboardApiError) return NextResponse.json({error:error.message},{status:error.status});
    const name=error instanceof Error?error.name:'';
    if(name==='TimeoutError'||name==='AbortError') return NextResponse.json({error:'Suggestion AI did not respond within 45 seconds.'},{status:504});
    return NextResponse.json({error:error instanceof Error?error.message:'Unable to create an AI suggestion draft.'},{status:500});
  }
}
