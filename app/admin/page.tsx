'use client';

import { useState, useEffect } from 'react';
import { Eye, EyeOff, Save, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ApiConfig = {
  configured: {
    soul: boolean;
    kling: boolean;
    a2e: boolean;
    stripe: boolean;
    google: boolean;
  };
  masked: {
    HIGGSFIELD_API_KEY: string | null;
    KLING_API_KEY: string | null;
    KLING_ACCESS_KEY: string | null;
    KLING_SECRET_KEY: string | null;
    A2E_API_TOKEN: string | null;
    STRIPE_SECRET_KEY: string | null;
    STRIPE_WEBHOOK_SECRET: string | null;
    GOOGLE_CLIENT_ID: string | null;
    GOOGLE_CLIENT_SECRET: string | null;
  };
};

export default function AdminPage() {
  const [adminEmail, setAdminEmail] = useState('admin@creatorsacademy.pro');
  const [config, setConfig] = useState<ApiConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [showKeys, setShowKeys] = useState(false);

  const [keys, setKeys] = useState({
    HIGGSFIELD_API_KEY: '',
    KLING_API_KEY: '',
    KLING_ACCESS_KEY: '',
    KLING_SECRET_KEY: '',
    A2E_API_TOKEN: '',
    STRIPE_SECRET_KEY: '',
    STRIPE_WEBHOOK_SECRET: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
  });

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const res = await fetch('/api/admin-apis');
      if (res.ok) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (error) {
      setMessage('Error al cargar configuración: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (adminEmail.trim() !== 'admin@creatorsacademy.pro') {
      setMessage('❌ Email de administrador incorrecto');
      return;
    }

    const filledKeys = Object.entries(keys).reduce((acc, [key, value]) => {
      if (value.trim()) acc[key as keyof typeof keys] = value.trim();
      return acc;
    }, {} as Record<string, string>);

    if (Object.keys(filledKeys).length === 0) {
      setMessage('❌ Ingresa al menos una API key');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/admin-apis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminEmail,
          keys: filledKeys,
        }),
      });

      if (res.ok) {
        setMessage('✅ API keys guardadas exitosamente');
        setKeys({
          HIGGSFIELD_API_KEY: '',
          KLING_API_KEY: '',
          KLING_ACCESS_KEY: '',
          KLING_SECRET_KEY: '',
          A2E_API_TOKEN: '',
          STRIPE_SECRET_KEY: '',
          STRIPE_WEBHOOK_SECRET: '',
          GOOGLE_CLIENT_ID: '',
          GOOGLE_CLIENT_SECRET: '',
        });
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
      <div className="max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold mb-2">⚙️ Panel de Administrador</h1>
        <p className="text-gray-400 mb-8">Configura tus API keys para los servicios de generación</p>

        {/* Status */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">📊 Estado de Servicios</h2>
          <div className="grid grid-cols-5 gap-4">
            <div className={`p-4 rounded-lg ${config?.configured.soul ? 'bg-green-900/30 border border-green-500/50' : 'bg-gray-700/50 border border-gray-600/50'}`}>
              <div className="text-sm text-gray-400">Avatares e imágenes</div>
              <div className="text-lg font-bold">{config?.configured.soul ? '✅ Activo' : '❌ Inactivo'}</div>
              {config?.masked.HIGGSFIELD_API_KEY && (
                <div className="text-xs text-gray-500 mt-1">{config.masked.HIGGSFIELD_API_KEY}</div>
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
          </div>
        </div>

        {/* Form */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">🔐 Configurar API Keys</h2>

          {message && (
            <div className={`mb-4 p-3 rounded-lg flex gap-2 ${message.startsWith('✅') ? 'bg-green-900/30 border border-green-500/50' : 'bg-red-900/30 border border-red-500/50'}`}>
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{message}</span>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">Email de Administrador</label>
            <input
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white"
              placeholder="admin@creatorsacademy.pro"
            />
          </div>

          <div className="space-y-3">
            {[
              { key: 'HIGGSFIELD_API_KEY', label: '🎨 API Key de imágenes y avatares' },
              { key: 'KLING_API_KEY', label: '🎬 Kling API Key' },
              { key: 'KLING_ACCESS_KEY', label: '🎬 Kling Access Key' },
              { key: 'KLING_SECRET_KEY', label: '🔑 Kling Secret Key' },
              { key: 'A2E_API_TOKEN', label: '✨ A2E API Token' },
              { key: 'STRIPE_SECRET_KEY', label: '💳 Stripe Secret Key (sk_live_... / sk_test_...)' },
              { key: 'STRIPE_WEBHOOK_SECRET', label: '🔐 Stripe Webhook Signing Secret (whsec_...)' },
              { key: 'GOOGLE_CLIENT_ID', label: '🔑 Google OAuth Client ID' },
              { key: 'GOOGLE_CLIENT_SECRET', label: '🔐 Google OAuth Client Secret' },
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
            {saving ? 'Guardando...' : 'Guardar API Keys'}
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

        <div className="text-gray-500 text-sm text-center">
          Este panel es solo para administradores. Solo usa el email autorizado.
        </div>
      </div>
    </div>
  );
}
