import { NextResponse } from 'next/server';
import { api,DashboardApiError } from '../../../../../lib/api';

export const dynamic='force-dynamic';

export async function POST(request:Request){
  try{
    const body=await request.json();
    const result=await api('/api/moderation/calibration/test',{
      method:'POST',
      signal:AbortSignal.timeout(60000),
      body:JSON.stringify(body)
    });
    return NextResponse.json(result);
  }catch(error){
    if(error instanceof DashboardApiError)return NextResponse.json({error:error.message},{status:error.status});
    const name=error instanceof Error?error.name:'';
    if(name==='TimeoutError'||name==='AbortError')return NextResponse.json({error:'The calibration test did not finish within 60 seconds.'},{status:504});
    return NextResponse.json({error:error instanceof Error?error.message:'Unable to run calibration test.'},{status:500});
  }
}
