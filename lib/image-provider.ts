export type ImageRequest = {
  prompt: string;
  style: string;
  aspectRatio: string;
  quality: string;
  count: number;
  model?: string;
  referenceImage?: string;
  avatarReferences?: string[];
};

export type ImageGenerationResult = {
  images: string[];
  source: 'live' | 'demo';
};


const POLL_INTERVAL_MS = 4000;
const MAX_POLL_MINUTES = 6;

// The API submits the provider tasks and returns a jobId; polling happens here so each
// status check is its own Worker invocation (Workers cap subrequests per invocation).
async function requestLiveImages(request: ImageRequest): Promise<string[]> {
  const response = await fetch('/api/generate-image', {
    method: 'POST',
    signal: AbortSignal.timeout(240000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  const data = (await response.json().catch(() => null)) as { images?: string[]; jobId?: string; error?: string } | null;
  if (!response.ok) {
    throw new Error(data?.error ?? `La API respondió con estado ${response.status}.`);
  }

  // Synchronous providers (Qwen image editing) answer with the images directly.
  if (data?.images?.length) return data.images;
  if (!data?.jobId) throw new Error('La API no devolvió imágenes.');

  const attempts = Math.ceil((MAX_POLL_MINUTES * 60_000) / POLL_INTERVAL_MS);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const statusResponse = await fetch(`/api/generate-image?jobId=${encodeURIComponent(data.jobId)}`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
    const status = (await statusResponse.json().catch(() => null)) as
      | { status?: string; images?: string[]; error?: string }
      | null;
    if (!statusResponse.ok) throw new Error(status?.error ?? 'No se pudo consultar la generación.');
    if (status?.status === 'SUCCEEDED' && status.images?.length) return status.images;
    if (status?.status === 'FAILED') throw new Error(status.error ?? 'No se pudo generar la imagen.');
  }
  throw new Error('La generación tardó demasiado. Inténtalo nuevamente.');
}

export async function generateImages(request: ImageRequest): Promise<ImageGenerationResult> {
  let images: string[];
  try { images = await requestLiveImages(request); } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('La generación tardó demasiado en responder. No se descontaron créditos.');
    throw error;
  }
  return { images, source: 'live' };
}
