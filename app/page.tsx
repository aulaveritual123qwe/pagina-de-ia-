'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  Coins,
  Download,
  FolderHeart,
  Heart,
  Home,
  Library,
  LoaderCircle,
  Menu,
  Palette,
  Search,
  Settings,
  Sparkles,
  Upload,
  Video,
  WandSparkles,
  X,
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
import { createDemoImages } from '@/lib/image-provider';

type View = 'inicio' | 'crear' | 'biblioteca' | 'planes' | 'ajustes';

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
  { id: 'crear', label: 'Crear imagen', icon: WandSparkles },
  { id: 'biblioteca', label: 'Biblioteca', icon: Library },
  { id: 'planes', label: 'Planes y créditos', icon: Coins },
  { id: 'ajustes', label: 'Configuración', icon: Settings },
];

export default function HomePage() {
  const [view, setView] = useState<View>('crear');
  const [mobileNav, setMobileNav] = useState(false);
  const [prompt, setPrompt] = useState(
    'Retrato editorial en una cafetería creativa, luz cálida, reflejos violeta, fotografía realista y natural.',
  );
  const [style, setStyle] = useState('Realista');
  const [ratio, setRatio] = useState('4:5');
  const [quality, setQuality] = useState('Alta');
  const [imageCount, setImageCount] = useState('4');
  const [credits, setCredits] = useState(320);
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState(media);
  const [favorite, setFavorite] = useState(false);

  const activeLabel = useMemo(
    () => navItems.find((item) => item.id === view)?.label ?? 'Crear imagen',
    [view],
  );

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
            const generated = await createDemoImages({ prompt: value.prompt.trim(), count: nextCount, style: nextStyle, aspectRatio: ratio, quality });
            setResults(generated);
            setCredits((current) => Math.max(0, current - nextCount));
            setIsGenerating(false);
            return { status: 'generated', count: generated.length, mode: 'demo' };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, [quality, ratio]);

  function navigate(next: View) {
    setView(next);
    setMobileNav(false);
  }

  async function handleGenerate() {
    if (!prompt.trim() || isGenerating) return;
    const amount = Number(imageCount);
    setIsGenerating(true);
    try {
      const generated = await createDemoImages({
        prompt,
        style,
        aspectRatio: ratio,
        quality,
        count: amount,
      });
      setResults(generated);
      setCredits((current) => Math.max(0, current - amount));
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <div className="app-shell">
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
          <label className="searchbox">
            <Search size={19} />
            <input
              type="search"
              placeholder="Buscar creaciones, estilos o proyectos..."
              aria-label="Buscar"
            />
          </label>
          <div className="topbar-actions">
            <button className="credit-pill" type="button" onClick={() => navigate('planes')}>
              <Coins size={19} />
              <strong>{credits}</strong>
              <span>créditos</span>
            </button>
            <button className="icon-button notification" type="button" aria-label="Notificaciones">
              <Bell size={21} />
              <span />
            </button>
            <button className="profile-button" type="button" aria-label="Abrir perfil">
              <img src="/assets/creator-portrait-1.png" alt="Avatar de Lalo" />
              <span>
                <strong>Hola, Lalo</strong>
                <small>Creator Free</small>
              </span>
              <ChevronDown size={16} />
            </button>
          </div>
        </header>

        <main className="content-area" aria-label={activeLabel}>
          {view === 'crear' && (
            <CreateView
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
              isGenerating={isGenerating}
              onGenerate={handleGenerate}
              results={results}
              credits={credits}
              favorite={favorite}
              setFavorite={setFavorite}
            />
          )}
          {view === 'inicio' && <DashboardView onNavigate={navigate} credits={credits} />}
          {view === 'biblioteca' && <LibraryView images={results} />}
          {view === 'planes' && <PlansView />}
          {view === 'ajustes' && <SettingsView />}
        </main>
      </div>
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
          <div className="brand-mark" aria-hidden="true"><span /></div>
          <div className="brand-copy">
            <strong>CREATORS</strong>
            <span>ACADEMY <em>PRO</em></span>
          </div>
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
          <button type="button" className="disabled-nav" title="Disponible próximamente">
            <Video size={22} strokeWidth={1.8} />
            <span>Generar video</span>
            <small>Pronto</small>
          </button>
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
  isGenerating: boolean;
  onGenerate: () => void;
  results: string[];
  credits: number;
  favorite: boolean;
  setFavorite: (value: boolean) => void;
};

function CreateView(props: CreateViewProps) {
  const currentImage = props.results[0] ?? media[0];
  return (
    <div className="view-stack create-view">
      <PageHeading
        eyebrow="ESTUDIO DE IMAGEN"
        title="Crear imagen con IA"
        description="Describe tu idea, elige el estilo y genera una colección lista para usar."
        note="Imagina · Crea · Comparte"
      />

      <div className="workspace-grid">
        <section className="creator-panel" aria-label="Configuración de imagen">
          <Step title="Describe tu imagen" number="1">
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
            <div className="prompt-meta">
              <button type="button" className="reference-button"><Upload size={16} /> Añadir referencia</button>
              <span>{props.prompt.length}/1000</span>
            </div>
          </Step>

          <Step title="Configura el resultado" number="2">
            <div className="settings-grid">
              <SelectField label="Estilo" value={props.style} onChange={props.setStyle} options={['Realista', 'Editorial', 'Cinematográfico', 'Ilustración']} />
              <SelectField label="Formato" value={props.ratio} onChange={props.setRatio} options={['1:1', '4:5', '9:16', '16:9']} />
              <SelectField label="Calidad" value={props.quality} onChange={props.setQuality} options={['Estándar', 'Alta', 'Ultra']} />
              <SelectField label="Cantidad" value={props.imageCount} onChange={props.setImageCount} options={['1', '2', '4']} suffix=" imágenes" />
            </div>
          </Step>

          <div className="generation-summary">
            <div><span>Listo para generar</span><small>Modo demostración · API pendiente</small></div>
            <span className="estimated-cost"><Coins size={16} /> {props.imageCount} créditos</span>
          </div>

          <Button
            className="generate-button"
            size="lg"
            disabled={!props.prompt.trim() || props.isGenerating || props.credits < Number(props.imageCount)}
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
            <span className="demo-badge">Demo</span>
          </div>
          <div className="main-result">
            <img src={currentImage} alt="Resultado de imagen generado" />
            <a href={currentImage} download className="download-button"><Download size={17} /> Descargar</a>
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
            <Button variant="secondary" type="button"><Palette /> Editar</Button>
            <Button
              variant="secondary"
              type="button"
              className={props.favorite ? 'is-favorite' : ''}
              onClick={() => props.setFavorite(!props.favorite)}
            >
              <Heart fill={props.favorite ? 'currentColor' : 'none'} /> {props.favorite ? 'Guardada' : 'Guardar'}
            </Button>
          </div>
          <div className="recent-block">
            <div className="section-title-row compact"><h3>Variaciones</h3><span>{props.results.length} imágenes</span></div>
            <div className="variation-grid">
              {props.results.map((image, index) => (
                <button key={`${image}-${index}`} type="button" className={index === 0 ? 'selected' : ''}>
                  <img src={image} alt={`Variación ${index + 1}`} />
                  {index === 0 && <span><Check size={14} /> Actual</span>}
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

function SelectField({ label, value, onChange, options, suffix = '' }: { label: string; value: string; onChange: (value: string) => void; options: string[]; suffix?: string }) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <Select value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger><SelectValue>{value}{suffix}</SelectValue></SelectTrigger>
        <SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{option}{suffix}</SelectItem>)}</SelectContent>
      </Select>
    </label>
  );
}

function PageHeading({ eyebrow, title, description, note }: { eyebrow: string; title: string; description: string; note?: string }) {
  return <header className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{note && <span className="hand-note">{note}</span>}</header>;
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

function LibraryView({ images }: { images: string[] }) {
  const allImages = [...images, ...media].slice(0, 8);
  return (
    <div className="view-stack">
      <PageHeading eyebrow="TU CONTENIDO" title="Biblioteca" description="Tus imágenes, organizadas para volver a usarlas cuando las necesites." note="Crea · Guarda · Reutiliza" />
      <div className="library-toolbar"><div className="filter-tabs"><button className="active" type="button">Todas</button><button type="button">Favoritas</button><button type="button">Recientes</button></div><Button type="button"><Upload /> Subir imagen</Button></div>
      <div className="gallery-grid library">{allImages.map((image, index) => <article className="library-card" key={`${image}-${index}`}><div><img src={image} alt={`Imagen guardada ${index + 1}`} /><button type="button" aria-label="Marcar favorita"><Heart size={18} /></button></div><h3>{['Editorial cálido', 'Retrato lifestyle', 'Luz de neón', 'Estudio nocturno'][index % 4]}</h3><p>Generada hoy · {index % 2 ? '4:5' : '16:9'}</p></article>)}</div>
    </div>
  );
}

function PlansView() {
  const plans = [
    { name: 'Inicial', price: '19', credits: '1.200', featured: false },
    { name: 'Creator', price: '32', credits: '2.500', featured: true },
    { name: 'Pro', price: '59', credits: '5.000', featured: false },
  ];
  return (
    <div className="view-stack">
      <PageHeading eyebrow="CRECE A TU RITMO" title="Planes y créditos" description="Elige un plan claro. Sin costos ocultos y con tus créditos siempre visibles." note="Más espacio para crear" />
      <div className="plans-grid">{plans.map((plan) => <article className={`plan-card ${plan.featured ? 'featured' : ''}`} key={plan.name}>{plan.featured && <span className="popular">Más elegido</span>}<h2>{plan.name}</h2><p>Para creadores {plan.name === 'Inicial' ? 'que están empezando' : 'en crecimiento'}</p><div className="price"><span>US$</span><strong>{plan.price}</strong><small>/ mes</small></div><div className="plan-credits"><Coins size={20} /> <strong>{plan.credits}</strong> créditos al mes</div><ul><li><Check /> Generación de imágenes</li><li><Check /> Descargas en alta calidad</li><li><Check /> Biblioteca personal</li><li><Check /> Uso comercial</li></ul><Button variant={plan.featured ? 'default' : 'secondary'} type="button">Elegir {plan.name}</Button></article>)}</div>
      <section className="topup-banner"><div><Coins /><span><strong>¿Solo necesitas más créditos?</strong><small>Recarga desde 500 créditos sin cambiar de plan.</small></span></div><Button variant="secondary">Ver recargas</Button></section>
    </div>
  );
}

function SettingsView() {
  const [autoSave, setAutoSave] = useState(true);
  const [emails, setEmails] = useState(false);
  return (
    <div className="view-stack">
      <PageHeading eyebrow="TU ESPACIO" title="Configuración" description="Ajusta tu perfil y cómo quieres trabajar dentro del estudio." note="Hecho a tu manera" />
      <div className="settings-page-grid">
        <section className="profile-settings"><div className="section-title-row"><h2>Información del perfil</h2><Button variant="secondary" size="sm">Editar</Button></div><div className="profile-summary"><img src="/assets/creator-portrait-1.png" alt="Foto de perfil" /><div><strong>Lalo Balarezo</strong><span>@lalo.creator</span><small>Creador de contenido · Perú</small></div></div><div className="form-grid"><label>Nombre<input value="Lalo Balarezo" readOnly /></label><label>Correo<input value="lalo@creator.studio" readOnly /></label><label>Idioma<input value="Español" readOnly /></label><label>Zona horaria<input value="GMT-05:00 · Lima" readOnly /></label></div></section>
        <section className="preference-settings"><h2>Preferencias</h2><PreferenceRow icon={FolderHeart} title="Guardar automáticamente" copy="Añade cada generación a tu biblioteca." checked={autoSave} onChange={setAutoSave} /><PreferenceRow icon={Bell} title="Novedades por correo" copy="Recibe nuevas funciones y consejos." checked={emails} onChange={setEmails} /></section>
      </div>
    </div>
  );
}

function PreferenceRow({ icon: Icon, title, copy, checked, onChange }: { icon: typeof Home; title: string; copy: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="preference-row"><span><Icon size={20} /></span><div><strong>{title}</strong><small>{copy}</small></div><Switch checked={checked} onCheckedChange={onChange} aria-label={title} /></div>;
}
