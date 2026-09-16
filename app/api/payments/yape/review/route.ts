import { env } from 'cloudflare:workers';

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

type CreditsRecord = { credits?: number; plan?: string };

type KVLike = {
  get: (key: string, type?: 'json') => Promise<unknown>;
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

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { adminEmail?: unknown; requestId?: unknown; action?: unknown } | null;
  const adminEmail = typeof body?.adminEmail === 'string' ? body.adminEmail.trim().toLowerCase() : '';
  if (adminEmail !== ADMIN_EMAIL) return json({ error: 'No autorizado.' }, 403);

  const requestId = typeof body?.requestId === 'string' ? body.requestId : '';
  const action = body?.action === 'approve' ? 'approve' : body?.action === 'reject' ? 'reject' : null;
  if (!requestId || !action) return json({ error: 'Solicitud inválida.' }, 400);

  const key = `yape-request:${requestId}`;
  const record = (await store().get(key, 'json').catch(() => null)) as YapeRequest | null;
  if (!record) return json({ error: 'Solicitud no encontrada.' }, 404);
  if (record.status !== 'pending') return json({ error: 'Esta solicitud ya fue revisada.' }, 409);

  if (action === 'approve') {
    const balanceKey = creditsKey(record.email);
    const current = (await store().get(balanceKey, 'json').catch(() => null)) as CreditsRecord | null;
    const nextCredits = (current?.credits ?? 0) + record.credits;
    await store().put(balanceKey, JSON.stringify({ credits: nextCredits, plan: record.planName || current?.plan || 'Free' }));
  }

  await store().put(key, JSON.stringify({ ...record, status: action === 'approve' ? 'approved' : 'rejected' }));
  return json({ ok: true });
}
