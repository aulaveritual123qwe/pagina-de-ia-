import { env } from 'cloudflare:workers';
import { isAdminAuthorized } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

type PaymentRecord = {
  email: string;
  method: 'stripe' | 'yape';
  kind: 'plan' | 'topup';
  planName: string;
  credits: number;
  amountUsd: number;
  payerPhone?: string;
  createdAt: number;
};

type KVLike = {
  get: (key: string, type?: 'json') => Promise<unknown>;
  list: (options: { prefix: string; cursor?: string }) => Promise<{ keys: Array<{ name: string }>; cursor?: string; list_complete: boolean }>;
};

function store() {
  return (env as unknown as { IMAGE_CACHE: KVLike }).IMAGE_CACHE;
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// Confirmed payments only — Stripe webhook writes one on checkout.session.completed,
// Yape review writes one when an admin approves a claim. This is the receipt
// trail an admin can use to double-check who actually paid.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (!(await isAdminAuthorized(store(), params.get('adminEmail'), params.get('adminPassword')))) return json({ error: 'No autorizado.' }, 403);

  const records: PaymentRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await store().list({ prefix: 'payment-log:', cursor });
    for (const key of page.keys) {
      const record = (await store().get(key.name, 'json').catch(() => null)) as PaymentRecord | null;
      if (record) records.push(record);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  records.sort((a, b) => b.createdAt - a.createdAt);
  return json({ payments: records.slice(0, 300) });
}
