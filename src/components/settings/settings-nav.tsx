"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  Bell,
  CalendarDays,
  Clock3,
  Download,
  Eye,
  MessageCircle,
  MessageSquare,
  Plug,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Smartphone,
  Tag,
  Target,
  Users,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { PageShell } from "@/components/ui/page-shell";
import { SectionTabs } from "@/components/ui/section-tabs";
import { pathWithin } from "@/lib/modules/nav-layout";
import { openUsageDialog } from "@/lib/usage-dialog";
import { cn } from "@/lib/utils";

/**
 * Ajustes en una columna de secciones a la izquierda (como el resto del CRM
 * reorganizado), en cuatro grupos: Negocio · Atención y ventas · IA conectada
 * · Personal. Arriba, «Buscar un ajuste». Las direcciones de cada página
 * (`/settings/<clave>`) no cambian.
 *
 * Un renglón puede reunir varias páginas (Canales y conexiones: WhatsApp,
 * Messenger, Plantillas y Conexión directa); con más de una se muestran como
 * control segmentado dentro del contenido. Qué páginas existen lo decide el
 * servidor y baja por prop (`allowed` y los módulos): este es un componente de
 * cliente y no puede leer variables de entorno. El servidor valida igual cada
 * página y cada ruta.
 */
type Page = { slug: string; label: string };
type Item = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Páginas que reúne; la primera visible es a donde lleva el renglón. */
  pages: readonly Page[];
  /** Otras palabras con las que se encuentra en el buscador. */
  keywords?: string;
  /** Sobrescribe el destino y cuándo se enciende (p. ej. Notificaciones dentro de Personalización). */
  href?: string;
  match?: (pathname: string) => boolean;
};
type Group = { label: string; items: readonly Item[] };

const P = "/settings/personalization";

const GROUPS: readonly Group[] = [
  {
    label: "Negocio",
    items: [
      {
        id: "canales",
        label: "Canales y conexiones",
        icon: MessageCircle,
        keywords: "whatsapp meta número messenger plantillas conexión directa",
        pages: [
          { slug: "whatsapp", label: "WhatsApp" },
          { slug: "messenger", label: "Messenger" },
          { slug: "templates", label: "Plantillas" },
          { slug: "direct-connection", label: "Conexión directa" },
        ],
      },
      { id: "team", label: "Equipo y permisos", icon: Users, keywords: "miembros roles personas invitar asesores chats nuevos", pages: [{ slug: "team", label: "Miembros y roles" }] },
      { id: "ads", label: "Anuncios (Meta)", icon: Target, keywords: "capi atribución anuncios", pages: [{ slug: "ads", label: "Anuncios (CAPI)" }] },
      { id: "datos", label: "Mis datos", icon: Download, keywords: "exportar descargar respaldo contactos chats csv zip cancelar", pages: [{ slug: "mis-datos", label: "Mis datos" }] },
      { id: "uso", label: "Uso y plan", icon: Wallet, keywords: "consumo ia plan límites", pages: [{ slug: "uso", label: "Uso y plan" }] },
    ],
  },
  {
    label: "Atención y ventas",
    items: [
      { id: "tags", label: "Etiquetas", icon: Tag, pages: [{ slug: "tags", label: "Etiquetas" }] },
      { id: "quick", label: "Respuestas rápidas", icon: Zap, keywords: "atajos", pages: [{ slug: "quick-replies", label: "Respuestas rápidas" }] },
      { id: "loss", label: "Motivos de pérdida", icon: X, keywords: "perdidos pipeline", pages: [{ slug: "loss-reasons", label: "Motivos de pérdida" }] },
      { id: "calendar", label: "Agenda y conectores", icon: CalendarDays, keywords: "zoom meet citas", pages: [{ slug: "calendar", label: "Conectores de agenda" }] },
      { id: "team-chat", label: "Chat de equipo", icon: MessageSquare, keywords: "grupos supervisión", pages: [{ slug: "team-chat", label: "Chat de equipo" }] },
      { id: "auto", label: "Mensajes automáticos", icon: Clock3, keywords: "bienvenida fuera de horario ausencia horario olvidados sin respuesta aviso", pages: [{ slug: "auto-mensajes", label: "Mensajes automáticos" }] },
      { id: "opt-out", label: "Bajas automáticas", icon: Shield, keywords: "stop baja darse de baja palabras respuesta", pages: [{ slug: "opt-out", label: "Bajas automáticas" }] },
    ],
  },
  {
    label: "IA conectada",
    items: [
      { id: "quien", label: "Quién contesta", icon: Bot, keywords: "ia agente encender apagar cerebro externo bot api", pages: [{ slug: "quien-contesta", label: "Quién contesta" }] },
      { id: "mi-ia", label: "Mi IA", icon: Plug, keywords: "conector mcp claude chatgpt", pages: [{ slug: "mi-ia", label: "Mi IA" }] },
      { id: "conector", label: "Conector del equipo", icon: SlidersHorizontal, keywords: "propietario roles tope", pages: [{ slug: "conector-ia", label: "Ajustes del conector" }] },
    ],
  },
  {
    label: "Personal",
    items: [
      {
        id: "numero",
        label: "Mi número",
        icon: Smartphone,
        keywords: "whatsapp personal dispositivo",
        pages: [
          { slug: "my-number", label: "Mi número" },
          { slug: "mi-numero", label: "Números del equipo" },
        ],
      },
      {
        id: "notif",
        label: "Notificaciones",
        icon: Bell,
        keywords: "sonido avisos no molestar",
        pages: [{ slug: "personalization", label: "Notificaciones" }],
        href: `${P}/notificaciones`,
        match: (p) => pathWithin(`${P}/notificaciones`, p),
      },
      {
        id: "look",
        label: "Apariencia",
        icon: Eye,
        keywords: "tema letra marca navegación colores",
        pages: [{ slug: "personalization", label: "Apariencia" }],
        href: P,
        match: (p) => pathWithin(P, p) && !pathWithin(`${P}/notificaciones`, p),
      },
    ],
  },
];

const href = (slug: string) => `/settings/${slug}`;

type Resolved = { item: Item; pages: Page[]; to: string };

/** Los grupos con solo los renglones que existen para quien mira. */
export function settingsGroups(visible: (slug: string) => boolean): { label: string; items: Resolved[] }[] {
  return GROUPS.map((g) => ({
    label: g.label,
    items: g.items.flatMap((item): Resolved[] => {
      const pages = item.pages.filter((p) => visible(p.slug));
      return pages.length ? [{ item, pages: [...pages], to: item.href ?? href(pages[0]!.slug) }] : [];
    }),
  })).filter((g) => g.items.length > 0);
}

/** Las páginas que se muestran como control segmentado de un renglón. */
const tabPages = (r: Resolved) => (r.item.id === "canales" ? r.pages.filter((p) => p.slug !== "direct-connection") : r.pages);

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function SettingsShell({
  agenda = false,
  atribucion = false,
  messenger = false,
  directConnection = false,
  miNumero = false,
  conectorIa = false,
  agente = false,
  templates = true,
  allowed,
  children,
}: {
  agenda?: boolean;
  atribucion?: boolean;
  messenger?: boolean;
  /** Conexión directa (PR 2) — solo con el complemento encendido y el permiso de vincular. */
  directConnection?: boolean;
  /** Mi número (046) — solo con el complemento encendido. */
  miNumero?: boolean;
  /** 047 — IA conectada, solo con el complemento. */
  conectorIa?: boolean;
  /** Módulo Agente — «Quién contesta» solo con él. */
  agente?: boolean;
  /** 030 (PR 4) — con Campañas encendido, Plantillas vive en Marketing. */
  templates?: boolean;
  /** 020 — páginas que el rol puede abrir (`/settings/<clave>`); lo decide el servidor. */
  allowed?: string[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const groups = settingsGroups((slug) => {
    // 015/016/017 — Agenda, Anuncios y Messenger solo con su módulo.
    if (slug === "calendar" && !agenda) return false;
    if (slug === "ads" && !atribucion) return false;
    if (slug === "messenger" && !messenger) return false;
    if (slug === "direct-connection" && !directConnection) return false;
    if ((slug === "my-number" || slug === "mi-numero") && !miNumero) return false;
    if ((slug === "mi-ia" || slug === "conector-ia") && !conectorIa) return false;
    if (slug === "quien-contesta" && !agente) return false;
    if (slug === "templates" && !templates) return false;
    return !allowed || allowed.includes(slug);
  });

  const isActive = (r: Resolved) =>
    r.item.match ? r.item.match(pathname) : r.pages.some((p) => pathWithin(href(p.slug), pathname));
  const current = groups.flatMap((g) => g.items).find(isActive);
  // Teléfono: lista de secciones en «/settings» y cada sección en su propia pantalla.
  const mobileList = pathname === "/settings";

  const q = norm(query.trim());
  const shown = groups
    .map((g) => ({
      ...g,
      items: q ? g.items.filter((r) => norm(`${r.item.label} ${r.item.keywords ?? ""} ${g.label}`).includes(q)) : g.items,
    }))
    .filter((g) => g.items.length > 0);

  const search = (
    <label className={cn("settings-search relative block w-56 max-w-full sm:w-64", !mobileList && "max-lg:hidden")}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" strokeWidth={1.8} />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar un ajuste"
        aria-label="Buscar un ajuste"
        data-testid="settings-search"
        className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </label>
  );

  return (
    <PageShell title="Ajustes" icon={Settings} pillar={false} actions={search} className="mobile-settings-page">
      <div data-premium-area="settings" className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Secciones de Ajustes" className={cn("settings-sections lg:sticky lg:top-0 lg:self-start", !mobileList && "max-lg:hidden")}>
          {shown.length === 0 && <p className="px-2 py-3 text-sm text-text-3">Ningún ajuste coincide con «{query}».</p>}
          {shown.map((g) => (
            <div key={g.label} className="settings-group mb-4">
              <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-3">{g.label}</p>
              <ul className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
                {g.items.map((r) => {
                  const Icon = r.item.icon;
                  const active = isActive(r);
                  const cls = cn(
                    "flex w-full items-center gap-2.5 whitespace-nowrap rounded-sm px-2.5 py-2 text-left text-[13.5px] transition-colors",
                    active ? "bg-brand-soft font-semibold text-brand-text" : "text-foreground hover:bg-accent"
                  );
                  const inner = (
                    <>
                      <Icon className={cn("h-[16px] w-[16px] shrink-0", active ? "text-brand" : "text-text-3")} strokeWidth={1.8} />
                      {r.item.label}
                    </>
                  );
                  return (
                    <li key={r.item.id}>
                      {r.item.id === "uso" ? (
                        <button type="button" onClick={() => openUsageDialog()} className={cls}>
                          {inner}
                        </button>
                      ) : (
                        <Link href={r.to} aria-current={active ? "page" : undefined} className={cls}>
                          {inner}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        {/* Pulido F: todas las páginas de Ajustes con el mismo ancho. */}
        <div className={cn("min-w-0 max-w-4xl", mobileList && "max-lg:hidden")}>
          {current && (
            <div className="mb-3 flex items-center gap-2 lg:hidden" data-testid="settings-detail-head">
              <Link href="/settings" aria-label="Volver a Ajustes" className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full active:bg-row-hover">
                <ArrowLeft className="h-[22px] w-[22px]" strokeWidth={1.8} />
              </Link>
              <h2 className="text-[18px] font-semibold">{current.item.label}</h2>
            </div>
          )}
          {/* Ronda 3: en Canales y conexiones el teléfono vinculado se abre desde su tarjeta, no como pestaña. */}
          {current && tabPages(current).length > 1 && (
            // Sub-secciones como control segmentado dentro del contenido.
            <div className="mb-5">
              <SectionTabs
                variant="segmented"
                tabs={tabPages(current).map((page) => ({
                  href: href(page.slug),
                  label: page.label,
                  match: (p) => pathWithin(href(page.slug), p),
                }))}
                label={`Secciones de ${current.item.label}`}
              />
            </div>
          )}
          {children}
        </div>
      </div>
    </PageShell>
  );
}
