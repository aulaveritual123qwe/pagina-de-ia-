import { env } from 'cloudflare:workers';
import { isAdminAuthorized } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

// Hidden from the admin's user list and immune to manual credit adjustments —
// this account gets its balance from the unlimited-credits special case in
// /api/credits instead.
const HIDDEN_EMAILS = new Set(['jef.barmen@gmail.com']);

type CreditsRecord = { purchasedCredits?: number; dailyCredits?: number; dailyResetDate?: string; plan?: string };

type KVLike = {
  get: (key: string, type?: 'json') => Promise<unknown>;
  put: (key: string, value: string) => Promise<void>;
  list: (options: { prefix: string; cursor?: string }) => Promise<{ keys: Array<{ name: string }>; cursor?: string; list_complete: boolean }>;
};

function store() {
  return (env as unknown as { IMAGE_CACHE: KVLike }).IMAGE_CACHE;
}

function creditsKey(email: string) {
  return `credits:${email}`;
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function listAllUserEmails(): Promise<string[]> {
  const emails: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await store().list({ prefix: 'credits:', cursor });
    for (const key of page.keys) emails.push(key.name.slice('credits:'.length));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return emails;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (!(await isAdminAuthorized(store(), params.get('adminEmail'), params.get('adminPassword')))) return json({ error: 'No autorizado.' }, 403);

  const emails = await listAllUserEmails();
  const users: Array<{ email: string; plan: string; credits: number; purchasedCredits: number; dailyCredits: number }> = [];
  for (const email of emails) {
    if (HIDDEN_EMAILS.has(email)) continue;
    const record = (await store().get(creditsKey(email), 'json').catch(() => null)) as CreditsRecord | null;
    const plan = record?.plan ?? 'Free';
    const purchasedCredits = record?.purchasedCredits ?? 0;
    const dailyCredits = record?.dailyCredits ?? 0;
    const credits = plan === 'Free' ? dailyCredits + purchasedCredits : purchasedCredits;
    users.push({ email, plan, credits, purchasedCredits, dailyCredits });
  }
  users.sort((a, b) => a.email.localeCompare(b.email));

  const byPlan: Record<string, number> = {};
  for (const user of users) byPlan[user.plan] = (byPlan[user.plan] ?? 0) + 1;

  return json({ users, total: users.length, byPlan });
}

// Admin manually grants (or removes, with a negative amount) purchased
// credits for a user — e.g. to compensate for a failed generation, or to
// honor a payment received outside Stripe/Yape.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { adminEmail?: unknown; adminPassword?: unknown; email?: unknown; amount?: unknown } | null;
  if (!(await isAdminAuthorized(store(), body?.adminEmail, body?.adminPassword))) return json({ error: 'No autorizado.' }, 403);

  const targetEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const amount = typeof body?.amount === 'number' ? body.amount : Number(body?.amount);
  if (!targetEmail || !targetEmail.includes('@')) return json({ error: 'Cuenta inválida.' }, 400);
  if (HIDDEN_EMAILS.has(targetEmail)) return json({ error: 'Esta cuenta no se puede modificar desde aquí.' }, 400);
  if (!Number.isFinite(amount) || amount === 0) return json({ error: 'Ingresa una cantidad de créditos distinta de cero.' }, 400);

  const key = creditsKey(targetEmail);
  const current = (await store().get(key, 'json').catch(() => null)) as CreditsRecord | null;
  const nextPurchased = Math.max(0, (current?.purchasedCredits ?? 0) + amount);
  await store().put(key, JSON.stringify({ ...current, purchasedCredits: nextPurchased, plan: current?.plan ?? 'Free' }));
  return json({ ok: true, purchasedCredits: nextPurchased });
}
