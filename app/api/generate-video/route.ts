import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

// Video generation takes 1-5 minutes, too long for a single Worker invocation to
// hold open. The client submits a task here, then polls GET with the returned
// taskId until it reports "SUCCEEDED" or "FAILED".

const WAN_SUBMIT_URL = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
const WAN_TASK_URL = 'https://dashscope-intl.aliyuncs.com/api/v1/tasks';
const WAN_I2V_MODEL = 'wan2.7-i2v-2026-04-25';
const A2E_API_BASE = 'https://video.a2e.ai';
const KLING_API_BASE = 'https://api.klingai.com/v1/videos';

function secret(name: string): string | undefined {
  const workerEnv = env as unknown as Record<string, string | undefined>;
  return process.env[name] ?? workerEnv[name];
}

async function providerSecret(name: string): Promise<string | undefined> {
  const direct = secret(name);
  if (direct) return direct;
  const kv = (env as unknown as { IMAGE_CACHE?: KVNamespaceLike }).IMAGE_CACHE;
  const config = await kv?.get?.('admin:api-config', 'json').catch(() => null);
  return typeof config?.[name] === 'string' ? config[name] : undefined;
}

// Wan2.7 accepts ratio directly; map the UI's aspect ratio options to supported values.
const WAN_RATIO_MAP: Record<string, string> = {
  '1:1': '1:1',
  '4:5': '3:4',
  '9:16': '9:16',
  '16:9': '16:9',
};

type KVNamespaceLike = {
  put: (key: string, value: ArrayBuffer, options?: { expirationTtl?: number; metadata?: Record<string, unknown> }) => Promise<void>;
  get?: (key: string, type?: 'json') => Promise<Record<string, string> | null>;
};

async function publishReferenceImage(dataUrl: string, origin: string): Promise<string> {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return dataUrl;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(origin)) {
    throw new Error('Para animar una imagen con A2E, la app debe estar desplegada para que A2E pueda leer la referencia.');
  }
  const [, mimeType, base64] = match;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

  const id = crypto.randomUUID();
  const kv = (env as unknown as { IMAGE_CACHE: KVNamespaceLike }).IMAGE_CACHE;
  await kv.put(id, bytes.buffer as ArrayBuffer, { expirationTtl: 3600, metadata: { mimeType } });
  return `${origin}/api/image/${id}`;
}

function json(body: Record<string, unknown>, status = 200) {
  if (typeof body.error === 'string') {
    const message = body.error;
    if (/inappropriate|sensitive|policy|moderation|nsfw|violation/i.test(message)) body.error = 'No se pudo procesar este contenido. Revisa el texto y la referencia.';
    else if (/timed? ?out|timeout|aborted/i.test(message)) body.error = 'La conexión tardó demasiado. Vuelve a consultar tu generación pendiente.';
    else if (/internal error|reference =/i.test(message)) body.error = 'El servicio de generación tuvo un error temporal. Inténtalo de nuevo más tarde.';
    else if (/Qwen|QWEN|Higgsfield|Kling|Wan|DashScope|api.key|model.*not|invalid.*model/i.test(message)) body.error = 'El servicio de generación no pudo completar la solicitud. Contacta al administrador.';
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

type SubmitBody = {
  prompt?: unknown;
  aspectRatio?: unknown;
  duration?: unknown;
  model?: unknown;
  mode?: unknown;
  referenceImage?: unknown;
  provider?: unknown;
};

type WanSubmitResponse = {
  output?: { task_id?: string };
  message?: string;
};

type WanTaskResponse = {
  output?: { task_status?: string; video_url?: string; message?: string };
  message?: string;
};

type A2EStartResponse = {
  data?: { _id?: string; task_id?: string; taskId?: string };
  task_id?: string;
  taskId?: string;
  message?: string;
  error?: string;
};

type A2EVideoTaskResponse = {
  data?: { current_status?: string; result_url?: string; failed_message?: string };
  current_status?: string;
  status?: string;
  result_url?: string;
  message?: string;
  error?: string;
};

type KlingSubmitResponse = {
  code?: number;
  message?: string;
  data?: { task_id?: string };
};

type KlingTaskResponse = {
  code?: number;
  message?: string;
  data?: {
    task_status?: string;
    task_status_msg?: string;
    task_result?: { videos?: Array<{ url?: string }> };
  };
};

function extractA2ETaskId(payload: A2EStartResponse | null): string | null {
  return payload?.data?._id ?? payload?.data?.task_id ?? payload?.data?.taskId ?? payload?.task_id ?? payload?.taskId ?? null;
}

async function klingAuthorization() {
  const access = await providerSecret('KLING_ACCESS_KEY');
  const secretKey = await providerSecret('KLING_SECRET_KEY');
  if (!access || !secretKey) {
    const apiKey = await providerSecret('KLING_API_KEY');
    if (apiKey) return `Bearer ${apiKey}`;
    throw new Error('La generación de video no está configurada. Contacta al administrador.');
  }
  const encode = (value: string) => btoa(value).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${encode(JSON.stringify({ iss: access, exp: now + 1800, nbf: now - 5 }))}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(unsigned)));
  return `Bearer ${unsigned}.${encode(String.fromCharCode(...signature))}`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as SubmitBody | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length < 3 || prompt.length > 2000) {
    return json({ error: 'El prompt debe tener entre 3 y 2000 caracteres.' }, 400);
  }

  const rawDuration = typeof body?.duration === 'number' ? body.duration : Number(body?.duration);
  const duration = body?.duration === undefined ? 5 : rawDuration;
  const provider = body?.provider === 'a2e' ? 'a2e' : 'kling';
  const allowedDurations = provider === 'a2e' ? [5, 10] : [5, 10, 12];
  if (!allowedDurations.includes(duration)) {
    return json({ error: provider === 'a2e' ? 'Elige una duración de 5 o 10 segundos.' : 'Elige una duración de 5, 10 o 12 segundos. El máximo es 12 segundos.' }, 400);
  }

  const isImageToVideo = body?.mode === 'image' || body?.model === 'wan-i2v';
  const referenceImage = typeof body?.referenceImage === 'string' && body.referenceImage.length > 0 ? body.referenceImage : null;
  if (isImageToVideo && !referenceImage) {
    return json({ error: 'Sube una imagen para animarla.' }, 400);
  }
  const ratio = body?.aspectRatio === undefined ? '9:16' : WAN_RATIO_MAP[body.aspectRatio as string];
  if (!isImageToVideo && !ratio) {
    return json({ error: 'Elige un formato válido.' }, 400);
  }

  const a2eToken = await providerSecret('A2E_API_TOKEN');
  if (provider === 'a2e') {
    if (!isImageToVideo) return json({ error: 'Contenido especial genera video desde una imagen de referencia.' }, 400);
    if (!a2eToken) return json({ error: 'La generación de video no está configurada. Contacta al administrador.' }, 501);
    try {
      const imageUrl = await publishReferenceImage(referenceImage as string, new URL(request.url).origin);
      const submitResponse = await fetch(`${A2E_API_BASE}/api/v1/userWanSpicy/start`, {
        method: 'POST',
        signal: AbortSignal.timeout(35000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${a2eToken}` },
        body: JSON.stringify({
          model: 'wan2.7-i2v-spicy',
          name: 'video-avatar',
          prompt,
          image_url: imageUrl,
          resolution: '720p',
          duration,
        }),
      });
      const payload = (await submitResponse.json().catch(() => null)) as A2EStartResponse | null;
      const taskId = extractA2ETaskId(payload);
      if (!submitResponse.ok || !taskId) {
        return json({ error: payload?.message ?? payload?.error ?? `El proveedor respondió con estado ${submitResponse.status}.` }, 502);
      }
      return json({ taskId: `a2e:${taskId}` });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Error contactando al proveedor.' }, 500);
    }
  }

  try {
    if (!await providerSecret('KLING_API_KEY') && (!await providerSecret('KLING_ACCESS_KEY') || !await providerSecret('KLING_SECRET_KEY'))) {
      return json({ error: 'La generación de video no está configurada. Contacta al administrador.' }, 501);
    }
    const auth = await klingAuthorization();
    const origin = new URL(request.url).origin;
    const imageUrl = isImageToVideo ? await publishReferenceImage(referenceImage as string, origin) : undefined;
    const submitResponse = await fetch(`${KLING_API_BASE}/${isImageToVideo ? 'image2video' : 'text2video'}`, {
      method: 'POST',
      signal: AbortSignal.timeout(35000),
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(isImageToVideo
        ? { model_name: 'kling-v2-6', image: imageUrl, prompt, mode: 'pro', duration: String(duration) }
        : { model_name: 'kling-v2-6', prompt, aspect_ratio: ratio, mode: 'pro', duration: String(duration) }),
    });
    const payload = (await submitResponse.json().catch(() => null)) as KlingSubmitResponse | null;
    const taskId = payload?.data?.task_id;
    if (!submitResponse.ok || payload?.code || !taskId) {
      return json({ error: payload?.message ?? `El proveedor respondió con estado ${submitResponse.status}.` }, 502);
    }
    return json({ taskId: `kling:${isImageToVideo ? 'image' : 'text'}:${taskId}` });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error contactando al proveedor.' }, 500);
  }

  const apiKey = await providerSecret('QWEN_API_KEY');
  if (!apiKey) {
    return json({ error: 'La generación de video no está configurada. Contacta al administrador.' }, 501);
  }

  const requestBody = isImageToVideo
    ? {
        model: WAN_I2V_MODEL,
        input: { prompt, media: [{ type: 'first_frame', url: referenceImage }] },
        parameters: { resolution: '720P', duration },
      }
    : {
        model: 'wan2.7-t2v',
        input: { prompt },
        parameters: { resolution: '720P', ratio, duration },
      };

  try {
    const submitResponse = await fetch(WAN_SUBMIT_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(35000),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(requestBody),
    });

    const payload = (await submitResponse.json().catch(() => null)) as WanSubmitResponse | null;
    if (!submitResponse.ok || !payload?.output?.task_id) {
      return json({ error: payload?.message ?? `El proveedor respondió con estado ${submitResponse.status}.` }, 502);
    }

    const taskId = payload?.output?.task_id;
    if (!taskId) return json({ error: 'El proveedor no devolvió una tarea válida.' }, 502);
    return json({ taskId });
  } catch {
    return json({ error: 'Error contactando al proveedor.' }, 500);
  }
}

export async function GET(request: Request) {
  const taskId = new URL(request.url).searchParams.get('taskId');
  if (!taskId || !/^[a-zA-Z0-9:_-]{1,140}$/.test(taskId)) {
    return json({ error: 'El identificador del video no es válido.' }, 400);
  }

  if (taskId.startsWith('a2e:')) {
    const a2eToken = await providerSecret('A2E_API_TOKEN');
    if (!a2eToken) return json({ error: 'La generación de video no está configurada. Contacta al administrador.' }, 501);
    const externalId = taskId.slice(4);
    try {
      const statusResponse = await fetch(`${A2E_API_BASE}/api/v1/userWanSpicy/${externalId}`, {
        headers: { Authorization: `Bearer ${a2eToken}` },
        signal: AbortSignal.timeout(25000),
      });
      const payload = (await statusResponse.json().catch(() => null)) as A2EVideoTaskResponse | null;
      if (!statusResponse.ok) return json({ error: payload?.message ?? payload?.error ?? `No se pudo consultar el estado (${statusResponse.status}).` }, 502);
      const status = payload?.data?.current_status ?? payload?.current_status ?? payload?.status;
      if (['completed', 'COMPLETED', 'SUCCESS', 'SUCCEEDED'].includes(status ?? '')) {
        const url = payload?.data?.result_url ?? payload?.result_url;
        if (!url) return json({ error: 'El proveedor completó la tarea sin devolver un video.' }, 502);
        return json({ status: 'SUCCEEDED', url });
      }
      if (['failed', 'FAILED', 'CANCELED', 'CANCELLED', 'UNKNOWN'].includes(status ?? '')) {
        return json({ status: 'FAILED', error: payload?.data?.failed_message ?? payload?.message ?? 'La generación de video falló.' });
      }
      if (!['sent', 'pending', 'PENDING', 'RUNNING', 'PROCESSING', 'QUEUED'].includes(status ?? '')) {
        return json({ error: 'El proveedor no devolvió un estado válido. Vuelve a consultar el video.' }, 502);
      }
      return json({ status: 'RUNNING' });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Error contactando al proveedor.' }, 500);
    }
  }

  if (taskId.startsWith('kling:')) {
    const [, klingMode = 'text', externalId = ''] = taskId.split(':');
    if (!externalId || !['image', 'text'].includes(klingMode)) return json({ error: 'El identificador del video no es válido.' }, 400);
    try {
      const statusResponse = await fetch(`${KLING_API_BASE}/${klingMode === 'image' ? 'image2video' : 'text2video'}/${externalId}`, {
        headers: { Authorization: await klingAuthorization() },
        signal: AbortSignal.timeout(25000),
      });
      const payload = (await statusResponse.json().catch(() => null)) as KlingTaskResponse | null;
      if (!statusResponse.ok || payload?.code) return json({ error: payload?.message ?? `No se pudo consultar el estado (${statusResponse.status}).` }, 502);
      const status = payload?.data?.task_status;
      if (status === 'succeed' || status === 'SUCCEEDED') {
        const url = payload?.data?.task_result?.videos?.[0]?.url;
        if (!url) return json({ error: 'El proveedor completó la tarea sin devolver un video.' }, 502);
        return json({ status: 'SUCCEEDED', url });
      }
      if (status === 'failed' || status === 'FAILED') return json({ status: 'FAILED', error: payload?.data?.task_status_msg ?? 'La generación de video falló.' });
      return json({ status: 'RUNNING' });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Error contactando al proveedor.' }, 500);
    }
  }

  const apiKey = await providerSecret('QWEN_API_KEY');
  if (!apiKey) {
    return json({ error: 'La generación de video no está configurada. Contacta al administrador.' }, 501);
  }

  try {
    const statusResponse = await fetch(`${WAN_TASK_URL}/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(25000),
    });
    const payload = (await statusResponse.json().catch(() => null)) as WanTaskResponse | null;

    if (!statusResponse.ok) {
      return json({ error: payload?.message ?? `No se pudo consultar el estado (${statusResponse.status}).` }, 502);
    }

    const status = payload?.output?.task_status;
    if (status === 'SUCCEEDED') {
      if (!payload?.output?.video_url) {
        return json({ error: 'El proveedor completó la tarea sin devolver un video.' }, 502);
      }
      return json({ status: 'SUCCEEDED', url: payload.output.video_url });
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      return json({ status: 'FAILED', error: payload?.output?.message ?? 'La generación de video falló.' });
    }
    if (status !== 'PENDING' && status !== 'RUNNING') {
      return json({ error: 'El proveedor no devolvió un estado válido. Vuelve a consultar el video.' }, 502);
    }
    return json({ status });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error contactando al proveedor.' }, 500);
  }
}
