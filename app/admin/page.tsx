'use client';

import { useState, useEffect } from 'react';
import { Eye, EyeOff, Save, AlertCircle, Check, X, Users, Receipt, Lock, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type YapeRequest = {
  id: string;
  email: string;
  kind: 'plan' | 'topup';
  planName: string;
  credits: number;
  priceUsd: number;
  payerPhone: string;
  proofImageUrl?: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
};

type AdminUser = { email: string; plan: string; credits: number; purchasedCredits: number; dailyCredits: number };

type PaymentRecord = {
  email: string;
  method: 'stripe' | 'yape';
  kind: 'plan' | 'topup';
  planName: string;
  credits: number;
  amountUsd: number;
  payerPhone?: string;
  createdAt: number;
};

type ApiConfig = {
  configured: {
    magnific: boolean;
    kling: boolean;
    a2e: boolean;
    stripe: boolean;
    google: boolean;
    paypal: boolean;
  };
  masked: {
    MAGNIFIC_API_KEY: string | null;
    MAGNIFIC_WEBHOOK_SECRET: string | null;
    KLING_API_KEY: string | null;
    KLING_ACCESS_KEY: string | null;
    KLING_SECRET_KEY: string | null;
    A2E_API_TOKEN: string | null;
    STRIPE_SECRET_KEY: string | null;
    STRIPE_WEBHOOK_SECRET: string | null;
    GOOGLE_CLIENT_ID: string | null;
    GOOGLE_CLIENT_SECRET: string | null;
    PAYPAL_CLIENT_ID: string | null;
    PAYPAL_CLIENT_SECRET: string | null;
  };
  hasPassword?: boolean;
};

const ADMIN_EMAIL = 'admin@creatorsacademy.pro';

export default function AdminPage() {
  const [adminEmail, setAdminEmail] = useState(ADMIN_EMAIL);
  const [adminPassword, setAdminPassword] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [showKeys, setShowKeys] = useState(false);

  const [keys, setKeys] = useState({
    MAGNIFIC_API_KEY: '',
    MAGNIFIC_WEBHOOK_SECRET: '',
    KLING_API_KEY: '',
    KLING_ACCESS_KEY: '',
    KLING_SECRET_KEY: '',
    A2E_API_TOKEN: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    PAYPAL_CLIENT_ID: '',
    PAYPAL_CLIENT_SECRET: '',
  });

  const [yapeRequests, setYapeRequests] = useState<YapeRequest[]>([]);
  const [yapeLoading, setYapeLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState('');

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersByPlan, setUsersByPlan] = useState<Record<string, number>>({});
  const [usersLoading, setUsersLoading] = useState(true);
  const [grantAmounts, setGrantAmounts] = useState<Record<string, string>>({});
  const [grantingEmail, setGrantingEmail] = useState('');

  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);

  const [tab, setTab] = useState<'resumen' | 'usuarios' | 'pagos'>('resumen');
  const pendingYapeCount = yapeRequests.filter((req) => req.status === 'pending').length;

  function authParams() {
    return { adminEmail, adminPassword };
  }

  useEffect(() => {
    loadConfig();
    loadYapeRequests();
    loadUsers();
    loadPayments();
  }, []);

  async function loadConfig() {
    try {
      const res = await fetch('/api/admin-apis');
      if (res.ok) setConfig(await res.json());
    } catch (error) {
      setMessage('Error al cargar configuración: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadYapeRequests() {
    setYapeLoading(true);
    try {
      const params = new URLSearchParams(authParams());
      const res = await fetch(`/api/payments/yape?${params}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json() as { requests?: YapeRequest[] };
        setYapeRequests(data.requests ?? []);
      }
    } catch { /* ignore */ }
    finally { setYapeLoading(false); }
  }

  async function loadUsers() {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams(authParams());
      const res = await fetch(`/api/admin-users?${params}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json() as { users?: AdminUser[]; total?: number; byPlan?: Record<string, number> };
        setUsers(data.users ?? []);
        setUsersTotal(data.total ?? 0);
        setUsersByPlan(data.byPlan ?? {});
      }
    } catch { /* ignore */ }
    finally { setUsersLoading(false); }
  }

  async function loadPayments() {
    setPaymentsLoading(true);
    try {
      const params = new URLSearchParams(authParams());
      const res = await fetch(`/api/admin-payments?${params}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json() as { payments?: PaymentRecord[] };
        setPayments(data.payments ?? []);
      }
    } catch { /* ignore */ }
    finally { setPaymentsLoading(false); }
  }

  async function reviewYapeRequest(requestId: string, action: 'approve' | 'reject') {
    setReviewingId(requestId);
    try {
      const res = await fetch('/api/payments/yape/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...authParams(), requestId, action }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) { setMessage(`❌ Error: ${data.error}`); return; }
      await Promise.all([loadYapeRequests(), loadUsers(), loadPayments()]);
    } catch {
      setMessage('❌ No se pudo actualizar la solicitud.');
    } finally {
      setReviewingId('');
    }
  }

  async function grantCredits(email: string) {
    const raw = grantAmounts[email];
    const amount = Number(raw);
    if (!raw || !Number.isFinite(amount) || amount === 0) {
      setMessage('❌ Ingresa una cantidad de créditos distinta de cero.');
      return;
    }
    setGrantingEmail(email);
    try {
      const res = await fetch('/api/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...authParams(), email, amount }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) { setMessage(`❌ Error: ${data.error}`); return; }
      setMessage(`✅ Créditos actualizados para ${email}`);
      setGrantAmounts((current) => ({ ...current, [email]: '' }));
      await loadUsers();
    } catch {
      setMessage('❌ No se pudieron asignar los créditos.');
    } finally {
      setGrantingEmail('');
    }
  }

  async function deleteUser(email: string) {
    if (!window.confirm(`¿Eliminar la cuenta ${email}? Esta acción no se puede deshacer.`)) return;
    setGrantingEmail(email);
    try {
      const res = await fetch('/api/admin-users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...authParams(), email }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) { setMessage(`❌ Error: ${data.error}`); return; }
      setMessage(`✅ Cuenta ${email} eliminada`);
      await loadUsers();
    } catch {
      setMessage('❌ No se pudo eliminar la cuenta.');
    } finally {
      setGrantingEmail('');
    }
  }

  async function handleSave() {
    if (adminEmail.trim() !== ADMIN_EMAIL) {
      setMessage('❌ Email de administrador incorrecto');
      return;
    }

    const filledKeys = Object.entries(keys).reduce((acc, [key, value]) => {
      if (value.trim()) acc[key as keyof typeof keys] = value.trim();
      return acc;
    }, {} as Record<string, string>);

    if (Object.keys(filledKeys).length === 0 && !newAdminPassword) {
      setMessage('❌ Ingresa al menos una API key o una nueva contraseña');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/admin-apis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...authParams(), newAdminPassword: newAdminPassword || undefined, keys: filledKeys }),
      });

      if (res.ok) {
        setMessage('✅ Guardado exitosamente');
        setKeys({
          MAGNIFIC_API_KEY: '',
          MAGNIFIC_WEBHOOK_SECRET: '',
          KLING_API_KEY: '',
          KLING_ACCESS_KEY: '',
          KLING_SECRET_KEY: '',
          A2E_API_TOKEN: '',
          STRIPE_SECRET_KEY: '',
          STRIPE_WEBHOOK_SECRET: '',
          GOOGLE_CLIENT_ID: '',
          GOOGLE_CLIENT_SECRET: '',
          PAYPAL_CLIENT_ID: '',
          PAYPAL_CLIENT_SECRET: '',
        });
        setNewAdminPassword('');
        await loadConfig();
      } else {
        const error = await res.json();
        setMessage(`❌ Error: ${error.error}`);
      }
    } catch (error) {
      setMessage('❌ Error al guardar: ' + (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-lg">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">⚙️ Panel de Administrador</h1>
        <p className="text-gray-400 mb-8">Servicios, usuarios, pagos y créditos de la plataforma</p>

        {message && (
          <div className={`mb-6 p-3 rounded-lg flex gap-2 ${message.startsWith('✅') ? 'bg-green-900/30 border border-green-500/50' : 'bg-red-900/30 border border-red-500/50'}`}>
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{message}</span>
          </div>
        )}

        <div className="flex gap-2 mb-8 border-b border-gray-700">
          {[
            { id: 'resumen' as const, label: '⚙️ Resumen' },
            { id: 'usuarios' as const, label: `👥 Usuarios (${usersTotal})` },
            { id: 'pagos' as const, label: `💳 Pagos${pendingYapeCount ? ` (${pendingYapeCount} por revisar)` : ''}` },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === item.id ? 'border-purple-500 text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Login */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2"><Lock className="w-5 h-5" /> Acceso de administrador</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-2">Email de Administrador</label>
              <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white" placeholder={ADMIN_EMAIL} />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Contraseña {config?.hasPassword ? '' : '(aún no configurada)'}
              </label>
              <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white" placeholder={config?.hasPassword ? 'Tu contraseña' : 'Déjalo vacío por ahora'} />
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {config?.hasPassword ? 'Esta contraseña se usa para todas las acciones de este panel.' : 'Aún no has creado una contraseña — cualquiera con el email correcto puede entrar. Crea una abajo, en "Configurar API Keys".'}
          </p>
          <div className="flex gap-2 mt-4">
            <Button variant="secondary" size="sm" onClick={() => { loadConfig(); loadYapeRequests(); loadUsers(); loadPayments(); }}>Actualizar todo con estas credenciales</Button>
          </div>
        </div>

        {tab === 'resumen' && (
        <>
        {/* Status */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">📊 Estado de Servicios</h2>
          <div className="grid grid-cols-6 gap-4">
            <div className={`p-4 rounded-lg ${config?.configured.magnific ? 'bg-green-900/30 border border-green-500/50' : 'bg-gray-700/50 border border-gray-600/50'}`}>
              <div className="text-sm text-gray-400">Seedream 4.5</div>
              <div className="text-lg font-bold">{config?.configured.magnific ? '✅ Activo' : '❌ Inactivo'}</div>
              {config?.masked.MAGNIFIC_API_KEY && (
                <div className="text-xs text-gray-500 mt-1">{config.masked.MAGNIFIC_API_KEY}</div>
              )}
            </div>
            <div className={`p-4 rounded-lg ${config?.configured.kling ? 'bg-green-900/30 border border-green-500/50' : 'bg-gray-700/50 border border-gray-600/50'}`}>
              <div className="text-sm text-gray-400">Kling</div>
              <div className="text-lg font-bold">{config?.configured.kling ? '✅ Activo' : '❌ Inactivo'}</div>
              {config?.masked.KLING_API_KEY && (
                <div className="text-xs text-gray-500 mt-1">{config.masked.KLING_API_KEY}</div>
              )}
            </div>
            <div className={`p-4 rounded-lg ${config?.configured.a2e ? 'bg-green-900/30 border border-green-500/50' : 'bg-gray-700/50 border border-gray-600/50'}`}>
              <div className="text-sm text-gray-400">A2E</div>
              <div className="text-lg font-bold">{config?.configured.a2e ? '✅ Activo' : '❌ Inactivo'}</div>
              {config?.masked.A2E_API_TOKEN && (
                <div className="text-xs text-gray-500 mt-1">{config.masked.A2E_API_TOKEN}</div>
              )}
            </div>
            <div className={`p-4 rounded-lg ${config?.configured.stripe ? 'bg-green-900/30 border border-green-500/50' : 'bg-gray-700/50 border border-gray-600/50'}`}>
              <div className="text-sm text-gray-400">Pagos (Stripe)</div>
              <div className="text-lg font-bold">{config?.configured.stripe ? '✅ Activo' : '❌ Inactivo'}</div>
              {config?.masked.STRIPE_SECRET_KEY && (
                <div className="text-xs text-gray-500 mt-1">{config.masked.STRIPE_SECRET_KEY}</div>
              )}
            </div>
            <div className={`p-4 rounded-lg ${config?.configured.google ? 'bg-green-900/30 border border-green-500/50' : 'bg-gray-700/50 border border-gray-600/50'}`}>
              <div className="text-sm text-gray-400">Login Google</div>
              <div className="text-lg font-bold">{config?.configured.google ? '✅ Activo' : '❌ Inactivo'}</div>
              {config?.masked.GOOGLE_CLIENT_ID && (
                <div className="text-xs text-gray-500 mt-1">{config.masked.GOOGLE_CLIENT_ID}</div>
              )}
            </div>
            <div className={`p-4 rounded-lg ${config?.configured.paypal ? 'bg-green-900/30 border border-green-500/50' : 'bg-gray-700/50 border border-gray-600/50'}`}>
              <div className="text-sm text-gray-400">Pagos (PayPal)</div>
              <div className="text-lg font-bold">{config?.configured.paypal ? '✅ Activo (Live)' : '❌ Inactivo'}</div>
              {config?.masked.PAYPAL_CLIENT_ID && (
                <div className="text-xs text-gray-500 mt-1">{config.masked.PAYPAL_CLIENT_ID}</div>
              )}
            </div>
          </div>
        </div>

        </>
        )}

        {tab === 'usuarios' && (
        <>
        {/* Users */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold flex items-center gap-2"><Users className="w-5 h-5" /> Usuarios</h2>
            <Button variant="ghost" size="sm" onClick={loadUsers} className="text-gray-400 hover:text-white">Actualizar</Button>
          </div>
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="bg-gray-700/50 border border-gray-600/50 rounded-lg px-4 py-2"><span className="text-gray-400 text-sm">Total </span><strong>{usersTotal}</strong></div>
            {Object.entries(usersByPlan).map(([plan, count]) => (
              <div key={plan} className="bg-gray-700/50 border border-gray-600/50 rounded-lg px-4 py-2"><span className="text-gray-400 text-sm">{plan} </span><strong>{count}</strong></div>
            ))}
          </div>
          {usersLoading ? (
            <p className="text-gray-400 text-sm">Cargando...</p>
          ) : users.length === 0 ? (
            <p className="text-gray-400 text-sm">Todavía no hay usuarios registrados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="py-2 pr-4">Correo</th>
                    <th className="py-2 pr-4">Plan</th>
                    <th className="py-2 pr-4">Créditos</th>
                    <th className="py-2 pr-4">Asignar créditos</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.email} className="border-b border-gray-800">
                      <td className="py-2 pr-4">{user.email}</td>
                      <td className="py-2 pr-4">{user.plan}</td>
                      <td className="py-2 pr-4">{user.credits.toLocaleString('es-PE')}</td>
                      <td className="py-2 pr-4">
                        <div className="flex gap-2">
                          <input
                            type="number"
                            value={grantAmounts[user.email] ?? ''}
                            onChange={(e) => setGrantAmounts((current) => ({ ...current, [user.email]: e.target.value }))}
                            placeholder="+100 / -50"
                            className="w-28 bg-gray-700 border border-gray-600 rounded px-2 py-1 text-white"
                          />
                          <Button size="sm" disabled={grantingEmail === user.email} onClick={() => grantCredits(user.email)}>Aplicar</Button>
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <Button size="sm" variant="secondary" disabled={grantingEmail === user.email} onClick={() => deleteUser(user.email)} className="text-red-400 hover:text-red-300 flex gap-1">
                          <Trash2 className="w-4 h-4" /> Eliminar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        </>
        )}

        {tab === 'pagos' && (
        <>
        {/* Payment history */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold flex items-center gap-2"><Receipt className="w-5 h-5" /> Historial de pagos confirmados</h2>
            <Button variant="ghost" size="sm" onClick={loadPayments} className="text-gray-400 hover:text-white">Actualizar</Button>
          </div>
          {paymentsLoading ? (
            <p className="text-gray-400 text-sm">Cargando...</p>
          ) : payments.length === 0 ? (
            <p className="text-gray-400 text-sm">Todavía no hay pagos confirmados.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-400 border-b border-gray-700">
                    <th className="py-2 pr-4">Fecha</th>
                    <th className="py-2 pr-4">Correo</th>
                    <th className="py-2 pr-4">Método</th>
                    <th className="py-2 pr-4">Detalle</th>
                    <th className="py-2 pr-4">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment, index) => (
                    <tr key={index} className="border-b border-gray-800">
                      <td className="py-2 pr-4">{new Date(payment.createdAt).toLocaleString('es-PE')}</td>
                      <td className="py-2 pr-4">{payment.email}</td>
                      <td className="py-2 pr-4">{payment.method === 'stripe' ? '💳 Tarjeta' : '📱 Yape'}</td>
                      <td className="py-2 pr-4">{payment.kind === 'plan' ? `Plan ${payment.planName}` : 'Recarga'} · {payment.credits} créditos</td>
                      <td className="py-2 pr-4">US$ {payment.amountUsd}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Yape pending claims */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">📱 Solicitudes de pago Yape (comprobantes por revisar)</h2>
            <Button variant="ghost" size="sm" onClick={loadYapeRequests} className="text-gray-400 hover:text-white">Actualizar</Button>
          </div>
          {yapeLoading ? (
            <p className="text-gray-400 text-sm">Cargando...</p>
          ) : yapeRequests.length === 0 ? (
            <p className="text-gray-400 text-sm">No hay solicitudes todavía.</p>
          ) : (
            <div className="space-y-3">
              {yapeRequests.map((req) => (
                <div key={req.id} className="flex items-center justify-between gap-4 bg-gray-700/50 border border-gray-600/50 rounded-lg p-4">
                  <div className="flex items-center gap-4">
                    {req.proofImageUrl && (
                      <a href={req.proofImageUrl} target="_blank" rel="noreferrer" title="Ver comprobante completo">
                        <img src={req.proofImageUrl} alt="Comprobante de pago" className="w-16 h-16 object-cover rounded-lg border border-gray-600" />
                      </a>
                    )}
                    <div>
                      <div className="font-semibold">{req.email}</div>
                      <div className="text-sm text-gray-400">
                        {req.kind === 'plan' ? `Plan ${req.planName}` : 'Recarga'} · {req.credits} créditos · US$ {req.priceUsd} · Pagó desde {req.payerPhone}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">{new Date(req.createdAt).toLocaleString('es-PE')}</div>
                    </div>
                  </div>
                  {req.status === 'pending' ? (
                    <div className="flex gap-2">
                      <Button size="sm" disabled={reviewingId === req.id} onClick={() => reviewYapeRequest(req.id, 'approve')} className="bg-green-600 hover:bg-green-700 text-white flex gap-1">
                        <Check className="w-4 h-4" /> Aprobar
                      </Button>
                      <Button size="sm" variant="secondary" disabled={reviewingId === req.id} onClick={() => reviewYapeRequest(req.id, 'reject')} className="flex gap-1">
                        <X className="w-4 h-4" /> Rechazar
                      </Button>
                    </div>
                  ) : (
                    <span className={`text-sm font-semibold ${req.status === 'approved' ? 'text-green-400' : 'text-red-400'}`}>
                      {req.status === 'approved' ? '✅ Aprobado' : '❌ Rechazado'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        </>
        )}

        {tab === 'resumen' && (
        <>
        {/* API keys form */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">🔐 Configurar API Keys y contraseña</h2>

          <div className="mb-4 p-4 bg-gray-700/50 border border-gray-600/50 rounded-lg">
            <label className="block text-sm text-gray-400 mb-2">{config?.hasPassword ? 'Cambiar contraseña de administrador' : 'Crear contraseña de administrador (opcional)'}</label>
            <input type="password" value={newAdminPassword} onChange={(e) => setNewAdminPassword(e.target.value)} className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white" placeholder="Mínimo 6 caracteres" />
            <p className="text-xs text-gray-500 mt-1">Si la creas, tendrás que ingresarla arriba junto con el email para usar este panel de ahora en adelante.</p>
          </div>

          <div className="space-y-3">
            {[
              { key: 'MAGNIFIC_API_KEY', label: '🎨 Magnific API Key (Seedream 4.5)' },
              { key: 'MAGNIFIC_WEBHOOK_SECRET', label: '🔐 Magnific Webhook Signing Secret' },
              { key: 'KLING_API_KEY', label: '🎬 Kling API Key' },
              { key: 'KLING_ACCESS_KEY', label: '🎬 Kling Access Key' },
              { key: 'KLING_SECRET_KEY', label: '🔑 Kling Secret Key' },
              { key: 'A2E_API_TOKEN', label: '✨ A2E API Token' },
              { key: 'STRIPE_SECRET_KEY', label: '💳 Stripe Secret Key (sk_live_... / sk_test_...)' },
              { key: 'STRIPE_WEBHOOK_SECRET', label: '🔐 Stripe Webhook Signing Secret (whsec_...)' },
              { key: 'GOOGLE_CLIENT_ID', label: '🔑 Google OAuth Client ID' },
              { key: 'GOOGLE_CLIENT_SECRET', label: '🔐 Google OAuth Client Secret' },
              { key: 'PAYPAL_CLIENT_ID', label: '💳 PayPal Client ID (Live)' },
              { key: 'PAYPAL_CLIENT_SECRET', label: '🔐 PayPal Client Secret (Live)' },
            ].map(({ key, label }) => (
              <div key={key}>
                <label className="block text-sm text-gray-400 mb-1">{label}</label>
                <div className="flex gap-2">
                  <input
                    type={showKeys ? 'text' : 'password'}
                    value={keys[key as keyof typeof keys]}
                    onChange={(e) => setKeys({ ...keys, [key]: e.target.value })}
                    className="flex-1 bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
                    placeholder="Pega tu API key aquí"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowKeys(!showKeys)}
                    className="text-gray-400 hover:text-white"
                  >
                    {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <Button
            onClick={handleSave}
            disabled={saving}
            className="w-full mt-6 bg-purple-600 hover:bg-purple-700 text-white flex gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 mb-8 text-sm text-gray-400">
          <h2 className="text-lg font-semibold mb-2 text-white">💳 Cómo activar los pagos</h2>
          <ol className="list-decimal list-inside space-y-1">
            <li>En tu dashboard de Stripe, copia tu <strong>Secret key</strong> y pégala arriba.</li>
            <li>Ve a Developers → Webhooks → Add endpoint, con esta URL: <code className="text-purple-300">{typeof window !== 'undefined' ? window.location.origin : ''}/api/stripe-webhook</code></li>
            <li>Selecciona el evento <strong>checkout.session.completed</strong>.</li>
            <li>Copia el <strong>Signing secret</strong> (whsec_...) del webhook y pégalo arriba.</li>
          </ol>
        </div>

        <div className="bg-gray-800 rounded-lg p-6 mb-8 text-sm text-gray-400">
          <h2 className="text-lg font-semibold mb-2 text-white">🔑 Cómo activar el acceso con Google</h2>
          <ol className="list-decimal list-inside space-y-1">
            <li>Ve a <a className="text-purple-300 underline" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud Console → Credentials</a> y crea un &quot;OAuth client ID&quot; de tipo Web application.</li>
            <li>Agrega como &quot;Authorized redirect URI&quot; esta URL: <code className="text-purple-300">{typeof window !== 'undefined' ? window.location.origin : ''}/api/auth/google/callback</code></li>
            <li>Copia el <strong>Client ID</strong> y el <strong>Client Secret</strong> y pégalos arriba.</li>
          </ol>
        </div>
        </>
        )}

        <div className="text-gray-500 text-sm text-center">
          Este panel es solo para administradores. Solo usa el email autorizado.
        </div>
      </div>
    </div>
  );
}
