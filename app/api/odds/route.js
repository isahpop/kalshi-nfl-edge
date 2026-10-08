import { NextResponse } from 'next/server';
import { getSportsbookOdds } from '../../../lib/feeds.mjs';
export const runtime = 'nodejs';
export async function GET() {
  const result = await getSportsbookOdds();
  return NextResponse.json(result, { status: result.error ? 502 : 200,
    headers:{'Cache-Control':'public, s-maxage=900, stale-while-revalidate=60'} });
}
