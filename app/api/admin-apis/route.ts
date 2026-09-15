import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

const ADMIN_EMAIL = 'admin@creatorsacademy.pro';
const CONFIG_KEY = 'admin:api-config';

type ApiConfig = {
  HIGGSFIELD_API_KEY?: string;
  KLING_API_KEY?: string;
  KLING_ACCESS_KEY?: string;
  KLING_SECRET_KEY?: string;
  A2E_API_TOKEN?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

type Store = {
  get: (key: string, type?: 'json') => Promise<ApiConfig | string | null>;
  put: (key: string, value: string, options?: { expirationTtl?: number }) => Promise<void>;
};

function store() {
  return (env as unknown as { IMAGE_CACHE: Store }).IMAGE_CACHE;
}

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function sanitize(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function mask(value?: string) {
  if (!value) return null;
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

export async function GET() {
  const config = (await store().get(CONFIG_KEY, 'json').catch(() => null)) as ApiConfig | null;
  return json({
    configured: {
      soul: Boolean(process.env.HIGGSFIELD_API_KEY || (env as unknown as Record<string, string | undefined>).HIGGSFIELD_API_KEY || config?.HIGGSFIELD_API_KEY),
      kling: Boolean(process.env.KLING_API_KEY || process.env.KLING_ACCESS_KEY || (env as unknown as Record<string, string | undefined>).KLING_API_KEY || (env as unknown as Record<string, string | undefined>).KLING_ACCESS_KEY || config?.KLING_API_KEY || config?.KLING_ACCESS_KEY),
      a2e: Boolean(process.env.A2E_API_TOKEN || (env as unknown as Record<string, string | undefined>).A2E_API_TOKEN || config?.A2E_API_TOKEN),
      stripe: Boolean(process.env.STRIPE_SECRET_KEY || (env as unknown as Record<string, string | undefined>).STRIPE_SECRET_KEY || config?.STRIPE_SECRET_KEY),
      google: Boolean(process.env.GOOGLE_CLIENT_ID || (env as unknown as Record<string, string | undefined>).GOOGLE_CLIENT_ID || config?.GOOGLE_CLIENT_ID),
    },
    masked: {
      HIGGSFIELD_API_KEY: mask(config?.HIGGSFIELD_API_KEY),
      KLING_API_KEY: mask(config?.KLING_API_KEY),
      KLING_ACCESS_KEY: mask(config?.KLING_ACCESS_KEY),
      KLING_SECRET_KEY: mask(config?.KLING_SECRET_KEY),
      A2E_API_TOKEN: mask(config?.A2E_API_TOKEN),
      STRIPE_SECRET_KEY: mask(config?.STRIPE_SECRET_KEY),
      STRIPE_WEBHOOK_SECRET: mask(config?.STRIPE_WEBHOOK_SECRET),
      GOOGLE_CLIENT_ID: mask(config?.GOOGLE_CLIENT_ID),
      GOOGLE_CLIENT_SECRET: mask(config?.GOOGLE_CLIENT_SECRET),
    },
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { adminEmail?: unknown; keys?: Record<string, unknown> } | null;
  if (sanitize(body?.adminEmail).toLowerCase() !== ADMIN_EMAIL) return json({ error: 'Solo el administrador puede vincular APIs.' }, 403);
  const current = (await store().get(CONFIG_KEY, 'json').catch(() => null)) as ApiConfig | null;
  const next: ApiConfig = { ...(current ?? {}) };
  const allowed: Array<keyof ApiConfig> = ['HIGGSFIELD_API_KEY', 'KLING_API_KEY', 'KLING_ACCESS_KEY', 'KLING_SECRET_KEY', 'A2E_API_TOKEN', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  for (const key of allowed) {
    const value = sanitize(body?.keys?.[key]);
    if (value) next[key] = value;
  }
  await store().put(CONFIG_KEY, JSON.stringify(next));
  return json({ ok: true, configured: { soul: Boolean(next.HIGGSFIELD_API_KEY), kling: Boolean(next.KLING_API_KEY || next.KLING_ACCESS_KEY), a2e: Boolean(next.A2E_API_TOKEN), stripe: Boolean(next.STRIPE_SECRET_KEY), google: Boolean(next.GOOGLE_CLIENT_ID) } });
}
