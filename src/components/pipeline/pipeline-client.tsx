"use client";

import { stageDot } from "@/lib/tags";
import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Clock, Plus, Search, SlidersHorizontal, Trophy, X, XCircle } from "lucide-react";
import type { LossReason, PriorityValue, StageDto } from "@/lib/types";
import type { TagDto } from "@/lib/tags";
import { formatMoneyCents, sumable } from "@/lib/money";
import { cn, initials } from "@/lib/utils";
import { matchesQuery } from "@/lib/search";
import { agoShort } from "@/lib/relative-day";
import { TagChip } from "@/components/tags/tag-chip";
import { NewContactDialog } from "@/components/contacts/new-contact-dialog";
import { useRouter } from "next/navigation";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { StageManager } from "./stage-manager";
import { LossReasonDialog } from "./loss-reason-dialog";
import { AmountDialog } from "./amount-dialog";
import { PriorityBadge } from "./priority-picker";
import { LeadDrawer } from "./lead-drawer";
import { useViewer } from "@/components/viewer-context";
import { PageShell } from "@/components/ui/page-shell";

export type BoardLead = {
  id: string;
  stageId: string;
  position: number;
  lastActivityAt: string | null;
  contact: { id: string; name: string; phone: string | null };
  conversationId: string | null;
  /** Etiquetas del contacto (ronda 3: se ven en la tarjeta). */
  tags?: Pick<TagDto, "id" | "name" | "color">[];
  amountCents: number | null;
  currency: string | null;
  priority: PriorityValue | null;
  /** 020: quién lo atiende; null = sin asignar. */
  assignee: { id: string; name: string } | null;
};

export function PipelineClient() {
  const viewer = useViewer();
  const router = useRouter();
  /** Buscador y filtro de asesor (ronda 3): solo filtran lo que se ve. */
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  /** «Nuevo lead» abierto; `stageId` = la columna de su «+ Agregar». */
  const [creating, setCreating] = useState<{ stageId?: string } | null>(null);
  const [stages, setStages] = useState<StageDto[]>([]);
  const [currency, setCurrency] = useState("MXN");
  const [leads, setLeads] = useState<BoardLead[]>([]);
  const [activeLead, setActiveLead] = useState<BoardLead | null>(null);
  const [managing, setManaging] = useState(false);
  /** Arrastre hacia una etapa perdida, esperando el motivo. */
  const [pendingLoss, setPendingLoss] = useState<{
    leadId: string;
    stageId: string;
    name: string;
  } | null>(null);
  /** Tarjeta cuyo monto se está capturando. */
  const [editandoMonto, setEditandoMonto] = useState<BoardLead | null>(null);
  /**
   * Trato abierto en el cajón. Se guarda el ID y no el objeto: así el cajón
   * lee siempre del tablero y refleja al instante lo que se cambie desde
   * dentro, en vez de enseñar una copia que envejece.
   */
  const [abiertoId, setAbiertoId] = useState<string | null>(null);
  const abierto = leads.find((l) => l.id === abiertoId) ?? null;
  /** El tablero no cargó: se dice y se ofrece reintentar (antes quedaba vacío sin aviso). */
  const [loadError, setLoadError] = useState(false);
  /** Un cambio no se guardó: la tarjeta vuelve a su lugar y se avisa (antes, silencio). */
  const [saveError, setSaveError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const refetch = useCallback(async () => {
    const res = await fetch("/api/pipeline/board").catch(() => null);
    if (!res?.ok) {
      setLoadError(true);
      return;
    }
    setLoadError(false);
    const data = (await res.json()) as {
      stages: StageDto[];
      leads: BoardLead[];
      currency?: string;
    };
    if (data.currency) setCurrency(data.currency);
    setStages(data.stages);
    setLeads(data.leads);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  /**
   * Guarda un cambio del trato. Si el servidor no lo acepta (error, sin red),
   * se avisa con el motivo y el tablero se vuelve a leer, así lo optimista
   * regresa a como está de verdad en la base.
   */
  async function persist(leadId: string, body: Record<string, unknown>, what: string) {
    const res = await fetch(`/api/pipeline/leads/${leadId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) {
      const name = leads.find((l) => l.id === leadId)?.contact.name;
      setSaveError(
        `No se pudo guardar ${what}${name ? ` de ${name}` : ""}. Lo regresamos a como estaba; intenta de nuevo.`
      );
    } else {
      setSaveError(null);
    }
    void refetch();
  }

  function onDragStart(event: DragStartEvent) {
    const lead = leads.find((l) => l.id === event.active.id);
    setActiveLead(lead ?? null);
  }

  async function moverLead(
    leadId: string,
    overStage: string,
    loss?: { reason: LossReason; note: string }
  ) {
    const position = leads.filter((l) => l.stageId === overStage).length;
    // Optimista + persistencia
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, stageId: overStage, position } : l))
    );
    await persist(
      leadId,
      {
        stageId: overStage,
        position,
        ...(loss
          ? { lossReason: loss.reason, ...(loss.note ? { lossNote: loss.note } : {}) }
          : {}),
      },
      "el cambio de etapa"
    );
  }

  async function guardarMonto(leadId: string, cents: number | null) {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, amountCents: cents } : l))
    );
    // Sin `stageId`: esto NO mueve la tarjeta, solo escribe el importe.
    await persist(leadId, { amountCents: cents }, "el monto");
  }

  async function guardarPrioridad(leadId: string, priority: PriorityValue | null) {
    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, priority } : l))
    );
    await persist(leadId, { priority }, "la prioridad");
  }

  async function onDragEnd(event: DragEndEvent) {
    setActiveLead(null);
    const leadId = String(event.active.id);
    const overStage = event.over ? String(event.over.id) : null;
    if (!overStage) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stageId === overStage) return;

    // Perder un trato exige motivo. Se pregunta ANTES de mover: si el dueño
    // cancela, la tarjeta ni siquiera parpadea fuera de su columna.
    const destino = stages.find((s) => s.id === overStage);
    if (destino?.kind === "lost") {
      setPendingLoss({ leadId, stageId: overStage, name: lead.contact.name });
      return;
    }

    await moverLead(leadId, overStage);
  }

  /**
   * Cambiar de etapa desde el cajón. Entra por la MISMA puerta que el
   * arrastre: perder un trato exige motivo venga de donde venga, y duplicar
   * esa regla aquí sería tener dos sitios donde olvidarla.
   */
  function moverDesdeCajon(leadId: string, stageId: string) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stageId === stageId) return;
    const destino = stages.find((s) => s.id === stageId);
    if (destino?.kind === "lost") {
      setPendingLoss({ leadId, stageId, name: lead.contact.name });
      return;
    }
    void moverLead(leadId, stageId);
  }

  const showAssignees = viewer.can("scope.all");
  // El filtro de asesor se arma con quienes atienden algo del tablero: no
  // hace falta pedir el equipo aparte (y al asesor ni se le muestra).
  const assigneeOptions = [
    ...new Map(
      leads.flatMap((l) => (l.assignee ? [[l.assignee.id, l.assignee.name] as const] : []))
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], "es"));
  const visibleLeads = leads.filter(
    (l) =>
      matchesQuery(query, { text: [l.contact.name], phone: l.contact.phone }) &&
      (assigneeFilter === "all" ||
        (assigneeFilter === "none" ? !l.assignee : l.assignee?.id === assigneeFilter))
  );
  const openStageIds = new Set(stages.filter((x) => x.kind === "open").map((x) => x.id));
  const openLeads = visibleLeads.filter((l) => openStageIds.has(l.stageId));
  const openTotals = totalesDeEtapa(openLeads, currency);

  return (
    <PageShell
      pillar="pipeline"
      variant="fluid"
      actions={
        <>
          {searchOpen ? (
            <div data-pm="search" className="relative">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setQuery("");
                    setSearchOpen(false);
                  }
                }}
                placeholder="Buscar prospecto…"
                aria-label="Buscar prospecto"
                className="h-8 w-40 rounded-md border border-input bg-card pl-8 pr-7 text-sm sm:w-56"
              />
              <button
                type="button"
                aria-label="Cerrar búsqueda"
                onClick={() => {
                  setQuery("");
                  setSearchOpen(false);
                }}
                className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground hover:bg-accent"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Buscar prospecto"
              title="Buscar"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-4 w-4" />
            </Button>
          )}
          {showAssignees && (
            <select
              data-pm="assignee-filter"
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              aria-label="Filtrar por asesor"
              className="hidden h-8 rounded-md border border-input bg-card px-2 text-sm sm:block"
            >
              <option value="all">Todos los asesores</option>
              {assigneeOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name || "Sin nombre"}
                </option>
              ))}
              <option value="none">Sin asignar</option>
            </select>
          )}
          {/* 020: crear, editar y borrar etapas no es del asesor (la API lo
              niega igual); mover sus tarjetas sí. */}
          {viewer.can("pipeline.edit") && (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Gestionar etapas"
              title="Gestionar etapas"
              onClick={() => setManaging(true)}
            >
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          )}
          <Button size="sm" data-pm="new-lead" onClick={() => setCreating({})}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nuevo prospecto</span>
            <span className="sr-only sm:hidden">Nuevo prospecto</span>
          </Button>
        </>
      }
    >
      {saveError && (
        <div
          role="alert"
          className="mx-3 mt-3 flex items-start gap-3 rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text sm:mx-4"
        >
          <span className="flex-1">{saveError}</span>
          <button type="button" className="font-medium underline" onClick={() => setSaveError(null)}>
            Entendido
          </button>
        </div>
      )}
      {loadError && stages.length === 0 && (
        <div role="alert" className="m-6 rounded-lg border bg-card p-6 text-center text-sm">
          <p className="font-medium">No pudimos cargar tu pipeline.</p>
          <p className="mt-1 text-muted-foreground">Revisa tu conexión e intenta de nuevo.</p>
          <Button className="mt-4" size="sm" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      )}
      {stages.length > 0 && (
        <p data-pm="board-summary" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 text-[13px] text-text-3">
          <span>
            {openLeads.length} {openLeads.length === 1 ? "prospecto abierto" : "prospectos abiertos"}
          </span>
          {openTotals.totalCents > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>
                Valor abierto{" "}
                <strong className="font-semibold text-foreground">
                  {moneyShort(openTotals.totalCents, currency)}
                </strong>
              </span>
            </>
          )}
        </p>
      )}
      {/* El tablero se arrastra en horizontal; en el teléfono cada columna
          se detiene en su sitio (snap) para no quedar a medio camino. */}
      <div className="flex-1 snap-x snap-mandatory overflow-x-auto p-3 sm:snap-none sm:p-4">
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={(e) => void onDragEnd(e)}
        >
          <div className="flex h-full gap-3">
            {stages.map((stage) => (
              <StageColumn
                key={stage.id}
                stage={stage}
                currency={currency}
                onEditAmount={setEditandoMonto}
                onOpen={(l) => setAbiertoId(l.id)}
                onAdd={stage.kind === "lost" ? undefined : () => setCreating({ stageId: stage.id })}
                leads={visibleLeads
                  .filter((l) => l.stageId === stage.id)
                  .sort((a, b) => a.position - b.position)}
              />
            ))}
          </div>
          <DragOverlay>
            {activeLead ? (
              <LeadCard lead={activeLead} currency={currency} overlay />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {creating && (
        <NewContactDialog
          title="Nuevo prospecto"
          initialStageId={creating.stageId}
          onClose={() => setCreating(null)}
          onCreated={() => {
            setCreating(null);
            void refetch();
          }}
          onOpenExisting={(contactId) => {
            setCreating(null);
            router.push(`/inbox?contact=${contactId}`);
          }}
        />
      )}

      {managing && (
        <StageManager
          stages={stages}
          onClose={() => setManaging(false)}
          onChanged={() => void refetch()}
        />
      )}

      {/* Va ANTES que los diálogos: con el mismo z-index, el que se pinta
          después queda encima, y el motivo de pérdida debe tapar al cajón. */}
      {abierto && (
        <LeadDrawer
          lead={abierto}
          stages={stages}
          currency={currency}
          onClose={() => setAbiertoId(null)}
          onMoveStage={(stageId) => moverDesdeCajon(abierto.id, stageId)}
          onAmount={(cents) => void guardarMonto(abierto.id, cents)}
          onPriority={(p) => void guardarPrioridad(abierto.id, p)}
        />
      )}

      {editandoMonto && (
        <AmountDialog
          leadName={editandoMonto.contact.name}
          currency={editandoMonto.currency ?? currency}
          amountCents={editandoMonto.amountCents}
          priority={editandoMonto.priority}
          onPriorityChange={(p) => {
            setEditandoMonto({ ...editandoMonto, priority: p });
            void guardarPrioridad(editandoMonto.id, p);
          }}
          onCancel={() => setEditandoMonto(null)}
          onSave={(cents) => {
            const leadId = editandoMonto.id;
            setEditandoMonto(null);
            void guardarMonto(leadId, cents);
          }}
        />
      )}

      {pendingLoss && (
        <LossReasonDialog
          leadName={pendingLoss.name}
          onCancel={() => setPendingLoss(null)}
          onConfirm={(reason, note) => {
            const { leadId, stageId } = pendingLoss;
            setPendingLoss(null);
            void moverLead(leadId, stageId, { reason, note });
          }}
        />
      )}
    </PageShell>
  );
}

/**
 * Totales de una columna. Se calculan al pintar: un total guardado se
 * desincroniza en cuanto alguien mueve una tarjeta, y sumar unas decenas es
 * gratis. Todo en CENTAVOS enteros — el dinero jamás pasa por coma flotante.
 */
function totalesDeEtapa(leads: BoardLead[], businessCurrency: string) {
  let totalCents = 0;
  let sinMonto = 0;
  let otraMoneda = 0;

  for (const l of leads) {
    if (l.amountCents === null) {
      sinMonto++;
      continue;
    }
    if (!sumable({ amountCents: l.amountCents, currency: l.currency }, businessCurrency)) {
      otraMoneda++;
      continue;
    }
    totalCents += l.amountCents;
  }
  return { totalCents, sinMonto, otraMoneda };
}

function StageColumn({
  stage,
  leads,
  currency,
  onEditAmount,
  onOpen,
  onAdd,
}: {
  stage: StageDto;
  leads: BoardLead[];
  currency: string;
  onEditAmount: (lead: BoardLead) => void;
  onOpen: (lead: BoardLead) => void;
  /** «+ Agregar» al pie: un lead nuevo directo en esta etapa. */
  onAdd?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const dot = stageDot(stage.color, stage.name);
  const { totalCents } = totalesDeEtapa(leads, currency);
  return (
    <div
      ref={setNodeRef}
      data-pm="col"
      className={cn(
        "flex h-full min-w-[12.5rem] flex-1 basis-0 snap-start flex-col rounded-lg border border-border-strong bg-subtle transition-[box-shadow,border-color]",
        isOver && "border-brand ring-[3px] ring-brand-soft"
      )}
    >
      <div data-pm="col-head" className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[13.5px] font-bold tracking-tight">
          {stage.kind === "won" && <Trophy className="h-3.5 w-3.5 text-primary" />}
          {stage.kind === "lost" && (
            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {stage.kind === "open" && (
            <span
              aria-hidden
              className={cn("h-2 w-2 shrink-0 rounded-full", dot.className)}
              style={dot.style}
            />
          )}
          <span className="truncate">{stage.name}</span>
          <span data-pm="col-count" className="ml-1 text-[12px] font-normal tabular-nums text-text-3">
            {leads.length}
          </span>
        </span>
        <span data-pm="col-total" className="shrink-0 text-[12px] tabular-nums text-text-3">
          {moneyShort(totalCents, currency)}
        </span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {leads.map((lead) => (
          <DraggableLead
            key={lead.id}
            lead={lead}
            currency={currency}
            onEditAmount={onEditAmount}
            onOpen={onOpen}
          />
        ))}
        {stage.kind === "lost" && leads.length === 0 && (
          <p
            data-pm="lost-empty"
            className="rounded-md border border-dashed border-border-strong px-3 py-4 text-center text-[12px] leading-relaxed text-text-3"
          >
            Arrastra aquí los que no avanzaron.
            <br />
            Te pediremos el motivo.
          </p>
        )}
        {onAdd && (
          <button
            type="button"
            data-pm="col-add"
            onClick={onAdd}
            className="w-full rounded-md py-1.5 text-center text-[12.5px] font-medium text-brand-text hover:bg-brand-tint"
          >
            + Agregar
          </button>
        )}
      </div>
      <StageFooter leads={leads} currency={currency} />
    </div>
  );
}

/** El total vive en el encabezado; aquí solo lo que quedó fuera de la cuenta. */
function StageFooter({ leads, currency }: { leads: BoardLead[]; currency: string }) {
  const { sinMonto, otraMoneda } = totalesDeEtapa(leads, currency);
  const conMonto = leads.length - sinMonto - otraMoneda;
  if (otraMoneda === 0 && (sinMonto === 0 || conMonto === 0)) return null;
  return (
    <div data-pm="stage-footer" className="border-t px-3 py-2 text-[11px] text-muted-foreground">
      {sinMonto > 0 && conMonto > 0 && <p>{sinMonto} sin monto</p>}
      {otraMoneda > 0 && (
        // Descartarlos en silencio haría que el total mintiera.
        <p className="text-warning-text">{otraMoneda} en otra moneda, fuera del total</p>
      )}
    </div>
  );
}

function DraggableLead({
  lead,
  currency,
  onEditAmount,
  onOpen,
}: {
  lead: BoardLead;
  currency: string;
  onEditAmount: (lead: BoardLead) => void;
  onOpen: (lead: BoardLead) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      // Abrir y arrastrar conviven porque el sensor solo activa el arrastre a
      // los 6 px de movimiento: un clic quieto nunca llega a ser un arrastre.
      // Los controles de dentro de la tarjeta cortan la propagación, para que
      // tocar "+ monto" no abra además el cajón.
      onClick={() => onOpen(lead)}
      // dnd-kit ya deja el nodo con `role="button"` y `tabIndex`, pero un div
      // no dispara `click` con el teclado: sin esto, el cajón sería alcanzable
      // solo con el ratón.
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(lead);
        }
      }}
      aria-label={`Abrir el trato de ${lead.contact.name}`}
      className={cn(isDragging && "opacity-40")}
    >
      <LeadCard lead={lead} currency={currency} onEditAmount={onEditAmount} />
    </div>
  );
}

function LeadCard({
  lead,
  currency,
  overlay = false,
  onEditAmount,
}: {
  lead: BoardLead;
  currency: string;
  overlay?: boolean;
  onEditAmount?: (lead: BoardLead) => void;
}) {
  const showAssignee = useViewer().can("scope.all");
  const amountText =
    lead.amountCents === null
      ? "+ monto"
      : moneyShort(lead.amountCents, lead.currency ?? currency);
  const tags = lead.tags ?? [];
  return (
    <div
      data-pm={overlay ? "card-overlay" : "card"}
      className={cn(
        "cursor-grab rounded-md border border-border-strong bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        overlay && "rotate-2 shadow-pop"
      )}
    >
      <div className="flex items-start gap-2.5">
        <ContactAvatar name={lead.contact.name} seed={lead.contact.id} size="sm" />
        {/* Ronda 3: el nombre completo, en dos renglones si hace falta. */}
        <p data-pm="card-name" lang="es" className="min-w-0 flex-1 hyphens-auto pt-0.5 text-[13.5px] font-semibold leading-snug">
          {lead.contact.name}
        </p>
        {!overlay && onEditAmount ? (
          <button
            // `stopPropagation` en pointerdown: sin esto, tocar el monto empieza
            // un arrastre y el diálogo nunca abre. También en `click`, para no
            // abrir además el cajón.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onEditAmount(lead);
            }}
            data-pm="amount"
            data-empty={lead.amountCents === null ? "" : undefined}
            className={cn(
              "shrink-0 rounded px-1 py-0.5 text-right text-[12.5px] tabular-nums hover:bg-accent",
              lead.amountCents === null ? "text-xs text-text-3" : "font-semibold text-foreground"
            )}
          >
            {amountText}
          </button>
        ) : (
          lead.amountCents !== null && (
            <span className="shrink-0 text-[12.5px] font-semibold tabular-nums">{amountText}</span>
          )
        )}
      </div>
      {(tags.length > 0 || lead.priority) && (
        <div data-pm="card-tags" className="mt-2 flex flex-wrap items-center gap-1">
          {tags.slice(0, 2).map((t) => (
            <TagChip key={t.id} tag={t} className="text-[10.5px]" />
          ))}
          {tags.length > 2 && (
            <span className="text-[11px] text-text-3">+{tags.length - 2}</span>
          )}
          {lead.priority && <PriorityBadge value={lead.priority} />}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-[11.5px] text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1 truncate">
          <Clock className="h-3 w-3 shrink-0" strokeWidth={1.8} />
          <span className="truncate">
            {lead.lastActivityAt ? agoShort(lead.lastActivityAt) : "Sin actividad"}
          </span>
        </span>
        <span className="flex-1" />
        {/* 020: a quién está asignado, visible para quien ve al equipo. */}
        {showAssignee && (
          <AssigneeDot name={lead.assignee?.name ?? null} />
        )}
      </div>
    </div>
  );
}

/** «$ 412,800» como en la maqueta: sin «.00» cuando el monto es cerrado. */
function moneyShort(cents: number, currency: string): string {
  const full = formatMoneyCents(cents, currency) ?? "";
  return cents % 100 === 0 ? full.replace(/[.,]00(?=\D*$)/, "") : full;
}

/** Iniciales de quien atiende; sin nadie, un guion discreto (sin círculo). */
function AssigneeDot({ name }: { name: string | null }) {
  if (!name) {
    return (
      <span title="Sin asignar" className="w-6 shrink-0 text-center text-[11px] text-text-3">
        —
      </span>
    );
  }
  return (
    <span
      title={name}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[10px] font-bold text-brand-text"
    >
      {initials(name)}
    </span>
  );
}
