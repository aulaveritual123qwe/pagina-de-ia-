import { env } from 'cloudflare:workers';
import { PLANS, TOPUP } from '@/lib/plans';

export const dynamic = 'force-dynamic';

const ADMIN_EMAIL = 'admin@creatorsacademy.pro';

type YapeRequest = {
  id: string;
  email: string;
  kind: 'plan' | 'topup';
  planName: string;
  credits: number;
  priceUsd: number;
  payerPhone: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
};

type KVLike = {
  get: (key: string, type?: 'json') => Promise<unknown>;
  put: (key: string, value: string) => Promise<void>;
  list: (options: { prefix: string }) => Promise<{ keys: Array<{ name: string }> }>;
};

function store() {
  return (env as unknown as { IMAGE_CACHE: KVLike }).IMAGE_CACHE;
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

const PHONE_PATTERN = /^9\d{8}$/;

// Yape has no public merchant API for individual creators, so payments are
// verified manually: the customer pays to the published phone number and
// files a claim here; an admin cross-checks it against their Yape app and
// approves it from /admin, which is what actually credits the account.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; kind?: unknown; planName?: unknown; payerPhone?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const payerPhone = typeof body?.payerPhone === 'string' ? body.payerPhone.replace(/\D/g, '') : '';
  if (!email || !email.includes('@')) return json({ error: 'Inicia sesión para continuar.' }, 400);
  if (!PHONE_PATTERN.test(payerPhone)) return json({ error: 'Ingresa el número de celular (9 dígitos) desde el que pagaste con Yape.' }, 400);

  const kind = body?.kind === 'plan' ? 'plan' : 'topup';
  let planName = '';
  let credits: number;
  let priceUsd: number;

  if (kind === 'plan') {
    planName = typeof body?.planName === 'string' ? body.planName : '';
    const plan = PLANS[planName];
    if (!plan) return json({ error: 'Plan inválido.' }, 400);
    credits = plan.credits;
    priceUsd = plan.priceUsd;
  } else {
    credits = TOPUP.credits;
    priceUsd = TOPUP.priceUsd;
  }

  const record: YapeRequest = {
    id: crypto.randomUUID(),
    email,
    kind,
    planName,
    credits,
    priceUsd,
    payerPhone,
    status: 'pending',
    createdAt: Date.now(),
  };
  await store().put(`yape-request:${record.id}`, JSON.stringify(record));
  return json({ ok: true, requestId: record.id });
}

// Admin-only: list pending (and recent) Yape claims for manual review.
export async function GET(request: Request) {
  const adminEmail = new URL(request.url).searchParams.get('adminEmail')?.trim().toLowerCase();
  if (adminEmail !== ADMIN_EMAIL) return json({ error: 'No autorizado.' }, 403);

  const list = await store().list({ prefix: 'yape-request:' });
  const records = (
    await Promise.all(list.keys.map((key) => store().get(key.name, 'json').catch(() => null)))
  ).filter((record): record is YapeRequest => Boolean(record));
  records.sort((a, b) => b.createdAt - a.createdAt);
  return json({ requests: records });
}
