import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type KVLike = {
  get: (key: string, type?: 'json') => Promise<unknown>;
  put: (key: string, value: string | ArrayBuffer, options?: { expirationTtl?: number; metadata?: Record<string, unknown> }) => Promise<void>;
};

function store() {
  return (env as unknown as { IMAGE_CACHE: KVLike }).IMAGE_CACHE;
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

const PROOF_TTL_SECONDS = 60 * 60 * 24 * 30;

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

// PayPal's own capture API already verifies the payment — this screenshot is
// extra documentation for the admin's records, requested for consistency
// with the manual Yape flow. It never gates the credits, which are granted
// the moment PayPal confirms the capture.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { orderId?: unknown; proofImage?: unknown } | null;
  const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
  const proofImage = typeof body?.proofImage === 'string' ? body.proofImage : '';
  if (!orderId) return json({ error: 'Pedido inválido.' }, 400);
  if (!proofImage) return json({ error: 'Sube una captura de pantalla del pago.' }, 400);

  const key = `payment-log:paypal-${orderId}`;
  const record = (await store().get(key, 'json').catch(() => null)) as Record<string, unknown> | null;
  if (!record) return json({ error: 'No se encontró el pago. Puede que ya haya expirado.' }, 404);

  let proofImageUrl: string;
  try {
    proofImageUrl = await storeProofImage(proofImage, new URL(request.url).origin);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'No se pudo subir el comprobante.' }, 400);
  }

  await store().put(key, JSON.stringify({ ...record, proofImageUrl }));
  return json({ ok: true });
}
