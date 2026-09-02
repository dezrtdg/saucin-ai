import { NextRequest, NextResponse } from 'next/server';
import { consumeOauthState, createDashboardSessionFromDiscord, exchangeDiscordCode } from '../../../../lib/auth';

function dashboardUrl(path: string) {
  return new URL(path, process.env.DASHBOARD_PUBLIC_URL || 'http://localhost:3000');
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code') || '';
  const state = request.nextUrl.searchParams.get('state') || '';
  if (!code || !(await consumeOauthState(state))) {
    return NextResponse.redirect(dashboardUrl('/?auth_error=invalid_state'));
  }
  try {
    const token = await exchangeDiscordCode(code);
    await createDashboardSessionFromDiscord(token.access_token);
    return NextResponse.redirect(dashboardUrl('/'));
  } catch (error) {
    console.error('[auth] Discord callback failed', error);
    return NextResponse.redirect(dashboardUrl('/?auth_error=access_denied'));
  }
}
