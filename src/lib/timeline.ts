import { HANDOFF_LABEL } from "@/lib/analytics";
import { WA_CONSENT_LABEL, type WaConsent } from "@/lib/tags";
import { LOSS_REASON_LABEL, type LossReason } from "@/lib/types";

/**
 * 022 — Línea de tiempo del chat: contrato entre `GET
 * /api/contacts/[id]/timeline` y el panel de la Bandeja, y la ÚNICA función
 * que la pone en palabras ("[acción] por [quién]"). Pura, sin BD: la prueban
 * los unit tests y la usa el cliente.
 */

export type TimelineActor =
  | { type: "user"; id: string; name: string }
  /** El agente de IA incluido. */
  | { type: "bot" }
  /** Un cerebro externo por `/api/bot/*`. */
  | { type: "api" }
  | { type: "sistema" };

export type TimelineKind =
  | "note"
  | "initial_note"
  | "stage"
  | "assignment"
  | "ai_paused"
  | "ai_resumed"
  | "ai_handoff"
  | "consent"
  | "tag_added"
  | "tag_removed";

export type TimelineItemDto = {
  id: string;
  kind: TimelineKind;
  /** ISO; cuándo PASÓ. */
  at: string;
  actor: TimelineActor | null;
  /** Lo propio de cada tipo (texto de la nota, etapa, motivo…). */
  detail: Record<string, string | null>;
};

export type TimelineLine = {
  /** Una línea: lo que se ve colapsado. */
  title: string;
  /** Contenido adicional para "ver más" (texto de la nota, motivo…). */
  body: string | null;
};

function by(actor: TimelineActor | null): string {
  if (!actor) return "";
  switch (actor.type) {
    case "user":
      return ` por ${actor.name}`;
    case "bot":
      return " por el agente de IA";
    case "api":
      return " por el cerebro externo";
    case "sistema":
      return "";
  }
}

const HANDOFF_TIMELINE: Record<string, string> = {
  ...HANDOFF_LABEL,
  manual_reply: "respondieron desde el teléfono del negocio",
};

export function describeTimelineItem(item: TimelineItemDto): TimelineLine {
  const d = item.detail;
  const actor = by(item.actor);
  switch (item.kind) {
    case "note":
      return { title: `Nota añadida${actor}`, body: d.text ?? null };
    case "initial_note":
      return { title: "Nota inicial", body: d.text ?? null };
    case "stage": {
      if (!d.from) {
        return { title: `Lead creado en ${d.to ?? "el pipeline"}${actor}`, body: null };
      }
      const reason = d.lossReason ? LOSS_REASON_LABEL[d.lossReason as LossReason] ?? d.lossReason : null;
      const body = [reason && `Motivo: ${reason}`, d.lossNote].filter(Boolean).join("\n");
      return { title: `Etapa cambiada a ${d.to}${actor}`, body: body || null };
    }
    case "assignment": {
      const how = d.source === "auto" ? " por reparto automático" : actor;
      const batch = d.source === "lote" ? " (en lote)" : "";
      const title = !d.to
        ? `Quedó sin asignar${how}${batch}`
        : d.from
          ? `Reasignado de ${d.from} a ${d.to}${how}${batch}`
          : `Asignado a ${d.to}${how}${batch}`;
      return { title, body: d.reason ?? null };
    }
    case "ai_paused":
      return { title: `IA pausada en esta conversación${actor}`, body: null };
    case "ai_resumed":
      return { title: `IA reactivada en esta conversación${actor}`, body: null };
    case "ai_handoff": {
      const why = d.reason ? HANDOFF_TIMELINE[d.reason] ?? d.reason : null;
      return {
        title: `IA en pausa · atención humana${why ? `: ${lower(why)}` : ""}`,
        body: null,
      };
    }
    case "consent": {
      const label = WA_CONSENT_LABEL[d.to as WaConsent] ?? d.to ?? "";
      return {
        title: `Mensajes masivos: ${label}${actor}`,
        body: d.source ? `Origen: ${d.source}` : null,
      };
    }
    case "tag_added":
      return { title: `Etiqueta «${d.tag}» añadida${actor}`, body: null };
    case "tag_removed":
      return { title: `Etiqueta «${d.tag}» quitada${actor}`, body: null };
  }
}

function lower(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Más reciente primero; a igual hora, el orden en que llegaron. */
export function sortTimeline(items: TimelineItemDto[]): TimelineItemDto[] {
  return [...items].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
