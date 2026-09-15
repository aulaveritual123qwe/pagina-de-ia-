import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type ConfigKV = {
  get: (key: string, type?: 'json') => Promise<Record<string, string> | null | string>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
  delete: (key: string) => Promise<void>;
};

function secret(name: string): string | undefined {
  const workerEnv = env as unknown as Record<string, string | undefined>;
  return process.env[name] ?? workerEnv[name];
}

async function providerSecret(name: string): Promise<string | undefined> {
  const direct = secret(name);
  if (direct) return direct;
  const kv = (env as unknown as { IMAGE_CACHE?: ConfigKV }).IMAGE_CACHE;
  const config = (await kv?.get?.('admin:api-config', 'json').catch(() => null)) as Record<string, string> | null;
  return typeof config?.[name] === 'string' ? config[name] : undefined;
}

function store() {
  return (env as unknown as { IMAGE_CACHE: ConfigKV }).IMAGE_CACHE;
}

type GoogleTokenResponse = { access_token?: string; error?: string; error_description?: string };
type GoogleUserInfo = { email?: string; email_verified?: boolean; name?: string };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  function fail(message: string) {
    return Response.redirect(`${origin}/?google_auth_error=${encodeURIComponent(message)}`, 302);
  }

  if (oauthError) return fail('Acceso con Google cancelado.');
  if (!code || !state) return fail('Respuesta de Google inválida.');

  const stateKey = `google-state:${state}`;
  const validState = await store().get(stateKey).catch(() => null);
  if (!validState) return fail('La sesión de acceso con Google expiró. Inténtalo de nuevo.');
  await store().delete(stateKey);

  const clientId = await providerSecret('GOOGLE_CLIENT_ID');
  const clientSecret = await providerSecret('GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) return fail('El acceso con Google no está configurado. Contacta al administrador.');

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }).toString(),
    });
    const tokenData = (await tokenResponse.json().catch(() => null)) as GoogleTokenResponse | null;
    if (!tokenResponse.ok || !tokenData?.access_token) {
      return fail(tokenData?.error_description ?? 'No se pudo completar el acceso con Google.');
    }

    const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(15000),
    });
    const userInfo = (await userInfoResponse.json().catch(() => null)) as GoogleUserInfo | null;
    if (!userInfoResponse.ok || !userInfo?.email || userInfo.email_verified === false) {
      return fail('No se pudo obtener tu correo de Google.');
    }

    const loginCode = crypto.randomUUID();
    await store().put(`google-login:${loginCode}`, JSON.stringify({ email: userInfo.email.toLowerCase(), name: userInfo.name ?? '' }), { expirationTtl: 120 });
    return Response.redirect(`${origin}/?google_auth=${loginCode}`, 302);
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Error contactando a Google.');
  }
}
