import { NextResponse } from 'next/server';
import { clearDashboardSession } from '../../../../lib/auth';

export async function GET() {
  await clearDashboardSession();
  return NextResponse.redirect(new URL('/', process.env.DASHBOARD_PUBLIC_URL || 'http://localhost:3000'));
}
