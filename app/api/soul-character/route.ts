import { env } from 'cloudflare:workers';
export const dynamic = 'force-dynamic';
const BASE = 'https://platform.higgsfield.ai';
type Store = { get?: (key: string, type?: 'json') => Promise<Record<string, string> | null> };
async function providerSecret(name: string): Promise<string | undefined> {
  const workerEnv = env as unknown as Record<string, string | undefined>;
  const direct = process.env[name] ?? workerEnv[name];
  if (direct) return direct;
  const kv = (env as unknown as { IMAGE_CACHE?: Store }).IMAGE_CACHE;
  const config = await kv?.get?.('admin:api-config', 'json').catch(() => null);
  return typeof config?.[name] === 'string' ? config[name] : undefined;
}
async function headers() {
  const key = await providerSecret('HIGGSFIELD_API_KEY');
  if (!key) throw new Error('Higgsfield Soul no está configurado.');
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: unknown; references?: unknown };
    const origin = new URL(request.url).origin;
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 40 || !Array.isArray(body.references) || body.references.length < 5 || body.references.length > 10 || body.references.some((url: unknown) => typeof url !== 'string' || !url.startsWith(`${new URL(request.url).origin}/api/image/`))) {
      return json({ error: 'Indica un nombre y entre 5 y 10 referencias subidas del mismo avatar.' }, 400);
    }
    if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin)) {
      return json({ error: 'Para crear avatares con Soul, abre la versión publicada. Soul necesita leer tus referencias desde una URL pública, no desde localhost.' }, 400);
    }
    const response = await fetch(`${BASE}/v1/custom-references`, { method: 'POST', headers: await headers(), body: JSON.stringify({ name: body.name.trim(), input_images: body.references.map((url: string) => ({ type: 'image_url', image_url: url })) }) });
    const data = await response.json() as { id?: string; status?: string; detail?: string; message?: string; error?: string };
    const upstreamMessage = `${data.detail ?? data.message ?? data.error ?? ''}`.toLowerCase();
    if (!response.ok || !data.id) {
      if (response.status === 403 && upstreamMessage.includes('not enough credits')) {
        return json({ error: 'La cuenta API de Soul/Higgsfield no tiene créditos suficientes. Recarga créditos en Higgsfield para poder crear el avatar.' }, 402);
      }
      return json({ error: 'Soul no pudo registrar el avatar. Revisa el acceso a Soul ID de tu cuenta.' }, 502);
    }
    return json({ id: data.id, status: data.status });
  } catch { return json({ error: 'No se pudo conectar con Soul. Inténtalo nuevamente.' }, 502); }
}
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return json({ error: 'Identidad inválida.' }, 400);
  try {
    const response = await fetch(`${BASE}/v1/custom-references/${id}`, { headers: await headers() });
    const data = await response.json() as { id?: string; status?: string };
    if (!response.ok) return json({ error: 'No se pudo consultar el avatar. Vuelve a consultar sin crear otro.' }, 502);
    return json({ id: data.id, status: data.status });
  } catch { return json({ error: 'No se pudo consultar Soul.' }, 502); }
}

