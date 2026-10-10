import { underlyingProfile } from '@/lib/binance/rwa.ts';
import { underlyingFor } from '@/lib/binance/symbols.ts';
import type { ProfileFeed } from '@/lib/binance/wire.ts';

/**
 * The company behind one holding.
 *
 * `GET /api/reference/profile?symbol=NVDA`
 *
 * Same `200`-with-a-reason convention as the prices route next door, for the same
 * reason: a deployment without credentials is not a broken route.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('symbol')?.trim();
  if (!raw) {
    return Response.json({ error: 'Pass ?symbol=NVDA.' }, { status: 400 });
  }

  const result = await underlyingProfile(underlyingFor(raw));

  const body: ProfileFeed = {
    source: 'binance-web3',
    fetchedAt: new Date().toISOString(),
    profile: result.ok ? result.data : null,
    ...(result.ok
      ? {}
      : {
          error: {
            reason: result.reason,
            status: result.status,
            ...(result.code ? { code: result.code } : {}),
            message: result.message,
          },
        }),
  };

  return Response.json(body, { headers: { 'cache-control': 'no-store' } });
}
