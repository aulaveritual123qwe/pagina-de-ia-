export type ImageRequest = {
  prompt: string;
  style: string;
  aspectRatio: string;
  quality: string;
  count: number;
  model?: string;
  referenceImage?: string;
  soulId?: string;
};

export type ImageGenerationResult = {
  images: string[];
  source: 'live' | 'demo';
};


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

export async function generateImages(request: ImageRequest): Promise<ImageGenerationResult> {
    const images = await requestLiveImages(request);
    return { images, source: 'live' };
}
