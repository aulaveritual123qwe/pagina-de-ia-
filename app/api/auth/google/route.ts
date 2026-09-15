import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

type ConfigKV = {
  get: (key: string, type?: 'json') => Promise<Record<string, string> | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
};

function secret(name: string): string | undefined {
  const workerEnv = env as unknown as Record<string, string | undefined>;
  return process.env[name] ?? workerEnv[name];
}

async function providerSecret(name: string): Promise<string | undefined> {
  const direct = secret(name);
  if (direct) return direct;
  const kv = (env as unknown as { IMAGE_CACHE?: ConfigKV }).IMAGE_CACHE;
  const config = await kv?.get?.('admin:api-config', 'json').catch(() => null);
  return typeof config?.[name] === 'string' ? config[name] : undefined;
}

function store() {
  return (env as unknown as { IMAGE_CACHE: ConfigKV }).IMAGE_CACHE;
}

// Sends the visitor to Google's consent screen. A short-lived `state` value is
// stashed in KV so the callback can confirm the request round-tripped through
// Google instead of being a forged hit straight at /callback.
export async function GET(request: Request) {
  const clientId = await providerSecret('GOOGLE_CLIENT_ID');
  const origin = new URL(request.url).origin;
  if (!clientId) {
    return Response.redirect(`${origin}/?google_auth_error=${encodeURIComponent('El acceso con Google no está configurado. Contacta al administrador.')}`, 302);
  }

  const state = crypto.randomUUID();
  await store().put(`google-state:${state}`, '1', { expirationTtl: 300 });

  const redirectUri = `${origin}/api/auth/google/callback`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('prompt', 'select_account');

  return Response.redirect(authUrl.toString(), 302);
}
