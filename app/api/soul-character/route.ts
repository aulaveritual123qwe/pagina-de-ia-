export const dynamic = 'force-dynamic';
const BASE = 'https://api.higgsfield.ai';
function headers() {
  const key = process.env.HIGGSFIELD_API_KEY;
  if (!key) throw new Error('Higgsfield Soul no está configurado.');
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request) {
  try {
    const body = await request.json() as { name?: unknown; references?: unknown };
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 40 || !Array.isArray(body.references) || body.references.length < 5 || body.references.length > 10 || body.references.some((url: unknown) => typeof url !== 'string' || !url.startsWith(`${new URL(request.url).origin}/api/image/`))) {
      return json({ error: 'Indica un nombre y entre 5 y 10 referencias subidas del mismo avatar.' }, 400);
    }
    const response = await fetch(`${BASE}/v1/custom-references`, { method: 'POST', headers: headers(), body: JSON.stringify({ name: body.name.trim(), input_images: body.references.map((url: string) => ({ type: 'image_url', image_url: url })) }) });
    const data = await response.json() as { id?: string; status?: string };
    if (!response.ok || !data.id) return json({ error: 'Soul no pudo registrar el avatar. Revisa el acceso a Soul ID de tu cuenta.' }, 502);
    return json({ id: data.id, status: data.status });
  } catch { return json({ error: 'No se pudo conectar con Soul. Inténtalo nuevamente.' }, 502); }
}
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return json({ error: 'Identidad inválida.' }, 400);
  try {
    const response = await fetch(`${BASE}/v1/custom-references/${id}`, { headers: headers() });
    const data = await response.json() as { id?: string; status?: string };
    if (!response.ok) return json({ error: 'No se pudo consultar el avatar. Vuelve a consultar sin crear otro.' }, 502);
    return json({ id: data.id, status: data.status });
  } catch { return json({ error: 'No se pudo consultar Soul.' }, 502); }
}

