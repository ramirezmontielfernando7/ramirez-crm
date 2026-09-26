import { EventEmitter } from "node:events";

/**
 * Bus de eventos in-process por organización (contrato sse.md).
 * Publicar SIEMPRE después del commit de BD. Una instancia = un proceso,
 * así que un EventEmitter es suficiente (sin colas externas — Constitución II).
 */

export type SseEvent =
  | { type: "message.new"; data: { conversationId: string; message: unknown } }
  | {
      type: "message.status";
      data: {
        conversationId: string;
        messageId: string;
        status: string;
        /** Motivo del fallo, presente solo cuando status = "failed". */
        error?: string | null;
      };
    }
  | { type: "conversation.updated"; data: { conversation: unknown } }
  /**
   * 020 — cambió quién atiende a uno o más contactos. Solo ids: la bandeja
   * refetchea. `/api/events` se lo entrega a quien ve todo y a los asesores
   * involucrados (el que lo recibe y el que lo pierde).
   */
  | {
      type: "assignment.changed";
      data: {
        contactIds: string[];
        toUserId: string | null;
        fromUserIds: string[];
      };
    }
  /**
   * 021 — avance de una campaña de envío masivo. Solo conteos: la pantalla de
   * detalle refetchea la lista si la necesita. Solo le llega a quien ve todo.
   */
  | {
      type: "campaign.progress";
      data: {
        campaignId: string;
        status: string;
        counts: { pending: number; sent: number; failed: number };
      };
    }
  /**
   * 026 — entró o salió un participante de uno o más chats. Solo ids: la
   * Bandeja refetchea. Le llega a quien ve todo y a los involucrados.
   */
  | { type: "participants.changed"; data: { contactIds: string[]; userIds: string[] } }
  /**
   * 026 — AVISO de handoff (aparte de `conversation.updated`): al asignado y
   * a quien ve todo; nunca a los participantes. Ver `inbox/handoff-notice.ts`.
   */
  | {
      type: "handoff.requested";
      data: {
        conversationId: string;
        contactId: string;
        contactName: string;
        reason: string;
        assignedUserId: string | null;
      };
    }
  /** 015 — algo cambió en la agenda: la pantalla de Citas se refresca sola. */
  | { type: "booking.updated"; data: { bookingId: string } }
  | {
      type: "lab.run";
      data: {
        runId: string;
        status: string;
        progress: { done: number; total: number };
        score?: number | null;
      };
    }
  | TeamSseEvent;

/**
 * 025 — Eventos del chat de EQUIPO. Llevan su `audience` (quién puede
 * recibirlos, calculada al publicar: participantes que siguen en la
 * organización + el Propietario si supervisa) FUERA de `data`: `/api/events`
 * solo escribe `data`, así que el cliente nunca ve la lista. No pasan por el
 * atajo de `seesAll`: ver todos los chats de clientes no es ver los directos
 * del equipo.
 */
export type TeamSseEvent =
  | {
      type: "team.message";
      /** El mensaje, igual para todos (lo "mío" se decide en el cliente). */
      data: { threadId: string; change: "new" | "updated" | "deleted"; message: unknown };
      audience: readonly string[];
    }
  | {
      type: "team.thread";
      /**
       * Algo cambió en la lista: un hilo nuevo, renombrado, con otros
       * participantes, borrado, o leído en otra pestaña. Solo ids: refetch.
       */
      data: { threadId: string | null; change: "created" | "updated" | "deleted" | "read" | "settings" };
      audience: readonly string[];
    };

export function isTeamEvent(event: SseEvent): event is TeamSseEvent {
  return event.type === "team.message" || event.type === "team.thread";
}

const globalForBus = globalThis as unknown as { __voceroBus?: EventEmitter };

function getBus(): EventEmitter {
  if (!globalForBus.__voceroBus) {
    const bus = new EventEmitter();
    bus.setMaxListeners(200);
    globalForBus.__voceroBus = bus;
  }
  return globalForBus.__voceroBus;
}

export function publish(organizationId: string, event: SseEvent): void {
  getBus().emit(`org:${organizationId}`, event);
}

export function subscribe(
  organizationId: string,
  listener: (event: SseEvent) => void
): () => void {
  const bus = getBus();
  const channel = `org:${organizationId}`;
  bus.on(channel, listener);
  return () => bus.off(channel, listener);
}
