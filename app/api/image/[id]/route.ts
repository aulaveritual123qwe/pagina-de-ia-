import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type KVNamespaceLike = {
  getWithMetadata: (
    key: string,
    options: { type: 'arrayBuffer' },
  ) => Promise<{ value: ArrayBuffer | null; metadata: { mimeType?: string } | null }>;
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) {
    return new Response('Not found', { status: 404 });
  }

  const kv = (env as unknown as { IMAGE_CACHE: KVNamespaceLike }).IMAGE_CACHE;
  const { value, metadata } = await kv.getWithMetadata(id, { type: 'arrayBuffer' });
  if (!value) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(value, {
    headers: {
      'Content-Type': metadata?.mimeType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
