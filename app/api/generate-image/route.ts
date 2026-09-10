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

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ===== Jobs =====
// Providers take longer than a single Worker invocation can afford to poll (50
// subrequests, shared across the whole batch). So POST only submits and hands back a
// jobId; the browser polls GET, and each poll is a fresh invocation with its own budget.

type JobTask = { kind: 'higgsfield' | 'qwen' | 'kling'; ref: string; url?: string; error?: string };
type Job = { tasks: JobTask[] };

type JobKV = KVNamespaceLike & {
  get: (key: string, type: 'json') => Promise<Job | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
};

function jobStore() {
  return (env as unknown as { IMAGE_CACHE: JobKV }).IMAGE_CACHE;
}

async function createJob(tasks: JobTask[]): Promise<string> {
  const jobId = crypto.randomUUID();
  await jobStore().put(`job:${jobId}`, JSON.stringify({ tasks }), { expirationTtl: 3600 });
  return jobId;
}

async function submitHiggsfield(endpoint: string, authHeader: string, payload: Record<string, unknown>): Promise<JobTask> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader },
    body: JSON.stringify(payload),
  });
  const data = (await response.json().catch(() => null)) as HiggsfieldSubmitResponse | null;
  if (!response.ok || !data?.status_url) {
    throw new Error(data?.error ?? `Higgsfield respondió con estado ${response.status}.`);
  }
  return { kind: 'higgsfield', ref: data.status_url };
}

async function submitQwen(apiKey: string, prompt: string, size: string): Promise<JobTask> {
  const response = await fetch(QWEN_SUBMIT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({ model: 'qwen-image', input: { prompt }, parameters: { size, n: 1 } }),
  });
  const data = (await response.json().catch(() => null)) as QwenSubmitResponse | null;
  if (!response.ok || !data?.output?.task_id) {
    throw new Error(data?.message ?? `Qwen respondió con estado ${response.status}.`);
  }
  return { kind: 'qwen', ref: data.output.task_id };
}

async function submitKling(apiKey: string, prompt: string, size: string): Promise<JobTask> {
  const response = await fetch(KLING_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ prompt, size }),
  });
  const data = (await response.json().catch(() => null)) as KlingResponse | null;
  if (!response.ok || !data?.data?.task_id) {
    throw new Error(data?.message ?? `Kling respondió con estado ${response.status}.`);
  }
  return { kind: 'kling', ref: data.data.task_id };
}

// One status check per still-pending task: at most `count` subrequests per poll.
async function checkTask(task: JobTask): Promise<JobTask> {
  if (task.url || task.error) return task;
  try {
    if (task.kind === 'higgsfield') {
      const apiKey = process.env.HIGGSFIELD_API_KEY;
      const response = await fetch(task.ref, { headers: { Authorization: `Key ${apiKey}` } });
      const data = (await response.json().catch(() => null)) as HiggsfieldStatusResponse | null;
      if (!response.ok) return { ...task, error: data?.error ?? `Higgsfield respondió ${response.status}.` };
      if (data?.status === 'completed') {
        const url = data.images?.[0]?.url;
        return url ? { ...task, url } : { ...task, error: 'Higgsfield completó sin devolver imagen.' };
      }
      if (data?.status === 'failed') return { ...task, error: data.error ?? 'Higgsfield falló al generar la imagen.' };
      return task;
    }
    if (task.kind === 'qwen') {
      const apiKey = process.env.QWEN_API_KEY;
      const response = await fetch(`${QWEN_TASK_URL}/${task.ref}`, { headers: { Authorization: `Bearer ${apiKey}` } });
      const data = (await response.json().catch(() => null)) as QwenTaskResponse | null;
      if (!response.ok) return { ...task, error: data?.message ?? `Qwen respondió ${response.status}.` };
      if (data?.output?.task_status === 'SUCCEEDED') {
        const url = data.output.results?.[0]?.url;
        return url ? { ...task, url } : { ...task, error: 'Qwen completó sin devolver imagen.' };
      }
      if (data?.output?.task_status === 'FAILED') return { ...task, error: data.message ?? 'Qwen falló al generar la imagen.' };
      return task;
    }
    const apiKey = process.env.KLING_API_KEY;
    const response = await fetch(`${KLING_API_URL}?task_id=${task.ref}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    const data = (await response.json().catch(() => null)) as KlingTaskResponse | null;
    if (!response.ok) return { ...task, error: data?.message ?? `Kling respondió ${response.status}.` };
    if (data?.data?.task_status === 'SUCCESS') {
      const url = data.data.images?.[0]?.url;
      return url ? { ...task, url } : { ...task, error: 'Kling completó sin devolver imagen.' };
    }
    if (data?.data?.task_status === 'FAILED') return { ...task, error: data.message ?? 'Kling falló al generar la imagen.' };
    return task;
  } catch (error) {
    return { ...task, error: error instanceof Error ? error.message : 'No se pudo consultar el estado.' };
  }
}

export async function GET(request: Request) {
  const jobId = new URL(request.url).searchParams.get('jobId');
  if (!jobId || !/^[a-zA-Z0-9-]{1,100}$/.test(jobId)) {
    return json({ error: 'Identificador de generación inválido.' }, 400);
  }

  const store = jobStore();
  const job = await store.get(`job:${jobId}`, 'json');
  if (!job) return json({ error: 'La generación expiró. Vuelve a intentarlo.' }, 404);

  const tasks = await Promise.all(job.tasks.map(checkTask));
  const pending = tasks.filter((task) => !task.url && !task.error);
  await store.put(`job:${jobId}`, JSON.stringify({ tasks }), { expirationTtl: 3600 });

  if (pending.length) return json({ status: 'RUNNING', ready: tasks.length - pending.length, total: tasks.length });

  const urls = tasks.filter((task) => task.url).map((task) => task.url as string);
  if (!urls.length) {
    return json({ status: 'FAILED', error: tasks.find((task) => task.error)?.error ?? 'No se pudo generar la imagen.' });
  }
  return json({ status: 'SUCCEEDED', images: await retainImages(urls, new URL(request.url).origin) });
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

// ===== Qwen-Image (Alibaba Model Studio, DashScope international) =====

type QwenSubmitResponse = {
  output?: { task_id?: string };
  code?: string;
  message?: string;
};

type QwenTaskResponse = {
  output?: { task_status?: string; results?: Array<{ url?: string }> };
  code?: string;
  message?: string;
};

type QwenEditResponse = {
  output?: { choices?: Array<{ message?: { content?: Array<{ image?: string; image_url?: string; url?: string }> } }> };
  code?: string;
  message?: string;
};

async function editOneImageQwen(apiKey: string, referenceImage: string, prompt: string, size: string): Promise<string> {
  const response = await fetch(QWEN_EDIT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'qwen-image-3.0-pro',
      input: {
        messages: [
          {
            role: 'user',
            content: [{ image: referenceImage }, { text: prompt }],
          },
        ],
      },
      parameters: { n: 1, negative_prompt: ' ', prompt_extend: true, watermark: false, size },
    }),
  });

  const payload = (await response.json().catch(() => null)) as QwenEditResponse | null;
  if (!response.ok) {
    throw new Error(payload?.message ?? `Qwen respondió con estado ${response.status}.`);
  }

  const image = payload?.output?.choices?.[0]?.message?.content?.find((item) => item.image || item.image_url || item.url);
  const url = image?.image ?? image?.image_url ?? image?.url;
  if (!url) throw new Error('Qwen completó sin devolver imagen.');
  return url;
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


// ===== Main Handler =====

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as GenerateImageBody | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length < 3 || prompt.length > 1000) {
    return json({ error: 'El prompt debe tener entre 3 y 1000 caracteres.' }, 400);
  }

  const style = typeof body?.style === 'string' ? body.style : 'Realista';
  const requestedModel = typeof body?.model === 'string' ? body.model : 'higgsfield';
  const model = ['higgsfield', 'qwen', 'kling'].includes(requestedModel) ? requestedModel : 'higgsfield';
  const aspectRatio = body?.aspectRatio as string;
  const quality = typeof body?.quality === 'string' ? body.quality : 'Alta';
  const rawCount = typeof body?.count === 'number' ? body.count : Number(body?.count);
  const count = [1, 2, 4].includes(rawCount) ? rawCount : 1;
  const referenceImage = typeof body?.referenceImage === 'string' && body.referenceImage.length > 0 ? body.referenceImage : null;

  // Quality has no dedicated parameter on these providers' basic endpoints, so it's
  // expressed as a prompt descriptor — the most portable way to influence output
  // quality across Higgsfield, Qwen, and Kling alike.
  const QUALITY_DESCRIPTOR: Record<string, string> = {
    'Estándar': 'standard quality',
    'Alta': 'high quality, sharp detail',
    'Ultra': 'ultra high quality, 8k, extremely detailed, professional photography',
  };
  const qualityDescriptor = QUALITY_DESCRIPTOR[quality] ?? QUALITY_DESCRIPTOR['Alta'];
  function buildPrompt(text: string) {
    return `${style}, ${qualityDescriptor}: ${text}`;
  }

  try {
    if (body?.soulId) {
      if (model !== 'higgsfield' || typeof body.soulId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.soulId)) return json({ error: 'Los avatares con identidad Soul solo se pueden generar con Higgsfield.' }, 400);
      const apiKey = process.env.HIGGSFIELD_API_KEY;
      if (!apiKey) return json({ error: 'Soul no está configurado.' }, 501);
      const authHeader = `Key ${apiKey}`;
      const tasks: JobTask[] = [];
      for (let index = 0; index < count; index++) {
        const response = await fetch('https://api.higgsfield.ai/higgsfield-ai/soul/character', { method: 'POST', headers: { Authorization: authHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: buildPrompt(prompt), custom_reference_id: body.soulId, custom_reference_strength: 1, aspect_ratio: HIGGSFIELD_ASPECT_RATIO_MAP[aspectRatio] ?? '1:1', resolution: '1080p' }) });
        const data = await response.json() as HiggsfieldSubmitResponse;
        if (!response.ok || !data.status_url) throw new Error(data.error ?? 'No se pudo generar con la identidad de Soul.');
        tasks.push({ kind: 'higgsfield', ref: data.status_url });
      }
      return json({ jobId: await createJob(tasks) });
    }
    if (referenceImage && model === 'qwen') {
      const apiKey = process.env.QWEN_API_KEY;
      if (!apiKey) return json({ error: 'QWEN_API_KEY no está configurada.' }, 501);
      const fullPrompt = buildPrompt(prompt);
      const size = QWEN_SIZE_MAP[aspectRatio] ?? '1024*1024';
      const results = await Promise.allSettled(
        Array.from({ length: count }, () => editOneImageQwen(apiKey, referenceImage, fullPrompt, size)),
      );
      const images = results
        .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
        .map((result) => result.value);
      if (!images.length) {
        const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        const message = firstError?.reason instanceof Error ? firstError.reason.message : 'No se pudo editar la imagen.';
        return json({ error: message }, 502);
      }
      return json({ images: await retainImages(images, new URL(request.url).origin) });
    }

    if (referenceImage && model === 'kling') {
      return json({ error: 'Kling no edita imágenes de referencia en este flujo. Selecciona Qwen para editar con referencia.' }, 400);
    }

    if (referenceImage && model === 'higgsfield') {
      const requestOrigin = new URL(request.url).origin;
      if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(requestOrigin)) {
        return json({ error: 'Higgsfield necesita una URL pública para leer referencias. En local usa Qwen o despliega la app.' }, 400);
      }
      const apiKey = process.env.HIGGSFIELD_API_KEY;
      if (!apiKey) {
        return json({ error: 'HIGGSFIELD_API_KEY no está configurada.' }, 501);
      }
      const authHeader = `Key ${apiKey}`;
      const higgsfieldRatio = HIGGSFIELD_ASPECT_RATIO_MAP[aspectRatio] ?? '1:1';
      const fullPrompt = buildPrompt(prompt);
      const referenceUrl = await publishReferenceImage(referenceImage, new URL(request.url).origin);
      const tasks = await Promise.all(
        Array.from({ length: count }, () => submitHiggsfield(HIGGSFIELD_REFERENCE_URL, authHeader, { prompt: fullPrompt, image_reference_url: referenceUrl, aspect_ratio: higgsfieldRatio })),
      );
      return json({ jobId: await createJob(tasks) });
    }

    if (model === 'qwen') {
      const apiKey = process.env.QWEN_API_KEY;
      if (!apiKey) return json({ error: 'QWEN_API_KEY no está configurada.' }, 501);
      const size = QWEN_SIZE_MAP[aspectRatio] ?? '1024*1024';
      const fullPrompt = buildPrompt(prompt);
      const tasks = await Promise.all(Array.from({ length: count }, () => submitQwen(apiKey, fullPrompt, size)));
      return json({ jobId: await createJob(tasks) });
    }

    if (model === 'kling') {
      const apiKey = process.env.KLING_API_KEY;
      if (!apiKey) return json({ error: 'KLING_API_KEY no está configurada.' }, 501);
      const size = KLING_SIZE_MAP[aspectRatio] ?? '1024x1024';
      const fullPrompt = buildPrompt(prompt);
      const tasks = await Promise.all(Array.from({ length: count }, () => submitKling(apiKey, fullPrompt, size)));
      return json({ jobId: await createJob(tasks) });
    }

    // Default: Higgsfield
    const apiKey = process.env.HIGGSFIELD_API_KEY;
    if (!apiKey) {
      return json({ error: 'HIGGSFIELD_API_KEY no está configurada.' }, 501);
    }
    const higgsfieldRatio = HIGGSFIELD_ASPECT_RATIO_MAP[aspectRatio] ?? '1:1';
    const authHeader = `Key ${apiKey}`;
    const fullPrompt = buildPrompt(prompt);
    const tasks = await Promise.all(
      Array.from({ length: count }, () => submitHiggsfield(HIGGSFIELD_SUBMIT_URL, authHeader, { prompt: fullPrompt, aspect_ratio: higgsfieldRatio, image_url: '' })),
    );
    return json({ jobId: await createJob(tasks) });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Error contactando al proveedor.' },
      500,
    );
  }
}



// Re-hosts provider images so they outlive the provider's short-lived signed URLs.
// A failure here must never discard an image the user already paid for: if retention
// fails for one, that image falls back to its (temporary) provider URL.
async function retainImages(urls: string[], origin: string): Promise<string[]> {
  const kv = (env as unknown as { IMAGE_CACHE: KVNamespaceLike }).IMAGE_CACHE;
  const retained: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`El proveedor respondió ${response.status}.`);
      const mimeType = response.headers.get('content-type')?.split(';')[0] ?? '';
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) throw new Error('Formato no compatible.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('Supera el límite de almacenamiento.');
      const expiresAt = imageExpiresAt();
      const id = crypto.randomUUID();
      await kv.put(id, bytes, { expirationTtl: Math.ceil((expiresAt - Date.now()) / 1000), metadata: { mimeType, expiresAt } });
      retained.push(`${origin}/api/image/${id}`);
    } catch {
      retained.push(url);
    }
  }
  return retained;
}
