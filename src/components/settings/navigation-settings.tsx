"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, GripVertical, Lock, RotateCcw } from "lucide-react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { ROLE_LABEL, type Role } from "@/lib/auth/permissions";
import { moduleDef, type ModuleKey } from "@/lib/modules/registry";
import { LAYOUT_ROLES, isLocked, type NavLayoutItem } from "@/lib/modules/nav-layout";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { NAV_ICONS, navItemClass } from "@/components/app-nav";

type RoleState = { items: NavLayoutItem[]; customized: boolean; available: ModuleKey[] };
type NavEvent = { id: string; role: Role; action: "saved" | "reset"; actorName: string | null; at: string };
type Data = { roles: Record<Role, RoleState>; events: NavEvent[] };

/**
 * 030 (PR 4) — Ajustes → Navegación. El Propietario reordena y oculta las
 * entradas del menú de cada rol: arrastrando, o con el teclado (flechas en la
 * manija, o los botones ↑ ↓). Vista previa en los estados del menú
 * (expandido y en íconos; oculto y móvil usan la misma lista).
 *
 * Ocultar es SOLO estético: lo que un rol no puede abrir (módulo apagado o
 * sin permiso) no aparece aunque se marque visible, y lo oculto sigue
 * respondiendo si alguien escribe la dirección. La API valida las reglas.
 */
export function NavigationSettingsClient() {
  const [data, setData] = useState<Data | null>(null);
  const [role, setRole] = useState<Role>("asesor");
  const [draft, setDraft] = useState<NavLayoutItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchJson<Data>("/api/settings/navigation");
    if (!res.ok) {
      setError(`No se pudo cargar el menú: ${res.error}`);
      return;
    }
    setData(res.data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = data?.roles[role] ?? null;
  const items = draft ?? current?.items ?? [];
  const available = useMemo(() => new Set(current?.available ?? []), [current]);
  const main = items.filter((i) => !moduleDef(i.key).pinnedBottom);
  const pinned = items.filter((i) => moduleDef(i.key).pinnedBottom);
  const visible = items.filter((i) => !i.hidden && available.has(i.key));
  const dirty = draft !== null;
  const empty = visible.length === 0;

  function pickRole(next: Role) {
    if (dirty && !window.confirm("Hay cambios sin guardar en este rol. ¿Descartarlos?")) return;
    setDraft(null);
    setError(null);
    setNotice(null);
    setRole(next);
  }

  function update(next: NavLayoutItem[]) {
    setNotice(null);
    setDraft([...next.filter((i) => !moduleDef(i.key).pinnedBottom), ...next.filter((i) => moduleDef(i.key).pinnedBottom)]);
  }

  function move(key: ModuleKey, delta: -1 | 1) {
    const from = main.findIndex((i) => i.key === key);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= main.length) return;
    update([...arrayMove(main, from, to), ...pinned]);
    setNotice(`${moduleDef(key).label}: posición ${to + 1} de ${main.length}`);
  }

  function toggle(key: ModuleKey, show: boolean) {
    update(items.map((i) => (i.key === key ? { ...i, hidden: !show } : i)));
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = main.findIndex((i) => i.key === active.id);
    const to = main.findIndex((i) => i.key === over.id);
    if (from < 0 || to < 0) return;
    update([...arrayMove(main, from, to), ...pinned]);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetchJson<{ items: NavLayoutItem[] }>("/api/settings/navigation", jsonInit("PUT", { role, items }));
    setBusy(false);
    if (!res.ok) {
      setError(`No se guardó: ${res.error}`);
      return;
    }
    setDraft(null);
    setNotice(`Menú de ${ROLE_LABEL[role]} guardado. Se verá al recargar la página.`);
    await load();
  }

  async function reset() {
    if (!window.confirm(`¿Restaurar el menú de fábrica para ${ROLE_LABEL[role]}?`)) return;
    setBusy(true);
    setError(null);
    const res = await fetchJson<{ items: NavLayoutItem[] }>(`/api/settings/navigation?role=${role}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError(`No se restauró: ${res.error}`);
      return;
    }
    setDraft(null);
    setNotice(`Menú de ${ROLE_LABEL[role]} restaurado a los valores por defecto.`);
    await load();
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (!data) {
    return error ? <p className="text-sm text-danger-text">{error}</p> : <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="max-w-4xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Elige qué entradas del menú ve cada rol y en qué orden. Es solo apariencia: lo que un rol no puede
        abrir no aparece aunque lo marques, y ocultar algo no le quita el permiso.
      </p>

      <div role="tablist" aria-label="Rol" className="flex flex-wrap gap-1.5">
        {LAYOUT_ROLES.map((r) => (
          <button
            key={r}
            role="tab"
            type="button"
            aria-selected={r === role}
            onClick={() => pickRole(r)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
              r === role ? "border-brand bg-brand-tint text-brand-text" : "text-text-2 hover:bg-accent"
            )}
          >
            {ROLE_LABEL[r]}
            {data.roles[r].customized && <span className="ml-1.5 text-[11px] font-normal text-text-3">· personalizado</span>}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <Card>
          <CardHeader>
            <CardTitle>Menú de {ROLE_LABEL[role]}</CardTitle>
            <CardDescription>
              Arrastra por la manija o usa ↑ ↓ (con el teclado: Tab hasta la manija, Espacio para tomarla,
              flechas para moverla y Espacio para soltarla).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
              accessibility={{
                screenReaderInstructions: {
                  draggable:
                    "Para mover esta entrada, presiona Espacio. Usa las flechas arriba y abajo para cambiarla de lugar y Espacio para soltarla, o Escape para cancelar.",
                },
                announcements: {
                  onDragStart: ({ active }) => `Tomaste ${label(active.id)}.`,
                  onDragOver: ({ active, over }) =>
                    over ? `${label(active.id)} sobre ${label(over.id)}.` : `${label(active.id)} fuera de la lista.`,
                  onDragEnd: ({ active, over }) =>
                    over ? `Soltaste ${label(active.id)} en el lugar de ${label(over.id)}.` : `Soltaste ${label(active.id)}.`,
                  onDragCancel: ({ active }) => `Cancelaste mover ${label(active.id)}.`,
                },
              }}
            >
              <SortableContext items={main.map((i) => i.key)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-1.5" aria-label={`Entradas del menú de ${ROLE_LABEL[role]}`}>
                  {main.map((item, index) => (
                    <SortableRow
                      key={item.key}
                      item={item}
                      index={index}
                      total={main.length}
                      available={available.has(item.key)}
                      locked={isLocked(role, item.key)}
                      onMove={move}
                      onToggle={toggle}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            {pinned.length > 0 && (
              <ul className="space-y-1.5 border-t pt-3" aria-label="Anclado abajo">
                {pinned.map((item) => (
                  <Row
                    key={item.key}
                    item={item}
                    available={available.has(item.key)}
                    locked={isLocked(role, item.key)}
                    onToggle={toggle}
                    note="Va siempre abajo"
                  />
                ))}
              </ul>
            )}

            {empty && (
              <p role="alert" className="text-sm text-danger-text">
                Cada rol debe conservar al menos una entrada visible.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger-text">
                {error}
              </p>
            )}
            <p aria-live="polite" className="min-h-[1.25rem] text-sm text-text-2">
              {notice}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} disabled={!dirty || empty || busy}>
                Guardar
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)} disabled={!dirty || busy}>
                Descartar cambios
              </Button>
              <Button
                variant="outline"
                onClick={() => void reset()}
                disabled={busy || (!data.roles[role].customized && !dirty)}
                className="ml-auto"
              >
                <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
                Restaurar valores por defecto
              </Button>
            </div>
          </CardContent>
        </Card>

        <Preview role={role} visible={visible} />
      </div>

      <History events={data.events} />
    </div>
  );
}

function label(id: string | number): string {
  return moduleDef(String(id) as ModuleKey).label;
}

function SortableRow(props: {
  item: NavLayoutItem;
  index: number;
  total: number;
  available: boolean;
  locked: boolean;
  onMove: (key: ModuleKey, delta: -1 | 1) => void;
  onToggle: (key: ModuleKey, show: boolean) => void;
}) {
  const { item, index, total, onMove } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
  });
  const name = moduleDef(item.key).label;
  return (
    <Row
      {...props}
      rowRef={setNodeRef}
      style={{
        transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined,
        transition,
      }}
      dragging={isDragging}
      handle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Mover ${name} (posición ${index + 1} de ${total})`}
          className="cursor-grab touch-none rounded p-1 text-text-3 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" strokeWidth={1.8} />
        </button>
      }
      arrows={
        <span className="flex">
          <button
            type="button"
            onClick={() => onMove(item.key, -1)}
            disabled={index === 0}
            aria-label={`Subir ${name}`}
            className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => onMove(item.key, 1)}
            disabled={index === total - 1}
            aria-label={`Bajar ${name}`}
            className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground disabled:opacity-30"
          >
            <ArrowDown className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </span>
      }
    />
  );
}

function Row({
  item,
  available,
  locked,
  onToggle,
  note,
  handle,
  arrows,
  rowRef,
  style,
  dragging = false,
}: {
  item: NavLayoutItem;
  available: boolean;
  locked: boolean;
  onToggle: (key: ModuleKey, show: boolean) => void;
  note?: string;
  handle?: React.ReactNode;
  arrows?: React.ReactNode;
  rowRef?: (el: HTMLLIElement | null) => void;
  style?: React.CSSProperties;
  dragging?: boolean;
}) {
  const def = moduleDef(item.key);
  const Icon = NAV_ICONS[def.icon];
  const why = !available ? "Este rol no puede abrirlo (módulo apagado o sin permiso): no se verá" : locked ? "El Propietario no puede ocultarse Ajustes" : note;
  return (
    <li
      ref={rowRef}
      style={style}
      data-nav-key={item.key}
      className={cn(
        "flex items-center gap-2 rounded-md border bg-background px-2 py-1.5",
        dragging && "relative z-10 shadow-pop",
        (!available || item.hidden) && "bg-subtle"
      )}
    >
      {handle ?? <span className="w-6" />}
      <Icon className={cn("h-[17px] w-[17px] shrink-0", available ? "text-text-2" : "text-text-3")} strokeWidth={1.8} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13.5px] font-semibold", !available && "text-text-3 line-through")}>
          {def.label}
        </span>
        {why && <span className="block truncate text-[11.5px] text-text-3">{why}</span>}
      </span>
      {locked && <Lock className="h-3.5 w-3.5 text-text-3" strokeWidth={1.8} aria-hidden />}
      {arrows}
      <Switch
        size="sm"
        checked={!item.hidden}
        disabled={locked}
        onCheckedChange={(show) => onToggle(item.key, show)}
        label={`${def.label} visible`}
      />
    </li>
  );
}

/** Cómo se verá: menú expandido y en íconos (oculto y móvil usan la misma lista). */
function Preview({ role, visible }: { role: Role; visible: NavLayoutItem[] }) {
  const main = visible.filter((i) => !moduleDef(i.key).pinnedBottom);
  const settings = visible.some((i) => i.key === "settings");
  return (
    <section aria-label={`Vista previa del menú de ${ROLE_LABEL[role]}`} className="space-y-2">
      <h3 className="kicker">Vista previa</h3>
      <div className="flex gap-2">
        <div className="nav-dark flex min-h-[18rem] w-44 flex-col rounded-md border bg-subtle p-2 text-foreground">
          {main.map((i) => {
            const def = moduleDef(i.key);
            const Icon = NAV_ICONS[def.icon];
            return (
              <span key={i.key} data-preview-key={i.key} className={cn(navItemClass(false), "pointer-events-none py-1.5")}>
                <Icon className="h-[15px] w-[15px] shrink-0 text-text-3" strokeWidth={1.8} />
                <span className="truncate">{def.label}</span>
              </span>
            );
          })}
          <span className="flex-1" />
          {settings && (
            <span className={cn(navItemClass(false), "pointer-events-none py-1.5")}>
              <NAV_ICONS.Settings className="h-[15px] w-[15px] shrink-0 text-text-3" strokeWidth={1.8} />
              <span>Ajustes</span>
            </span>
          )}
        </div>
        <div className="nav-dark flex min-h-[18rem] w-12 flex-col items-center gap-1 rounded-md border bg-subtle py-2 text-foreground" aria-hidden>
          {main.map((i) => {
            const Icon = NAV_ICONS[moduleDef(i.key).icon];
            return <Icon key={i.key} className="m-1.5 h-[15px] w-[15px] text-text-3" strokeWidth={1.8} />;
          })}
          <span className="flex-1" />
          {settings && <NAV_ICONS.Settings className="m-1.5 h-[15px] w-[15px] text-text-3" strokeWidth={1.8} />}
        </div>
      </div>
      <p className="text-[11.5px] text-text-3">Expandido y en íconos. Oculto y en el teléfono se abre la misma lista.</p>
    </section>
  );
}

function History({ events }: { events: NavEvent[] }) {
  if (events.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cambios recientes</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm text-text-2">
          {events.map((e) => (
            <li key={e.id}>
              {new Date(e.at).toLocaleString("es-MX")} · {e.actorName ?? "Alguien"}{" "}
              {e.action === "reset" ? "restauró" : "cambió"} el menú de {ROLE_LABEL[e.role]}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
