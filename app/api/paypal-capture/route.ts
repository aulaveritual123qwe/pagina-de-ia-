import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

// Live PayPal credentials are configured in /admin — this moves real money.
const PAYPAL_API_BASE = 'https://api-m.paypal.com';

type ConfigKV = {
  get: (key: string, type?: 'json') => Promise<Record<string, string> | null>;
};

function secret(name: string): string | undefined {
  const workerEnv = env as unknown as Record<string, string | undefined>;
  return process.env[name] ?? workerEnv[name];
}

async function providerSecret(name: string): Promise<string | undefined> {
  const direct = secret(name);
  if (direct) return direct;
  const kv = (env as unknown as { IMAGE_CACHE?: ConfigKV }).IMAGE_CACHE;
  const config = await kv?.get?.('admin:api-config', 'json').catch(() => null);
  return typeof config?.[name] === 'string' ? config[name] : undefined;
}

type CreditsRecord = { purchasedCredits?: number; dailyCredits?: number; dailyResetDate?: string; plan?: string };

type KVLike = ConfigKV & {
  put: (key: string, value: string) => Promise<void>;
};

function store() {
  return (env as unknown as { IMAGE_CACHE: KVLike }).IMAGE_CACHE;
}

function creditsKey(email: string) {
  return `credits:${email.trim().toLowerCase()}`;
}

async function getPayPalAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: 'grant_type=client_credentials',
  });
  const data = (await response.json().catch(() => null)) as { access_token?: string } | null;
  if (!response.ok || !data?.access_token) throw new Error('No se pudo autenticar con PayPal.');
  return data.access_token;
}

// PayPal redirects the browser here (GET) after the user approves the order
// on PayPal's own site, appending `token` (the order id). Capturing it here
// is what actually moves the money — approval alone doesn't charge anything.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const orderId = url.searchParams.get('token');
  const email = url.searchParams.get('email');
  const credits = Number(url.searchParams.get('credits'));
  const planName = url.searchParams.get('planName') ?? '';
  const kind = url.searchParams.get('kind') === 'plan' ? 'plan' : 'topup';
  const amountUsd = Number(url.searchParams.get('amountUsd') ?? 0);

  function fail() {
    return Response.redirect(`${origin}/?checkout=cancel`, 302);
  }

  if (!orderId || !email || !email.includes('@') || !Number.isFinite(credits) || credits <= 0) return fail();

  const clientId = await providerSecret('PAYPAL_CLIENT_ID');
  const clientSecret = await providerSecret('PAYPAL_CLIENT_SECRET');
  if (!clientId || !clientSecret) return fail();

  try {
    const accessToken = await getPayPalAccessToken(clientId, clientSecret);
    const captureResponse = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    });
    const captureData = (await captureResponse.json().catch(() => null)) as { status?: string } | null;
    if (!captureResponse.ok || captureData?.status !== 'COMPLETED') return fail();

    const key = creditsKey(email);
    const current = (await store().get(key, 'json').catch(() => null)) as CreditsRecord | null;
    const nextPurchased = (current?.purchasedCredits ?? 0) + credits;
    await store().put(key, JSON.stringify({ ...current, purchasedCredits: nextPurchased, plan: planName || current?.plan || 'Free' }));
    await store().put(`payment-log:${Date.now()}-${crypto.randomUUID()}`, JSON.stringify({
      email: email.trim().toLowerCase(), method: 'paypal', kind, planName, credits, amountUsd, createdAt: Date.now(),
    }));

    return Response.redirect(`${origin}/?checkout=success`, 302);
  } catch {
    return fail();
  }
}
