"use client";

import { useEffect, useRef } from "react";

export type EventHandlers = {
  onMessageNew?: (data: { conversationId: string; message: unknown }) => void;
  onMessageStatus?: (data: {
    conversationId: string;
    messageId: string;
    status: string;
    /** Motivo, presente solo cuando status = "failed". */
    error?: string | null;
  }) => void;
  onConversationUpdated?: (data: { conversation: unknown }) => void;
  onLabRun?: (data: {
    runId: string;
    status: string;
    progress: { done: number; total: number };
    score?: number | null;
  }) => void;
  /** 015 — Algo cambió en la agenda (también cuando agenda la IA). */
  onBookingUpdated?: (data: { bookingId: string }) => void;
  /** 020 — Cambió quién atiende uno o más contactos: refetch. */
  onAssignmentChanged?: (data: {
    contactIds: string[];
    toUserId: string | null;
    fromUserIds: string[];
  }) => void;
  /** 021 — Avance de una campaña de envío masivo. */
  onCampaignProgress?: (data: {
    campaignId: string;
    status: string;
    counts: { pending: number; sent: number; failed: number };
  }) => void;
  /** 025 — Chat de equipo: un mensaje nuevo, editado, borrado o con otra reacción. */
  onTeamMessage?: (data: {
    threadId: string;
    change: "new" | "updated" | "deleted";
    message: unknown;
  }) => void;
  /** 025 — Chat de equipo: cambió la lista (hilo nuevo, participantes, leído, ajustes). */
  onTeamThread?: (data: {
    threadId: string | null;
    change: "created" | "updated" | "deleted" | "read" | "settings";
  }) => void;
  /**
   * 025 — Cada vez que la conexión queda abierta, INCLUIDA la primera. Quien
   * cargó datos antes de que el SSE terminara de conectarse se pone al día
   * aquí (lo publicado en ese intervalo no llega por el canal).
   */
  onConnect?: () => void;
  /** Se llama tras RECONECTAR (no en la conexión inicial): catch-up con refetch. */
  onReconnect?: () => void;
};

/** Los tipos de evento que la app escucha (contrato sse.md). */
const EVENT_TYPES = {
  "message.new": "onMessageNew",
  "message.status": "onMessageStatus",
  "conversation.updated": "onConversationUpdated",
  "lab.run": "onLabRun",
  "booking.updated": "onBookingUpdated",
  "assignment.changed": "onAssignmentChanged",
  "campaign.progress": "onCampaignProgress",
  "team.message": "onTeamMessage",
  "team.thread": "onTeamThread",
} as const satisfies Record<string, keyof EventHandlers>;

type Subscriber = { current: EventHandlers };

/**
 * UNA conexión SSE por pestaña, compartida por todos los que escuchan.
 *
 * Antes cada `useEvents` abría su propio `EventSource`: el menú lateral más la
 * pantalla ya eran dos conexiones largas por pestaña, y con HTTP/1.1 el
 * navegador solo abre seis por origen — tres pestañas y las peticiones
 * normales se quedan en cola. Ahora hay una sola y los eventos se reparten
 * a cada suscriptor.
 */
const subscribers = new Set<Subscriber>();
let source: EventSource | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
/** Un cambio de pantalla desmonta y monta en el mismo tick: sin esta gracia
 *  la conexión se cerraría y reabriría (y se perdería lo que llegue entre). */
const CLOSE_GRACE_MS = 1000;

function dispatch(key: keyof EventHandlers, data: unknown) {
  for (const sub of subscribers) {
    const handler = sub.current[key] as ((d: unknown) => void) | undefined;
    try {
      handler?.(data);
    } catch (err) {
      // Un suscriptor que truena no debe dejar sin el evento a los demás.
      console.error("[events] un suscriptor falló", err);
    }
  }
}

function open() {
  const es = new EventSource("/api/events");
  let hadError = false;
  for (const [type, key] of Object.entries(EVENT_TYPES)) {
    es.addEventListener(type, (ev) => {
      let data: unknown;
      try {
        data = JSON.parse((ev as MessageEvent).data);
      } catch {
        return; // evento malformado: ignorar
      }
      dispatch(key, data);
    });
  }
  es.onerror = () => {
    hadError = true;
  };
  es.onopen = () => {
    dispatch("onConnect", undefined);
    if (hadError) {
      hadError = false;
      dispatch("onReconnect", undefined);
    }
  };
  return es;
}

/**
 * Suscribe un juego de handlers a LA conexión compartida (la abre si no hay).
 * Devuelve la función para soltarla; al irse el último, la conexión se cierra
 * tras una gracia corta. La usa `useEvents`; exportada para las pruebas.
 */
export function subscribeEvents(sub: Subscriber): () => void {
  retain(sub);
  return () => release(sub);
}

function retain(sub: Subscriber) {
  subscribers.add(sub);
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (!source) source = open();
}

function release(sub: Subscriber) {
  subscribers.delete(sub);
  if (subscribers.size > 0 || closeTimer) return;
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (subscribers.size === 0) {
      source?.close();
      source = null;
    }
  }, CLOSE_GRACE_MS);
}

/**
 * Suscripción SSE (contrato sse.md). EventSource reconecta solo; el servidor
 * no garantiza replay, así que al reconectar el consumidor debe refetch con
 * `since=` (onReconnect).
 */
export function useEvents(handlers: EventHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    return subscribeEvents(handlersRef);
  }, []);
}
