export const dynamic = 'force-dynamic';

type GenerateImageBody = {
  prompt?: unknown;
  style?: unknown;
  aspectRatio?: unknown;
  quality?: unknown;
  count?: unknown;
};

const SIZE_BY_RATIO: Record<string, string> = {
  '1:1': '1024x1024',
  '4:5': '1024x1536',
  '9:16': '1024x1536',
  '16:9': '1536x1024',
};

const QUALITY_MAP: Record<string, string> = {
  Estándar: 'low',
  Alta: 'medium',
  Ultra: 'high',
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(request: Request) {
  // Read at request time (not module scope) so a key added after the dev
  // server started is picked up without a restart in most environments.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(
      { error: 'OPENAI_API_KEY no está configurada en el servidor todavía.' },
      501,
    );
  }

  const body = (await request.json().catch(() => null)) as GenerateImageBody | null;
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt || prompt.length < 3 || prompt.length > 1000) {
    return json({ error: 'El prompt debe tener entre 3 y 1000 caracteres.' }, 400);
  }

  const style = typeof body?.style === 'string' ? body.style : 'Realista';
  const aspectRatio = typeof body?.aspectRatio === 'string' ? body.aspectRatio : '1:1';
  const quality = typeof body?.quality === 'string' ? body.quality : 'Alta';
  const rawCount = typeof body?.count === 'number' ? body.count : Number(body?.count);
  const count = [1, 2, 4].includes(rawCount) ? rawCount : 1;

  try {
    const apiUrl = process.env.OPENAI_IMAGE_API_URL ?? 'https://api.openai.com/v1/images/generations';
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: `${style}: ${prompt}`,
        size: SIZE_BY_RATIO[aspectRatio] ?? '1024x1024',
        quality: QUALITY_MAP[quality] ?? 'medium',
        n: count,
      }),
    });

    if (!response.ok) {
      const errorBody = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      const message =
        errorBody?.error?.message ?? `La API de imágenes respondió con estado ${response.status}.`;
      return json({ error: message }, response.status);
    }

    const payload = (await response.json()) as { data?: Array<{ b64_json?: string }> };
    const images = (payload.data ?? [])
      .map((item) => item.b64_json)
      .filter((value): value is string => Boolean(value))
      .map((b64) => `data:image/png;base64,${b64}`);

    if (!images.length) {
      return json({ error: 'La API no devolvió imágenes.' }, 502);
    }

    return json({ images });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : 'Error al contactar la API de imágenes.' },
      500,
    );
  }
}
