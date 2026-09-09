import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

// Some providers (Higgsfield's soul/reference endpoint) require a real public
// URL for the reference image, not a base64 data URL. This stores an
// uploaded image in Workers KV for a short time and returns a URL this
// Worker itself serves, so it can be handed to those providers.

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const TTL_SECONDS = 3600;

type KVNamespaceLike = {
  put: (key: string, value: ArrayBuffer, options?: { expirationTtl?: number; metadata?: Record<string, unknown> }) => Promise<void>;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { dataUrl?: unknown } | null;
  const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl : '';
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    return json({ error: 'Formato de imagen inválido.' }, 400);
  }

  const [, mimeType, base64] = match;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(base64);
  } catch {
    return json({ error: 'No se pudo decodificar la imagen.' }, 400);
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return json({ error: 'La imagen debe pesar menos de 6 MB.' }, 400);
  }

  const id = crypto.randomUUID();
  const kv = (env as unknown as { IMAGE_CACHE: KVNamespaceLike }).IMAGE_CACHE;
  await kv.put(id, bytes.buffer as ArrayBuffer, { expirationTtl: TTL_SECONDS, metadata: { mimeType } });

  const publicUrl = `${new URL(request.url).origin}/api/image/${id}`;
  return json({ url: publicUrl });
}
