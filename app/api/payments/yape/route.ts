import { env } from 'cloudflare:workers';
import { PLANS, TOPUP } from '@/lib/plans';
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
  proofImageUrl: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
};

type KVLike = {
  get: (key: string, type?: 'json') => Promise<unknown>;
  put: (key: string, value: string | ArrayBuffer, options?: { expirationTtl?: number; metadata?: Record<string, unknown> }) => Promise<void>;
  list: (options: { prefix: string }) => Promise<{ keys: Array<{ name: string }> }>;
};

function store() {
  return (env as unknown as { IMAGE_CACHE: KVLike }).IMAGE_CACHE;
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

const PHONE_PATTERN = /^9\d{8}$/;
const PROOF_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — long enough for an admin to get to it

// The claim is only useful as a receipt the admin can actually check against
// their Yape app, so a screenshot of the transaction is required, not just
// the phone number. Stored the same way reference images are: re-hosted
// through our own KV-backed image route so it survives Yape's own history.
async function storeProofImage(dataUrl: string, origin: string): Promise<string> {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('La imagen del comprobante no es válida.');
  const [, mimeType, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('La imagen del comprobante debe pesar menos de 8 MB.');

  const id = crypto.randomUUID();
  await store().put(id, bytes.buffer as ArrayBuffer, { expirationTtl: PROOF_TTL_SECONDS, metadata: { mimeType } });
  return `${origin}/api/image/${id}`;
}

// Yape has no public merchant API for individual creators, so payments are
// verified manually: the customer pays to the published phone number and
// files a claim here (with a screenshot as proof); an admin cross-checks it
// against their Yape app and approves it from /admin, which is what
// actually credits the account.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; kind?: unknown; planName?: unknown; payerPhone?: unknown; proofImage?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const payerPhone = typeof body?.payerPhone === 'string' ? body.payerPhone.replace(/\D/g, '') : '';
  const proofImage = typeof body?.proofImage === 'string' ? body.proofImage : '';
  if (!email || !email.includes('@')) return json({ error: 'Inicia sesión para continuar.' }, 400);
  if (!PHONE_PATTERN.test(payerPhone)) return json({ error: 'Ingresa el número de celular (9 dígitos) desde el que pagaste con Yape.' }, 400);
  if (!proofImage) return json({ error: 'Sube una captura de pantalla del pago de Yape.' }, 400);

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

  let proofImageUrl: string;
  try {
    proofImageUrl = await storeProofImage(proofImage, new URL(request.url).origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'No se pudo subir el comprobante.' }, 400);
  }

  const record: YapeRequest = {
    id: crypto.randomUUID(),
    email,
    kind,
    planName,
    credits,
    priceUsd,
    payerPhone,
    proofImageUrl,
    status: 'pending',
    createdAt: Date.now(),
  };
  await store().put(`yape-request:${record.id}`, JSON.stringify(record));
  return json({ ok: true, requestId: record.id });
}

// Admin-only: list pending (and recent) Yape claims for manual review.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  if (!(await isAdminAuthorized(store(), params.get('adminEmail'), params.get('adminPassword')))) return json({ error: 'No autorizado.' }, 403);

  const list = await store().list({ prefix: 'yape-request:' });
  const records = (
    await Promise.all(list.keys.map((key) => store().get(key.name, 'json').catch(() => null)))
  ).filter((record): record is YapeRequest => Boolean(record));
  records.sort((a, b) => b.createdAt - a.createdAt);
  return json({ requests: records });
}
