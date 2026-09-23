import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

const LIBRARY_MAX_ITEMS = 300;

type KVLike = {
  get: (key: string, type?: 'json') => Promise<unknown>;
  put: (key: string, value: string) => Promise<void>;
};

function store() {
  return (env as unknown as { IMAGE_CACHE: KVLike }).IMAGE_CACHE;
}

function libraryKey(email: string) {
  return `library:${email.trim().toLowerCase()}`;
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

// Mirrors a user's generated-content library server-side (KV) so it follows
// the account across devices instead of staying trapped in one browser's
// localStorage — the browser still keeps a local cache for instant loads,
// but this is the copy that's shared.
export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get('email')?.trim().toLowerCase();
  if (!email || !email.includes('@')) return json({ error: 'Cuenta inválida.' }, 400);
  const library = (await store().get(libraryKey(email), 'json').catch(() => null)) as unknown;
  return json({ library: Array.isArray(library) ? library : [] });
}

// The client merges/dedupes/caps the list locally before calling this, so
// the server just stores whatever full list it's given.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; library?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) return json({ error: 'Cuenta inválida.' }, 400);
  const library = Array.isArray(body?.library)
    ? body.library.filter((item): item is string => typeof item === 'string').slice(0, LIBRARY_MAX_ITEMS)
    : [];
  await store().put(libraryKey(email), JSON.stringify(library));
  return json({ ok: true });
}
