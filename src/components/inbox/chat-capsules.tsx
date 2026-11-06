"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import { cn } from "@/lib/utils";
import type { ConversationDto, StageDto } from "@/lib/types";
import { stageDot, tagColorClass, tagDotClass, type TagDto } from "@/lib/tags";
import { FloatingMenu, type MenuAnchor } from "./floating-menu";

/**
 * 034 — Las tres cápsulas de la fila de la Bandeja, debajo del preview:
 *
 *   [Etapa ▾] · [Alumno +2 ▾] · [Sin asignar ▾]
 *
 * Cada una es un botón con su PROPIO menú (se cierra al tocar fuera). Tocarla
 * nunca abre el chat: frena el clic y el inicio de la pulsación larga de la
 * fila. Cambian el dato con las rutas de siempre y pintan el cambio al
 * instante (`onPatch`); si el servidor lo rechaza, vuelven a lo que había
 * (`onRefetch`) y lo dicen (`onError`).
 */

/** El punto de una etapa: su color elegido, o el respaldo por nombre (ver `stageDot`). */
function StageDotMark({ color, name, className }: { color: string | null | undefined; name: string | null | undefined; className?: string }) {
  const d = stageDot(color, name);
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", d.className, className)} style={d.style} aria-hidden />;
}

/** UNA medida para las cápsulas: 20 px de alto, relleno suave en vez de borde. */
const CAPSULE =
  "relative inline-flex h-[18px] max-w-full items-center gap-1 rounded-full px-2 text-[11px] font-medium leading-none transition-colors " +
  // Zona de toque más grande que la píldora (20 px es poco para un dedo).
  "before:absolute before:-inset-x-0.5 before:-inset-y-1.5 before:content-[''] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export type PatchRow = (id: string, patch: Partial<ConversationDto>) => void;

type Shared = {
  conversation: ConversationDto;
  onPatch: PatchRow;
  onRefetch: () => void;
  onError: (message: string) => void;
};

type ApiBody = {
  error?: { message?: string };
  tags?: TagDto[];
  tag?: TagDto;
};

async function request(
  url: string,
  method: string,
  body?: unknown
): Promise<{ error: string | null; data: ApiBody | null }> {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { error: "Sin conexión con el servidor", data: null };
  const data = (await res.json().catch(() => null)) as ApiBody | null;
  if (res.ok) return { error: null, data };
  return { error: data?.error?.message ?? "No se pudo guardar el cambio", data };
}

/** El botón de una cápsula + su menú. Abre/cierra, sin tocar la fila. */
function CapsuleMenu({
  label,
  trigger,
  className,
  children,
  menuClassName,
}: {
  label: string;
  trigger: React.ReactNode;
  className?: string;
  menuClassName?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        aria-label={label}
        // Ni el clic ni el inicio de una pulsación larga llegan a la fila.
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (anchor) return close();
          const rect = ref.current?.getBoundingClientRect();
          if (rect) setAnchor({ kind: "rect", rect });
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className={cn(CAPSULE, className)}
      >
        {trigger}
      </button>
      {anchor && (
        <FloatingMenu anchor={anchor} onClose={close} label={label} triggerRef={ref} className={menuClassName}>
          {children(close)}
        </FloatingMenu>
      )}
    </>
  );
}

function Option({
  selected,
  disabled,
  title,
  role = "menuitemradio",
  onSelect,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  title?: string;
  role?: "menuitemradio" | "menuitemcheckbox";
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={selected}
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className={cn(
        "flex min-h-8 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "bg-brand-tint font-semibold text-brand-text" : "text-foreground hover:bg-accent"
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <Check className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} strokeWidth={2} aria-hidden />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Etapa                                                               */
/* ------------------------------------------------------------------ */

export function StageCapsule({ conversation: c, stages, onPatch, onRefetch, onError }: Shared & { stages: StageDto[] }) {
  // Un chat sin lead (p. ej. uno anterior al arreglo de los echoes) no tiene
  // etapa que cambiar: se dice, sin menú.
  if (!c.leadId) {
    return (
      <span className={cn(CAPSULE, "shrink-0 cursor-default bg-transparent px-1 font-normal text-text-2 before:hidden")}>
        Sin etapa
      </span>
    );
  }

  async function pick(stage: StageDto, close: () => void) {
    close();
    if (stage.id === c.stageId) return;
    const before = { stageId: c.stageId, stageName: c.stageName, stageColor: c.stageColor };
    onPatch(c.id, { stageId: stage.id, stageName: stage.name, stageColor: stage.color ?? null });
    const { error } = await request(`/api/pipeline/leads/${c.leadId}`, "PATCH", { stageId: stage.id });
    if (error) {
      onPatch(c.id, before);
      onError(error);
      onRefetch();
    }
  }

  const name = c.stageName ?? "Etapa";
  return (
    <CapsuleMenu
      label={`Etapa: ${name}. Cambiar etapa`}
      className="shrink-0 bg-secondary text-text-2 hover:bg-accent"
      trigger={
        <>
          <StageDotMark color={c.stageColor} name={name} />
          <span className="truncate">{name}</span>
        </>
      }
    >
      {(close) => (
        <>
          <p className="kicker px-2 pb-1 pt-1">Etapa</p>
          {stages.length === 0 && <p className="px-2 py-1.5 text-[12px] text-text-3">Cargando…</p>}
          {stages.map((s) => {
            // Perder un trato pide el motivo, que se captura en Detalles.
            const lost = s.kind === "lost";
            return (
              <Option
                key={s.id}
                selected={s.id === c.stageId}
                disabled={lost && s.id !== c.stageId}
                title={lost ? "Para marcarla como perdida indica el motivo en Detalles" : undefined}
                onSelect={() => void pick(s, close)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <StageDotMark color={s.color} name={s.name} className="h-2 w-2" />
                  <span className="truncate">{s.name}</span>
                </span>
              </Option>
            );
          })}
        </>
      )}
    </CapsuleMenu>
  );
}

/* ------------------------------------------------------------------ */
/* Etiquetas                                                           */
/* ------------------------------------------------------------------ */

export function TagsCapsule({
  conversation: c,
  catalog,
  canCreate,
  onCatalogAdd,
  onPatch,
  onRefetch,
  onError,
}: Shared & { catalog: TagDto[]; canCreate: boolean; onCatalogAdd: (tag: TagDto) => void }) {
  const first = c.tags[0];
  const more = c.tags.length - 1;

  async function save(next: TagDto[]) {
    const before = c.tags;
    onPatch(c.id, { tags: next });
    const { error, data } = await request(`/api/contacts/${c.contact.id}/tags`, "PUT", {
      tagIds: next.map((t) => t.id),
    });
    if (error) {
      onPatch(c.id, { tags: before });
      onError(error);
      onRefetch();
      return;
    }
    if (Array.isArray(data?.tags)) onPatch(c.id, { tags: data.tags });
  }

  // Ronda 3: sin etiquetas no se pinta nada (se agregan desde Detalles).
  if (!first) return null;
  return (
    <CapsuleMenu
      label={`Etiquetas: ${c.tags.map((t) => t.name).join(", ")}. Editar`}
      className="min-w-0 shrink gap-1.5 bg-transparent px-0 before:-inset-x-0.5"
      menuClassName="w-60"
      trigger={
        <>
          <span className={cn("inline-flex h-[18px] min-w-0 items-center rounded-full px-2", tagColorClass(first.color))}>
            <span className="truncate">{first.name}</span>
          </span>
          {more > 0 && (
            <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-secondary px-2 tabular-nums text-text-2">
              +{more}
            </span>
          )}
        </>
      }
    >
      {() => <TagsMenu conversation={c} catalog={catalog} canCreate={canCreate} onCatalogAdd={onCatalogAdd} save={save} onError={onError} />}
    </CapsuleMenu>
  );
}

/**
 * Ronda 3 — «+ Agregar» de la sección Etiquetas de Detalles: el MISMO menú
 * de la cápsula (buscar, marcar, crear), con otro botón.
 */
export function TagsAddButton({
  conversation: c,
  catalog,
  canCreate,
  onCatalogAdd,
  onPatch,
  onRefetch,
  onError,
  onSaved,
}: Shared & { catalog: TagDto[]; canCreate: boolean; onCatalogAdd: (tag: TagDto) => void; onSaved?: () => void }) {
  async function save(next: TagDto[]) {
    const before = c.tags;
    onPatch(c.id, { tags: next });
    const { error, data } = await request(`/api/contacts/${c.contact.id}/tags`, "PUT", {
      tagIds: next.map((t) => t.id),
    });
    if (error) {
      onPatch(c.id, { tags: before });
      onError(error);
      onRefetch();
      return;
    }
    if (Array.isArray(data?.tags)) onPatch(c.id, { tags: data.tags });
    onSaved?.();
  }
  return (
    <CapsuleMenu
      label="Agregar o quitar etiquetas"
      className="h-auto bg-transparent px-0 text-[12px] font-medium normal-case tracking-normal text-brand-ink hover:underline before:hidden"
      menuClassName="w-60"
      trigger={<span>+ Agregar</span>}
    >
      {() => <TagsMenu conversation={c} catalog={catalog} canCreate={canCreate} onCatalogAdd={onCatalogAdd} save={save} onError={onError} />}
    </CapsuleMenu>
  );
}

function TagsMenu({
  conversation: c,
  catalog,
  canCreate,
  onCatalogAdd,
  save,
  onError,
}: {
  conversation: ConversationDto;
  catalog: TagDto[];
  canCreate: boolean;
  onCatalogAdd: (tag: TagDto) => void;
  save: (next: TagDto[]) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const q = query.trim().toLowerCase();
  const owned = useMemo(() => new Set(c.tags.map((t) => t.id)), [c.tags]);
  const shown = catalog.filter((t) => !q || t.name.toLowerCase().includes(q));
  const exact = catalog.some((t) => t.name.toLowerCase() === q);

  function toggle(tag: TagDto) {
    void save(owned.has(tag.id) ? c.tags.filter((t) => t.id !== tag.id) : [...c.tags, tag]);
  }

  async function create() {
    setCreating(true);
    const { error, data } = await request("/api/contact-tags", "POST", { name: query.trim() });
    setCreating(false);
    if (error || !data?.tag) {
      onError(error ?? "No se pudo crear la etiqueta");
      return;
    }
    const tag = data.tag;
    onCatalogAdd(tag);
    setQuery("");
    void save([...c.tags, tag]);
  }

  return (
    <>
      <div className="relative px-1 pb-1 pt-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-3" strokeWidth={1.8} aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar etiqueta"
          aria-label="Buscar etiqueta"
          // 16 px en touch evita el zoom automático de iOS al enfocar.
          className="h-8 w-full rounded-md border border-input bg-card pl-7 pr-2 text-base md:text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {shown.map((t) => (
        <Option key={t.id} role="menuitemcheckbox" selected={owned.has(t.id)} onSelect={() => toggle(t)}>
          <span className="flex min-w-0 items-center gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", tagDotClass(t.color))} aria-hidden />
            <span className="truncate">{t.name}</span>
          </span>
        </Option>
      ))}
      {shown.length === 0 && !(canCreate && q && !exact) && (
        <p className="px-2 py-1.5 text-[12px] text-text-3">
          {catalog.length === 0 ? "Aún no hay etiquetas." : "Sin coincidencias."}
        </p>
      )}
      {canCreate && q && !exact && (
        <button
          type="button"
          role="menuitem"
          disabled={creating}
          onClick={() => void create()}
          className="flex min-h-8 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] font-medium text-brand-text hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <span className="truncate">Crear «{query.trim()}»</span>
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Asignado                                                            */
/* ------------------------------------------------------------------ */

export function AssigneeCapsule({
  conversation: c,
  members,
  canAssign,
  viewerId,
  onPatch,
  onRefetch,
  onError,
  variant = "capsule",
}: Shared & {
  /** Ronda 3: «header» = el selector del encabezado del chat; «plain» = el renglón «Asignado» de Detalles. */
  variant?: "capsule" | "header" | "plain";
  members: { userId: string; name: string }[];
  /** `assignment.manage`: sin él la cápsula solo informa. */
  canAssign: boolean;
  viewerId: string;
}) {
  const label = c.assignee ? (c.assignee.id === viewerId ? "Tú" : c.assignee.name) : "Sin asignar";
  const tone = cn(
    "min-w-[3rem] shrink",
    c.assignee ? "bg-secondary text-text-2" : "pm-empty bg-transparent px-1 font-normal text-text-2"
  );
  const header = variant !== "capsule";
  const headerTrigger = (
    <>
      {c.assignee ? (
        <ContactAvatar name={c.assignee.name} size="xs" />
      ) : null}
      <span className="truncate">{c.assignee ? shortName(c.assignee.name) : "Sin asignar"}</span>
      {variant === "header" && <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-3" strokeWidth={1.75} aria-hidden />}
    </>
  );
  const headerClass =
    variant === "plain"
      ? "h-6 max-w-full gap-1.5 rounded-control bg-transparent pl-0 pr-1 text-[13px] font-normal text-foreground hover:bg-row-hover before:hidden"
      : cn(
          "h-8 max-w-[11rem] gap-2 rounded-control border border-border-strong bg-surface pr-2 text-[14px] font-normal text-text-2 hover:bg-row-hover before:hidden",
          c.assignee ? "pl-1" : "pl-2.5"
        );

  if (!canAssign) {
    if (header) {
      return (
        <span className={cn(CAPSULE, headerClass, "cursor-default pr-2.5 hover:bg-surface")} title={`Atiende: ${label}`}>
          {c.assignee && <ContactAvatar name={c.assignee.name} size="xs" />}
          <span className="truncate">{c.assignee ? shortName(c.assignee.name) : "Sin asignar"}</span>
        </span>
      );
    }
    return (
      <span className={cn(CAPSULE, tone, "cursor-default before:hidden")} title={`Atiende: ${label}`}>
        <span className="truncate">{label}</span>
      </span>
    );
  }

  async function pick(userId: string | null, name: string | null, close: () => void) {
    close();
    if ((c.assignee?.id ?? null) === userId) return;
    const before = c.assignee;
    onPatch(c.id, { assignee: userId ? { id: userId, name: name ?? "" } : null });
    const { error } = await request("/api/assignments", "POST", { contactIds: [c.contact.id], userId });
    if (error) {
      onPatch(c.id, { assignee: before });
      onError(error);
      onRefetch();
    }
  }

  return (
    <CapsuleMenu
      label={header ? `Asignar a: ${label}. Cambiar` : `Asignado: ${label}. Cambiar`}
      className={header ? headerClass : cn(tone, "hover:bg-accent")}
      trigger={header ? headerTrigger : <span className="truncate">{label}</span>}
    >
      {(close) => (
        <>
          <p className="kicker px-2 pb-1 pt-1">Asignar a</p>
          <Option selected={!c.assignee} onSelect={() => void pick(null, null, close)}>
            Sin asignar
          </Option>
          {members.map((m) => (
            <Option key={m.userId} selected={c.assignee?.id === m.userId} onSelect={() => void pick(m.userId, m.name, close)}>
              {m.userId === viewerId ? `${m.name} (tú)` : m.name}
            </Option>
          ))}
        </>
      )}
    </CapsuleMenu>
  );
}


/** «Fernando Ramírez» → «Fernando R.»: el nombre corto del encabezado. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? name;
  return `${parts[0]} ${parts[1]![0]?.toUpperCase() ?? ""}.`;
}
