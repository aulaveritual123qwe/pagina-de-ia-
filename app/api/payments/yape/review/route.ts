import { env } from 'cloudflare:workers';
import { isAdminAuthorized } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

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

type CreditsRecord = { purchasedCredits?: number; dailyCredits?: number; dailyResetDate?: string; plan?: string };

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
  const body = (await request.json().catch(() => null)) as { adminEmail?: unknown; adminPassword?: unknown; requestId?: unknown; action?: unknown } | null;
  if (!(await isAdminAuthorized(store(), body?.adminEmail, body?.adminPassword))) return json({ error: 'No autorizado.' }, 403);

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
    const nextPurchased = (current?.purchasedCredits ?? 0) + record.credits;
    await store().put(balanceKey, JSON.stringify({ ...current, purchasedCredits: nextPurchased, plan: record.planName || current?.plan || 'Free' }));
    await store().put(`payment-log:${Date.now()}-${crypto.randomUUID()}`, JSON.stringify({
      email: record.email,
      method: 'yape',
      kind: record.kind,
      planName: record.planName,
      credits: record.credits,
      amountUsd: record.priceUsd,
      payerPhone: record.payerPhone,
      createdAt: Date.now(),
    }));
  }

  await store().put(key, JSON.stringify({ ...record, status: action === 'approve' ? 'approved' : 'rejected' }));
  return json({ ok: true });
}
