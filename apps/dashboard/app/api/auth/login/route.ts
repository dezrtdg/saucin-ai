import { NextResponse } from 'next/server';
import { createOauthState, discordAuthorizeUrl, isDashboardAuthRequired } from '../../../../lib/auth';

export async function GET() {
  if (!isDashboardAuthRequired()) return NextResponse.redirect(new URL('/', process.env.DASHBOARD_PUBLIC_URL || 'http://localhost:3000'));
  const state = await createOauthState();
  return NextResponse.redirect(discordAuthorizeUrl(state));
}
