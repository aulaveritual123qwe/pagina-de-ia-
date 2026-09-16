import { env } from 'cloudflare:workers';

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

// Stripe signs webhook bodies as `t=<timestamp>,v1=<hmac>`; verifying it here
// (instead of trusting the payload outright) stops anyone from POSTing fake
// "payment succeeded" events straight at this endpoint to mint free credits.
async function verifyStripeSignature(payload: string, header: string, signingSecret: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=') as [string, string]));
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signingSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(signatureBuffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return expected === signature;
}

type StripeCheckoutSession = {
  client_reference_id?: string;
  metadata?: Record<string, string>;
};

type StripeEvent = {
  type?: string;
  data?: { object?: StripeCheckoutSession };
};

export async function POST(request: Request) {
  const webhookSecret = await providerSecret('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) return new Response('No configurado', { status: 501 });

  const signatureHeader = request.headers.get('stripe-signature');
  const payload = await request.text();
  if (!signatureHeader || !(await verifyStripeSignature(payload, signatureHeader, webhookSecret))) {
    return new Response('Firma inválida', { status: 400 });
  }

  const event = JSON.parse(payload) as StripeEvent;
  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object;
    const email = session?.metadata?.email ?? session?.client_reference_id;
    const creditsToAdd = Number(session?.metadata?.credits ?? 0);
    const planName = session?.metadata?.planName ?? '';
    if (email && email.includes('@') && creditsToAdd > 0) {
      const key = creditsKey(email);
      const current = (await store().get(key, 'json').catch(() => null)) as CreditsRecord | null;
      const nextPurchased = (current?.purchasedCredits ?? 0) + creditsToAdd;
      await store().put(key, JSON.stringify({ ...current, purchasedCredits: nextPurchased, plan: planName || current?.plan || 'Free' }));
    }
  }

  return new Response('ok', { status: 200 });
}
