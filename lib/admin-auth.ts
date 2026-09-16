export const ADMIN_EMAIL = 'admin@creatorsacademy.pro';

export async function hashAdminPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

type ConfigKV = {
  get: (key: string, type?: 'json') => Promise<{ ADMIN_PASSWORD_HASH?: string } | null>;
};

// Every admin-only endpoint calls this the same way: email must match, and if
// a password has been set (admin opted into one from /admin), it must match
// too. No password set yet means the account is still in first-time setup,
// so email alone is accepted — that's how the very first password gets set.
export async function isAdminAuthorized(kv: ConfigKV, email: unknown, password: unknown): Promise<boolean> {
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (cleanEmail !== ADMIN_EMAIL) return false;
  const config = await kv.get('admin:api-config', 'json').catch(() => null);
  const storedHash = config?.ADMIN_PASSWORD_HASH;
  if (!storedHash) return true;
  const providedHash = typeof password === 'string' && password ? await hashAdminPassword(password) : '';
  return providedHash === storedHash;
}
