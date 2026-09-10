import { imageExpiresAt } from '@/lib/image-retention';
import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type KVNamespaceLike = {
  put: (key: string, value: ArrayBuffer, options?: { expirationTtl?: number; metadata?: Record<string, unknown> }) => Promise<void>;
};

// Higgsfield's soul/reference endpoint requires a real public URL (max 2083 chars),
// unlike Qwen which accepts data: URIs directly. Stash the upload in KV and hand
// back a URL this Worker serves at /api/image/[id].
async function publishReferenceImage(dataUrl: string, origin: string): Promise<string> {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Formato de imagen de referencia inválido.');
  const [, mimeType, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

  const id = crypto.randomUUID();
  const kv = (env as unknown as { IMAGE_CACHE: KVNamespaceLike }).IMAGE_CACHE;
  await kv.put(id, bytes.buffer as ArrayBuffer, { expirationTtl: 3600, metadata: { mimeType } });
  return `${origin}/api/image/${id}`;
}

type GenerateImageBody = {
  prompt?: unknown;
  style?: unknown;
  aspectRatio?: unknown;
  quality?: unknown;
  count?: unknown;
  model?: unknown;
  referenceImage?: unknown;
  soulId?: unknown;
};

// Maps UI aspect ratios to Higgsfield Soul v2 API ('9:16' | '16:9' | '4:3' | '3:4' | '1:1' | '2:3' | '3:2')
const HIGGSFIELD_ASPECT_RATIO_MAP: Record<string, string> = {
  '1:1': '1:1',
  '4:5': '3:4',
  '3:4': '3:4',
  '9:16': '9:16',
  '16:9': '16:9',
};

// Qwen-Image (DashScope) expects "WxH" with '*' as separator.
const QWEN_SIZE_MAP: Record<string, string> = {
  '1:1': '1024*1024',
  '4:5': '928*1152',
  '3:4': '768*1024',
  '9:16': '768*1344',
  '16:9': '1344*768',
};

// Kling supports: 1024x1024, 768x1344, 1344x768
const KLING_SIZE_MAP: Record<string, string> = {
  '1:1': '1024x1024',
  '4:5': '768x1344',
  '9:16': '768x1344',
  '16:9': '1344x768',
};

const HIGGSFIELD_SUBMIT_URL = 'https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard';
// Character-consistent generation from a single reference photo (needs a real public URL, no data: URIs).
const HIGGSFIELD_REFERENCE_URL = 'https://api.higgsfield.ai/higgsfield-ai/soul/reference';
// International (Singapore) DashScope endpoint — pay-as-you-go key (sk-ws-...), not the Token Plan key.
const QWEN_SUBMIT_URL = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
const QWEN_TASK_URL = 'https://dashscope-intl.aliyuncs.com/api/v1/tasks';
// Synchronous image-editing endpoint used when a reference image is supplied.
const QWEN_EDIT_URL = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const KLING_API_URL = 'https://api.klingai.com/v1/images/generations';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 30;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===== Higgsfield Soul =====

type HiggsfieldSubmitResponse = {
  status?: string;
  request_id?: string;
  status_url?: string;
  error?: string;
};

type HiggsfieldStatusResponse = {
  status?: 'queued' | 'in_progress' | 'completed' | 'failed';
  images?: Array<{ url?: string }>;
  error?: string;
};

async function pollHiggsfieldTask(statusUrl: string, authHeader: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);

    const statusResponse = await fetch(statusUrl, {
      headers: { Authorization: authHeader },
    });
    const statusPayload = (await statusResponse.json().catch(() => null)) as HiggsfieldStatusResponse | null;

    if (!statusResponse.ok) {
      throw new Error(statusPayload?.error ?? `No se pudo consultar Higgsfield (${statusResponse.status}).`);
    }

    if (statusPayload?.status === 'completed') {
      const url = statusPayload.images?.[0]?.url;
      if (!url) throw new Error('Higgsfield completó sin devolver imagen.');
      return url;
    }

    if (statusPayload?.status === 'failed') {
      throw new Error(statusPayload.error ?? 'Higgsfield falló al generar la imagen.');
    }
  }

  throw new Error('Higgsfield tardó demasiado.');
}

async function generateOneImageHiggsfield(
  authHeader: string,
  prompt: string,
  aspectRatio: string,
): Promise<string> {
  const submitResponse = await fetch(HIGGSFIELD_SUBMIT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify({ prompt, aspect_ratio: aspectRatio, image_url: '' }),
  });

  const submitPayload = (await submitResponse.json().catch(() => null)) as HiggsfieldSubmitResponse | null;
  if (!submitResponse.ok || !submitPayload?.status_url) {
    throw new Error(submitPayload?.error ?? `Higgsfield respondió con estado ${submitResponse.status}.`);
  }

  return pollHiggsfieldTask(submitPayload.status_url, authHeader);
}

// Character-consistent generation: keeps the person's likeness from a reference photo.
async function generateOneImageHiggsfieldReference(
  authHeader: string,
  prompt: string,
  aspectRatio: string,
  imageReferenceUrl: string,
): Promise<string> {
  const submitResponse = await fetch(HIGGSFIELD_REFERENCE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify({ prompt, image_reference_url: imageReferenceUrl, aspect_ratio: aspectRatio }),
  });

  const submitPayload = (await submitResponse.json().catch(() => null)) as HiggsfieldSubmitResponse | null;
  if (!submitResponse.ok || !submitPayload?.status_url) {
    throw new Error(submitPayload?.error ?? `Higgsfield respondió con estado ${submitResponse.status}.`);
  }

  return pollHiggsfieldTask(submitPayload.status_url, authHeader);
}

// ===== Main Handler =====

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as GenerateImageBody | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length < 3 || prompt.length > 1000) {
    return json({ error: 'El prompt debe tener entre 3 y 1000 caracteres.' }, 400);
  }

  const style = typeof body?.style === 'string' ? body.style : 'Realista';
  const model = 'higgsfield';
  const aspectRatio = body?.aspectRatio as string;
  const rawCount = typeof body?.count === 'number' ? body.count : Number(body?.count);
  const count = [1, 2, 4].includes(rawCount) ? rawCount : 1;
  const referenceImage = typeof body?.referenceImage === 'string' && body.referenceImage.length > 0 ? body.referenceImage : null;

  try {
    if (body?.soulId) {
      if (model !== 'higgsfield' || typeof body.soulId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.soulId)) return json({ error: 'Los avatares deben generarse con su identidad de Soul.' }, 400);
      const apiKey = process.env.HIGGSFIELD_API_KEY;
      if (!apiKey) return json({ error: 'Soul no está configurado.' }, 501);
      const authHeader = `Key ${apiKey}`;
      const images: string[] = [];
      for (let index = 0; index < count; index++) {
        const response = await fetch('https://api.higgsfield.ai/higgsfield-ai/soul/character', { method: 'POST', headers: { Authorization: authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: `${style}: ${prompt}`, custom_reference_id: body.soulId, custom_reference_strength: 1, aspect_ratio: HIGGSFIELD_ASPECT_RATIO_MAP[aspectRatio] ?? '1:1', resolution: '1080p' }) });
        const data = await response.json() as HiggsfieldSubmitResponse;
        if (!response.ok || !data.status_url) throw new Error(data.error ?? 'No se pudo generar con la identidad de Soul.');
        images.push(await pollHiggsfieldTask(data.status_url, authHeader));
      }
      return json({ images: await retainImages(images, new URL(request.url).origin) });
    }
    if (referenceImage && model === 'higgsfield') {
      const apiKey = process.env.HIGGSFIELD_API_KEY;
      if (!apiKey) {
        return json({ error: 'HIGGSFIELD_API_KEY no está configurada.' }, 501);
      }
      const authHeader = `Key ${apiKey}`;
      const higgsfieldRatio = HIGGSFIELD_ASPECT_RATIO_MAP[aspectRatio] ?? '1:1';
      const fullPrompt = `${style}: ${prompt}`;
      const referenceUrl = await publishReferenceImage(referenceImage, new URL(request.url).origin);
      const results = await Promise.allSettled(
        Array.from({ length: count }, () => generateOneImageHiggsfieldReference(authHeader, fullPrompt, higgsfieldRatio, referenceUrl)),
      );
      const images = results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
        .map((result) => result.value);
      if (!images.length) {
        const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        const message = firstError?.reason instanceof Error ? firstError.reason.message : 'No se pudo generar la imagen.';
        return json({ error: message }, 502);
      }
      return json({ images: await retainImages(images, new URL(request.url).origin) });
    }

    // Default: Higgsfield
    const apiKey = process.env.HIGGSFIELD_API_KEY;
    if (!apiKey) {
      return json({ error: 'HIGGSFIELD_API_KEY no está configurada.' }, 501);
    }
    const higgsfieldRatio = HIGGSFIELD_ASPECT_RATIO_MAP[aspectRatio] ?? '1:1';
    const authHeader = `Key ${apiKey}`;
    const fullPrompt = `${style}: ${prompt}`;
    const results = await Promise.allSettled(
      Array.from({ length: count }, () => generateOneImageHiggsfield(authHeader, fullPrompt, higgsfieldRatio)),
    );
    const images = results
      .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
      .map((result) => result.value);
    if (!images.length) {
      const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      const message = firstError?.reason instanceof Error ? firstError.reason.message : 'No se pudo generar.';
      return json({ error: message }, 502);
    }
    return json({ images: await retainImages(images, new URL(request.url).origin) });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Error contactando al proveedor.' },
      500,
    );
  }
}



async function retainImages(urls: string[], origin: string): Promise<string[]> {
  const kv = (env as unknown as { IMAGE_CACHE: KVNamespaceLike }).IMAGE_CACHE;
  const retained: string[] = [];
  for (const url of urls) {
    const response = await fetch(url);
    if (!response.ok) throw new Error('No se pudo guardar la imagen generada.');
    const mimeType = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('El proveedor devolvió un formato de imagen no compatible.');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('La imagen supera el límite de almacenamiento.');
    const expiresAt = imageExpiresAt();
    const id = crypto.randomUUID();
    await kv.put(id, bytes, { expirationTtl: Math.ceil((expiresAt - Date.now()) / 1000), metadata: { mimeType, expiresAt } });
    retained.push(`${origin}/api/image/${id}`);
  }
  return retained;
}
