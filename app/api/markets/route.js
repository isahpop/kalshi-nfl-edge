import { NextResponse } from 'next/server';
import { getKalshiMarkets, getFeeConfig } from '../../../lib/feeds.mjs';
export const runtime = 'nodejs';
export async function GET() {
  try {
    const [feed, fee] = await Promise.all([getKalshiMarkets(), getFeeConfig()]);
    return NextResponse.json({ ...feed, ...fee }, { headers:{'Cache-Control':'public, s-maxage=60, stale-while-revalidate=30'} });
  } catch (error) {
    return NextResponse.json({ error:`Kalshi feed unavailable: ${error.message}`, markets:[] }, {status:502});
  }
}
