export type ImageRequest = {
  prompt: string;
  style: string;
  aspectRatio: string;
  quality: string;
  count: number;
};

const demoImages = [
  '/assets/creator-wide.png',
  '/assets/creator-portrait-1.png',
  '/assets/creator-portrait-2.png',
  '/assets/creator-portrait-3.png',
];

/**
 * Temporary provider used by the interface until the production image API is supplied.
 * Replace this function with a server-side call so the future API key never reaches
 * the browser.
 */
export async function createDemoImages(request: ImageRequest): Promise<string[]> {
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const offset = (request.prompt.length + request.style.length) % demoImages.length;
  return Array.from(
    { length: request.count },
    (_, index) => demoImages[(index + offset) % demoImages.length],
  );
}
