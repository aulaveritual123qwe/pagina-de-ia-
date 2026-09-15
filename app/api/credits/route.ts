import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type CreditsRecord = { credits?: number; plan?: string };

type KVLike = {
  get: (key: string, type?: 'json') => Promise<CreditsRecord | null>;
  put: (key: string, value: string) => Promise<void>;
};

function store() {
  return (env as unknown as { IMAGE_CACHE: KVLike }).IMAGE_CACHE;
}

function creditsKey(email: string) {
  return `credits:${email.trim().toLowerCase()}`;
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get('email')?.trim().toLowerCase();
  if (!email || !email.includes('@')) return json({ error: 'Cuenta inválida.' }, 400);
  const record = await store().get(creditsKey(email), 'json').catch(() => null);
  return json({ credits: record?.credits ?? 0, plan: record?.plan ?? 'Free' });
}

// Client-side spends (image/video generation) sync here so the server balance
// — the source of truth Stripe payments add to — doesn't drift from what the
// browser has already deducted locally.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; credits?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const credits = typeof body?.credits === 'number' ? body.credits : Number(body?.credits);
  if (!email || !email.includes('@')) return json({ error: 'Cuenta inválida.' }, 400);
  if (!Number.isFinite(credits) || credits < 0) return json({ error: 'Saldo inválido.' }, 400);
  const key = creditsKey(email);
  const current = await store().get(key, 'json').catch(() => null);
  await store().put(key, JSON.stringify({ credits: Math.floor(credits), plan: current?.plan ?? 'Free' }));
  return json({ ok: true });
}
