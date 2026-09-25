"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  ChartColumn,
  FlaskConical,
  Inbox,
  Kanban,
  LogOut,
  Megaphone,
  Settings,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { Branding } from "@/lib/branding";
import type { ThemePreference } from "@/lib/theme";
import { cn, initials } from "@/lib/utils";
import { signOut } from "@/lib/auth/client";
import { useEvents } from "@/components/use-events";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandLogo, BrandTile } from "@/components/brand-mark";
import { SPRING } from "@/components/motion";
import type { NavMode } from "@/lib/preferences";
import { isHouseName } from "@/lib/brand";
import { useViewer } from "@/components/viewer-context";
import { roleLabel, type Permission } from "@/lib/auth/permissions";
import {
  BUILD_COMMIT,
  UNVERIFIED_COMMIT_NOTE,
  versionLabel,
  versionTitle,
  type ResolvedCommit,
} from "@/lib/version";

type NavItem = {
  href: string;
  label: string;
  icon: typeof Inbox;
  badge?: boolean;
  /** 020 — sin este permiso la entrada no se pinta (la API ya lo niega). */
  permission?: Permission;
};

const NAV: NavItem[] = [
  { href: "/inbox", label: "Bandeja", icon: Inbox, badge: true },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/contacts", label: "Contactos", icon: Users },
  // 024 — Material que el equipo envía a los clientes: junto a Contactos,
  // porque se usa atendiendo. Todos los roles (editar: knowledge.manage).
  { href: "/knowledge", label: "Conocimientos", icon: BookOpen },
  // 019 — Después de Contactos: primero se atiende y se organiza, luego se
  // mide. Antes de Agente y Laboratorio, que son configuración.
  {
    href: "/results",
    label: "Resultados",
    icon: ChartColumn,
    // 022: el Asesor no tiene Resultados, colapsado o expandido.
    permission: "results.read",
  },
  { href: "/agent", label: "Agente", icon: Sparkles, permission: "agent.manage" },
  {
    href: "/lab",
    label: "Laboratorio",
    icon: FlaskConical,
    permission: "agent.manage",
  },
];

/** 015 — "Citas" solo existe si esta instancia encendió la agenda. */
const AGENDA_ITEM: NavItem = {
  href: "/bookings",
  label: "Citas",
  icon: CalendarDays,
};

/**
 * 021 — "Campañas" solo si la instancia encendió CAMPAIGNS y el rol puede
 * mandarlas. Va junto a Contactos: una campaña es mandarle algo a una parte
 * de la base.
 */
const CAMPAIGNS_ITEM: NavItem = {
  href: "/campaigns",
  label: "Campañas",
  icon: Megaphone,
  permission: "campaigns.manage",
};

/**
 * Un renglón del menú, como el `side-item` del mockup de la landing: texto
 * semibold, esquinas de 9px y, activo, lavado del acento con tinta azul.
 * Exportado para la vista previa de Configuración → Marca, que pinta la barra.
 */
export function navItemClass(active: boolean) {
  return cn(
    "flex items-center gap-[10px] rounded-sm px-2.5 py-2.5 text-[13.5px] font-semibold transition-colors lg:py-2",
    // Acento sólido: dentro de `.nav-dark` es el calculado para fondo oscuro,
    // así que contrasta con la barra (≥ 3.5:1) sea cual sea el white-label.
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    active
      ? "bg-brand-tint text-brand-text"
      : "text-text-2 hover:bg-accent hover:text-foreground"
  );
}

export function AppNav({
  branding,
  userName,
  role,
  theme,
  commit,
  agenda = false,
  campaigns = false,
  open = false,
  onClose,
  mode = "expanded",
  onCycleMode,
}: {
  branding: Branding;
  userName: string;
  role: string;
  theme: ThemePreference;
  /**
   * Commit resuelto en el servidor. Gana al de build porque puede venir de la
   * plataforma cuando quien construyó no lo pasó como build-arg — y en ese
   * caso llega con `verified: false`, y la insignia lo dice.
   */
  commit?: ResolvedCommit;
  /**
   * 015 — ¿hay agenda en esta instancia? Viene del servidor por prop y no se
   * deduce de los datos: una instancia con la agenda encendida pero sin citas
   * todavía debe ver la entrada igual.
   */
  agenda?: boolean;
  /** 021 — ¿hay Campañas en esta instancia? Viene del servidor. */
  campaigns?: boolean;
  /** Solo aplica por debajo de `lg`: en escritorio el lateral es fijo. */
  open?: boolean;
  onClose?: () => void;
  /**
   * 022 — Solo escritorio: expandida, en íconos u oculta (el hamburguesa
   * recorre el ciclo). El default depende del rol y la elección se guarda por
   * usuario (`user_preference`); en el teléfono el cajón siempre va completo.
   */
  mode?: NavMode;
  onCycleMode?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  // "Mini" = colapsado Y en escritorio. En el cajón del teléfono lo colapsado
  // no aplica: ahí el menú siempre se lee completo.
  const desktop = useIsDesktop();
  const mini = mode === "collapsed" && desktop;
  const house = isHouseName(branding.name);
  // Oculta: en escritorio la columna desaparece (el botón para volver lo pinta
  // AppShell). El cajón del teléfono no se entera: sigue abriendo completo.
  const hidden = mode === "hidden";
  const toggleLabel = mini ? "Ocultar el menú" : "Colapsar el menú";

  async function refetchUnread() {
    const res = await fetch("/api/conversations").catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as {
      conversations: { unreadCount: number }[];
    };
    setUnread(data.conversations.reduce((a, c) => a + c.unreadCount, 0));
  }

  useEffect(() => {
    void refetchUnread();
  }, []);

  useEvents({
    onMessageNew: () => void refetchUnread(),
    onConversationUpdated: () => void refetchUnread(),
  });

  async function signOutAndLeave() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  const version = commit ?? { commit: BUILD_COMMIT, verified: BUILD_COMMIT !== "" };
  const settingsActive = pathname.startsWith("/settings");
  // Citas va después de Pipeline: es el paso siguiente de un trato, no una
  // sección aparte.
  const viewer = useViewer();
  const base = agenda ? [...NAV.slice(0, 2), AGENDA_ITEM, ...NAV.slice(2)] : NAV;
  // 024: Campañas va después de Conocimientos, que se queda pegado a Contactos.
  const campaignsAfter = base.findIndex((i) => i.href === "/knowledge");
  const items = (
    campaigns ? [...base.slice(0, campaignsAfter + 1), CAMPAIGNS_ITEM, ...base.slice(campaignsAfter + 1)] : base
  ).filter((item) => !item.permission || viewer.can(item.permission));
  // Ajustes solo si hay al menos una pestaña que pueda abrir.
  const showSettings =
    viewer.can("settings.manage") ||
    viewer.can("templates.manage") ||
    viewer.can("users.read");

  return (
    <aside
      // Móvil: cajón que se desliza desde la izquierda (siempre montado, así
      // la transición corre en ambos sentidos). Escritorio: columna fija.
      // `visibility` va en la transición a propósito: al cerrar mantiene el
      // cajón visible mientras se desliza y recién entonces lo oculta, que es
      // lo que lo saca del orden de tabulación en móvil.
      className={cn(
        // `text-foreground` explícito: sin él, el texto sin color propio (el
        // nombre del usuario, el nombre white-label en BrandLogo) hereda el
        // color YA CALCULADO en <body> con el tema de la página, no el de
        // `.nav-dark` — y un texto oscuro sobre este fondo oscuro se pierde.
        "nav-dark fixed inset-y-0 left-0 z-50 flex w-[17rem] shrink-0 flex-col overflow-y-auto border-r bg-subtle px-3 pb-3.5 pt-3 text-foreground transition-[transform,visibility] duration-200",
        // En escritorio el ancho cambia de golpe (animar `width` recalcula el
        // layout de toda la página en cada cuadro); lo que se mueve con
        // resorte son los textos, solo con `opacity` + `transform`.
        // `relative z-10`: al reaparecer, la columna de contenido se desliza
        // desde DEBAJO del menú, no encima.
        "lg:relative lg:visible lg:z-10 lg:translate-x-0 lg:overflow-x-hidden",
        mini ? "lg:w-14 lg:px-2" : "lg:w-56",
        hidden && "lg:hidden",
        open ? "visible translate-x-0 shadow-pop" : "invisible -translate-x-full"
      )}
    >
      {/* Marca. En escritorio el LOGO es el botón del menú (expandido →
          íconos → oculto): el mosaico queda fijo a 12 px del borde en todos
          los estados — con el menú en íconos (56 px) queda centrado — y a su
          lado va el nombre. En el teléfono, la ✕ del cajón y la marca completa. */}
      <div
        className={cn(
          // El logo cae a 12 px del borde de arriba: centrado en los 56 px
          // del encabezado, como el que reabre el menú oculto junto al título.
          "mb-5 flex items-start gap-2.5",
          // El aside tiene 12 px de relleno expandido y 8 px en íconos: el
          // 4 px de más en íconos deja el logo exactamente donde estaba.
          mini && "lg:pl-1"
        )}
      >
        {/* En móvil el cajón necesita su propio cierre: el velo no siempre es
            alcanzable con el pulgar. */}
        <button
          onClick={onClose}
          aria-label="Cerrar el menú"
          className={cn(
            "-ml-1 rounded-md p-1.5 text-text-3 hover:bg-accent hover:text-foreground lg:hidden",
            !house && "mt-0.5"
          )}
        >
          <X className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
        {/* 022: expandido → íconos → oculto, con el logo como botón. Oculto,
            el que lo reabre va en la fila del título de cada pantalla
            (`NavRevealButton`), con el mismo logo. */}
        <button
          onClick={onCycleMode}
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={!mini}
          className="nav-logo-btn hidden h-8 w-8 shrink-0 rounded-[9px] transition-[transform,filter] duration-150 hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-subtle lg:flex"
        >
          <BrandTile branding={branding} className="h-8 w-8 rounded-[9px] text-[15px]" />
        </button>
        <div
          aria-hidden={mini || undefined}
          className={cn(
            "min-w-0 transition-[opacity,transform] duration-200 ease-spring",
            mini && "pointer-events-none -translate-x-1.5 opacity-0"
          )}
        >
          <BrandLogo branding={branding} className="lg:hidden" />
          <BrandLogo branding={branding} tile={false} className="hidden lg:flex" />
          {/* La firma "by Demfort" ya ocupa ese lugar en la marca de la casa. */}
          {!house && <span className="kicker mt-2 block whitespace-nowrap">CRM · WhatsApp</span>}
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={mini ? item.label : undefined}
              className={cn(navItemClass(active), "relative")}
            >
              <item.icon
                className={cn("h-[17px] w-[17px] shrink-0", active ? "text-brand" : "text-text-3")}
                strokeWidth={1.8}
              />
              <NavLabel mini={mini}>{item.label}</NavLabel>
              {item.badge && unread > 0 && (
                mini ? (
                  // Colapsado, el conteo es un punto sobre el ícono.
                  <span
                    aria-label={`${unread} sin leer`}
                    className="absolute left-[22px] top-1.5 h-2 w-2 rounded-full bg-brand"
                  />
                ) : (
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1.5 text-[10.5px] font-bold text-brand-fg">
                    {unread}
                  </span>
                )
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex-1" />

      {showSettings && (
        <Link
          href="/settings"
          title={mini ? "Ajustes" : undefined}
          className={navItemClass(settingsActive)}
        >
          <Settings
            className={cn("h-[17px] w-[17px] shrink-0", settingsActive ? "text-brand" : "text-text-3")}
            strokeWidth={1.8}
          />
          <NavLabel mini={mini}>Ajustes</NavLabel>
        </Link>
      )}

      {mini ? (
        <ProfileMenu
          userName={userName}
          roleText={viewer.roleLabel || roleLabel(role)}
          theme={theme}
          onSignOut={signOutAndLeave}
        />
      ) : (
        <div className="mt-1 flex items-center gap-2.5 rounded-sm px-2.5 py-2 hover:bg-accent">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-text">
            {initials(userName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{userName}</span>
            <span className="block truncate text-[11px] text-text-3">
              {viewer.roleLabel || roleLabel(role)} · En línea
            </span>
          </span>
          <ThemeToggle initial={theme} />
          <button
            aria-label="Cerrar sesión"
            title="Cerrar sesión"
            className="rounded p-1 text-text-3 hover:text-foreground"
            onClick={() => void signOutAndLeave()}
          >
            <LogOut className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      {/* Qué versión está corriendo. Discreta pero siempre visible: la duda
          "¿ya se desplegó?" aparece justo cuando algo no funciona, y mandar a
          alguien a comparar commits en el servidor significa que no lo hará. */}
      {/* `text-2` y no `text-3`: a 10.5px, el gris más claro no pasa AA contra
          el fondo de la barra. Discreta sí, ilegible no. */}
      {/* El nombre sale de la marca, no de una constante: esto es white-label,
          y una instancia rebautizada que dice "Vocero" en el tooltip delata el
          producto de debajo justo donde el operador la mira todos los días. */}
      {/* Un commit que no salió del build lo dice (#50): presentarlo igual
          que uno verificado es la insignia mintiendo justo cuando alguien la
          consulta para saber qué código corre. El aviso es el ícono (color de
          advertencia: basta 3:1 para un gráfico) y el texto va en `text-2`,
          que pasa AA sobre la barra en cualquier tema. */}
      <p
        className={cn(
          "mt-2 px-2.5 font-mono text-[10.5px] tracking-[0.06em] text-text-2",
          // Colapsado no cabe: sigue en el tooltip del menú expandido.
          mini && "lg:hidden"
        )}
        title={versionTitle(branding.name, version)}
      >
        {versionLabel(version.commit)}
        {version.commit && !version.verified && (
          <span className="mt-0.5 flex items-center gap-1">
            <AlertTriangle
              className="h-3 w-3 shrink-0 text-warning-text"
              strokeWidth={2}
              aria-hidden
            />
            {UNVERIFIED_COMMIT_NOTE}
          </span>
        )}
      </p>
    </aside>
  );
}

/**
 * El texto de un renglón: al expandir entra deslizándose con resorte; al
 * colapsar se desvanece (el ancho lo recorta). Solo `opacity` + `transform`.
 */
function NavLabel({ mini, children }: { mini: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "flex-1 whitespace-nowrap transition-[opacity,transform] duration-200 ease-spring",
        mini && "-translate-x-1.5 opacity-0"
      )}
    >
      {children}
    </span>
  );
}

/** ¿Escritorio (lg+)? Arranca en `true` para que el servidor pinte la barra
 *  como la verá el escritorio; en el teléfono el cajón nace cerrado, así que
 *  corregirlo al montar no se nota. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return desktop;
}

/**
 * 022 — El perfil con la barra colapsada: solo el avatar. Al tocarlo sale una
 * tarjeta con nombre, rol, tema y cerrar sesión. Va en un portal: la barra
 * recorta lo que se sale de su ancho.
 */
function ProfileMenu({
  userName,
  roleText,
  theme,
  onSignOut,
}: {
  userName: string;
  roleText: string;
  theme: ThemePreference;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (card.current?.contains(t) || button.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle() {
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ left: r.right + 10, bottom: window.innerHeight - r.bottom });
    setOpen((v) => !v);
  }

  return (
    <>
      <button
        ref={button}
        onClick={toggle}
        aria-label={`${userName} · ${roleText}`}
        title={`${userName} · ${roleText}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="mt-1 flex items-center justify-center rounded-sm py-2 transition-transform duration-150 hover:bg-accent active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-text">
          {initials(userName)}
        </span>
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <m.div
                ref={card}
                role="dialog"
                aria-label="Tu perfil"
                initial={{ opacity: 0, scale: 0.96, x: -4 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.98, x: -2, transition: { duration: 0.1 } }}
                transition={SPRING}
                style={{ left: pos.left, bottom: pos.bottom, transformOrigin: "bottom left" }}
                className="nav-dark fixed z-50 w-60 rounded-md border bg-subtle p-2 text-foreground shadow-pop"
              >
                <div className="flex items-center gap-2.5 px-1.5 py-1.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-text">
                    {initials(userName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{userName}</span>
                    <span className="block truncate text-[11px] text-text-3">{roleText} · En línea</span>
                  </span>
                  <ThemeToggle initial={theme} />
                  <button
                    aria-label="Cerrar sesión"
                    title="Cerrar sesión"
                    className="rounded p-1 text-text-3 hover:text-foreground"
                    onClick={() => void onSignOut()}
                  >
                    <LogOut className="h-4 w-4" strokeWidth={1.7} />
                  </button>
                </div>
              </m.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}
