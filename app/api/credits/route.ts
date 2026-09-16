import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

const DAILY_FREE_CREDITS = 120;

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

// Free-plan users get a 120-credit allowance that RESETS (doesn't accumulate)
// once per calendar day. Purchased credits (Stripe/Yape/plan grants) live in a
// separate field that this reset never touches, so a free refill can never
// erase money someone actually paid.
async function loadBalance(email: string): Promise<{ record: Required<CreditsRecord>; total: number }> {
  const key = creditsKey(email);
  const current = (await store().get(key, 'json').catch(() => null)) ?? {};
  const plan = current.plan ?? 'Free';
  let dailyCredits = current.dailyCredits ?? 0;
  let dailyResetDate = current.dailyResetDate ?? '';
  const today = todayUtc();
  let changed = false;

  if (plan === 'Free') {
    if (dailyResetDate !== today) {
      dailyCredits = DAILY_FREE_CREDITS;
      dailyResetDate = today;
      changed = true;
    }
  } else if (dailyCredits !== 0) {
    dailyCredits = 0;
    changed = true;
  }

  const record: Required<CreditsRecord> = { purchasedCredits: current.purchasedCredits ?? 0, dailyCredits, dailyResetDate, plan };
  if (changed) await store().put(key, JSON.stringify(record));
  const total = plan === 'Free' ? record.dailyCredits + record.purchasedCredits : record.purchasedCredits;
  return { record, total };
}

export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get('email')?.trim().toLowerCase();
  if (!email || !email.includes('@')) return json({ error: 'Cuenta inválida.' }, 400);
  const { record, total } = await loadBalance(email);
  return json({ credits: total, plan: record.plan, dailyCredits: record.dailyCredits, purchasedCredits: record.purchasedCredits });
}

// Client-side spends (image/video generation) sync here: deducted from the
// daily allowance first, then from purchased credits, so the server balance
// — the one the daily reset and Stripe/Yape payments operate on — stays
// accurate instead of drifting from what the browser already used.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; spend?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const spend = typeof body?.spend === 'number' ? body.spend : Number(body?.spend);
  if (!email || !email.includes('@')) return json({ error: 'Cuenta inválida.' }, 400);
  if (!Number.isFinite(spend) || spend < 0) return json({ error: 'Monto inválido.' }, 400);

  const { record } = await loadBalance(email);
  let remaining = Math.floor(spend);
  const fromDaily = Math.min(record.dailyCredits, remaining);
  remaining -= fromDaily;
  const fromPurchased = Math.min(record.purchasedCredits, remaining);

  const next: Required<CreditsRecord> = {
    ...record,
    dailyCredits: record.dailyCredits - fromDaily,
    purchasedCredits: record.purchasedCredits - fromPurchased,
  };
  await store().put(creditsKey(email), JSON.stringify(next));
  const total = next.plan === 'Free' ? next.dailyCredits + next.purchasedCredits : next.purchasedCredits;
  return json({ ok: true, credits: total });
}
