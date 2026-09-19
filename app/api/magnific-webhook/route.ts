import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type Store = {
  get?: (key: string, type?: 'json') => Promise<Record<string, unknown> | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function webhookSecret(): Promise<string | undefined> {
  const workerEnv = env as unknown as Record<string, string | undefined>;
  const direct = process.env.MAGNIFIC_WEBHOOK_SECRET ?? workerEnv.MAGNIFIC_WEBHOOK_SECRET;
  if (direct) return direct;
  const store = (env as unknown as { IMAGE_CACHE?: Store }).IMAGE_CACHE;
  const config = await store?.get?.('admin:api-config', 'json').catch(() => null);
  return typeof config?.MAGNIFIC_WEBHOOK_SECRET === 'string' ? config.MAGNIFIC_WEBHOOK_SECRET : undefined;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function hasValidSignature(header: string, expected: string) {
  return header.split(' ').some((part) => {
    const separator = part.indexOf(',');
    return separator > 0 && /^v\d+$/i.test(part.slice(0, separator)) && constantTimeEqual(part.slice(separator + 1), expected);
  });
}

export async function POST(request: Request) {
  const id = request.headers.get('webhook-id');
  const timestamp = request.headers.get('webhook-timestamp');
  const signature = request.headers.get('webhook-signature');
  const secret = await webhookSecret();
  if (!id || !timestamp || !signature || !secret) return json({ error: 'Webhook no autorizado.' }, 401);
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) return json({ error: 'Webhook vencido.' }, 401);

  const rawBody = await request.text();
  const expected = await sign(`${id}.${timestamp}.${rawBody}`, secret);
  if (!hasValidSignature(signature, expected)) return json({ error: 'Firma de webhook inválida.' }, 401);

  const payload = JSON.parse(rawBody) as { data?: { task_id?: string }; task_id?: string };
  const taskId = payload.data?.task_id ?? payload.task_id;
  if (taskId) {
    const store = (env as unknown as { IMAGE_CACHE: Store }).IMAGE_CACHE;
    await store.put(`magnific:task:${taskId}`, rawBody, { expirationTtl: 3600 });
  }
  return json({ ok: true });
}
