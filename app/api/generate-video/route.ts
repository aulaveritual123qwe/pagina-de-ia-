export const dynamic = 'force-dynamic';

// Video generation takes 1-5 minutes, too long for a single Worker invocation to
// hold open. The client submits a task here, then polls GET with the returned
// taskId until it reports "SUCCEEDED" or "FAILED".

const WAN_SUBMIT_URL = 'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis';
const WAN_TASK_URL = 'https://dashscope-intl.aliyuncs.com/api/v1/tasks';

// Wan2.7 accepts ratio directly; map the UI's aspect ratio options to supported values.
const WAN_RATIO_MAP: Record<string, string> = {
  '1:1': '1:1',
  '4:5': '3:4',
  '9:16': '9:16',
  '16:9': '16:9',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type SubmitBody = {
  prompt?: unknown;
  aspectRatio?: unknown;
  duration?: unknown;
};

type WanSubmitResponse = {
  output?: { task_id?: string };
  message?: string;
};

type WanTaskResponse = {
  output?: { task_status?: string; video_url?: string; message?: string };
  message?: string;
};

export async function POST(request: Request) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    return json({ error: 'QWEN_API_KEY no está configurada.' }, 501);
  }

  const body = (await request.json().catch(() => null)) as SubmitBody | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length < 3 || prompt.length > 2000) {
    return json({ error: 'El prompt debe tener entre 3 y 2000 caracteres.' }, 400);
  }

  const ratio = WAN_RATIO_MAP[body?.aspectRatio as string] ?? '9:16';
  const rawDuration = typeof body?.duration === 'number' ? body.duration : Number(body?.duration);
  const duration = [5, 10].includes(rawDuration) ? rawDuration : 5;

  try {
    const submitResponse = await fetch(WAN_SUBMIT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: 'wan2.7-t2v',
        input: { prompt },
        parameters: { resolution: '720P', ratio, duration },
      }),
    });

    const payload = (await submitResponse.json().catch(() => null)) as WanSubmitResponse | null;
    if (!submitResponse.ok || !payload?.output?.task_id) {
      return json({ error: payload?.message ?? `El proveedor respondió con estado ${submitResponse.status}.` }, 502);
    }

    return json({ taskId: payload.output.task_id });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error contactando al proveedor.' }, 500);
  }
}

export async function GET(request: Request) {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) {
    return json({ error: 'QWEN_API_KEY no está configurada.' }, 501);
  }

  const taskId = new URL(request.url).searchParams.get('taskId');
  if (!taskId) {
    return json({ error: 'Falta el parámetro taskId.' }, 400);
  }

  try {
    const statusResponse = await fetch(`${WAN_TASK_URL}/${taskId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
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
    if (status === 'FAILED') {
      return json({ status: 'FAILED', error: payload?.output?.message ?? 'La generación de video falló.' });
    }
    return json({ status: status ?? 'PENDING' });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error contactando al proveedor.' }, 500);
  }
}
