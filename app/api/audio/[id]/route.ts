import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type KVNamespaceLike = {
  getWithMetadata: (
    key: string,
    options: { type: 'arrayBuffer' },
  ) => Promise<{ value: ArrayBuffer | null; metadata: { mimeType?: string; expiresAt?: number } | null }>;
};

// A separate route (rather than reusing /api/image/[id]) because A2E's
// audio_url validation requires the URL itself to end in .mp3 or .wav.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[a-zA-Z0-9-]{1,100}\.(mp3|wav)$/.test(id)) {
    return new Response('Not found', { status: 404 });
  }

  const kv = (env as unknown as { IMAGE_CACHE: KVNamespaceLike }).IMAGE_CACHE;
  const { value, metadata } = await kv.getWithMetadata(id, { type: 'arrayBuffer' });
  if (!value || (metadata?.expiresAt && metadata.expiresAt <= Date.now())) {
    return new Response('Not found', { status: 404 });
  }

  return new Response(value, {
    headers: {
      'Content-Type': metadata?.mimeType ?? 'audio/mpeg',
      'Cache-Control': 'private, no-store',
    },
  });
}
