import { NextResponse } from 'next/server';
import { api,DashboardApiError } from '../../../../lib/api';

export const dynamic='force-dynamic';

export async function GET(){
  try{return NextResponse.json(await api('/api/notifications'));}
  catch(error){
    if(error instanceof DashboardApiError)return NextResponse.json({error:error.message},{status:error.status});
    return NextResponse.json({error:'Unable to load notifications.'},{status:500});
  }
}

export async function POST(request:Request){
  try{
    const body=await request.json();
    return NextResponse.json(await api('/api/notifications/read',{method:'POST',body:JSON.stringify(body)}));
  }catch(error){
    if(error instanceof DashboardApiError)return NextResponse.json({error:error.message},{status:error.status});
    return NextResponse.json({error:'Unable to update notifications.'},{status:500});
  }
}
