"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Cable, ChevronDown, ChevronLeft, Sparkles, UserRound, X } from "lucide-react";
import {
  externalAnswerLabel,
  externalAnswering,
  externalDown,
  type BrainStatusDto,
} from "@/lib/brain-status";
import type {
  AnuncioDto,
  ContactDto,
  ConversationDto,
  FichaDto,
  FichaValue,
  LossReason,
  PriorityValue,
  StageDto,
} from "@/lib/types";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { cn, phoneCompact } from "@/lib/utils";
import { AnuncioOrigen } from "@/components/anuncio-origen";
import { ContactAvatar } from "@/components/avatar";
import { Switch } from "@/components/ui/switch";
import { FichaPanel } from "@/components/ficha-panel";
import { useAssignees } from "@/components/assignment/use-assignees";
import { AssigneeCapsule, TagsAddButton, type PatchRow } from "@/components/inbox/chat-capsules";
import { useInboxCatalogs } from "@/components/inbox/use-inbox-catalogs";
import { dueLabel } from "@/components/work/tasks-client";
import type { TaskDto } from "@/lib/work";
import { ParticipantsCard } from "@/components/assignment/participants-card";
import { ContactTagsCard } from "@/components/tags/contact-tags-card";
import { LossReasonDialog } from "@/components/pipeline/loss-reason-dialog";
import { AmountDialog } from "@/components/pipeline/amount-dialog";
import { PRIORITY_LABELS } from "@/server/leads/priority";
import { formatMoneyCents } from "@/lib/money";
import { stageDot, tagColorClass } from "@/lib/tags";
import { useViewer } from "@/components/viewer-context";
import { ChatTimeline } from "@/components/inbox/chat-timeline";
import { ContactNotes } from "@/components/work/contact-notes";
import { Collapse, DisclosureButton, useDisclosureId } from "@/components/motion";
import { contactLabel } from "@/lib/phone-search";
import { OPEN_HISTORY_EVENT } from "./panel-events";

const HANDOFF_LABELS: Record<string, string> = {
  cliente: "El cliente pidió un humano",
  modelo: "El agente decidió escalar",
  error: "Error del proveedor de IA",
  ventana: "Ventana de 24h cerrada",
  cuota: "Se agotó la cuota mensual de IA",
  pausa: "Los agentes de IA están en pausa",
  manual_reply: "Respondiste desde el teléfono — IA en pausa",
};

export function ContactPanel({
  conversation,
  refreshKey = 0,
  onPatchConversation,
  onClose,
  numberAi,
  onPatchRow,
}: {
  conversation: ConversationDto;
  /** Ronda 3: etiquetas y asignado se editan aquí con los mismos menús de la fila. */
  onPatchRow?: PatchRow;
  /**
   * 046 — Chat de cliente de «Mi número»: la IA de ese chat va por su número
   * (pausar/reanudar propio, o nada) y no por el agente de la empresa. Con
   * esto el panel no pregunta al agente ni pinta su caja: pinta esto.
   */
  numberAi?: React.ReactNode;
  /** Aumenta con cada evento SSE relevante: dispara un refetch en vivo. */
  refreshKey?: number;
  onPatchConversation: (patch: {
    aiEnabled?: boolean;
    reactivate?: boolean;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [ficha, setFicha] = useState<FichaDto>({});
  const [loaded, setLoaded] = useState(false);
  // 022: "Más detalles" (consentimiento, etiquetas, ficha) arranca plegado.
  const [moreOpen, setMoreOpen] = useState(false);
  // Ronda 3: «Ver todo» del Historial cambia el panel a la vista completa.
  const [view, setView] = useState<"details" | "history">("details");
  useEffect(() => {
    const open = () => setView("history");
    window.addEventListener(OPEN_HISTORY_EVENT, open);
    return () => window.removeEventListener(OPEN_HISTORY_EVENT, open);
  }, []);
  const moreId = useDisclosureId("more-details");
  // 022: lo que se cambia DESDE el panel también refresca la línea de tiempo
  // (el SSE solo avisa de lo que cambió en otro lado).
  const [timelineRev, setTimelineRev] = useState(0);
  const bumpTimeline = useCallback(() => setTimelineRev((v) => v + 1), []);
  const [stages, setStages] = useState<StageDto[]>([]);
  const [currentStageId, setCurrentStageId] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
  // Venta: monto y prioridad del lead (se editan desde «Venta»).
  const [sale, setSale] = useState<{ amountCents: number | null; currency: string | null; priority: PriorityValue | null }>({
    amountCents: null,
    currency: null,
    priority: null,
  });
  const [editingSale, setEditingSale] = useState(false);
  // 018: de qué anuncio llegó; null si escribió por su cuenta.
  const [anuncio, setAnuncio] = useState<AnuncioDto | null>(null);
  // Quién responde (agente incluido, cerebro externo o los dos): sin esto, el
  // toggle "Respondiendo" mentiría cuando el agente aún no se ha
  // configurado/encendido, y pediría la clave de IA aunque conteste Nea.
  const [brain, setBrain] = useState<BrainStatusDto | null>(null);
  // Todo fallo se DICE: antes, mover a "Perdido" sin motivo respondía 422 y
  // el panel regresaba la etapa en silencio, como si nada.
  const [error, setError] = useState<string | null>(null);
  const [brainError, setBrainError] = useState<string | null>(null);
  /** Etapa perdida elegida: espera el motivo antes de mover (regla del dominio). */
  const [pendingLoss, setPendingLoss] = useState<StageDto | null>(null);
  // 031 (PR B): el agente por etapa que atiende; null = el general (no se muestra).
  const [attending, setAttending] = useState<{ label: string; stageName: string } | null>(null);

  const contactId = conversation.contact.id;
  const viewer = useViewer();
  const catalogs = useInboxCatalogs();
  const assignees = useAssignees();
  // 020: a quién le toca el handoff. Al asesor asignado se le dice que es a
  // él; sin asignar, quien reparte ve que falta alguien.
  const handoffOwner = !conversation.assignee
    ? "sin asignar"
    : conversation.assignee.id === viewer.userId
      ? "te toca a ti"
      : conversation.assignee.name;

  const aiConfigured = brain?.embedded.configured ?? false;
  const agentReady = brain?.embedded.answering ?? false;
  // Hasta donde se sabe, contesta: activo y, si hay /health, en línea.
  const externalActive = brain ? externalAnswering(brain) : false;
  // El control es la FUENTE DE VERDAD de la conversación: el agente in-process
  // y cualquier cerebro externo conectado por /api/bot/* respetan este flag,
  // así que el toggle opera siempre — `agentReady` solo matiza el texto.
  const aiActive = conversation.aiEnabled && !conversation.handoffAt;

  // Aparte del resto: consultar el /health del cerebro externo puede tardar
  // hasta 2 s, y eso no debe demorar la etapa ni la ficha.
  const numberChat = numberAi !== undefined;
  const loadBrain = useCallback(async () => {
    if (numberChat) return;
    const res = await fetchJson<BrainStatusDto>("/api/agent/brain-status");
    if (!res.ok) {
      setBrainError(`No se pudo consultar quién responde: ${res.error}`);
      return;
    }
    setBrainError(null);
    setBrain(res.data);
  }, [numberChat]);

  // Carga inicial: se re-ejecuta al cambiar de contacto.
  const refetch = useCallback(async () => {
    void loadBrain();
    const [detailRes, stagesRes] = await Promise.all([
      fetchJson<ContactDetail>(`/api/contacts/${contactId}`),
      fetchJson<{ stages: StageDto[] }>("/api/pipeline/stages"),
    ]);
    const problems: string[] = [];
    if (detailRes.ok) {
      const detail = detailRes.data;
      setFicha(detail.contact?.ficha ?? {});
      setCurrentStageId(detail.stage?.id ?? null);
      setLeadId(detail.lead?.id ?? null);
      setSale(saleOf(detail.lead));
      setAnuncio(detail.anuncio ?? null);
      setLoaded(true);
    } else {
      problems.push(`No se pudo cargar el contacto: ${detailRes.error}`);
    }
    if (stagesRes.ok) setStages(stagesRes.data.stages);
    else problems.push(`No se pudieron cargar las etapas: ${stagesRes.error}`);
    // Solo AGREGA avisos: la carga puede resolver después de que el operador
    // ya hizo algo que falló, y un `null` aquí le borraría ese aviso. El
    // aviso del contacto anterior se limpia al cambiar de contacto (abajo).
    if (problems.length) setError(problems.join(" · "));
  }, [contactId, loadBrain]);

  // Refetch en vivo (etapa/lead + quién responde). Lo dispara el SSE.
  const refreshLive = useCallback(async () => {
    void loadBrain();
    const res = await fetchJson<ContactDetail>(`/api/contacts/${contactId}`);
    if (!res.ok) {
      setError(`No se pudo actualizar el contacto: ${res.error}`);
      return;
    }
    const detail = res.data;
    // La ficha SÍ se refresca en vivo: el agente la va llenando mientras la
    // conversación ocurre, y verla aparecer sola es justo para lo que sirve.
    // No pisa una edición a medias — el borrador vive dentro del panel.
    setFicha(detail.contact?.ficha ?? {});
    setCurrentStageId(detail.stage?.id ?? null);
    setLeadId(detail.lead?.id ?? null);
    setSale(saleOf(detail.lead));
    // La imagen del creativo se copia después de que entra el mensaje: este
    // refetch en vivo es lo que la hace aparecer sin recargar.
    setAnuncio(detail.anuncio ?? null);
  }, [contactId, loadBrain]);

  useEffect(() => {
    setLoaded(false);
    setError(null);
    // Al cambiar de contacto no puede asomarse el anuncio del anterior.
    setAnuncio(null);
    void refetch();
  }, [refetch]);

  // Depende de la etapa: se vuelve a preguntar cuando el lead se mueve.
  useEffect(() => {
    if (numberChat) return;
    let alive = true;
    void fetchJson<{ agent: { label: string; stageName: string } | null }>(
      `/api/conversations/${conversation.id}/agent`
    ).then((res) => {
      if (alive) setAttending(res.ok ? res.data.agent : null);
    });
    return () => {
      alive = false;
    };
  }, [conversation.id, currentStageId, refreshKey, numberChat]);

  useEffect(() => {
    if (!loaded) return; // la carga inicial ya trae el estado fresco
    void refreshLive();
  }, [refreshKey, loaded, refreshLive]);

  /** Punto de entrada del stepper: a una etapa perdida primero se pide el motivo. */
  function requestMove(stage: StageDto) {
    if (!leadId || stage.id === currentStageId) return;
    if (stage.kind === "lost") {
      setPendingLoss(stage);
      return;
    }
    void moveToStage(stage.id);
  }

  async function moveToStage(stageId: string, loss?: { reason: LossReason; note: string }) {
    if (!leadId || stageId === currentStageId) return;
    const previous = currentStageId;
    setCurrentStageId(stageId); // optimista; se revierte si falla
    setError(null);
    const res = await fetchJson(
      `/api/pipeline/leads/${leadId}`,
      jsonInit("PATCH", {
        stageId,
        position: 0,
        ...(loss ? { lossReason: loss.reason, ...(loss.note ? { lossNote: loss.note } : {}) } : {}),
      })
    );
    if (!res.ok) {
      setCurrentStageId(previous);
      if (res.code === "loss_reason_required") {
        // La etapa es de pérdida aunque el catálogo local no lo supiera
        // (p. ej. cambió de tipo): se pide el motivo en vez de fallar.
        const stage = stages.find((s) => s.id === stageId);
        if (stage) setPendingLoss({ ...stage, kind: "lost" });
        return;
      }
      setError(`No se movió la etapa: ${res.error}`);
      return;
    }
    void refreshLive();
    bumpTimeline();
  }

  /** Monto y prioridad: no mueven al lead de etapa, solo escriben el dato. */
  async function saveSale(patch: { amountCents?: number | null; priority?: PriorityValue | null }) {
    if (!leadId) return;
    const previous = sale;
    setSale((s) => ({ ...s, ...patch }));
    const res = await fetchJson(`/api/pipeline/leads/${leadId}`, jsonInit("PATCH", patch));
    if (!res.ok) {
      setSale(previous);
      setError(`No se guardó: ${res.error}`);
      return;
    }
    void refreshLive();
    bumpTimeline();
  }

  /** Manda SOLO lo que cambió: el servidor hace merge (ver `server/bot/ficha`). */
  async function saveFicha(patch: Record<string, FichaValue | null>) {
    setFicha((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      return next; // optimista: el refetch de abajo confirma
    });
    const res = await fetchJson(`/api/contacts/${contactId}`, jsonInit("PATCH", { ficha: patch }));
    if (!res.ok) setError(`No se guardó la ficha: ${res.error}`);
    // Con o sin error, la verdad del servidor reemplaza al optimista.
    void refreshLive();
  }


  const stage = stages.find((x) => x.id === currentStageId);
  const email = typeof ficha.email === "string" ? ficha.email : typeof ficha.correo === "string" ? ficha.correo : null;
  const aiTitle = conversation.handoffAt
    ? "Atención humana"
    : !conversation.aiEnabled
      ? "IA en pausa en este chat"
      : attending
        ? null
        : agentReady || externalActive
          ? "Respondiendo"
          : "Activada";

  if (view === "history") {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b bg-surface px-3 max-xl:bg-popover">
          <button type="button" onClick={() => setView("details")} aria-label="Volver a Detalles" className="btn-r3 g ic h-8 w-8">
            <ChevronLeft className="h-4 w-4" strokeWidth={1.75} />
          </button>
          <h3 className="text-[15px] font-semibold">Historial</h3>
          <button type="button" onClick={onClose} aria-label="Ocultar panel" className="btn-r3 g ic ml-auto h-8 w-8">
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto" id="chat-historial">
          <ChatTimeline contactId={contactId} refreshKey={refreshKey + timelineRev} mode="full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Ronda 3: «Detalles» de 56 px. Por debajo de xl el panel flota
          (bg-popover): su cabecera va del mismo tono. */}
      <header className="sticky top-0 flex h-14 shrink-0 items-center justify-between border-b bg-surface pl-4 pr-3 max-xl:bg-popover">
        <h3 className="text-[15px] font-semibold">Detalles</h3>
        <button type="button" onClick={onClose} aria-label="Ocultar panel" className="btn-r3 g ic h-8 w-8">
          <X className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div
            role="alert"
            className="m-3 flex items-start gap-2 rounded-md border border-danger-soft bg-danger-tint p-2.5 text-xs text-danger-text"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
            <p className="flex-1">{error}</p>
            <button
              onClick={() => setError(null)}
              aria-label="Cerrar aviso"
              className="font-medium underline underline-offset-2"
            >
              Cerrar
            </button>
          </div>
        )}

        {/* Contacto */}
        <section className="sec flex items-center gap-3">
          <ContactAvatar name={contactLabel(conversation.contact)} seed={conversation.contact.id} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-5">{contactLabel(conversation.contact)}</p>
            {conversation.contact.phone && (
              <p className="text-[12px] leading-4 text-text-3">{phoneCompact(conversation.contact.phone)}</p>
            )}
            {email && <p className="truncate text-[12px] leading-4 text-text-3">{email}</p>}
          </div>
        </section>

        {/* Venta: etapa, monto, prioridad, quién lo atiende y participantes. */}
        <section className="sec" data-testid="panel-sale">
          <h3 className="sec-h">Venta</h3>
          <dl className="grid grid-cols-[96px_1fr] items-center gap-y-2 text-[13px]">
            {stages.length > 0 && leadId && (
              <>
                <dt className="text-text-3">Etapa</dt>
                <dd>
                  <span className="relative inline-flex items-center">
                    <StageDot stage={stage} />
                    <select
                      aria-label="Etapa del pipeline"
                      value={currentStageId ?? ""}
                      onChange={(e) => {
                        const st = stages.find((x) => x.id === e.target.value);
                        if (st) requestMove(st);
                      }}
                      className="h-6 cursor-pointer appearance-none rounded-full border bg-surface pl-[22px] pr-6 text-[12px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {currentStageId === null && <option value="">Sin etapa</option>}
                      {stages.map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 h-3 w-3 text-text-3" strokeWidth={2} aria-hidden />
                  </span>
                </dd>
                <dt className="text-text-3">Monto</dt>
                <dd>
                  <button
                    type="button"
                    onClick={() => setEditingSale(true)}
                    className={cn("-ml-1 rounded px-1 hover:bg-secondary", sale.amountCents === null && "text-text-3")}
                    data-testid="panel-amount"
                  >
                    {sale.amountCents === null ? "Sin monto" : formatMoneyCents(sale.amountCents, sale.currency ?? "MXN")}
                  </button>
                </dd>
                <dt className="text-text-3">Prioridad</dt>
                <dd>
                  <button type="button" onClick={() => setEditingSale(true)} className="-ml-1 rounded px-1 hover:bg-secondary">
                    {sale.priority ? <PriorityText value={sale.priority} /> : <span className="text-text-3">Sin prioridad</span>}
                  </button>
                </dd>
              </>
            )}
            <dt className="text-text-3">Asignado</dt>
            <dd className="min-w-0">
              <AssigneeCapsule
                variant="plain"
                conversation={conversation}
                members={assignees}
                canAssign={viewer.can("assignment.manage")}
                viewerId={viewer.userId}
                onPatch={(id, patch) => {
                  onPatchRow?.(id, patch);
                  bumpTimeline();
                }}
                onRefetch={() => void refreshLive()}
                onError={(m) => setError(m)}
              />
            </dd>
            {/* 026: quienes también ven y atienden el chat (la asignación no cambia). */}
            <ParticipantsCard
              variant="row"
              contactId={contactId}
              assignedUserId={conversation.assignee?.id ?? null}
              refreshKey={refreshKey}
              onChanged={bumpTimeline}
            />
          </dl>
        </section>

        {/* Etiquetas: todas a la vista; «+ Agregar» abre el mismo menú de la fila. */}
        <section className="sec" aria-label="Etiquetas">
          <h3 className="sec-h">
            Etiquetas
            {onPatchRow && (
              <TagsAddButton
                conversation={conversation}
                catalog={catalogs.tags}
                canCreate={viewer.can("tags.manage")}
                onCatalogAdd={catalogs.addTag}
                onPatch={onPatchRow}
                onRefetch={() => void refreshLive()}
                onError={(m) => setError(m)}
                onSaved={bumpTimeline}
              />
            )}
          </h3>
          {conversation.tags.length === 0 ? (
            <p className="text-[13px] text-text-3">Sin etiquetas</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {conversation.tags.map((t) => (
                <span key={t.id} className={cn("cap", tagColorClass(t.color))}>
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* IA en este chat: quién responde, el interruptor y lo que falte. */}
        {conversation.groupJid ? (
          <section className="sec"><h3 className="sec-h">IA en este grupo</h3><p className="text-[12px] text-text-3">Solo sugerencias manuales. La IA nunca envía mensajes automáticos a grupos.</p></section>
        ) : numberChat ? (
          numberAi && (
            <section className="sec">
              <h3 className="sec-h">IA en este chat</h3>
              {numberAi}
            </section>
          )
        ) : (
          <section className="sec">
            <h3 className="sec-h">IA en este chat</h3>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                {aiTitle === "Atención humana" ? (
                  <p className="text-[13px] font-semibold leading-5 text-warning-text">
                    <UserRound className="-mt-0.5 mr-1 inline h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
                    Atención humana <span className="font-normal opacity-80">· {handoffOwner}</span>
                  </p>
                ) : attending && aiActive ? (
                  <p className="truncate text-[13px] font-semibold">
                    Atiende: {attending.label}
                  </p>
                ) : (
                  <p className="text-[13px] font-semibold">{aiTitle}</p>
                )}
                <p className="text-[12px] leading-4 text-text-3">
                  {conversation.handoffAt
                    ? (HANDOFF_LABELS[conversation.handoffReason ?? ""] ?? "La IA está en pausa en esta conversación.")
                    : attending && aiActive
                      ? `Etapa ${attending.stageName}`
                      : !conversation.aiEnabled
                        ? "La IA no contesta este chat"
                        : "La IA contesta este chat"}
                </p>
              </div>
              <Switch
                size="sm"
                checked={aiActive}
                label="IA en esta conversación"
                onCheckedChange={() => {
                  void onPatchConversation({
                    aiEnabled: !conversation.aiEnabled,
                  });
                }}
              />
            </div>
            {conversation.handoffAt && (
              <button
                type="button"
                onClick={() => void onPatchConversation({ reactivate: true })}
                className="btn-r3 sm mt-2.5 w-full"
              >
                Reactivar IA
              </button>
            )}

            {brain?.warning === "doble_respuesta" ? (
              <div className="mt-2.5 flex items-start gap-2 rounded-md border border-danger-soft bg-danger-tint p-2.5">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger-text" strokeWidth={1.7} />
                <div className="text-[11px] leading-relaxed text-danger-text">
                  <p>
                    <span className="font-semibold">Doble respuesta:</span> el agente incluido y tu cerebro externo
                    contestan a la vez.
                  </p>
                  <Link href="/settings/quien-contesta" className="mt-1 inline-block font-medium underline underline-offset-2">
                    Revisar en Ajustes →
                  </Link>
                </div>
              </div>
            ) : brain && !agentReady && externalActive ? (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-3">
                <Cable className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                {externalAnswerLabel(brain)}
              </p>
            ) : brain && !agentReady && externalDown(brain) ? (
              <p className="mt-2 text-[11px] leading-relaxed text-warning-text">
                Tu cerebro externo no está en línea: nadie contesta en automático hasta que vuelva.{" "}
                <Link href="/settings/quien-contesta" className="font-medium underline underline-offset-2">
                  Ver en Ajustes →
                </Link>
              </p>
            ) : (
              brain &&
              !agentReady && (
                <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-text-3">
                  <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-warning-text" strokeWidth={1.7} />
                  <span>
                    {aiConfigured
                      ? "El agente de IA aún no responde por su cuenta."
                      : "Falta la clave de IA de la instancia para que el agente responda."}
                    {aiConfigured && (
                      <Link href="/lab" className="ml-1 whitespace-nowrap font-medium text-brand-ink underline-offset-2 hover:underline">
                        Configurar agente →
                      </Link>
                    )}
                  </span>
                </p>
              )
            )}
            {brainError && (
              <p role="alert" className="mt-2 text-[11px] text-danger-text">
                {brainError}
              </p>
            )}
          </section>
        )}

        {/* 033: tareas ligadas a este chat y las notas de trabajo del equipo. */}
        {viewer.hasModule("trabajo") && (
          <section className="sec">
            <h3 className="sec-h">
              Tareas y notas
              <Link
                href={`/trabajo/tareas?${new URLSearchParams({
                  nueva: "1",
                  contacto: contactId,
                  conversacion: conversation.id,
                  nombre: conversation.contact.name,
                })}`}
                aria-label="Nueva tarea para este chat"
                className="sec-link"
              >
                + Nueva
              </Link>
            </h3>
            <ContactTasks contactId={contactId} refreshKey={refreshKey} />
            <ContactNotes contactId={contactId} conversationId={conversation.id} bare />
          </section>
        )}

        {anuncio && (
          <section className="sec">
            <h3 className="sec-h">Llegó por anuncio</h3>
            <AnuncioOrigen anuncio={anuncio} />
          </section>
        )}

        {/* Lo que se consulta de vez en cuando: consentimiento y ficha. */}
        <section className="border-b">
          <DisclosureButton
            open={moreOpen}
            onToggle={() => setMoreOpen((v) => !v)}
            controls={moreId}
            className="rounded-none px-4 py-3 text-text-3 hover:bg-row-hover hover:text-foreground"
          >
            <span className="text-[12px] font-semibold uppercase tracking-[0.03em]">Más detalles</span>
          </DisclosureButton>
          <Collapse open={moreOpen} id={moreId} className="border-t">
            <ContactTagsCard contactId={contactId} only="consent" onChanged={bumpTimeline} />
            <FichaPanel ficha={ficha} onSave={saveFicha} />
          </Collapse>
        </section>

        {/* 022: los 3 últimos; «Ver todo» abre el historial completo. */}
        <ChatTimeline
          contactId={contactId}
          refreshKey={refreshKey + timelineRev}
          mode="preview"
          onSeeAll={() => setView("history")}
        />
      </div>
      {editingSale && leadId && (
        <AmountDialog
          leadName={contactLabel(conversation.contact)}
          currency={sale.currency ?? "MXN"}
          amountCents={sale.amountCents}
          priority={sale.priority}
          onPriorityChange={(p) => void saveSale({ priority: p })}
          onCancel={() => setEditingSale(false)}
          onSave={(cents) => {
            setEditingSale(false);
            void saveSale({ amountCents: cents });
          }}
        />
      )}
      {pendingLoss && (
        <LossReasonDialog
          leadName={contactLabel(conversation.contact)}
          onCancel={() => setPendingLoss(null)}
          onConfirm={(reason, note) => {
            const stageId = pendingLoss.id;
            setPendingLoss(null);
            void moveToStage(stageId, { reason, note });
          }}
        />
      )}
    </div>
  );
}

/** Lo que responde `GET /api/contacts/[id]` y usa este panel. */
function StageDot({ stage }: { stage: StageDto | undefined }) {
  const d = stageDot(stage?.color, stage?.name);
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute left-2.5 h-2 w-2 rounded-full", d.className)}
      style={d.style}
    />
  );
}

function saleOf(lead: ContactDetail["lead"]) {
  return { amountCents: lead?.amountCents ?? null, currency: lead?.currency ?? null, priority: lead?.priority ?? null };
}

type ContactDetail = {
  contact: ContactDto | null;
  stage: { id: string } | null;
  lead: { id: string; amountCents?: number | null; currency?: string | null; priority?: PriorityValue | null } | null;
  anuncio: AnuncioDto | null;
};

const PRIORITY_TONE: Record<PriorityValue, string> = {
  alta: "text-danger-text",
  media: "text-warning-text",
  baja: "text-text-2",
};

function PriorityText({ value }: { value: PriorityValue }) {
  return <span className={cn("font-semibold", PRIORITY_TONE[value])}>{PRIORITY_LABELS[value]}</span>;
}

/** 033 — Las tareas abiertas de este contacto; marcar una la cierra. */
function ContactTasks({ contactId, refreshKey = 0 }: { contactId: string; refreshKey?: number }) {
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchJson<{ tasks: TaskDto[] }>(
      `/api/work/tasks?${new URLSearchParams({ filter: "all", contactId })}`
    ).then((res) => {
      if (!alive) return;
      if (res.ok) setTasks(res.data.tasks.filter((t) => !t.doneAt));
    });
    return () => {
      alive = false;
    };
  }, [contactId, refreshKey]);

  async function complete(task: TaskDto) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    const res = await fetchJson(`/api/work/tasks/${task.id}`, jsonInit("PATCH", { done: true }));
    if (!res.ok) {
      setTasks((prev) => [task, ...prev]);
      setError(`No se cerró la tarea: ${res.error}`);
    }
  }

  if (tasks.length === 0 && !error) return null;
  const now = new Date();
  return (
    <ul className="mb-2.5 space-y-1.5" aria-label="Tareas de este chat">
      {tasks.map((t) => {
        const overdue = t.dueAt !== null && new Date(t.dueAt) < now;
        return (
          <li key={t.id} className="flex items-start gap-2 text-[13px]">
            <input
              type="checkbox"
              aria-label={`Marcar como hecha: ${t.title}`}
              disabled={!t.canEdit}
              onChange={() => void complete(t)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
            />
            <span className="min-w-0 flex-1 leading-5">{t.title}</span>
            {t.dueAt && (
              <span className={cn("cap shrink-0", overdue ? "bg-warning-tint text-warning-text" : "bg-secondary text-text-2")}>
                {dueLabel(t.dueAt, now)}
              </span>
            )}
          </li>
        );
      })}
      {error && (
        <li role="alert" className="text-[11px] text-danger-text">
          {error}
        </li>
      )}
    </ul>
  );
}
