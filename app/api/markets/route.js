import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const revalidate = 45;
export async function GET() {
  const url = 'https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=KXNFLGAME&status=open&limit=250';
  try {
    const response = await fetch(url, { next: { revalidate: 45 }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Kalshi returned HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.markets)) throw new Error('Kalshi returned an unexpected response');
    return NextResponse.json({ markets: data.markets, fetchedAt: new Date().toISOString(), truncated: Boolean(data.cursor) });
  } catch (error) {
    return NextResponse.json({ error: `Kalshi market feed unavailable: ${error.message}`, markets: [] }, { status: 502 });
  }
}
