"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Cable, Check, ChevronRight, Sparkles, UserRound } from "lucide-react";
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
  StageDto,
} from "@/lib/types";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { cn, formatPhone } from "@/lib/utils";
import { AnuncioOrigen } from "@/components/anuncio-origen";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { FichaPanel } from "@/components/ficha-panel";
import { AssignmentCard } from "@/components/assignment/assignment-card";
import { ContactTagsCard } from "@/components/tags/contact-tags-card";
import { LossReasonDialog } from "@/components/pipeline/loss-reason-dialog";
import { useViewer } from "@/components/viewer-context";
import { ChatTimeline } from "@/components/inbox/chat-timeline";
import { Collapse, DisclosureButton, useDisclosureId } from "@/components/motion";

const HANDOFF_LABELS: Record<string, string> = {
  cliente: "El cliente pidió un humano",
  modelo: "El agente decidió escalar",
  error: "Error del proveedor de IA",
  ventana: "Ventana de 24h cerrada",
  manual_reply: "Respondiste desde el teléfono — IA en pausa",
};

export function ContactPanel({
  conversation,
  refreshKey = 0,
  onPatchConversation,
  onClose,
}: {
  conversation: ConversationDto;
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
  const moreId = useDisclosureId("more-details");
  // 022: lo que se cambia DESDE el panel también refresca la línea de tiempo
  // (el SSE solo avisa de lo que cambió en otro lado).
  const [timelineRev, setTimelineRev] = useState(0);
  const bumpTimeline = useCallback(() => setTimelineRev((v) => v + 1), []);
  const [stages, setStages] = useState<StageDto[]>([]);
  const [currentStageId, setCurrentStageId] = useState<string | null>(null);
  const [leadId, setLeadId] = useState<string | null>(null);
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

  const contactId = conversation.contact.id;
  const viewer = useViewer();
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
  const loadBrain = useCallback(async () => {
    const res = await fetchJson<BrainStatusDto>("/api/agent/brain-status");
    if (!res.ok) {
      setBrainError(`No se pudo consultar quién responde: ${res.error}`);
      return;
    }
    setBrainError(null);
    setBrain(res.data);
  }, []);

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

  const currentIndex = stages.findIndex((s) => s.id === currentStageId);

  return (
    <div className="flex h-full flex-col">
      {/* Por debajo de xl el panel flota (bg-popover, ver InboxClient): su
          cabecera va del mismo tono para no dejar una franja más oscura. */}
      <header className="sticky top-0 flex items-center justify-between border-b bg-background px-4 py-3 max-xl:bg-popover">
        <h3 className="kicker text-text-2">Detalles</h3>
        <button
          onClick={onClose}
          aria-label="Ocultar panel"
          className="rounded p-1 text-text-3 hover:bg-accent hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" strokeWidth={1.7} />
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
        <section className="border-b p-4">
          <div className="flex items-center gap-3">
            <ContactAvatar
              name={conversation.contact.name}
              seed={conversation.contact.id}
              size="md"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight">
                {conversation.contact.name}
              </p>
              <p className="text-xs text-text-3">
                {formatPhone(conversation.contact.phone)}
              </p>
            </div>
          </div>

          {conversation.handoffAt && (
            <div className="mt-3 rounded-md border border-warning-soft bg-warning-tint p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-warning-text">
                <UserRound className="h-4 w-4" strokeWidth={1.7} /> Atención humana
                <span className="font-normal opacity-80">· {handoffOwner}</span>
              </p>
              <p className="mt-1 text-xs text-warning-text opacity-80">
                {HANDOFF_LABELS[conversation.handoffReason ?? ""] ??
                  "La IA está en pausa en esta conversación."}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-2 w-full"
                onClick={() => void onPatchConversation({ reactivate: true })}
              >
                Reactivar IA
              </Button>
            </div>
          )}

          <div className="mt-3 rounded-md border bg-subtle px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">IA en esta conversación</p>
                <p className="text-[11px] text-text-3">
                  {conversation.handoffAt
                    ? "En pausa · atención humana"
                    : !conversation.aiEnabled
                      ? "En pausa"
                      : agentReady || externalActive
                        ? "Respondiendo"
                        : "Activada"}
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

            {brain?.warning === "doble_respuesta" ? (
              <div className="mt-2.5 flex items-start gap-2 rounded-md border border-danger-soft bg-danger-tint p-2.5">
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger-text"
                  strokeWidth={1.7}
                />
                <div className="text-[11px] leading-relaxed text-danger-text">
                  <p>
                    <span className="font-semibold">Doble respuesta:</span> el agente
                    incluido y tu cerebro externo contestan a la vez.
                  </p>
                  <Link
                    href="/agent"
                    className="mt-1 inline-block font-medium underline underline-offset-2"
                  >
                    Revisar en Agente →
                  </Link>
                </div>
              </div>
            ) : brain && !agentReady && externalActive ? (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-text-3">
                <Cable className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                {externalAnswerLabel(brain)}
              </p>
            ) : brain && !agentReady && externalDown(brain) ? (
              <div className="mt-2.5 flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-2.5">
                <Cable
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-text"
                  strokeWidth={1.7}
                />
                <p className="text-[11px] leading-relaxed text-warning-text">
                  Tu cerebro externo no está en línea: nadie contesta en automático
                  hasta que vuelva.
                  <Link
                    href="/agent"
                    className="ml-1 whitespace-nowrap font-medium text-brand-text underline underline-offset-2 hover:text-brand"
                  >
                    Ver en Agente →
                  </Link>
                </p>
              </div>
            ) : brain && !agentReady && (
              <div className="mt-2.5 flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-2.5">
                <Sparkles
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-text"
                  strokeWidth={1.7}
                />
                <p className="text-[11px] leading-relaxed text-warning-text">
                  {aiConfigured
                    ? "El agente de IA no responde por su cuenta. Configura lo básico y enciéndelo (o conecta tu propio bot por la API)."
                    : "Falta la clave de IA de la instancia (OPENROUTER_API_TOKEN) para que el agente responda, o conecta tu propio bot por la API."}
                  {aiConfigured && (
                    <Link
                      href="/agent"
                      className="ml-1 whitespace-nowrap font-medium text-brand-text underline underline-offset-2 hover:text-brand"
                    >
                      Configurar agente →
                    </Link>
                  )}
                </p>
              </div>
            )}
          </div>

          {brainError && (
            <p role="alert" className="mt-2 text-[11px] text-danger-text">
              {brainError}
            </p>
          )}

          {anuncio && (
            <div className="mt-3">
              <AnuncioOrigen anuncio={anuncio} />
            </div>
          )}
        </section>

        {/* 020: quién atiende y reasignar. 022: el historial, plegado y
            solo para quien reparte. */}
        <AssignmentCard contactId={contactId} refreshKey={refreshKey} onChanged={bumpTimeline} />

        {/* Stepper de etapa */}
        {stages.length > 0 && leadId && (
          <section className="border-b p-4">
            <p className="kicker mb-3">Etapa del pipeline</p>
            <ol>
              {stages.map((s, i) => {
                const done = currentIndex >= 0 && i < currentIndex;
                const current = s.id === currentStageId;
                return (
                  <li key={s.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < stages.length - 1 && (
                      <span
                        className={cn(
                          "absolute left-[7px] top-4 h-full w-px",
                          done ? "bg-brand" : "bg-border-strong"
                        )}
                      />
                    )}
                    <button
                      onClick={() => requestMove(s)}
                      aria-label={`Mover a ${s.name}`}
                      className={cn(
                        "relative z-10 mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full transition-colors",
                        done && "bg-brand text-brand-fg",
                        current && "bg-brand ring-4 ring-brand-soft",
                        !done && !current && "border border-border-strong bg-background hover:border-brand"
                      )}
                    >
                      {done && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                    </button>
                    <button
                      onClick={() => requestMove(s)}
                      className={cn(
                        "text-left text-[13px]",
                        current ? "font-[650] text-brand-text" : "text-text-2 hover:text-foreground"
                      )}
                    >
                      {s.name}
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {/* 022: lo que se consulta de vez en cuando, plegado. Mensajes
            masivos, etiquetas y la ficha (lo que se SABE del lead). */}
        <section className="border-b">
          <DisclosureButton
            open={moreOpen}
            onToggle={() => setMoreOpen((v) => !v)}
            controls={moreId}
            className="rounded-none px-4 py-3 text-text-2 hover:bg-accent hover:text-foreground"
          >
            <span className="kicker">Más detalles</span>
          </DisclosureButton>
          <Collapse open={moreOpen} id={moreId} className="border-t">
            {/* 021: consentimiento para mensajes masivos y etiquetas. */}
            <ContactTagsCard contactId={contactId} consentFirst onChanged={bumpTimeline} />
            <FichaPanel ficha={ficha} onSave={saveFicha} />
          </Collapse>
        </section>

        {/* 022: todo lo que le pasó a este chat, con su nota al frente. */}
        <ChatTimeline contactId={contactId} refreshKey={refreshKey + timelineRev} />
      </div>

      {pendingLoss && (
        <LossReasonDialog
          leadName={conversation.contact.name}
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
type ContactDetail = {
  contact: ContactDto | null;
  stage: { id: string } | null;
  lead: { id: string } | null;
  anuncio: AnuncioDto | null;
};
