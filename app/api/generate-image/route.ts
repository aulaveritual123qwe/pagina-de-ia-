export const dynamic = 'force-dynamic';

type GenerateImageBody = {
  prompt?: unknown;
  style?: unknown;
  aspectRatio?: unknown;
  quality?: unknown;
  count?: unknown;
};

// Maps the app's UI aspect ratios to the ones the Higgsfield Soul v2 API accepts
// ('9:16' | '16:9' | '4:3' | '3:4' | '1:1' | '2:3' | '3:2').
const ASPECT_RATIO_MAP: Record<string, string> = {
  '1:1': '1:1',
  '4:5': '3:4',
  '9:16': '9:16',
  '16:9': '16:9',
};

const SUBMIT_URL = 'https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard';
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 30; // ~90s per image

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function generateOneImage(authHeader: string, prompt: string, aspectRatio: string): Promise<string> {
  const submitResponse = await fetch(SUBMIT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
    },
    body: JSON.stringify({ prompt, aspect_ratio: aspectRatio, image_url: '' }),
  });

  const submitPayload = (await submitResponse.json().catch(() => null)) as HiggsfieldSubmitResponse | null;
  if (!submitResponse.ok || !submitPayload?.status_url) {
    throw new Error(submitPayload?.error ?? `El proveedor de imágenes respondió con estado ${submitResponse.status}.`);
  }

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);

    const statusResponse = await fetch(submitPayload.status_url, {
      headers: { Authorization: authHeader },
    });
    const statusPayload = (await statusResponse.json().catch(() => null)) as HiggsfieldStatusResponse | null;

    if (!statusResponse.ok) {
      throw new Error(statusPayload?.error ?? `No se pudo consultar el estado de la generación (${statusResponse.status}).`);
    }

    if (statusPayload?.status === 'completed') {
      const url = statusPayload.images?.[0]?.url;
      if (!url) throw new Error('La generación terminó sin devolver ninguna imagen.');
      return url;
    }

    if (statusPayload?.status === 'failed') {
      throw new Error(statusPayload.error ?? 'La generación de la imagen falló.');
    }
    // otherwise still "queued" or "in_progress" — keep polling
  }

  throw new Error('La generación tardó demasiado y se agotó el tiempo de espera.');
}

export async function POST(request: Request) {
  const apiKey = process.env.HIGGSFIELD_API_KEY;
  if (!apiKey) {
    return json({ error: 'HIGGSFIELD_API_KEY no está configurada en el servidor todavía.' }, 501);
  }

  const body = (await request.json().catch(() => null)) as GenerateImageBody | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length < 3 || prompt.length > 1000) {
    return json({ error: 'El prompt debe tener entre 3 y 1000 caracteres.' }, 400);
  }

  const style = typeof body?.style === 'string' ? body.style : 'Realista';
  const aspectRatio = ASPECT_RATIO_MAP[body?.aspectRatio as string] ?? '1:1';
  const rawCount = typeof body?.count === 'number' ? body.count : Number(body?.count);
  const count = [1, 2, 4].includes(rawCount) ? rawCount : 1;

  const authHeader = `Key ${apiKey}`;
  const fullPrompt = `${style}: ${prompt}`;

  try {
    const results = await Promise.allSettled(
      Array.from({ length: count }, () => generateOneImage(authHeader, fullPrompt, aspectRatio)),
    );

    const images = results
      .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
      .map((result) => result.value);

    if (!images.length) {
      const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
      const message = firstError?.reason instanceof Error ? firstError.reason.message : 'No se pudo generar ninguna imagen.';
      return json({ error: message }, 502);
    }

    return json({ images });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Error al contactar al proveedor de imágenes.' },
      500,
    );
  }
}
