export const dynamic = 'force-dynamic';

type GenerateImageBody = {
  prompt?: unknown;
  style?: unknown;
  aspectRatio?: unknown;
  quality?: unknown;
  count?: unknown;
  model?: unknown;
};

// Maps UI aspect ratios to Higgsfield Soul v2 API ('9:16' | '16:9' | '4:3' | '3:4' | '1:1' | '2:3' | '3:2')
const HIGGSFIELD_ASPECT_RATIO_MAP: Record<string, string> = {
  '1:1': '1:1',
  '4:5': '3:4',
  '9:16': '9:16',
  '16:9': '16:9',
};

// Qwen supports: 1024x1024, 720x1280, 1280x720
const QWEN_SIZE_MAP: Record<string, string> = {
  '1:1': '1024x1024',
  '4:5': '720x1280',
  '9:16': '720x1280',
  '16:9': '1280x720',
};

// Kling supports: 1024x1024, 768x1344, 1344x768
const KLING_SIZE_MAP: Record<string, string> = {
  '1:1': '1024x1024',
  '4:5': '768x1344',
  '9:16': '768x1344',
  '16:9': '1344x768',
};

const HIGGSFIELD_SUBMIT_URL = 'https://api.higgsfield.ai/higgsfield-ai/soul/v2/standard';
const QWEN_API_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis';
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

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);

    const statusResponse = await fetch(submitPayload.status_url, {
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

// ===== Qwen =====

type QwenResponse = {
  output?: { task_id?: string };
  code?: string;
  message?: string;
};

type QwenTaskResponse = {
  output?: { task_status?: string; results?: Array<{ url?: string }> };
  code?: string;
  message?: string;
};

async function generateOneImageQwen(apiKey: string, prompt: string, size: string): Promise<string> {
  const submitResponse = await fetch(QWEN_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'qwen-vl-plus-latest',
      prompt,
      size,
    }),
  });

  const submitPayload = (await submitResponse.json().catch(() => null)) as QwenResponse | null;
  if (!submitResponse.ok || !submitPayload?.output?.task_id) {
    throw new Error(submitPayload?.message ?? `Qwen respondió con estado ${submitResponse.status}.`);
  }

  const taskId = submitPayload.output.task_id;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);

    const statusResponse = await fetch(`${QWEN_API_URL}?task_id=${taskId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const statusPayload = (await statusResponse.json().catch(() => null)) as QwenTaskResponse | null;

    if (!statusResponse.ok) {
      throw new Error(statusPayload?.message ?? `No se pudo consultar Qwen (${statusResponse.status}).`);
    }

    if (statusPayload?.output?.task_status === 'SUCCEEDED') {
      const url = statusPayload.output.results?.[0]?.url;
      if (!url) throw new Error('Qwen completó sin devolver imagen.');
      return url;
    }

    if (statusPayload?.output?.task_status === 'FAILED') {
      throw new Error('Qwen falló al generar la imagen.');
    }
  }

  throw new Error('Qwen tardó demasiado.');
}

// ===== Kling =====

type KlingResponse = {
  data?: { task_id?: string };
  code?: string;
  message?: string;
};

type KlingTaskResponse = {
  data?: { task_status?: string; images?: Array<{ url?: string }> };
  code?: string;
  message?: string;
};

async function generateOneImageKling(apiKey: string, prompt: string, size: string): Promise<string> {
  const submitResponse = await fetch(KLING_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      prompt,
      size,
    }),
  });

  const submitPayload = (await submitResponse.json().catch(() => null)) as KlingResponse | null;
  if (!submitResponse.ok || !submitPayload?.data?.task_id) {
    throw new Error(submitPayload?.message ?? `Kling respondió con estado ${submitResponse.status}.`);
  }

  const taskId = submitPayload.data.task_id;

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);

    const statusResponse = await fetch(`${KLING_API_URL}?task_id=${taskId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    const statusPayload = (await statusResponse.json().catch(() => null)) as KlingTaskResponse | null;

    if (!statusResponse.ok) {
      throw new Error(statusPayload?.message ?? `No se pudo consultar Kling (${statusResponse.status}).`);
    }

    if (statusPayload?.data?.task_status === 'SUCCESS') {
      const url = statusPayload.data.images?.[0]?.url;
      if (!url) throw new Error('Kling completó sin devolver imagen.');
      return url;
    }

    if (statusPayload?.data?.task_status === 'FAILED') {
      throw new Error('Kling falló al generar la imagen.');
    }
  }

  throw new Error('Kling tardó demasiado.');
}

// ===== Main Handler =====

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as GenerateImageBody | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length < 3 || prompt.length > 1000) {
    return json({ error: 'El prompt debe tener entre 3 y 1000 caracteres.' }, 400);
  }

  const style = typeof body?.style === 'string' ? body.style : 'Realista';
  const model = typeof body?.model === 'string' ? body.model : 'higgsfield';
  const aspectRatio = body?.aspectRatio as string;
  const rawCount = typeof body?.count === 'number' ? body.count : Number(body?.count);
  const count = [1, 2, 4].includes(rawCount) ? rawCount : 1;

  try {
    if (model === 'qwen') {
      const apiKey = process.env.QWEN_API_KEY;
      if (!apiKey) {
        return json({ error: 'QWEN_API_KEY no está configurada.' }, 501);
      }
      const size = QWEN_SIZE_MAP[aspectRatio] ?? '1024x1024';
      const fullPrompt = `${style}: ${prompt}`;
      const results = await Promise.allSettled(
        Array.from({ length: count }, () => generateOneImageQwen(apiKey, fullPrompt, size)),
      );
      const images = results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
        .map((result) => result.value);
      if (!images.length) {
        const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        const message = firstError?.reason instanceof Error ? firstError.reason.message : 'No se pudo generar.';
        return json({ error: message }, 502);
      }
      return json({ images });
    }

    if (model === 'kling') {
      const apiKey = process.env.KLING_API_KEY;
      if (!apiKey) {
        return json({ error: 'KLING_API_KEY no está configurada.' }, 501);
      }
      const size = KLING_SIZE_MAP[aspectRatio] ?? '1024x1024';
      const fullPrompt = `${style}: ${prompt}`;
      const results = await Promise.allSettled(
        Array.from({ length: count }, () => generateOneImageKling(apiKey, fullPrompt, size)),
      );
      const images = results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
        .map((result) => result.value);
      if (!images.length) {
        const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        const message = firstError?.reason instanceof Error ? firstError.reason.message : 'No se pudo generar.';
        return json({ error: message }, 502);
      }
      return json({ images });
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
    return json({ images });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Error contactando al proveedor.' },
      500,
    );
  }
}
