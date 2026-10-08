import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const revalidate = 180;
export async function GET() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return NextResponse.json({ configured: false, events: [] });
  const url = new URL('https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds');
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', 'h2h');
  url.searchParams.set('oddsFormat', 'american');
  url.searchParams.set('apiKey', apiKey);
  try {
    const response = await fetch(url, { next: { revalidate: 180 }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Sportsbook API returned HTTP ${response.status}`);
    const events = await response.json();
    if (!Array.isArray(events)) throw new Error('Unexpected sportsbook data');
    return NextResponse.json({ configured: true, events, fetchedAt: new Date().toISOString(), remaining: response.headers.get('x-requests-remaining') });
  } catch (error) {
    return NextResponse.json({ configured: true, events: [], error: error.message }, { status: 502 });
  }
}
