import { env } from 'cloudflare:workers';
import { PLANS, TOPUP } from '@/lib/plans';

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

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
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
  const data = (await response.json().catch(() => null)) as { access_token?: string; error_description?: string } | null;
  if (!response.ok || !data?.access_token) throw new Error(data?.error_description ?? 'No se pudo autenticar con PayPal.');
  return data.access_token;
}

type CheckoutBody = { email?: unknown; kind?: unknown; planName?: unknown };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as CheckoutBody | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) return json({ error: 'Inicia sesión para continuar con el pago.' }, 400);

  const clientId = await providerSecret('PAYPAL_CLIENT_ID');
  const clientSecret = await providerSecret('PAYPAL_CLIENT_SECRET');
  if (!clientId || !clientSecret) return json({ error: 'Los pagos con PayPal no están configurados. Contacta al administrador.' }, 501);

  const kind = body?.kind === 'plan' ? 'plan' : 'topup';
  let amountUsd: number;
  let creditsAmount: number;
  let planName = '';
  let description: string;

  if (kind === 'plan') {
    planName = typeof body?.planName === 'string' ? body.planName : '';
    const plan = PLANS[planName];
    if (!plan) return json({ error: 'Plan inválido.' }, 400);
    amountUsd = plan.priceUsd;
    creditsAmount = plan.credits;
    description = `Plan ${planName} · Creators Academy`;
  } else {
    amountUsd = TOPUP.priceUsd;
    creditsAmount = TOPUP.credits;
    description = 'Recarga de 700 créditos · Creators Academy';
  }

  const origin = new URL(request.url).origin;
  const returnUrl = new URL(`${origin}/api/paypal-capture`);
  returnUrl.searchParams.set('email', email);
  returnUrl.searchParams.set('credits', String(creditsAmount));
  returnUrl.searchParams.set('planName', planName);
  returnUrl.searchParams.set('kind', kind);
  returnUrl.searchParams.set('amountUsd', String(amountUsd));

  try {
    const accessToken = await getPayPalAccessToken(clientId, clientSecret);
    const orderResponse = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'USD', value: amountUsd.toFixed(2) }, description }],
        application_context: {
          return_url: returnUrl.toString(),
          cancel_url: `${origin}/?checkout=cancel`,
          user_action: 'PAY_NOW',
          brand_name: 'Creators Academy Pro',
        },
      }),
    });
    const orderData = (await orderResponse.json().catch(() => null)) as { links?: Array<{ rel?: string; href?: string }>; message?: string } | null;
    const approveLink = orderData?.links?.find((link) => link.rel === 'approve')?.href;
    if (!orderResponse.ok || !approveLink) return json({ error: 'No se pudo iniciar el pago con PayPal. Contacta al administrador.' }, 502);
    return json({ url: approveLink });
  } catch {
    // Never echo PayPal's raw error text (e.g. "Client Authentication failed")
    // to the user — it's a config problem for the admin, not something a
    // buyer can act on.
    return json({ error: 'Los pagos con PayPal no están disponibles en este momento. Contacta al administrador.' }, 500);
  }
}
