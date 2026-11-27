"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useViewer } from "@/components/viewer-context";
import type { Permission } from "@/lib/auth/permissions";

/**
 * 031 (A2) — Subpestañas de una sección (Campañas, Laboratorio…), extraídas
 * de `CampaignsTabs`. Son rutas: el enlace se comparte y Atrás funciona.
 * `permission` oculta la pestaña a quien no puede (el servidor lo valida
 * igual); `match` deja que una pestaña siga activa en sus rutas hijas.
 */
export type SectionTab = {
  href: string;
  label: string;
  permission?: Permission;
  match?: (pathname: string) => boolean;
};

/** 039 — Cómo se pinta cada pestaña según la variante. */
const TAB_CLASS = {
  inline: (active: boolean) =>
    cn(
      "whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-sm transition-colors",
      active ? "border-brand font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
    ),
  // Dentro de la fila de 56 px de `PageShell`: píldora como el renglón del menú lateral.
  pill: (active: boolean) =>
    cn(
      "flex shrink-0 items-center whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active ? "bg-brand-tint text-brand-text" : "text-text-2 hover:bg-accent hover:text-foreground"
    ),
  // Sub-secciones dentro del contenido (Ajustes, Tareas y notas): control segmentado.
  segmented: (active: boolean) =>
    cn(
      "flex shrink-0 items-center whitespace-nowrap rounded-[7px] px-3 py-1 text-[13px] font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active ? "bg-card text-foreground shadow-sm" : "text-text-2 hover:text-foreground"
    ),
} as const;

const NAV_CLASS = {
  inline: "-mb-px mt-2 flex gap-1 overflow-x-auto",
  pill: "flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]",
  segmented: "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md bg-muted p-[3px] [scrollbar-width:none]",
} as const;

type SectionTabsVariant = keyof typeof TAB_CLASS;

export function SectionTabs({
  tabs,
  label,
  variant = "inline",
  className,
}: {
  tabs: readonly SectionTab[];
  label: string;
  /**
   * `inline`: pestañas anidadas con subrayado. 039 — `pill`: las del pilar,
   * dentro de la fila de 56 px de `PageShell`; `segmented`: sub-secciones
   * dentro del contenido (nunca una segunda barra bajo el encabezado).
   */
  variant?: SectionTabsVariant;
  className?: string;
}) {
  const pathname = usePathname();
  const viewer = useViewer();
  const edges = useScrollEdges(pathname);
  return (
    <nav
      ref={edges.ref}
      aria-label={label}
      className={cn(NAV_CLASS[variant], className)}
      style={edges.style}
      data-more-left={edges.left || undefined}
      data-more-right={edges.right || undefined}
    >
      {tabs
        .filter((t) => !t.permission || viewer.can(t.permission))
        .map((t) => {
          const active = t.match ? t.match(pathname) : pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={TAB_CLASS[variant](active)}
            >
              {t.label}
            </Link>
          );
        })}
    </nav>
  );
}

/**
 * Auditoría UX 2026-11 (22) — En el celular las pestañas se cortaban («Bibl»,
 * «Métric») sin pista de que hay más. Con más pestañas que ancho, el borde
 * que esconde algo se desvanece, y la pestaña activa se trae a la vista al
 * entrar (sin mover la página, solo la tira).
 */
const FADE = "28px";
function useScrollEdges(pathname: string) {
  const ref = useRef<HTMLElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (active && el.scrollWidth > el.clientWidth) {
      const start = active.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft;
      const end = start + active.offsetWidth;
      if (start < el.scrollLeft || end > el.scrollLeft + el.clientWidth) {
        el.scrollLeft = Math.max(0, start - 24);
      }
    }
    const update = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setEdge((p) => (p.left === left && p.right === right ? p : { left, right }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [pathname]);
  const mask =
    edge.left || edge.right
      ? `linear-gradient(to right, ${edge.left ? "transparent" : "#000"} 0, #000 ${edge.left ? FADE : "0px"}, #000 calc(100% - ${edge.right ? FADE : "0px"}), ${edge.right ? "transparent" : "#000"} 100%)`
      : undefined;
  return {
    ref,
    left: edge.left,
    right: edge.right,
    style: mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined,
  };
}
