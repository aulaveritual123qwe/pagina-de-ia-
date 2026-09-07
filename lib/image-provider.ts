export type ImageRequest = {
  prompt: string;
  style: string;
  aspectRatio: string;
  quality: string;
  count: number;
  model?: string;
};

export type ImageGenerationResult = {
  images: string[];
  source: 'live' | 'demo';
};

const demoImages = [
  '/assets/creator-wide.png',
  '/assets/creator-portrait-1.png',
  '/assets/creator-portrait-2.png',
  '/assets/creator-portrait-3.png',
];

async function requestLiveImages(request: ImageRequest): Promise<string[]> {
  const response = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `La API respondió con estado ${response.status}.`);
  }

  const data = (await response.json()) as { images?: string[] };
  if (!data.images?.length) {
    throw new Error('La API no devolvió imágenes.');
  }
  return data.images;
}

function createFallbackImages(request: ImageRequest): string[] {
  const offset = (request.prompt.length + request.style.length) % demoImages.length;
  return Array.from(
    { length: request.count },
    (_, index) => demoImages[(index + offset) % demoImages.length],
  );
}

/**
 * Tries the real image generation endpoint (app/api/generate-image/route.ts) first.
 * Falls back to bundled demo images when no API key is configured yet, or the
 * request fails, so the interface keeps working before the production API is wired up.
 */
export async function generateImages(request: ImageRequest): Promise<ImageGenerationResult> {
  try {
    const images = await requestLiveImages(request);
    return { images, source: 'live' };
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 1100));
    return { images: createFallbackImages(request), source: 'demo' };
  }
}
