export const dynamic = 'force-dynamic';
const BASE = 'https://api.klingai.com/v1/videos/motion-control';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
type KlingResult = { code?: number; message?: string; data?: { task_id?: string; task_status?: string; task_status_msg?: string; task_result?: { videos?: Array<{ url?: string }> } } };
async function authorization() {
  const access = process.env.KLING_ACCESS_KEY;
  const secret = process.env.KLING_SECRET_KEY;
  if (!access || !secret) {
    if (process.env.KLING_API_KEY) return `Bearer ${process.env.KLING_API_KEY}`;
    throw new Error('Configura las credenciales de Kling para Motion Control.');
  }
  const encode = (value: string) => btoa(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${encode(JSON.stringify({ iss: access, exp: now + 1800, nbf: now - 5 }))}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned)));
  return `Bearer ${unsigned}.${encode(String.fromCharCode(...signature))}`;
}
function publicUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(url.hostname); } catch { return false; }
}
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { imageUrl?: unknown; videoUrl?: unknown; prompt?: unknown; orientation?: unknown; mode?: unknown; keepSound?: unknown } | null;
  if (!body || !publicUrl(body.imageUrl) || !publicUrl(body.videoUrl) || typeof body.prompt !== 'string' || body.prompt.length > 2500 || !['image', 'video'].includes(String(body.orientation)) || !['std', 'pro'].includes(String(body.mode))) return json({ error: 'Indica enlaces HTTPS públicos para la imagen y el video, y ajustes válidos.' }, 400);
  try {
    const response = await fetch(BASE, { method: 'POST', headers: { Authorization: await authorization(), 'Content-Type': 'application/json' }, body: JSON.stringify({ model_name: 'kling-v2-6', image_url: body.imageUrl, video_url: body.videoUrl, prompt: body.prompt, character_orientation: body.orientation, mode: body.mode, keep_original_sound: body.keepSound ? 'yes' : 'no' }) });
    const data = await response.json() as KlingResult;
    if (!response.ok || data.code || !data.data?.task_id) return json({ error: data.message ?? 'Kling no pudo iniciar Motion Control.' }, 502);
    return json({ taskId: data.data.task_id });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'No se pudo conectar con Kling.' }, 502); }
}
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('taskId');
  if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return json({ error: 'Tarea inválida.' }, 400);
  try {
    const response = await fetch(`${BASE}/${id}`, { headers: { Authorization: await authorization() } });
    const data = await response.json() as KlingResult;
    if (!response.ok || data.code) return json({ error: data.message ?? 'No se pudo consultar Kling.' }, 502);
    if (data.data?.task_status === 'succeed') {
      const url = data.data.task_result?.videos?.[0]?.url;
      if (!url) return json({ error: 'Kling terminó sin devolver video.' }, 502);
      return json({ status: 'SUCCEEDED', url });
    }
    if (data.data?.task_status === 'failed') return json({ status: 'FAILED', error: data.data.task_status_msg ?? 'Kling no pudo completar el video.' });
    return json({ status: 'RUNNING' });
  } catch { return json({ error: 'No se pudo consultar Kling. Reintenta la consulta.' }, 502); }
}
