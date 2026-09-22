import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

const SIGNUP_CREDITS = 120;
const UNLIMITED_CREDITS_DISPLAY = 999_999_999;
// Accounts granted unlimited usage: never deducted, always reports a balance
// large enough that no real usage could ever exhaust it.
const UNLIMITED_EMAILS = new Set(['jef.barmen@gmail.com']);

type CreditsRecord = {
  purchasedCredits?: number;
  dailyCredits?: number;
  dailyResetDate?: string;
  plan?: string;
};

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

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// New accounts get a one-time 120-credit grant when their record is first
// created — never repeated, no daily recharge. Any leftover dailyCredits from
// the old recurring-reset system are folded into purchasedCredits once (so
// nobody loses a balance they already had) and the field is retired from
// then on. From here out, every credit — signup grant, admin grant, or a
// paid plan/top-up — lives in purchasedCredits and is only ever added to by
// a real payment or an admin decision.
async function loadBalance(email: string): Promise<{ record: Required<CreditsRecord>; total: number }> {
  const key = creditsKey(email);
  const existing = await store().get(key, 'json').catch(() => null);

  if (UNLIMITED_EMAILS.has(email)) {
    const record: Required<CreditsRecord> = { purchasedCredits: UNLIMITED_CREDITS_DISPLAY, dailyCredits: 0, dailyResetDate: existing?.dailyResetDate ?? '', plan: existing?.plan ?? 'Free' };
    return { record, total: UNLIMITED_CREDITS_DISPLAY };
  }

  if (!existing) {
    const record: Required<CreditsRecord> = { purchasedCredits: SIGNUP_CREDITS, dailyCredits: 0, dailyResetDate: todayUtc(), plan: 'Free' };
    await store().put(key, JSON.stringify(record));
    return { record, total: record.purchasedCredits };
  }

  const plan = existing.plan ?? 'Free';
  const leftoverDaily = existing.dailyCredits ?? 0;
  const record: Required<CreditsRecord> = { purchasedCredits: (existing.purchasedCredits ?? 0) + leftoverDaily, dailyCredits: 0, dailyResetDate: existing.dailyResetDate ?? '', plan };
  if (leftoverDaily !== 0) await store().put(key, JSON.stringify(record));
  return { record, total: record.purchasedCredits };
}

export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get('email')?.trim().toLowerCase();
  if (!email || !email.includes('@')) return json({ error: 'Cuenta inválida.' }, 400);
  const { record, total } = await loadBalance(email);
  return json({ credits: total, plan: record.plan, dailyCredits: record.dailyCredits, purchasedCredits: record.purchasedCredits });
}

// Client-side spends (image/video generation) sync here, deducted straight
// from purchasedCredits — the single pool that holds the signup grant, admin
// grants, and paid top-ups alike.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; spend?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const spend = typeof body?.spend === 'number' ? body.spend : Number(body?.spend);
  if (!email || !email.includes('@')) return json({ error: 'Cuenta inválida.' }, 400);
  if (!Number.isFinite(spend) || spend < 0) return json({ error: 'Monto inválido.' }, 400);

  if (UNLIMITED_EMAILS.has(email)) return json({ ok: true, credits: UNLIMITED_CREDITS_DISPLAY });

  const { record } = await loadBalance(email);
  const fromPurchased = Math.min(record.purchasedCredits, Math.floor(spend));

  const next: Required<CreditsRecord> = { ...record, purchasedCredits: record.purchasedCredits - fromPurchased };
  await store().put(creditsKey(email), JSON.stringify(next));
  return json({ ok: true, credits: next.purchasedCredits });
}
