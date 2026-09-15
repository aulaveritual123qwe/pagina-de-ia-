import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type KVLike = {
  get: (key: string) => Promise<string | null>;
  delete: (key: string) => Promise<void>;
};

function store() {
  return (env as unknown as { IMAGE_CACHE: KVLike }).IMAGE_CACHE;
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// One-time redemption: the callback hands the browser an opaque code instead of
// the email directly, and this consumes it exactly once so a leaked URL (browser
// history, a referrer header) can't be replayed to sign in as someone else.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code');
  if (!code || !/^[a-zA-Z0-9-]{1,100}$/.test(code)) return json({ error: 'Código inválido.' }, 400);

  const key = `google-login:${code}`;
  const raw = await store().get(key).catch(() => null);
  if (!raw) return json({ error: 'El acceso con Google expiró. Inténtalo de nuevo.' }, 404);
  await store().delete(key);

  try {
    const data = JSON.parse(raw) as { email?: string; name?: string };
    if (!data.email) return json({ error: 'Respuesta inválida.' }, 400);
    return json({ email: data.email, name: data.name ?? '' });
  } catch {
    return json({ error: 'Respuesta inválida.' }, 400);
  }
}
