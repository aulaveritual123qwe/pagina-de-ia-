'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Camera,
  Check,
  ChevronDown,
  Coins,
  Download,
  Eye,
  EyeOff,
  FolderHeart,
  Heart,
  Home,
  Image as ImageIcon,
  Lock,
  Library,
  LoaderCircle,
  LogOut,
  Mail,
  Menu,
  Music2,
  Palette,
  Play,
  Search,
  Settings,
  Sparkles,
  Upload,
  Users,
  Video,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { generateImages } from '@/lib/image-provider';

type View = 'inicio' | 'creaciones' | 'avatares' | 'crear' | 'video' | 'especial' | 'biblioteca' | 'planes' | 'ajustes';

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => Promise<Record<string, unknown>>;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

declare global {
  interface Document {
    readonly modelContext?: ModelContext;
  }
}

const media = [
  '/assets/creator-wide.png',
  '/assets/creator-portrait-1.png',
  '/assets/creator-portrait-2.png',
  '/assets/creator-portrait-3.png',
];


const navItems: Array<{ id: View; label: string; icon: typeof Home }> = [
  { id: 'inicio', label: 'Inicio', icon: Home },
  { id: 'creaciones', label: 'Creaciones', icon: FolderHeart },
  { id: 'avatares', label: 'Mis Avatares', icon: Users },
  { id: 'crear', label: 'Crear Imagen', icon: WandSparkles },
  { id: 'video', label: 'Generar Video', icon: Video },
  { id: 'especial', label: 'Contenido', icon: Sparkles },
  { id: 'biblioteca', label: 'Biblioteca', icon: Library },
  { id: 'planes', label: 'Planes y Créditos', icon: Coins },
  { id: 'ajustes', label: 'Configuración', icon: Settings },
];

const SESSION_KEY = 'creators-session-email';
const USERS_KEY = 'creators-users';

function onboardedKey(email: string) { return `creators-onboarded:${email}`; }
function charactersKey(email: string) { return `creators-characters:${email}`; }

type Character = { id: string; name: string; referenceImage: string; resultImage: string; references?: string[]; soulId?: string; description?: string };
type UserRecord = { name: string; passwordHash: string };

async function hashPassword(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function loadUsers(): Record<string, UserRecord> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(USERS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveUsers(users: Record<string, UserRecord>) {
  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function nameFromEmail(email: string) {
  const handle = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  if (!handle) return 'Creador';
  return handle
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function HomePage() {
  const [accountEmail, setAccountEmail] = useState('');
  const [sessionChecked, setSessionChecked] = useState(false);
  const [view, setView] = useState<View>('crear');
  const [specialMode, setSpecialMode] = useState('Crear imagen');
  const [mobileNav, setMobileNav] = useState(false);
  const [prompt, setPrompt] = useState(
    'Retrato editorial en una cafetería creativa, luz cálida, reflejos violeta, fotografía realista y natural.',
  );
  const [style, setStyle] = useState('Realista');
  const [ratio, setRatio] = useState('3:4');
  const [quality, setQuality] = useState('Alta');
  const [imageCount, setImageCount] = useState('4');
  const model = 'higgsfield';
  const specialImageModel = 'qwen';
  // "Contenido" keeps its own prompt/settings/results so it never mixes
  // with "Crear Imagen" — they're two separate workspaces that happen to share UI.
  const [specialPrompt, setSpecialPrompt] = useState('');
  const [specialStyle, setSpecialStyle] = useState('Realista');
  const [specialRatio, setSpecialRatio] = useState('3:4');
  const [specialQuality, setSpecialQuality] = useState('Alta');
  const [specialImageCount, setSpecialImageCount] = useState('4');
  const [specialResults, setSpecialResults] = useState(media);
  const [specialResultSource, setSpecialResultSource] = useState<'demo' | 'live'>('demo');
  const [specialFavorite, setSpecialFavorite] = useState(false);
  const [specialReferenceImage, setSpecialReferenceImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [specialIsGenerating, setSpecialIsGenerating] = useState(false);
  const [credits, setCredits] = useState(320);
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState(media);
  const [resultSource, setResultSource] = useState<'demo' | 'live'>('demo');
  const [favorite, setFavorite] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [plan, setPlan] = useState('Free');
  const [selectedAvatar, setSelectedAvatar] = useState('Lua');
  const [profileName, setProfileName] = useState('');
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [referenceImage, setReferenceImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const authenticated = Boolean(accountEmail);
  const displayName = profileName || (accountEmail ? nameFromEmail(accountEmail) : '');

  const activeLabel = useMemo(
    () => navItems.find((item) => item.id === view)?.label ?? 'Crear imagen',
    [view],
  );

  useEffect(() => {
    (async () => {
      const users = loadUsers();
      if (!users[ACCOUNT_EMAIL]) {
        users[ACCOUNT_EMAIL] = { name: 'Admin', passwordHash: await hashPassword(ACCOUNT_PASSWORD) };
        saveUsers(users);
      }

      const savedEmail = window.localStorage.getItem(SESSION_KEY) ?? '';
      setAccountEmail(savedEmail);
      if (savedEmail) {
        try {
          const savedCharacters = JSON.parse(window.localStorage.getItem(charactersKey(savedEmail)) ?? '[]');
          if (Array.isArray(savedCharacters)) setCharacters(savedCharacters);
        } catch { /* ignore malformed data */ }
        if (window.localStorage.getItem(onboardedKey(savedEmail)) !== 'true') {
          setShowOnboarding(true);
        }
      }
      setSessionChecked(true);
    })();
  }, []);

  function handleLogin(email: string) {
    window.localStorage.setItem(SESSION_KEY, email);
    setAccountEmail(email);
    setView('crear');
    notify(`Bienvenido de nuevo, ${nameFromEmail(email).split(' ')[0]}.`);
    try {
      const savedCharacters = JSON.parse(window.localStorage.getItem(charactersKey(email)) ?? '[]');
      setCharacters(Array.isArray(savedCharacters) ? savedCharacters : []);
    } catch {
      setCharacters([]);
    }
    if (window.localStorage.getItem(onboardedKey(email)) !== 'true') {
      setShowOnboarding(true);
    }
  }

  function completeOnboarding() {
    window.localStorage.setItem(onboardedKey(accountEmail), 'true');
    setShowOnboarding(false);
  }

  function saveCharacter(character: Character) {
    setCharacters((current) => {
      const next = [...current, character];
      window.localStorage.setItem(charactersKey(accountEmail), JSON.stringify(next));
      return next;
    });
    window.localStorage.setItem(onboardedKey(accountEmail), 'true');
    setShowOnboarding(false);
    setSelectedAvatar(character.name);
    notify(`Personaje "${character.name}" creado correctamente.`);
  }

  function handleLogout() {
    window.localStorage.removeItem(SESSION_KEY);
    setAccountEmail('');
    setProfileName('');
    setProfileMenuOpen(false);
    setNotificationOpen(false);
    setMobileNav(false);
    setResults(media);
    setResultSource('demo');
    setFavorites([]);
    setUploadedImages([]);
    setCharacters([]);
    setNotice('Cerraste sesión correctamente.');
  }

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    void Promise.resolve(
      context.registerTool(
        {
          name: 'generate_demo_images',
          title: 'Generar imágenes de demostración',
          description: 'Configura el estudio con un prompt y genera de una a cuatro imágenes de demostración visibles en la interfaz.',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: { type: 'string', minLength: 3, maxLength: 1000 },
              count: { type: 'integer', enum: [1, 2, 4] },
              style: { type: 'string', enum: ['Realista', 'Editorial', 'Cinematográfico', 'Ilustración'] },
            },
            required: ['prompt'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          async execute(input) {
            const value = input as { prompt?: unknown; count?: unknown; style?: unknown };
            if (typeof value.prompt !== 'string' || value.prompt.trim().length < 3 || value.prompt.length > 1000) {
              throw new Error('El prompt debe tener entre 3 y 1000 caracteres.');
            }
            const nextCount = typeof value.count === 'number' && [1, 2, 4].includes(value.count) ? value.count : 4;
            const nextStyle = typeof value.style === 'string' && ['Realista', 'Editorial', 'Cinematográfico', 'Ilustración'].includes(value.style) ? value.style : 'Realista';
            setView('crear');
            setPrompt(value.prompt.trim());
            setImageCount(String(nextCount));
            setStyle(nextStyle);
            setIsGenerating(true);
            const { images, source } = await generateImages({ prompt: value.prompt.trim(), count: nextCount, style: nextStyle, aspectRatio: ratio, quality });
            setResults(images);
            setResultSource(source);
            setCredits((current) => Math.max(0, current - nextCount));
            setIsGenerating(false);
            return { status: 'generated', count: images.length, mode: source };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, [quality, ratio]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function navigate(next: View) {
    setView(next);
    setMobileNav(false);
  }

  function notify(message: string) {
    setNotice(message);
  }

  function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!search.trim()) {
      notify('Escribe una palabra para buscar.');
      return;
    }
    navigate('biblioteca');
    notify(`Mostrando resultados para “${search.trim()}”.`);
  }

  function toggleFavorite(image: string) {
    setFavorites((current) => current.includes(image) ? current.filter((item) => item !== image) : [...current, image]);
  }

  function handleUpload(file: File) {
    if (!file.type.startsWith('image/')) {
      notify('Selecciona un archivo de imagen válido.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setUploadedImages((current) => [reader.result as string, ...current]);
        notify('Imagen añadida a tu biblioteca.');
      }
    };
    reader.readAsDataURL(file);
  }

  function spendCredits(amount: number, message: string) {
    if (credits < amount) {
      navigate('planes');
      notify('No tienes créditos suficientes. Elige un plan o recarga créditos.');
      return false;
    }
    setCredits((current) => current - amount);
    notify(message);
    return true;
  }

  function selectPlan(name: string, includedCredits: number) {
    setPlan(name);
    setCredits(includedCredits);
    notify(`Plan ${name} activado en modo demostración.`);
  }

  function useTemplate(name: string) {
    setPrompt(`${name}: retrato realista de una creadora digital, composición profesional, iluminación natural y detalles de alta calidad.`);
    navigate('crear');
    notify(`Plantilla “${name}” aplicada al prompt.`);
  }

  async function handleGenerate() {
    if (!prompt.trim() || isGenerating) return;
    const amount = Number(imageCount);
    if (credits < amount * IMAGE_CREDIT_COST) { notify('No tienes créditos suficientes.'); return; }
    const avatar = characters.find((character) => character.name === selectedAvatar);
    if (avatar && !avatar.soulId) { notify('Este avatar necesita configurarse con 5 a 10 referencias con sus referencias. Crea su nueva identidad en Mis Avatares.'); return; }
    setIsGenerating(true);
    try {
      const { images, source } = await generateImages({
        prompt,
        style,
        aspectRatio: ratio,
        quality,
        count: amount,
        model: 'higgsfield',
        referenceImage: avatar?.soulId ? undefined : avatar?.referenceImage ?? referenceImage?.dataUrl,
        soulId: avatar?.soulId,
      });
      setResults(images);
      if (avatar) {
        setCharacters((current) => {
          const next = current.map((character) => character.id === avatar.id ? { ...character, resultImage: images[0] } : character);
          window.localStorage.setItem(charactersKey(accountEmail), JSON.stringify(next));
          return next;
        });
      }
      setResultSource(source);
      setCredits((current) => Math.max(0, current - images.length * IMAGE_CREDIT_COST));
      notify(
        source === 'live'
          ? `${images.length} imagen${images.length === 1 ? '' : 'es'} generada${images.length === 1 ? '' : 's'} con IA.`
          : `${images.length} imagen${images.length === 1 ? '' : 'es'} generada${images.length === 1 ? '' : 's'} en modo demostración.`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo completar la generación. Inténtalo nuevamente.');
    } finally {
      setIsGenerating(false);
    }
  }

  // Independent generation flow for "Contenido" — separate prompt, settings
  // and results from "Crear Imagen" so the two never mix.
  async function handleGenerateSpecial() {
    if (!specialPrompt.trim() || specialIsGenerating) return;
    const amount = Number(specialImageCount);
    if (credits < amount * IMAGE_CREDIT_COST) { notify('No tienes créditos suficientes.'); return; }
    setSpecialIsGenerating(true);
    try {
      const { images, source } = await generateImages({
        prompt: specialPrompt,
        style: specialStyle,
        aspectRatio: specialRatio,
        quality: specialQuality,
        count: amount,
        model: specialImageModel,
        referenceImage: specialReferenceImage?.dataUrl,
      });
      setSpecialResults(images);
      setSpecialResultSource(source);
      setCredits((current) => Math.max(0, current - images.length * IMAGE_CREDIT_COST));
      notify(
        source === 'live'
          ? `${images.length} imagen${images.length === 1 ? '' : 'es'} generada${images.length === 1 ? '' : 's'} con IA.`
          : `${images.length} imagen${images.length === 1 ? '' : 'es'} generada${images.length === 1 ? '' : 's'} en modo demostración.`,
      );
    } catch (error) {
      notify(error instanceof Error ? error.message : 'No se pudo completar la generación. Inténtalo nuevamente.');
    } finally {
      setSpecialIsGenerating(false);
    }
  }

  if (!sessionChecked) return null;

  if (!authenticated) {
    return (
      <>
        <LoginView onLogin={handleLogin} onNotify={notify} />
        {notice && <div className="app-notice" role="status"><Check size={18} /> {notice}</div>}
      </>
    );
  }

  return (
    <div className={`app-shell${view === 'especial' ? ' special-theme' : ''}`}>
      <Sidebar
        view={view}
        open={mobileNav}
        onClose={() => setMobileNav(false)}
        onNavigate={navigate}
      />

      <div className="app-main">
        <header className="topbar">
          <button
            className="mobile-menu"
            type="button"
            onClick={() => setMobileNav(true)}
            aria-label="Abrir menú"
          >
            <Menu size={24} />
          </button>
          <form className="searchbox" onSubmit={handleSearch}>
            <Search size={19} />
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar creaciones, estilos o proyectos..." aria-label="Buscar" />
          </form>
          <div className="topbar-actions">
            <button className="credit-pill" type="button" onClick={() => navigate('planes')}>
              <Coins size={19} />
              <strong>{credits}</strong>
              <span>créditos</span>
            </button>
            <button className="icon-button notification" type="button" aria-label="Notificaciones" aria-expanded={notificationOpen} onClick={() => setNotificationOpen((current) => !current)}>
              <Bell size={21} />
              <span />
            </button>
            {notificationOpen && <div className="notification-popover"><strong>Notificaciones</strong><p>Tu estudio está listo para crear.</p><button type="button" onClick={() => setNotificationOpen(false)}>Marcar como leída</button></div>}
            <button
              className="profile-button"
              type="button"
              aria-label="Abrir perfil"
              aria-expanded={profileMenuOpen}
              onClick={() => { setProfileMenuOpen((current) => !current); setNotificationOpen(false); }}
            >
              <img src="/assets/creator-portrait-1.png" alt={`Avatar de ${displayName}`} />
              <span>
                <strong>Hola, {displayName.split(' ')[0]}</strong>
                <small>{plan === 'Free' ? 'Creator Free' : `Plan ${plan}`}</small>
              </span>
              <ChevronDown size={16} />
            </button>
            {(profileMenuOpen || notificationOpen) && (
              <button
                className="popover-backdrop"
                type="button"
                aria-label="Cerrar menú"
                onClick={() => { setProfileMenuOpen(false); setNotificationOpen(false); }}
              />
            )}
            {profileMenuOpen && (
              <div className="profile-popover">
                <div className="profile-popover-head">
                  <strong>{displayName}</strong>
                  <small>{accountEmail}</small>
                </div>
                <button type="button" onClick={() => { setProfileMenuOpen(false); navigate('ajustes'); }}>
                  <Settings size={16} /> Configuración
                </button>
                <button type="button" onClick={() => { setProfileMenuOpen(false); navigate('planes'); }}>
                  <Coins size={16} /> Planes y créditos
                </button>
                <button type="button" className="logout-action" onClick={handleLogout}>
                  <LogOut size={16} /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="content-area" aria-label={activeLabel}>
          {view === 'especial' && (
            <div className="special-content-heading view-stack">
              <PageHeading eyebrow="ESTUDIO CREATIVO" title="Contenido" description="Crea imágenes y genera videos en un solo lugar." note="Imagina · Crea · Comparte" />
              <div className="special-content-modes" role="group" aria-label="Tipo de contenido">
                {['Crear imagen', 'Generar video'].map((mode) => (
                  <Button key={mode} type="button" variant={specialMode === mode ? 'default' : 'outline'} aria-pressed={specialMode === mode} onClick={() => setSpecialMode(mode)}>
                    {mode === 'Crear imagen' ? <ImageIcon size={18} /> : <Video size={18} />}{mode}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {view === 'crear' && (
            <CreateView
              avatarImage={characters.find((character) => character.name === selectedAvatar)?.resultImage}
              prompt={prompt}
              setPrompt={setPrompt}
              style={style}
              setStyle={setStyle}
              ratio={ratio}
              setRatio={setRatio}
              quality={quality}
              setQuality={setQuality}
              imageCount={imageCount}
              setImageCount={setImageCount}
              model={model}
              isGenerating={isGenerating}
              onGenerate={handleGenerate}
              results={results}
              credits={credits}
              favorite={favorite}
              setFavorite={setFavorite}
              onToggleFavorite={toggleFavorite}
              onNavigate={navigate}
              onNotify={notify}
              selectedAvatar={selectedAvatar}
              resultSource={resultSource}
              referenceImage={referenceImage}
              onReferenceImageChange={setReferenceImage}
            />
          )}
          {view === 'especial' && specialMode === 'Crear imagen' && (
            <CreateView
              hideHeading
              prompt={specialPrompt}
              setPrompt={setSpecialPrompt}
              style={specialStyle}
              setStyle={setSpecialStyle}
              ratio={specialRatio}
              setRatio={setSpecialRatio}
              quality={specialQuality}
              setQuality={setSpecialQuality}
              imageCount={specialImageCount}
              setImageCount={setSpecialImageCount}
              model={specialImageModel}
              isGenerating={specialIsGenerating}
              onGenerate={handleGenerateSpecial}
              results={specialResults}
              credits={credits}
              favorite={specialFavorite}
              setFavorite={setSpecialFavorite}
              onToggleFavorite={toggleFavorite}
              onNavigate={navigate}
              onNotify={notify}
              selectedAvatar={selectedAvatar}
              resultSource={specialResultSource}
              referenceImage={specialReferenceImage}
              onReferenceImageChange={setSpecialReferenceImage}
            />
          )}
          {view === 'inicio' && <DashboardView onNavigate={navigate} credits={credits} />}
          {view === 'creaciones' && <CreacionesView credits={credits} onCreated={saveCharacter} onNotify={notify} />}
          {view === 'avatares' && (
            <AvatarsView
              onNavigate={navigate}
              plan={plan}
              onNotify={notify}
              selectedAvatar={selectedAvatar}
              onSelectAvatar={setSelectedAvatar}
              characters={characters}
              onCreateCharacter={() => setShowOnboarding(true)}
            />
          )}
          <div hidden={view !== 'video'}><VideoView credits={credits} onSpendCredits={spendCredits} onNotify={notify} provider="kling" /></div>
          <div hidden={view !== 'especial' || specialMode !== 'Generar video'}><VideoView hideHeading credits={credits} onSpendCredits={spendCredits} onNotify={notify} provider="a2e" /></div>
          {view === 'biblioteca' && <LibraryView images={[...uploadedImages, ...results]} search={search} favorites={favorites} onToggleFavorite={toggleFavorite} onUpload={handleUpload} />}
          {view === 'planes' && <PlansView currentPlan={plan} onSelectPlan={selectPlan} onTopUp={() => { setCredits((current) => current + 700); notify('Se añadieron 700 créditos (recarga de US$9.90).'); }} />}
          {view === 'ajustes' && (
            <SettingsView
              onNotify={notify}
              profileName={displayName}
              accountEmail={accountEmail}
              onProfileNameChange={setProfileName}
              onLogout={handleLogout}
            />
          )}
        </main>
      </div>
      {notice && <div className="app-notice" role="status"><Check size={18} /> {notice}</div>}
      {showOnboarding && (
        <CharacterOnboarding
          credits={credits}
          onSpendCredits={spendCredits}
          onCreated={saveCharacter}
          onSkip={completeOnboarding}
        />
      )}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20c11.045 0 20-8.955 20-20 0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4c-7.682 0-14.344 4.337-17.694 10.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C39.203 36.971 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Single fixed account for the demo — no backend/user database yet.
const ACCOUNT_EMAIL = 'admin@creatorsacademy.pro';
const ACCOUNT_PASSWORD = 'Creators2026!';

function LoginView({ onLogin, onNotify }: { onLogin: (email: string) => void; onNotify: (message: string) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const rememberedEmail = window.localStorage.getItem('remembered-email');
    if (rememberedEmail) {
      setEmail(rememberedEmail);
      setRemember(true);
    }
  }, []);

  function persistRememberedEmail(currentEmail: string) {
    if (remember) {
      window.localStorage.setItem('remembered-email', currentEmail);
    } else {
      window.localStorage.removeItem('remembered-email');
    }
  }

  function switchMode(next: 'login' | 'signup') {
    setMode(next);
    setError('');
    setPassword('');
    setConfirmPassword('');
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();

    if (mode === 'signup' && !name.trim()) {
      setError('Ingresa tu nombre para continuar.');
      return;
    }
    if (!cleanEmail || !password) {
      setError('Ingresa tu correo y contraseña para continuar.');
      return;
    }
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      setError('Escribe un correo electrónico válido, por ejemplo nombre@correo.com');
      return;
    }
    if (password.length < 6) {
      setError('Tu contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const users = loadUsers();

      if (mode === 'signup') {
        if (users[cleanEmail]) {
          setError('Ya existe una cuenta con ese correo. Inicia sesión.');
          return;
        }
        if (password !== confirmPassword) {
          setError('Las contraseñas no coinciden.');
          return;
        }
        users[cleanEmail] = { name: name.trim(), passwordHash: await hashPassword(password) };
        saveUsers(users);
        persistRememberedEmail(cleanEmail);
        onLogin(cleanEmail);
        return;
      }

      const user = users[cleanEmail];
      const passwordHash = await hashPassword(password);
      if (!user || user.passwordHash !== passwordHash) {
        setError('Correo o contraseña incorrectos.');
        return;
      }
      persistRememberedEmail(cleanEmail);
      onLogin(cleanEmail);
    } finally {
      setSubmitting(false);
    }
  }

  function handleGoogleLogin() {
    onNotify('El acceso con Google aún no está disponible. Inicia sesión con tu correo electrónico.');
  }

  function comingSoon(label: string) {
    onNotify(`${label} estará disponible próximamente.`);
  }

  return (
    <div className="auth-page">
      <header className="auth-topbar">
        <div className="auth-logo">
          <img src="/assets/ad-creators-academy-logo.png" alt="Creators Academy Pro" />
        </div>
        <nav className="auth-nav" aria-label="Navegación">
          <button type="button" onClick={() => onNotify('Ya estás en el inicio.')}>Inicio</button>
          <button type="button" onClick={() => comingSoon('Precios')}>Precios</button>
          <button type="button" onClick={() => comingSoon('El blog')}>Blog</button>
          <button type="button" className="auth-nav-cta" onClick={() => switchMode('signup')}>Crear cuenta</button>
        </nav>
      </header>

      <div className="auth-body">
        <section className="auth-hero">
          <img src="/assets/creator-wide.png" alt="Creadora de contenido trabajando en su estudio" />
          <div className="auth-hero-overlay" aria-hidden="true" />
          <span className="auth-hero-tag"><Heart size={12} fill="currentColor" /> Create a better you</span>
          <div className="auth-hero-copy">
            <h1>Crea avatares realistas con IA<span>y lleva tu contenido al siguiente nivel</span></h1>
            <p>Personajes consistentes, imágenes y videos listos para usar en tus proyectos, redes sociales o marca personal.</p>
            <div className="auth-feature-row">
              <div><span><Users size={20} /></span><small>Avatares realistas</small></div>
              <div><span><ImageIcon size={20} /></span><small>Imágenes y videos</small></div>
              <div><span><Coins size={20} /></span><small>Sin suscripciones complicadas</small></div>
            </div>
          </div>
        </section>

        <section className="auth-card-wrap">
          <form className="auth-card" onSubmit={handleSubmit}>
            <h2>{mode === 'signup' ? 'Crea tu cuenta' : 'Bienvenido de nuevo'}</h2>
            <p>{mode === 'signup' ? 'Regístrate para empezar a crear con IA sin límites.' : 'Inicia sesión para continuar y seguir creando sin límites.'}</p>

            <button type="button" className="oauth-button" onClick={handleGoogleLogin}>
              <GoogleIcon /> Continuar con Google
            </button>

            <div className="auth-divider"><span>{mode === 'signup' ? 'o regístrate con tu correo' : 'o inicia sesión con tu correo'}</span></div>

            {mode === 'signup' && (
              <label className="auth-field">
                <Users size={17} />
                <input
                  type="text"
                  placeholder="Nombre completo"
                  value={name}
                  onChange={(event) => { setName(event.target.value); setError(''); }}
                  autoComplete="name"
                />
              </label>
            )}
            <label className="auth-field">
              <Mail size={17} />
              <input
                type="email"
                placeholder="Correo electrónico"
                value={email}
                onChange={(event) => { setEmail(event.target.value); setError(''); }}
                autoComplete="email"
              />
            </label>
            <label className="auth-field">
              <Lock size={17} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Contraseña"
                value={password}
                onChange={(event) => { setPassword(event.target.value); setError(''); }}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                className="eye-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </label>
            {mode === 'signup' && (
              <label className="auth-field">
                <Lock size={17} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Confirmar contraseña"
                  value={confirmPassword}
                  onChange={(event) => { setConfirmPassword(event.target.value); setError(''); }}
                  autoComplete="new-password"
                />
              </label>
            )}

            {error && <p className="auth-error" role="alert">{error}</p>}

            <div className="auth-row">
              <label className="auth-checkbox">
                <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
                Recordarme
              </label>
              {mode === 'login' && (
                <button type="button" onClick={() => onNotify('Revisa tu correo para restablecer tu contraseña (modo demostración).')}>
                  ¿Olvidaste tu contraseña?
                </button>
              )}
            </div>

            <Button type="submit" className="auth-submit" disabled={submitting}>
              {submitting ? <LoaderCircle className="spin" size={18} /> : <>{mode === 'signup' ? 'Crear cuenta' : 'Iniciar sesión'} <ArrowRight size={18} /></>}
            </Button>

            <p className="auth-switch">
              {mode === 'signup' ? (
                <>¿Ya tienes cuenta?{' '}<button type="button" onClick={() => switchMode('login')}>Iniciar sesión</button></>
              ) : (
                <>¿No tienes cuenta?{' '}<button type="button" onClick={() => switchMode('signup')}>Crear cuenta</button></>
              )}
            </p>
          </form>
        </section>
      </div>

      <footer className="auth-footer">
        <div className="auth-logo">
          <img src="/assets/ad-creators-academy-logo.png" alt="Creators Academy Pro" />
        </div>
        <div className="auth-footer-links">
          <button type="button" onClick={() => comingSoon('Términos y Condiciones')}>Términos y Condiciones</button>
          <button type="button" onClick={() => comingSoon('La política de privacidad')}>Política de Privacidad</button>
          <button type="button" onClick={() => onNotify('Escríbenos a hola@creatorsacademy.pro')}>Contacto</button>
        </div>
        <div className="auth-social">
          <button type="button" aria-label="Instagram" onClick={() => comingSoon('Nuestro Instagram')}><Camera size={16} /></button>
          <button type="button" aria-label="TikTok" onClick={() => comingSoon('Nuestro TikTok')}><Music2 size={16} /></button>
          <button type="button" aria-label="YouTube" onClick={() => comingSoon('Nuestro YouTube')}><Play size={16} /></button>
        </div>
      </footer>
    </div>
  );
}

function Sidebar({
  view,
  open,
  onClose,
  onNavigate,
}: {
  view: View;
  open: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
}) {
  return (
    <>
      {open && <button className="nav-backdrop" onClick={onClose} aria-label="Cerrar menú" />}
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="brand-row">
          <img
            className="brand-logo"
            src="/assets/ad-creators-academy-logo.png"
            alt="AD Creators Academy"
          />
          <button className="close-nav" type="button" onClick={onClose} aria-label="Cerrar menú">
            <X size={21} />
          </button>
        </div>

        <nav className="primary-nav" aria-label="Navegación principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                className={view === item.id ? 'active' : ''}
                onClick={() => onNavigate(item.id)}
              >
                <Icon size={22} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="upgrade-card">
          <div className="crown">✦</div>
          <strong>Desbloquea Creator Pro</strong>
          <p>Más créditos, calidad superior y uso comercial.</p>
          <Button type="button" onClick={() => onNavigate('planes')}>Ver planes</Button>
        </div>
      </aside>
    </>
  );
}

type CreateViewProps = {
  prompt: string;
  setPrompt: (value: string) => void;
  style: string;
  setStyle: (value: string) => void;
  ratio: string;
  setRatio: (value: string) => void;
  quality: string;
  setQuality: (value: string) => void;
  imageCount: string;
  setImageCount: (value: string) => void;
  model: string;
  setModel?: (value: string) => void;
  showModelPicker?: boolean;

  isGenerating: boolean;
  onGenerate: () => void;
  results: string[];
  credits: number;
  favorite: boolean;
  setFavorite: (value: boolean) => void;
  onToggleFavorite: (image: string) => void;
  onNavigate: (view: View) => void;
  onNotify: (message: string) => void;
  selectedAvatar: string;
  resultSource: 'demo' | 'live';
  referenceImage: { name: string; dataUrl: string } | null;
  onReferenceImageChange: (value: { name: string; dataUrl: string } | null) => void;
};

const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;

const RATIO_OPTIONS: Array<{ value: string; label: string; width: number; height: number }> = [
  { value: '1:1', label: '1:1', width: 16, height: 16 },
  { value: '3:4', label: '3:4', width: 14, height: 17 },
  { value: '9:16', label: '9:16', width: 11, height: 19 },
  { value: '16:9', label: '16:9', width: 19, height: 11 },
];

function RatioIcon({ width, height }: { width: number; height: number }) {
  return (
    <svg width="22" height="20" viewBox="0 0 22 20" aria-hidden="true">
      <rect
        x={(22 - width) / 2}
        y={(20 - height) / 2}
        width={width}
        height={height}
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

function RatioField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <div className="field-block">
      <span className="field-label">Formato</span>
      <div className="ratio-picker" role="radiogroup" aria-label="Formato de imagen">
        {RATIO_OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`ratio-chip ${selected ? 'is-selected' : ''}`}
              disabled={disabled}
              onClick={() => onChange(option.value)}
            >
              <RatioIcon width={option.width} height={option.height} />
              <small>{option.label}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SegmentedField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return (
    <div className="field-block">
      <span className="field-label">{label}</span>
      <div className="segmented-control" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`segmented-option ${selected ? 'is-selected' : ''}`}
              onClick={() => onChange(option)}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CreateView(props: CreateViewProps & { hideHeading?: boolean; avatarImage?: string }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const referenceInput = useRef<HTMLInputElement>(null);
  const currentImage = props.results[currentIndex] ?? props.results[0] ?? media[0];
  const avatarImage = props.avatarImage ?? (props.selectedAvatar === 'Lua Beach' ? media[2] : props.selectedAvatar === 'Lua Studio' ? media[3] : media[1]);

  useEffect(() => setCurrentIndex(0), [props.results]);
  return (
    <div className="view-stack create-view">
      {!props.hideHeading && <PageHeading
        eyebrow="ESTUDIO DE IMAGEN"
        title="Crear imagen con IA"
        description="Describe tu idea, elige el estilo y genera una colección lista para usar."
        note="Imagina · Crea · Comparte"
      />}

      <div className="workspace-grid">
        <section className="creator-panel" aria-label="Configuración de imagen">
          <Step title="Selecciona tu avatar" number="1">
            <button className="avatar-selector" type="button" onClick={() => props.onNavigate('avatares')}>
              <img src={avatarImage} alt={`Avatar ${props.selectedAvatar}`} />
              <span className="avatar-selector-copy">
                <strong>{props.selectedAvatar}</strong>
                <small>Avatar principal</small>
              </span>
              <span className="free-pill">Free</span>
              <ChevronDown size={18} />
            </button>
          </Step>

          <Step title="Escribe tu prompt" number="2">
            <div className="prompt-head">
              <span>Prompt</span>
              <button
                type="button"
                onClick={() => props.setPrompt('Retrato editorial de una creadora digital en un estudio moderno, luz cálida con neón violeta, mirada natural, fotografía cinematográfica.')}
              >
                <Sparkles size={16} /> Mejorar idea
              </button>
            </div>
            <Textarea
              value={props.prompt}
              onChange={(event) => props.setPrompt(event.target.value)}
              className="prompt-input"
              maxLength={1000}
              aria-label="Descripción de la imagen"
            />
            {props.referenceImage && (
              <div className="reference-preview">
                <img src={props.referenceImage.dataUrl} alt="Imagen de referencia" />
                <div className="reference-preview-copy">
                  <strong>{props.referenceImage.name}</strong>
                  <small>La IA editará esta imagen según tu prompt</small>
                </div>
                <button
                  type="button"
                  className="reference-remove"
                  aria-label="Quitar imagen de referencia"
                  onClick={() => props.onReferenceImageChange(null)}
                >
                  <X size={15} />
                </button>
              </div>
            )}
            <div className="prompt-meta">
              <button type="button" className="reference-button" onClick={() => referenceInput.current?.click()}>
                <Upload size={16} /> {props.referenceImage ? 'Cambiar referencia' : 'Añadir referencia'}
              </button>
              <input
                ref={referenceInput}
                className="visually-hidden"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { props.onNotify('Usa imágenes JPG, PNG o WebP.'); return; }
    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
                    props.onNotify('La imagen de referencia debe pesar menos de 5 MB.');
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === 'string') {
                      props.onReferenceImageChange({ name: file.name, dataUrl: reader.result });
                      props.onNotify('Imagen de referencia añadida. Se usará para editar el resultado.');
                    }
                  };
                  reader.readAsDataURL(file);
                }}
              />
              <span>{props.prompt.length}/1000</span>
            </div>
          </Step>

          <Step title="Ajustes de imagen" number="3">
            <div className="settings-grid">
              <SelectField label="Estilo" value={props.style} onChange={props.setStyle} options={['Realista', 'Editorial', 'Cinematográfico', 'Ilustración']} />
              <SegmentedField label="Calidad" value={props.quality} onChange={props.setQuality} options={['Estándar', 'Alta', 'Ultra']} />
            </div>
            <div className="settings-grid">
              <RatioField value={props.ratio} onChange={props.setRatio} />
              <SegmentedField label="Cantidad" value={props.imageCount} onChange={props.setImageCount} options={['1', '2', '4']} />
            </div>
            {props.referenceImage && <p className="reference-note">Usaremos tu referencia para conservar la apariencia del personaje.</p>}
          </Step>

          <div className="generation-summary">
            <div>
              <span>Listo para generar</span>
              <small>
                {props.referenceImage
                  ? 'Editando tu imagen de referencia con IA'
                  : props.resultSource === 'live'
                    ? 'Crea una nueva imagen con tus ajustes'
                    : 'Elige tus ajustes y genera tu primera imagen'}
              </small>
            </div>
            <span className="estimated-cost"><Coins size={16} /> {Number(props.imageCount) * IMAGE_CREDIT_COST} créditos</span>
          </div>

          <Button
            className="generate-button"
            size="lg"
            disabled={!props.prompt.trim() || props.isGenerating || props.credits < Number(props.imageCount) * IMAGE_CREDIT_COST}
            onClick={props.onGenerate}
          >
            {props.isGenerating ? (
              <><LoaderCircle className="spin" /> Creando tu colección...</>
            ) : (
              <><WandSparkles /> Generar imágenes</>
            )}
          </Button>
        </section>

        <section className="result-panel" aria-label="Resultado">
          <div className="section-title-row">
            <div><span className="tiny-label">VISTA PREVIA</span><h2>Tu resultado</h2></div>
            <span className={`demo-badge ${props.resultSource === 'live' ? 'live-badge' : ''}`}>{props.resultSource === 'live' ? 'IA' : 'Demo'}</span>
          </div>
          <div className="main-result">
            <img src={currentImage} alt="Resultado de imagen generado" />
            <a href={currentImage} download className="download-button" onClick={() => props.onNotify('Descarga iniciada.')}><Download size={17} /> Descargar</a>
            {props.isGenerating && (
              <div className="generating-overlay">
                <LoaderCircle className="spin" size={30} />
                <strong>Interpretando tu idea</strong>
                <span>Preparando luz, encuadre y estilo...</span>
              </div>
            )}
          </div>
          <div className="result-actions">
            <Button variant="secondary" type="button" onClick={props.onGenerate}><Sparkles /> Variaciones</Button>
            <Button variant="secondary" type="button" onClick={() => { props.setPrompt(`${props.prompt} Ajustar encuadre y detalles del resultado seleccionado.`); props.onNotify('El resultado quedó preparado para editar mediante el prompt.'); }}><Palette /> Editar</Button>
            <Button
              variant="secondary"
              type="button"
              className={props.favorite ? 'is-favorite' : ''}
              onClick={() => {
                props.setFavorite(!props.favorite);
                props.onToggleFavorite(currentImage);
                props.onNotify(props.favorite ? 'Imagen eliminada de favoritos.' : 'Imagen guardada en favoritos.');
              }}
            >
              <Heart fill={props.favorite ? 'currentColor' : 'none'} /> {props.favorite ? 'Guardada' : 'Guardar'}
            </Button>
          </div>
          <div className="recent-block">
            <div className="section-title-row compact"><h3>Variaciones</h3><span>{props.results.length} imágenes</span></div>
            <div className="variation-grid">
              {props.results.map((image, index) => (
                <button key={`${image}-${index}`} type="button" className={index === currentIndex ? 'selected' : ''} onClick={() => setCurrentIndex(index)}>
                  <img src={image} alt={`Variación ${index + 1}`} />
                  {index === currentIndex && <span><Check size={14} /> Actual</span>}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Step({ title, number, children }: { title: string; number: string; children: React.ReactNode }) {
  return <div className="step-block"><div className="step-title"><span>{number}</span><h2>{title}</h2></div><div className="step-content">{children}</div></div>;
}

function SelectField({ label, value, onChange, options, suffix = '', disabled = false }: { label: string; value: string; onChange: (value: string) => void; options: string[]; suffix?: string; disabled?: boolean }) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <Select value={value} onValueChange={(next) => next && onChange(next)} disabled={disabled}>
        <SelectTrigger><SelectValue>{value}{suffix}</SelectValue></SelectTrigger>
        <SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}{suffix}</SelectItem>)}</SelectContent>
      </Select>
    </label>
  );
}

function PageHeading({ eyebrow, title, description, note }: { eyebrow: string; title: string; description: string; note?: string }) {
  return (
    <header className="page-heading">
      <div className="page-heading-copy">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {note && (
        <div className="heading-visual" aria-hidden="true">
          <span className="hand-note">{note}</span>
          <div className="heading-banner">
            <img src="/assets/creator-wide.png" alt="" />
            <span>Crea sin límites ♡</span>
          </div>
        </div>
      )}
    </header>
  );
}

function DashboardView({ onNavigate, credits }: { onNavigate: (view: View) => void; credits: number }) {
  return (
    <div className="view-stack">
      <section className="welcome-hero">
        <img src="/assets/creator-wide.png" alt="Creadora en su estudio" />
        <div className="welcome-copy"><span className="eyebrow light">TU ESTUDIO CREATIVO</span><h1>Hola, Lalo <span>👋</span></h1><p>Convierte una idea en contenido listo para publicar.</p><Button type="button" onClick={() => onNavigate('crear')}><WandSparkles /> Crear una imagen</Button></div>
      </section>
      <div className="quick-grid">
        <QuickCard icon={WandSparkles} title="Crear imagen" copy="Empieza desde un prompt" tone="violet" onClick={() => onNavigate('crear')} />
        <QuickCard icon={Library} title="Tu biblioteca" copy="Organiza tus resultados" tone="blue" onClick={() => onNavigate('biblioteca')} />
        <QuickCard icon={Coins} title={`${credits} créditos`} copy="Revisa tu consumo" tone="mint" onClick={() => onNavigate('planes')} />
      </div>
      <section className="home-gallery">
        <div className="section-title-row"><div><span className="tiny-label">RECIENTES</span><h2>Tu universo visual</h2></div><button type="button" onClick={() => onNavigate('biblioteca')}>Ver biblioteca →</button></div>
        <div className="gallery-grid home">{media.map((image, index) => <figure key={image}><img src={image} alt={`Creación reciente ${index + 1}`} /><figcaption>{['Estudio creativo', 'Retrato vertical', 'Luz editorial', 'Momento casual'][index]}</figcaption></figure>)}</div>
      </section>
    </div>
  );
}

function QuickCard({ icon: Icon, title, copy, tone, onClick }: { icon: typeof Home; title: string; copy: string; tone: string; onClick: () => void }) {
  return <button className={`quick-card ${tone}`} type="button" onClick={onClick}><span><Icon size={24} /></span><div><strong>{title}</strong><small>{copy}</small></div><span className="quick-arrow">→</span></button>;
}

function CreacionesView({ credits, onCreated, onNotify }: { credits: number; onCreated: (character: Character) => void; onNotify: (message: string) => void }) {
  const [name, setName] = useState('Lua');
  const [description, setDescription] = useState('Joven latina, extrovertida, trabaja creando contenido para redes. Mantener rostro, cabello, cuerpo y detalles de identidad.');
  const [references, setReferences] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Character | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const primaryPreview = references[0]?.dataUrl ?? media[1];
  const exampleImages = [primaryPreview, ...media, ...references.map((reference) => reference.dataUrl)].slice(0, 7);

  function addFiles(files: File[]) {
    if (!files.length) return;
    if (references.length + files.length > 10) {
      setError('Puedes subir máximo 10 imágenes de referencia.');
      return;
    }
    files.forEach((file) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        setError('Usa imágenes JPG, PNG o WebP.');
        return;
      }
      if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
        setError('Cada imagen debe pesar menos de 5 MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setReferences((current) => [...current, { name: file.name, dataUrl: reader.result as string }].slice(0, 10));
          setError('');
          setSaved(null);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  async function createAvatar() {
    if (creating) return;
    if (references.length < 5) { setError('Sube mínimo 5 imágenes del mismo avatar para que Soul pueda mantener la identidad.'); return; }
    if (!name.trim()) { setError('Ponle un nombre a tu avatar.'); return; }
    if (credits < IMAGE_CREDIT_COST) { setError('No tienes créditos suficientes para preparar este avatar.'); return; }
    setCreating(true);
    setError('');
    try {
      const urls: string[] = [];
      for (const image of references) {
        const upload = await fetch('/api/upload-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: image.dataUrl, purpose: 'avatar' }) });
        const uploaded = await upload.json() as { url?: string; error?: string };
        if (!upload.ok || !uploaded.url) throw new Error(uploaded.error ?? 'No se pudo subir una referencia.');
        urls.push(uploaded.url);
      }
      const create = await fetch('/api/soul-character', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), references: urls }) });
      const created = await create.json() as { id?: string; status?: string; error?: string };
      if (!create.ok || !created.id) throw new Error(created.error ?? 'Soul no pudo crear el avatar.');

      let ready = created.status === 'completed';
      for (let attempt = 0; attempt < 80 && !ready; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const response = await fetch(`/api/soul-character?id=${encodeURIComponent(created.id)}`);
        const data = await response.json() as { status?: string; error?: string };
        if (!response.ok || data.status === 'failed') throw new Error(data.error ?? 'Soul no pudo preparar el avatar.');
        ready = data.status === 'completed';
      }
      if (!ready) throw new Error('Soul sigue preparando el avatar. Inténtalo otra vez en unos minutos sin cambiar las fotos.');

      const character: Character = {
        id: crypto.randomUUID(),
        name: name.trim(),
        description,
        referenceImage: urls[0],
        resultImage: primaryPreview,
        references: urls,
        soulId: created.id,
      };
      setSaved(character);
      onCreated(character);
      onNotify(`Avatar "${character.name}" guardado con Soul.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el avatar. Inténtalo nuevamente.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="creaciones-view view-stack">
      <section className="creaciones-hero">
        <div>
          <span className="eyebrow light">CREACIONES</span>
          <h1>Mi Avatar</h1>
          <p>Sube imágenes de referencia para crear avatares propios con Soul y mantener la misma identidad en tus próximas imágenes.</p>
        </div>
        <Button type="button" onClick={createAvatar} disabled={creating || references.length < 5}>
          {creating ? <LoaderCircle className="spin" size={18} /> : <FolderHeart size={18} />} Guardar Avatar
        </Button>
      </section>

      <section className="creaciones-grid">
        <article className="avatar-profile-card">
          <div className="avatar-profile-image"><img src={primaryPreview} alt="Vista previa del avatar" /></div>
          <label>Nombre del avatar<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} /></label>
          <label>Descripción<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={600} /></label>
          <div className="avatar-profile-meta"><span>Formato base: 3:4</span><span>Referencias: {references.length}/10</span></div>
        </article>

        <article className="reference-studio-card">
          <div className="reference-title-row"><div><h2>Imágenes de Referencia</h2><p>Sube de 5 a 10 fotos desde diferentes ángulos. Frente, perfil y cuerpo completo dan mejores resultados.</p></div><span>{references.length}/10</span></div>
          <div className="reference-mosaic">
            {Array.from({ length: 8 }).map((_, index) => {
              const image = references[index];
              return image ? (
                <button type="button" key={`${image.name}-${index}`} onClick={() => setReferences((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Quitar referencia ${index + 1}`}>
                  <img src={image.dataUrl} alt={`Referencia ${index + 1}`} /><span><X size={13} /></span>
                </button>
              ) : <div key={`empty-${index}`} className="reference-empty"><ImageIcon size={20} /></div>;
            })}
          </div>
          <button type="button" className="reference-dropzone" onClick={() => inputRef.current?.click()} disabled={references.length >= 10}>
            <Upload size={28} /><strong>Subir más imágenes</strong><small>JPG, PNG o WebP · máximo 5 MB cada una</small>
          </button>
          <input ref={inputRef} className="visually-hidden" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; addFiles(files); }} />
        </article>

        <aside className="avatar-save-rail">
          <Button type="button" onClick={createAvatar} disabled={creating || references.length < 5}>
            {creating ? <LoaderCircle className="spin" size={18} /> : <Check size={18} />} {creating ? 'Creando avatar' : 'Guardar Avatar'}
          </Button>
          <div className={`avatar-status-card ${saved ? 'is-saved' : ''}`}>
            <Check size={28} />
            <strong>{saved ? 'Avatar guardado' : 'Listo para guardar'}</strong>
            <p>{saved ? 'Estas imágenes serán usadas por Soul para mantener la misma identidad.' : 'Completa mínimo 5 referencias y guarda el avatar para usarlo en Crear Imagen.'}</p>
          </div>
          <div className="avatar-advice-card">
            <Sparkles size={26} />
            <strong>Consejos</strong>
            <ul><li>Incluye fotos de frente, perfil y cuerpo completo.</li><li>Usa buena iluminación.</li><li>Muestra diferentes ángulos y expresiones.</li><li>No mezcles personas distintas.</li></ul>
          </div>
          {error && <p className="avatar-create-error">{error}</p>}
        </aside>
      </section>

      <section className="soul-flow-card">
        <div className="section-title-row"><div><h2>¿Cómo funciona Soul?</h2><p>Soul analiza tus referencias y crea un perfil visual interno para generar nuevas imágenes con la misma identidad.</p></div></div>
        <div className="soul-flow-grid">
          {[
            ['1', 'Tú subes las imágenes', 'Referencias reales del mismo avatar.'],
            ['2', 'Soul analiza tu avatar', 'Rostro, cabello, cuerpo y detalles.'],
            ['3', 'Crea un perfil visual', 'Una identidad interna reutilizable.'],
            ['4', 'Tú pones el prompt', 'Defines lugar, pose y estilo.'],
            ['5', 'Resultado consistente', 'Nueva imagen con el mismo avatar.'],
          ].map((item, index) => <div className="soul-step" key={item[0]}><span>{item[0]}</span><img src={exampleImages[index] ?? media[1]} alt="Ejemplo Soul" /><strong>{item[1]}</strong><p>{item[2]}</p></div>)}
        </div>
      </section>

      <section className="avatar-examples-strip">
        <h2>Ejemplos de resultados con el mismo avatar</h2>
        <div>{exampleImages.map((image, index) => <img key={`${image}-${index}`} src={image} alt={`Ejemplo ${index + 1}`} />)}</div>
      </section>
    </div>
  );
}



function CharacterOnboarding({ credits, onSpendCredits, onCreated, onSkip }: {
  credits: number;
  onSpendCredits: (amount: number, message: string) => boolean;
  onCreated: (character: Character) => void;
  onSkip: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [reference, setReference] = useState<{ name: string; dataUrl: string } | null>(null);
  const [references, setReferences] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [soulId, setSoulId] = useState('');
  const [savedReferences, setSavedReferences] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [avatarRatio, setAvatarRatio] = useState('3:4');

  const [name, setName] = useState('Mi personaje');
  const [prompt, setPrompt] = useState('Misma persona, en una cafetería, usando un vestido negro, mirando a la cámara, estilo fotografía profesional.');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [resultImage, setResultImage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFile(file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Usa imágenes JPG, PNG o WebP.'); return; }
    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
      setError('La imagen debe pesar menos de 5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setReference({ name: file.name, dataUrl: reader.result });
        const dataUrl = reader.result;
        setReferences((current) => [...current, { name: file.name, dataUrl }].slice(0, 10));
        setError('');
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleGenerate() {
    if (!reference || references.length < 5 || generating) return;
    const cost = IMAGE_CREDIT_COST;
    if (credits < cost) {
      setError('No tienes créditos suficientes para crear tu personaje.');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      let identity = soulId;
      if (!identity) {
        const urls: string[] = [];
        for (const image of references) {
          const upload = await fetch('/api/upload-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: image.dataUrl, purpose: 'avatar' }) });
          const uploaded = await upload.json() as { url?: string; error?: string };
          if (!upload.ok || !uploaded.url) throw new Error(uploaded.error ?? 'No se pudo subir una referencia.');
          urls.push(uploaded.url);
        }
        setSavedReferences(urls);
        const create = await fetch('/api/soul-character', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, references: urls }) });
        const created = await create.json() as { id?: string; error?: string };
        if (!create.ok || !created.id) throw new Error(created.error ?? 'No se pudo crear la identidad.');
        identity = created.id;
        setSoulId(identity);
      }
      let ready = false;
      for (let attempt = 0; attempt < 120; attempt++) {
        const response = await fetch(`/api/soul-character?id=${encodeURIComponent(identity)}`);
        const data = await response.json() as { status?: string; error?: string };
        if (!response.ok || data.status === 'failed') throw new Error(data.error ?? 'No se pudo preparar el avatar.');
        if (data.status === 'completed') { ready = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      if (!ready) throw new Error('Seguimos preparando tu avatar. Pulsa Reintentar para consultar la misma identidad.');
      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `${description}. ${prompt}`,
          style: 'Realista',
          aspectRatio: avatarRatio,
          quality: 'Alta',
          count: 1,
          model: 'higgsfield',
          soulId: identity,
        }),
      });
      const data = (await response.json().catch(() => null)) as { images?: string[]; error?: string } | null;
      if (!response.ok || !data?.images?.length) {
        throw new Error(data?.error ?? 'No se pudo crear tu personaje. Inténtalo de nuevo.');
      }
      onSpendCredits(cost, '');
      setResultImage(data.images[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear tu personaje. Inténtalo de nuevo.');
    } finally {
      setGenerating(false);
    }
  }

  function handleSave() {
    if (!reference || !resultImage) return;
    onCreated({ id: crypto.randomUUID(), name: name.trim() || 'Mi personaje', referenceImage: savedReferences[0], resultImage, soulId, description, references: savedReferences });
  }

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true" aria-label="Crear tu personaje con IA">
      <div className="onboarding-card">
        <button type="button" className="onboarding-close" aria-label="Omitir por ahora" onClick={onSkip}><X size={18} /></button>
        <div className="onboarding-steps">
          {[1, 3, 4].map((n) => <span key={n} className={`onboarding-dot ${step >= n ? 'is-done' : ''}`} />)}
        </div>

        {step === 1 && (
          <div className="onboarding-step">
            <span className="onboarding-eyebrow">PASO 1</span>
            <h2>Crea tu avatar desde cero</h2>
            <p>Sube entre 5 y 10 fotos del mismo personaje: rostro de frente, perfiles y cuerpo. Usaremos estas referencias para preparar su identidad.</p>
            <div className="avatar-reference-grid">{references.map((image, index) => <div key={`${image.name}-${index}`}><img src={image.dataUrl} alt={`Referencia ${index + 1}`} /><button type="button" aria-label={`Quitar referencia ${index + 1}`} onClick={() => setReferences((current) => current.filter((_, i) => i !== index))}><X size={14} /></button></div>)}</div>
            <p>{references.length}/10 referencias · mínimo 5</p>
            <Button type="button" variant="secondary" disabled={references.length >= 10} onClick={() => fileInputRef.current?.click()}><Upload size={16} /> Añadir referencias</Button>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              multiple
              accept="image/*"
              onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length + references.length > 10) { setError('Puedes subir como máximo 10 referencias.'); return; } files.forEach(handleFile); }}
            />
            {error && <p className="onboarding-error">{error}</p>}
            <div className="onboarding-actions">
              <button type="button" className="link-button" onClick={onSkip}>Omitir por ahora</button>
              <Button type="button" disabled={references.length < 5} onClick={() => setStep(3)}>Continuar <ArrowRight size={16} /></Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="onboarding-step">
            <span className="onboarding-eyebrow">PASO 2</span>
            <h2>Describe tu escena</h2>
            <p>Escribe el escenario, pose, outfit o estilo que quieres para tu personaje.</p>
            <label className="onboarding-field">Nombre del personaje
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} />
            </label>
            <label className="onboarding-field">Prompt
              <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={500} />
            </label>
            <label className="onboarding-field">Descripción del avatar<Textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} /></label>
            <SelectField label="Formato" value={avatarRatio} onChange={setAvatarRatio} options={['1:1', '3:4', '9:16', '16:9']} />
            <p>{references.length} referencias para tu avatar</p>
            <div className="onboarding-actions">
              <button type="button" className="link-button" onClick={onSkip}>Omitir por ahora</button>
              <Button type="button" disabled={prompt.trim().length < 3} onClick={() => { setStep(4); handleGenerate(); }}>
                <Sparkles size={16} /> Generar
              </Button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="onboarding-step">
            <span className="onboarding-eyebrow">PASO 3</span>
            <h2>{resultImage ? 'Tu personaje está listo' : 'Generando tu primera imagen'}</h2>
            {!resultImage && !error && <p>Manteniendo la misma identidad en una nueva escena. Puede tardar un momento...</p>}
            <div className="onboarding-result">
              {generating && <LoaderCircle className="spin" size={32} />}
              {resultImage && <img src={resultImage} alt="Personaje generado" />}
            </div>
            {error && <p className="onboarding-error">{error}</p>}
            <div className="onboarding-actions">
              {error ? (
                <>
                  <button type="button" className="link-button" onClick={onSkip}>Omitir por ahora</button>
                  <Button type="button" onClick={handleGenerate}>Reintentar</Button>
                </>
              ) : resultImage ? (
                <Button type="button" onClick={handleSave}><Check size={16} /> Guardar personaje</Button>
              ) : (
                <button type="button" className="link-button" onClick={onSkip}>Omitir por ahora</button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AvatarsView({ onNavigate, plan, onNotify, selectedAvatar, onSelectAvatar, characters, onCreateCharacter }: { onNavigate: (view: View) => void; plan: string; onNotify: (message: string) => void; selectedAvatar: string; onSelectAvatar: (name: string) => void; characters: Character[]; onCreateCharacter: () => void }) {
  const avatars = [
    ...characters.map((character) => ({ name: character.name, detail: character.description || 'Tu personaje', image: character.resultImage, premium: false })),
    { name: 'Lua', detail: 'Principal · Realista', image: media[1], premium: false },
    { name: 'Lua Beach', detail: 'Lifestyle · Verano', image: media[2], premium: true },
    { name: 'Lua Studio', detail: 'Editorial · Interior', image: media[3], premium: true },
  ];

  return (
    <div className="view-stack">
      <PageHeading eyebrow="TUS PERSONAJES" title="Mis Avatares" description="Gestiona y utiliza tus personajes creados con IA." note="Personajes que dan vida a tus ideas" />
      <div className="avatar-page-toolbar">
        <div><strong>Estás en el plan {plan}</strong><span>{plan === 'Free' ? 'Puedes tener 1 avatar activo. Mejora a Pro para desbloquear hasta 3.' : 'Tienes acceso a todos tus avatares.'}</span></div>
        <div className="avatar-page-toolbar-actions">
          <button type="button" className="link-button pro-upgrade-button" onClick={() => onNavigate('planes')}>{plan === 'Free' ? 'Mejorar a Pro' : 'Gestionar plan'}</button>
          <Button type="button" onClick={onCreateCharacter}><Sparkles size={16} /> Crear personaje</Button>
        </div>
      </div>
      {characters.length === 0 && (
        <button type="button" className="avatar-upload-banner" onClick={onCreateCharacter}>
          <span className="avatar-upload-icon"><Upload size={22} /></span>
          <span className="avatar-upload-copy">
            <strong>Sube las fotos de tu personaje</strong>
            <small>No subiste imágenes de referencia al crear tu cuenta. Hazlo ahora para generar contenido con tu identidad.</small>
          </span>
          <span className="avatar-upload-cta">Subir fotos <ArrowRight size={16} /></span>
        </button>
      )}
      <div className="avatar-page-grid">
        {avatars.map((avatar) => (
          <article className={`avatar-card ${selectedAvatar === avatar.name ? 'active-avatar' : ''} ${avatar.premium && plan === 'Free' ? 'locked-avatar' : ''}`} key={avatar.name}>
            <div className="avatar-card-image">
              <img src={avatar.image} alt={avatar.name} />
              <span>{selectedAvatar === avatar.name ? '● Activo' : avatar.premium ? '♛ Pro' : 'Disponible'}</span>
              {avatar.premium && plan === 'Free' && <div className="avatar-lock"><strong>Disponible en Plan Pro</strong><small>Registra hasta 3 avatares</small></div>}
            </div>
            <h2>{avatar.name}</h2>
            <p>{avatar.detail}</p>
            <div className="avatar-reference-grid">{characters.find((character) => character.name === avatar.name)?.references?.map((url, index) => <img key={url} src={url} alt={`Referencia ${index + 1} de ${avatar.name}`} />)}</div>
            <Button type="button" variant={selectedAvatar === avatar.name ? 'default' : 'secondary'} onClick={() => {
              if (avatar.premium && plan === 'Free') {
                onNavigate('planes');
                onNotify('Este avatar requiere un plan de pago.');
                return;
              }
              onSelectAvatar(avatar.name);
              onNotify(`${avatar.name} seleccionado como avatar activo.`);
              onNavigate('crear');
            }}>
              {avatar.premium && plan === 'Free' ? 'Mejorar a Pro' : selectedAvatar === avatar.name ? 'Usar avatar' : 'Seleccionar'}
            </Button>
          </article>
        ))}
      </div>
    </div>
  );
}

// Credit costs — see the "Tabla maestra de créditos" pricing sheet.
const IMAGE_CREDIT_COST = 15;
const VIDEO_CREDIT_COST_BY_DURATION: Record<string, number> = {
  '5 segundos': 120,
  '10 segundos': 240,
  '12 segundos': 288,
};

const VIDEO_DURATION_OPTIONS_BY_PROVIDER: Record<'kling' | 'a2e', string[]> = {
  kling: ['5 segundos', '10 segundos', '12 segundos'],
  a2e: ['5 segundos', '10 segundos'],
};

const VIDEO_POLL_INTERVAL_MS = 5000;
const VIDEO_MAX_POLL_ATTEMPTS = 60; // up to ~5 minutes

const VIDEO_MODE_OPTIONS = ['Texto a video', 'Imagen a video'];

function VideoView({ credits, onSpendCredits, onNotify, hideHeading = false, provider = 'kling' }: { credits: number; onSpendCredits: (amount: number, message: string) => boolean; onNotify: (message: string) => void; hideHeading?: boolean; provider?: 'kling' | 'a2e' }) {
  const [studioMode, setStudioMode] = useState('Generar video');
  const [videoMode, setVideoMode] = useState(VIDEO_MODE_OPTIONS[0]);
  const [videoPrompt, setVideoPrompt] = useState('Lua caminando por una cafetería creativa, movimiento de cámara suave y luz cinematográfica.');
  const [duration, setDuration] = useState('5 segundos');
  const [ratio, setRatio] = useState('9:16');
  const [refImage, setRefImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const refImageInput = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState(false);
  const [statusLabel, setStatusLabel] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingTask, setPendingTask] = useState<{ id: string; cost: number } | null>(null);
  const busyRef = useRef(false);
  const cancelRef = useRef(false);
  const isImageMode = videoMode === 'Imagen a video';
  const durationOptions = VIDEO_DURATION_OPTIONS_BY_PROVIDER[provider];

  useEffect(() => { cancelRef.current = false; return () => { cancelRef.current = true; }; }, []);
  useEffect(() => {
    if (!durationOptions.includes(duration)) setDuration(durationOptions[0]);
  }, [duration, durationOptions]);

  async function pollVideoTask(taskId: string): Promise<string> {
    for (let attempt = 0; attempt < VIDEO_MAX_POLL_ATTEMPTS; attempt += 1) {
      if (cancelRef.current) throw new Error('cancelled');
      await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
      if (cancelRef.current) throw new Error('cancelled');
      const response = await fetch(`/api/generate-video?taskId=${encodeURIComponent(taskId)}`, { cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const data = (await response.json().catch(() => null)) as { status?: string; url?: string; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? 'No se pudo consultar el estado del video.');
      if (data?.status === 'SUCCEEDED' && data.url) return data.url;
      if (data?.status === 'FAILED') { setPendingTask(null); throw new Error(data.error ?? 'La generación de video falló.'); }
      setStatusLabel(data?.status === 'RUNNING' ? 'Creando tu video. Puede tardar unos minutos…' : 'Tu video está en la cola de generación…');
    }
    throw new Error('Tu video sigue pendiente. Pulsa «Consultar video» para recuperar el resultado sin iniciar otra generación.');
  }

  async function generateVideo() {
    if (busyRef.current || (!pendingTask && videoPrompt.trim().length < 3)) return;
    if (!pendingTask && isImageMode && !refImage) {
      onNotify('Sube una imagen para animarla con IA.');
      return;
    }
    const cost = pendingTask?.cost ?? VIDEO_CREDIT_COST_BY_DURATION[duration];
    if (!pendingTask && credits < cost) {
      onSpendCredits(cost, '');
      return;
    }
    busyRef.current = true;
    setGenerating(true);
    setErrorMessage('');
    setStatusLabel('Enviando tu idea...');
    try {
      let taskId = pendingTask?.id;
      if (!taskId) {
      const submitResponse = await fetch('/api/generate-video', {
        signal: AbortSignal.timeout(45000),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: videoPrompt,
          aspectRatio: ratio,
          duration: Number.parseInt(duration, 10),
          mode: isImageMode ? 'image' : 'text',
          provider,
          referenceImage: isImageMode ? refImage?.dataUrl : undefined,
        }),
      });
      const submitData = (await submitResponse.json().catch(() => null)) as { taskId?: string; error?: string } | null;
      if (!submitResponse.ok || !submitData?.taskId) {
        throw new Error(submitData?.error ?? 'No se pudo iniciar la generación de video.');
      }
      taskId = submitData.taskId;
      setPendingTask({ id: taskId, cost });
      }
      const url = await pollVideoTask(taskId);
      if (cancelRef.current) return;
      setVideoUrl(url);
      setPendingTask(null);
      onSpendCredits(cost, 'Video generado correctamente con IA.');
    } catch (error) {
      if (error instanceof Error && error.message === 'cancelled') return;
      setErrorMessage(error instanceof Error && error.name === 'TimeoutError' ? 'La conexión tardó demasiado. Si el video ya está pendiente, pulsa Consultar video para recuperar el resultado.' : error instanceof Error ? error.message : 'No se pudo generar el video. Inténtalo nuevamente.');
      onNotify(error instanceof Error ? error.message : 'No se pudo generar el video. Inténtalo nuevamente.');
    } finally {
      busyRef.current = false;
      setGenerating(false);
      setStatusLabel('');
    }
  }

  return (
    <div className="view-stack">
      {!hideHeading && <PageHeading eyebrow="ESTUDIO DE VIDEO" title="Generar Video con IA" description="Describe una escena y conviértela en un video con inteligencia artificial." note="Ideas que se mueven" />}
      <SegmentedField label="Herramienta de video" value={studioMode} onChange={setStudioMode} options={['Generar video', 'Control de movimiento']} />
      <div hidden={studioMode !== 'Control de movimiento'}><MotionControlView /></div>
      <section className="video-coming-card" style={studioMode !== 'Generar video' ? { display: 'none' } : undefined}>
        <div className="video-coming-copy">
          <span><Video size={24} /></span>
          <small>DE TEXTO A VIDEO · 720P</small>
          <h2>Crea un clip desde tu idea</h2>
          <p>Define el personaje, la acción y el movimiento de cámara. Cuantos más detalles, más tuyo será el clip.</p>
          <fieldset className="video-fields" disabled={generating || !!pendingTask}>
          <SegmentedField label="Modo" value={videoMode} onChange={setVideoMode} options={VIDEO_MODE_OPTIONS} />
          {isImageMode && (
            <div className="field-block">
              <span className="field-label">Imagen a animar</span>
              {refImage ? (
                <div className="reference-preview">
                  <img src={refImage.dataUrl} alt="Imagen a animar" />
                  <div className="reference-preview-copy">
                    <strong>{refImage.name}</strong>
                    <small>La IA animará esta imagen según tu descripción</small>
                  </div>
                  <button type="button" className="reference-remove" aria-label="Quitar imagen" onClick={() => setRefImage(null)}>
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <button type="button" className="reference-button" onClick={() => refImageInput.current?.click()}>
                  <Upload size={16} /> Subir imagen
                </button>
              )}
              <input
                ref={refImageInput}
                className="visually-hidden"
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { onNotify('Usa imágenes JPG, PNG o WebP.'); return; }
    if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
                    onNotify('La imagen debe pesar menos de 5 MB.');
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === 'string') setRefImage({ name: file.name, dataUrl: reader.result });
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </div>
          )}
          <label className="video-prompt-label">Describe {isImageMode ? 'el movimiento' : 'tu escena'}
            <Textarea value={videoPrompt} onChange={(event) => setVideoPrompt(event.target.value)} minLength={3} maxLength={2000} aria-describedby="video-prompt-help" />
          </label>
          <div className="video-prompt-help" id="video-prompt-help"><span>Incluye el lugar, la luz y la acción.</span><span>{videoPrompt.length}/2000</span></div>
          <div className="settings-grid">
            <SelectField label={`Duración · máximo ${provider === 'a2e' ? '10' : '12'} segundos`} value={duration} onChange={setDuration} options={durationOptions} />
            {isImageMode ? <p>Formato del video: se conserva el formato de la imagen de referencia.</p> : <SelectField label="Formato" value={ratio} onChange={setRatio} options={['9:16', '1:1', '16:9']} />}
          </div>
          </fieldset>
          <Button className="video-generate-button" type="button" onClick={generateVideo} disabled={(!pendingTask && (videoPrompt.trim().length < 3 || (isImageMode && !refImage))) || generating}>
            {generating ? <><LoaderCircle className="spin" /> Creando tu video…</> : pendingTask ? 'Consultar video' : <><Video /> Generar Video · {VIDEO_CREDIT_COST_BY_DURATION[duration]} créditos</>}
          </Button>
          <p className="video-credit-note">Saldo disponible: {credits} créditos · Se descuentan al completar el video.</p>
          {generating && <p className="video-status-note" role="status">{statusLabel} Puedes visitar otras secciones; mantén esta página abierta.</p>}
          {errorMessage && <div className="video-error" role="alert">{errorMessage}</div>}
        </div>
        <div className="video-result">
        <div className="video-result-heading"><h3>{videoUrl ? 'Tu video está listo' : 'Tu próximo video'}</h3><span>{videoUrl ? 'VIDEO GENERADO' : 'VISTA DE REFERENCIA'}</span></div>
        <div className={`video-preview-frame ${videoUrl ? 'generated-video' : ''}`}>
          {videoUrl ? (
            <video src={videoUrl} controls playsInline preload="metadata" />
          ) : (
            <img src={media[0]} alt="Imagen de inspiración; el video se creará a partir de tu descripción" />
          )}
          {!videoUrl && (
            <span>{generating ? <LoaderCircle className="spin" size={26} /> : <Video size={26} />}</span>
          )}
        </div>
        {videoUrl ? <div className="video-result-footer"><p>Guarda tu video: el enlace del proveedor es temporal.</p><a href={videoUrl} target="_blank" rel="noopener noreferrer"><Download size={16} /> Abrir y guardar video</a></div> : <p className="video-result-hint">{generating ? 'El resultado aparecerá aquí cuando esté listo.' : 'Esta imagen es inspiración. Tu descripción define el video final.'}</p>}
        </div>
      </section>
    </div>
  );
}

function TemplatesView({ onUseTemplate }: { onUseTemplate: (name: string) => void }) {
  const [category, setCategory] = useState('Todas');
  const templates = [
    { name: 'Café creativo', category: 'Lifestyle' },
    { name: 'Día de playa', category: 'Tendencia' },
    { name: 'Rutina fitness', category: 'Redes sociales' },
    { name: 'Noche editorial', category: 'Moda' },
    { name: 'Estudio urbano', category: 'Tendencia' },
    { name: 'Lifestyle casual', category: 'Lifestyle' },
    { name: 'Producto', category: 'Redes sociales' },
    { name: 'Retrato profesional', category: 'Moda' },
  ];
  const visibleTemplates = category === 'Todas' ? templates : templates.filter((template) => template.category === category);
  return (
    <div className="view-stack">
      <PageHeading eyebrow="IDEAS LISTAS" title="Plantillas" description="Elige una idea visual y personalízala con tu avatar." note="Ideas listas para usar" />
      <div className="template-tabs">{['Todas', 'Tendencia', 'Redes sociales', 'Lifestyle', 'Moda'].map((item) => <button key={item} type="button" className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <div className="template-grid">
        {visibleTemplates.map((template, index) => (
          <article className="template-card" key={template.name}>
            <div><img src={media[(index % 3) + 1]} alt={template.name} /><span>{template.category}</span></div>
            <h2>{template.name}</h2>
            <p>{index % 2 ? 'Estilo realista y natural.' : 'Ideal para contenido social.'}</p>
            <Button type="button" variant="secondary" onClick={() => onUseTemplate(template.name)}>Usar plantilla</Button>
          </article>
        ))}
      </div>
    </div>
  );
}

function LibraryView({ images, search, favorites, onToggleFavorite, onUpload }: { images: string[]; search: string; favorites: string[]; onToggleFavorite: (image: string) => void; onUpload: (file: File) => void }) {
  const [filter, setFilter] = useState('Todas');
  const uploadInput = useRef<HTMLInputElement>(null);
  const allImages = Array.from(new Set([...images, ...media])).slice(0, 12);
  const filteredByTab = filter === 'Favoritas' ? allImages.filter((image) => favorites.includes(image)) : filter === 'Recientes' ? allImages.slice(0, 4) : allImages;
  const query = search.trim().toLowerCase();
  const visibleImages = filteredByTab.filter((_, index) => !query || ['editorial', 'retrato', 'neón', 'estudio', 'lifestyle', 'playa'][index % 6].includes(query));
  return (
    <div className="view-stack">
      <PageHeading eyebrow="TU CONTENIDO" title="Biblioteca" description="Las nuevas imágenes generadas se conservan durante 3 meses. Descárgalas antes de que caduquen." note="Crea · Guarda · Reutiliza" />
      <div className="library-toolbar">
        <div className="filter-tabs">{['Todas', 'Favoritas', 'Recientes'].map((item) => <button key={item} className={filter === item ? 'active' : ''} type="button" onClick={() => setFilter(item)}>{item}</button>)}</div>
        <Button type="button" onClick={() => uploadInput.current?.click()}><Upload /> Subir imagen</Button>
        <input ref={uploadInput} className="visually-hidden" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ''; }} />
      </div>
      {visibleImages.length ? (
        <div className="gallery-grid library">{visibleImages.map((image, index) => <article className="library-card" key={`${image}-${index}`}><div><img src={image} alt={`Imagen guardada ${index + 1}`} /><button type="button" className={favorites.includes(image) ? 'favorite-active' : ''} aria-label={favorites.includes(image) ? 'Quitar de favoritos' : 'Marcar favorita'} onClick={() => onToggleFavorite(image)}><Heart size={18} fill={favorites.includes(image) ? 'currentColor' : 'none'} /></button></div><h3>{['Editorial cálido', 'Retrato lifestyle', 'Luz de neón', 'Estudio nocturno'][index % 4]}</h3><p>Generada hoy · {index % 2 ? '4:5' : '16:9'}</p><a href={image} download>Descargar</a></article>)}</div>
      ) : <div className="empty-state"><FolderHeart size={34} /><strong>No encontramos imágenes</strong><p>Cambia el filtro, prueba otra búsqueda o sube una imagen.</p></div>}
    </div>
  );
}

function PlansView({ currentPlan, onSelectPlan, onTopUp }: { currentPlan: string; onSelectPlan: (name: string, credits: number) => void; onTopUp: () => void }) {
  const plans = [
    { name: 'Inicial', price: '19', credits: '1.200', creditAmount: 1200, featured: false },
    { name: 'Creator', price: '32', credits: '2.500', creditAmount: 2500, featured: true },
    { name: 'Pro', price: '59', credits: '5.000', creditAmount: 5000, featured: false },
  ];
  return (
    <div className="view-stack">
      <PageHeading eyebrow="CRECE A TU RITMO" title="Planes y créditos" description="Elige un plan claro. Sin costos ocultos y con tus créditos siempre visibles." note="Más espacio para crear" />
      <div className="plans-grid">{plans.map((plan) => <article className={`plan-card ${plan.featured ? 'featured' : ''} ${currentPlan === plan.name ? 'current-plan' : ''}`} key={plan.name}>{plan.featured && <span className="popular">Más elegido</span>}<h2>{plan.name}</h2><p>Para creadores {plan.name === 'Inicial' ? 'que están empezando' : 'en crecimiento'}</p><div className="price"><span>US$</span><strong>{plan.price}</strong><small>/ mes</small></div><div className="plan-credits"><Coins size={20} /> <strong>{plan.credits}</strong> créditos al mes</div><ul><li><Check /> Generación de imágenes</li><li><Check /> Descargas en alta calidad</li><li><Check /> Biblioteca personal</li><li><Check /> Uso comercial</li></ul><Button variant={plan.featured ? 'default' : 'secondary'} type="button" onClick={() => onSelectPlan(plan.name, plan.creditAmount)}>{currentPlan === plan.name ? 'Plan actual' : `Elegir ${plan.name}`}</Button></article>)}</div>
      <section className="topup-banner"><div><Coins /><span><strong>¿Solo necesitas más créditos?</strong><small>Recarga 700 créditos por US$9.90 sin cambiar de plan.</small></span></div><Button variant="secondary" type="button" onClick={onTopUp}>Recargar 700 créditos</Button></section>
    </div>
  );
}

function SettingsView({ onNotify, profileName, accountEmail, onProfileNameChange, onLogout }: { onNotify: (message: string) => void; profileName: string; accountEmail: string; onProfileNameChange: (name: string) => void; onLogout: () => void }) {
  const [autoSave, setAutoSave] = useState(true);
  const [emails, setEmails] = useState(false);
  const [editing, setEditing] = useState(false);
  const [profile, setProfile] = useState({ name: profileName, email: accountEmail, language: 'Español', description: '' });

  useEffect(() => {
    const saved = window.localStorage.getItem('creator-profile');
    if (!saved) return;
    try {
      const storedProfile = JSON.parse(saved);
      setProfile({ name: storedProfile.name ?? profileName, email: storedProfile.email ?? accountEmail, language: storedProfile.language ?? 'Español', description: storedProfile.description ?? '' });
      if (storedProfile.name) onProfileNameChange(storedProfile.name);
    } catch { window.localStorage.removeItem('creator-profile'); }
  }, []);

  function saveProfile() {
    if (!profile.name.trim() || !profile.email.includes('@')) {
      onNotify('Revisa el nombre y el correo antes de guardar.');
      return;
    }
    setEditing(false);
    window.localStorage.setItem('creator-profile', JSON.stringify(profile));
    onProfileNameChange(profile.name.trim());
    onNotify('Perfil guardado correctamente.');
  }

  return (
    <div className="view-stack">
      <PageHeading eyebrow="TU ESPACIO" title="Configuración" description="Ajusta tu perfil y cómo quieres trabajar dentro del estudio." note="Hecho a tu manera" />
      <div className="settings-page-grid">
        <section className="profile-settings"><div className="section-title-row"><h2>Información del perfil</h2><Button variant="secondary" size="sm" type="button" onClick={() => editing ? saveProfile() : setEditing(true)}>{editing ? 'Guardar' : 'Editar'}</Button></div><div className="profile-summary"><img src="/assets/creator-portrait-1.png" alt="Foto de perfil" /><div><strong>{profile.name}</strong><span>{accountEmail}</span><small>Creador de contenido · Perú</small></div></div><div className="form-grid"><label>Nombre<input value={profile.name} readOnly={!editing} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label><label>Correo<input value={profile.email} readOnly={!editing} onChange={(event) => setProfile({ ...profile, email: event.target.value })} /></label><label>Idioma<input value={profile.language} readOnly={!editing} onChange={(event) => setProfile({ ...profile, language: event.target.value })} /></label><label>Descripción<Textarea value={profile.description} readOnly={!editing} maxLength={500} placeholder="Cuéntanos qué contenido creas" onChange={(event) => setProfile({ ...profile, description: event.target.value })} /></label></div></section>
        <section className="preference-settings"><h2>Preferencias</h2><PreferenceRow icon={FolderHeart} title="Guardar automáticamente" copy="Añade cada generación a tu biblioteca." checked={autoSave} onChange={(checked) => { setAutoSave(checked); onNotify(checked ? 'Guardado automático activado.' : 'Guardado automático desactivado.'); }} /><PreferenceRow icon={Bell} title="Novedades por correo" copy="Recibe nuevas funciones y consejos." checked={emails} onChange={(checked) => { setEmails(checked); onNotify(checked ? 'Novedades por correo activadas.' : 'Novedades por correo desactivadas.'); }} />
          <div className="account-actions">
            <h2>Cuenta</h2>
            <p>Sesión iniciada como <strong>{accountEmail}</strong></p>
            <Button variant="secondary" type="button" className="logout-button" onClick={onLogout}>
              <LogOut size={17} /> Cerrar sesión
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function PreferenceRow({ icon: Icon, title, copy, checked, onChange }: { icon: typeof Home; title: string; copy: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="preference-row"><span><Icon size={20} /></span><div><strong>{title}</strong><small>{copy}</small></div><Switch checked={checked} onCheckedChange={onChange} aria-label={title} /></div>;
}





function MotionControlView() {
  const [uploading, setUploading] = useState(false);
  const [imageName, setImageName] = useState('');
  const [videoName, setVideoName] = useState('');
  const [videoDuration, setVideoDuration] = useState(0);
  const [imageUrl, setImageUrl] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [prompt, setPrompt] = useState('');
  const [orientation, setOrientation] = useState('Video de referencia');
  const [quality, setQuality] = useState('Estándar');
  const [sound, setSound] = useState(true);
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function uploadReference(file: File, kind: 'image' | 'video') {
    if (file.size > 20 * 1024 * 1024) { setError('El archivo debe pesar como máximo 20 MB.'); return; }
    setUploading(true); setError('');
    const preview = URL.createObjectURL(file);
    try {
      let duration = 0;
      await new Promise<void>((resolve, reject) => {
        if (kind === 'image') {
          const image = new Image();
          image.onload = () => image.width >= 340 && image.height >= 340 && image.width / image.height >= .4 && image.width / image.height <= 2.5 ? resolve() : reject(new Error('Usa una imagen de al menos 340 px por lado, con proporción entre 1:2.5 y 2.5:1.'));
          image.onerror = () => reject(new Error('No se pudo leer la imagen.'));
          image.src = preview;
        } else {
          const video = document.createElement('video');
          video.preload = 'metadata';
          video.onloadedmetadata = () => {
            duration = video.duration;
            const valid = duration >= 3 && duration <= 12 && video.videoWidth >= 340 && video.videoHeight >= 340 && video.videoWidth <= 3850 && video.videoHeight <= 3850;
            video.removeAttribute('src'); video.load();
            valid ? resolve() : reject(new Error('Usa un video de 3 a 12 segundos y entre 340 y 3850 px por lado.'));
          };
          video.onerror = () => reject(new Error('No se pudo leer el video. Usa MP4 o MOV.'));
          video.src = preview;
        }
      });
      const form = new FormData(); form.set('file', file);
      const response = await fetch('/api/motion-upload', {method:'POST',body:form});
      const data = await response.json() as {url?:string;error?:string};
      if (!response.ok || !data.url) throw new Error(data.error ?? 'No se pudo subir la referencia.');
      if (kind === 'image') { setImageUrl(data.url); setImageName(file.name); }
      else { setVideoUrl(data.url); setVideoName(file.name); setVideoDuration(duration); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo subir el archivo.'); }
    finally { URL.revokeObjectURL(preview); setUploading(false); }
  }
  async function generate() {
    if (lock.current || uploading) return;
    if (!task && orientation === 'Imagen del personaje' && videoDuration > 10) { setError('Con orientación de la imagen, usa un video de hasta 10 segundos.'); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      let id = task;
      if (!id) {
        const response = await fetch('/api/motion-control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl, videoUrl, prompt, orientation: orientation === 'Video de referencia' ? 'video' : 'image', mode: quality === 'Estándar' ? 'std' : 'pro', keepSound: sound }) });
        const data = await response.json() as { taskId?: string; error?: string };
        if (!response.ok || !data.taskId) throw new Error(data.error ?? 'No se pudo iniciar Motion Control.');
        id = data.taskId; setTask(id);
      }
      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        if (!mounted.current) return;
        const response = await fetch(`/api/motion-control?taskId=${encodeURIComponent(id)}`, { cache: 'no-store' });
        const data = await response.json() as { status?: string; url?: string; error?: string };
        if (!response.ok) throw new Error(data.error ?? 'No se pudo consultar el video.');
        if (data.status === 'FAILED') { setTask(''); throw new Error(data.error ?? 'La generación falló.'); }
        if (data.status === 'SUCCEEDED' && data.url) { setResult(data.url); setTask(''); return; }
      }
      throw new Error('El video sigue pendiente. Consulta el resultado sin crear una nueva tarea.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo generar el video.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="video-coming-card">
    <div className="video-coming-copy">
      <h2>Control de movimiento</h2><p>Transfiere los movimientos de un video a tu personaje.</p>
      <fieldset className="video-fields" disabled={busy || !!task || uploading}>
        <div className="motion-reference-grid">
          <label className="motion-upload"><span><ImageIcon size={18} /> Imagen del personaje</span>{imageUrl ? <img src={imageUrl} alt="Personaje de referencia" /> : <div className="motion-upload-placeholder"><Upload size={26} /><strong>Sube tu personaje</strong><small>JPG, PNG o WebP</small></div>}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file=event.target.files?.[0]; event.target.value=''; if(file) void uploadReference(file,'image'); }} /><small>{imageName || 'Hasta 20 MB · mínimo 340 px por lado'}</small></label>
          <label className="motion-upload"><span><Video size={18} /> Video de movimiento</span>{videoUrl ? <video src={videoUrl} controls playsInline preload="metadata" /> : <div className="motion-upload-placeholder"><Upload size={26} /><strong>Añade el movimiento</strong><small>MP4 o MOV · 3–12 segundos</small></div>}<input type="file" accept="video/mp4,video/quicktime" onChange={(event) => { const file=event.target.files?.[0]; event.target.value=''; if(file) void uploadReference(file,'video'); }} /><small>{videoName || 'Hasta 20 MB'}</small></label>
        </div>
        <label className="video-prompt-label">Descripción de la escena<Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2500} /></label>
        <SelectField label="Orientación del personaje" value={orientation} onChange={setOrientation} options={['Video de referencia', 'Imagen del personaje']} />
        <SelectField label="Calidad" value={quality} onChange={setQuality} options={['Estándar', 'Profesional']} />
        <label className="motion-sound"><Switch checked={sound} onCheckedChange={setSound} /> Conservar audio original</label>
        <p>{orientation === 'Video de referencia' ? 'Video de 3 a 12 segundos.' : 'Video de 3 a 10 segundos.'} El formato sigue la referencia; no se recorta la vista previa.</p>
      </fieldset>
      <Button className="video-generate-button" onClick={generate} disabled={busy || uploading || (!task && (!imageUrl || !videoUrl))}>{uploading ? 'Subiendo referencia…' : busy ? <><LoaderCircle className="spin" /> Generando movimiento…</> : task ? 'Consultar resultado' : 'Generar movimiento'}</Button>
      {busy && <p role="status">Estamos procesando las referencias. Mantén esta página abierta.</p>}
      {error && <div className="video-error" role="alert">{error}</div>}
    </div>
    <div className="video-result">{result ? <><video className="motion-result" src={result} controls playsInline /><a href={result} target="_blank" rel="noopener noreferrer">Abrir y guardar video</a></> : <div className="motion-empty"><Video size={32} /><h3>Tu personaje, en movimiento</h3><p>El resultado aparecerá aquí al completar la generación.</p></div>}</div>
  </section>;
}
