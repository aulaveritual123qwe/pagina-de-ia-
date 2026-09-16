import { env } from 'cloudflare:workers';
import { PLANS, TOPUP } from '@/lib/plans';

export const dynamic = 'force-dynamic';

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

function formBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

type CheckoutBody = { email?: unknown; kind?: unknown; planName?: unknown };

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as CheckoutBody | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) return json({ error: 'Inicia sesión para continuar con el pago.' }, 400);

  const stripeKey = await providerSecret('STRIPE_SECRET_KEY');
  if (!stripeKey) return json({ error: 'Los pagos no están configurados. Contacta al administrador.' }, 501);

  const kind = body?.kind === 'plan' ? 'plan' : 'topup';
  const origin = new URL(request.url).origin;

  let amountCents: number;
  let creditsAmount: number;
  let productName: string;
  let mode: 'payment' | 'subscription' = 'payment';
  let planName = '';

  if (kind === 'plan') {
    planName = typeof body?.planName === 'string' ? body.planName : '';
    const plan = PLANS[planName];
    if (!plan) return json({ error: 'Plan inválido.' }, 400);
    amountCents = Math.round(plan.priceUsd * 100);
    creditsAmount = plan.credits;
    productName = `Plan ${planName} · Creators Academy`;
    mode = 'subscription';
  } else {
    amountCents = Math.round(TOPUP.priceUsd * 100);
    creditsAmount = TOPUP.credits;
    productName = 'Recarga de 700 créditos · Creators Academy';
  }

  const fields: Record<string, string> = {
    mode,
    'payment_method_types[0]': 'card',
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancel`,
    client_reference_id: email,
    'metadata[email]': email,
    'metadata[credits]': String(creditsAmount),
    'metadata[planName]': planName,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': productName,
    'line_items[0][price_data][unit_amount]': String(amountCents),
  };
  if (mode === 'subscription') {
    fields['line_items[0][price_data][recurring][interval]'] = 'month';
    fields['subscription_data[metadata][email]'] = email;
    fields['subscription_data[metadata][planName]'] = planName;
    fields['subscription_data[metadata][credits]'] = String(creditsAmount);
  }

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${stripeKey}` },
      body: formBody(fields),
    });
    const data = (await response.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
    if (!response.ok || !data?.url) return json({ error: data?.error?.message ?? 'No se pudo iniciar el pago.' }, 502);
    return json({ url: data.url });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error contactando a Stripe.' }, 500);
  }
}
