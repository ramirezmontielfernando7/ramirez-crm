"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, LogOut, Gauge, Settings, ShieldCheck, Sparkles, UsersRound, Smartphone, type LucideIcon } from "lucide-react";
import { useViewer } from "@/components/viewer-context";
import { ContactAvatar } from "@/components/avatar";
import { ThemeToggle } from "@/components/theme-toggle";
import { AvisosMenu } from "@/components/notifications/avisos-menu";
import { TeamUnreadRowBadge } from "@/components/team-chat/unread-badge";
import { NAV_ICONS } from "@/components/nav-icons";
import { navItemOf } from "@/components/app-nav";
import { signOut } from "@/lib/auth/client";
import { openUsageDialog } from "@/lib/usage-dialog";
import { moduleDef } from "@/lib/modules/registry";
import { availableSections, type NavEntries } from "@/lib/modules/nav-layout";
import { MOBILE_TAB_COUNT } from "@/components/mobile-tabbar";
import type { ThemePreference } from "@/lib/theme";

/**
 * Pantalla «Más» del teléfono (maqueta D, app móvil): tu tarjeta y, en una
 * lista sencilla, todo lo que no cabe en la barra de abajo. Reemplaza al
 * cajón lateral en el teléfono; en escritorio no existe (el lateral es fijo).
 * Ocultar es solo estético: cada ruta valida módulo y permiso en el servidor.
 */
export function MobileMore({
  nav,
  userName,
  theme,
  platform,
  onClose,
}: {
  nav?: NavEntries;
  userName: string;
  theme: ThemePreference;
  platform: boolean;
  onClose: () => void;
}) {
  const viewer = useViewer();
  const router = useRouter();
  const keys = nav?.keys ?? [];
  const tabs = new Set(keys.slice(0, MOBILE_TAB_COUNT));
  const modules = { has: viewer.hasModule };

  // Trabajo: Agenda y Tareas (pestañas del CRM Comercial), el chat de equipo,
  // «Mi número» y los pilares que no caben abajo (menos el Asistente, que va aparte).
  const work: Row[] = [];
  if (keys.includes("pipeline")) {
    for (const s of availableSections(moduleDef("pipeline"), modules, viewer.can)) {
      if (s.module === "agenda" || s.module === "trabajo") {
        work.push({ href: s.route, label: s.label, icon: s.module === "agenda" ? NAV_ICONS.CalendarDays : NAV_ICONS.ListChecks });
      }
    }
  }
  if (viewer.hasModule("team_chat")) work.push({ href: "/chat", label: "Chat de equipo", icon: UsersRound, team: true });
  if (viewer.hasMyNumber || viewer.seesTeamNumbers) {
    work.push({ href: "/inbox/mi-numero", label: viewer.hasMyNumber ? "Mi número" : "Números", icon: Smartphone });
  }
  for (const k of keys) {
    if (tabs.has(k) || k === "asistente" || k === "inbox") continue;
    const item = navItemOf(k, nav?.hrefs?.[k]);
    work.push({ href: item.href, label: item.label, icon: item.icon });
  }
  if (platform) work.push({ href: "/platform", label: "Plataforma", icon: ShieldCheck });

  const assistant = keys.includes("asistente") ? navItemOf("asistente", nav?.hrefs?.asistente).href : null;

  return (
    <div data-testid="mobile-more" className="mobile-more absolute inset-0 z-30 flex flex-col overflow-y-auto bg-surface lg:hidden">
      <h1 className="px-[18px] pb-1.5 pt-3 text-[26px] font-bold leading-tight">Más</h1>
      <div className="flex items-center gap-3.5 border-b-8 border-subtle px-[18px] pb-[18px] pt-3.5">
        <ContactAvatar name={userName} seed={viewer.userId} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-[18px] font-semibold">{userName}</p>
          <p className="mt-0.5 text-[13px] text-text-2">{viewer.roleLabel}</p>
        </div>
      </div>

      {work.length > 0 && <Group title="Trabajo" rows={work} onClose={onClose} />}

      {assistant && (
        <Group title="Asistente" rows={[{ href: assistant, label: "Preguntar al asistente", icon: Sparkles }]} onClose={onClose} />
      )}

      <p className="px-[18px] pb-1 pt-4 text-[12.5px] font-semibold uppercase tracking-[0.04em] text-text-3">Cuenta</p>
      <div className="mobile-more-avisos px-2">
        <AvisosMenu />
      </div>
      {nav?.settings && <RowLink row={{ href: "/settings", label: "Ajustes", icon: Settings }} onClose={onClose} />}
      {viewer.can("usage.read") && (
        <button type="button" onClick={() => openUsageDialog()} className={rowClass}>
          <Gauge className="h-[22px] w-[22px] text-text-2" strokeWidth={1.7} />
          Uso y plan
        </button>
      )}
      <div className={rowClass}>
        <span className="flex h-[22px] w-[22px] items-center justify-center">
          <ThemeToggle initial={theme} className="-m-1 text-text-2" />
        </span>
        Tema claro / oscuro
      </div>
      <button
        type="button"
        onClick={async () => {
          await signOut();
          router.push("/login");
          router.refresh();
        }}
        className={rowClass}
      >
        <LogOut className="h-[22px] w-[22px] text-text-2" strokeWidth={1.7} />
        Cerrar sesión
      </button>
      <div className="h-6 shrink-0" />
    </div>
  );
}

type Row = { href: string; label: string; icon: LucideIcon; team?: boolean };

const rowClass =
  "flex w-full items-center gap-[18px] px-[18px] py-[13px] text-left text-[15.5px] transition-colors active:bg-row-hover";

function Group({ title, rows, onClose }: { title: string; rows: Row[]; onClose: () => void }) {
  return (
    <>
      <p className="px-[18px] pb-1 pt-4 text-[12.5px] font-semibold uppercase tracking-[0.04em] text-text-3">{title}</p>
      {rows.map((r) => (
        <RowLink key={r.href} row={r} onClose={onClose} />
      ))}
    </>
  );
}

function RowLink({ row, onClose }: { row: Row; onClose: () => void }) {
  const Icon = row.icon;
  return (
    // Al tocar se cierra al instante: la pantalla nueva llega detrás.
    <Link href={row.href} onClick={onClose} className={rowClass}>
      <Icon className="h-[22px] w-[22px] text-text-2" strokeWidth={1.7} />
      <span className="flex-1">{row.label}</span>
      {row.team && <TeamUnreadRowBadge />}
      <ChevronRight className="h-4 w-4 text-text-4" strokeWidth={1.7} />
    </Link>
  );
}
