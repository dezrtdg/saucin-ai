import { NextResponse } from 'next/server';
import { api,DashboardApiError } from '../../../../lib/api';

export const dynamic='force-dynamic';

export async function GET(request:Request){
  try{
    const url=new URL(request.url);
    const includeReviewed=url.searchParams.get('include_reviewed')==='true';
    const data=await api(`/api/automation?include_reviewed=${includeReviewed?'true':'false'}`,{
      signal:AbortSignal.timeout(12000)
    });
    return NextResponse.json(data,{headers:{'cache-control':'private, no-store'}});
  }catch(error){
    if(error instanceof DashboardApiError)return NextResponse.json({error:error.message},{status:error.status});
    return NextResponse.json({error:'Unable to refresh the Automation Center.'},{status:500});
  }
}
