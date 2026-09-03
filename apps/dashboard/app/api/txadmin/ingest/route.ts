import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

export const dynamic='force-dynamic';
export const runtime='nodejs';

function sameSecret(provided:string,expected:string){
  const left=Buffer.from(provided);const right=Buffer.from(expected);
  return left.length===right.length&&timingSafeEqual(left,right);
}

export async function POST(request:Request){
  const token=process.env.TXADMIN_COLLECTOR_TOKEN||'';
  if(!token)return NextResponse.json({error:'txAdmin collector is not configured'},{status:503});
  const authorization=request.headers.get('authorization')||'';
  const provided=authorization.startsWith('Bearer ')?authorization.slice(7).trim():'';
  if(!provided||!sameSecret(provided,token))return NextResponse.json({error:'unauthorized collector'},{status:401});
  const body=await request.text();
  if(body.length>1_500_000)return NextResponse.json({error:'collector payload too large'},{status:413});
  try{
    const response=await fetch(`${process.env.API_INTERNAL_URL||'http://api:3100'}/api/txadmin/ingest`,{
      method:'POST',headers:{authorization, 'content-type':'application/json'},body,cache:'no-store'
    });
    const text=await response.text();
    return new NextResponse(text,{status:response.status,headers:{'content-type':response.headers.get('content-type')||'application/json'}});
  }catch{
    return NextResponse.json({error:'txAdmin ingestion service unavailable'},{status:503});
  }
}
