/**
 * Paso 2 (PR 2) — Reglas puras para refrescar la Bandeja por partes. Sin React
 * ni BD.
 *
 * Cada aviso en vivo dice QUÉ chat cambió (`message.new`, `conversation.updated`
 * traen el id de la conversación; `assignment.changed`, `participants.changed`
 * traen ids de contacto). La Bandeja junta los de una ráfaga y pide SOLO esos
 * (`GET /api/conversations?ids=…&contactIds=…`); la lista completa se pide
 * solo al cargar, al reconectar el canal o cuando un aviso no dice qué cambió.
 */

import type { ConversationDto } from "@/lib/types";

/** Más de esto en una ráfaga (un reparto masivo, p. ej.) y conviene la lista entera. */
export const MAX_SUBSET = 50;

/** Ids de nanoid con prefijo (`cv_…`, `ct_…`): nada que haya que escapar. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `?ids=a,b` → `["a","b"]`. null = el parámetro no vino (o vino vacío).
 * "invalid" = demasiados o con caracteres raros: la ruta responde 422.
 */
export function parseSubsetParam(value: string | null): string[] | null | "invalid" {
  if (value == null) return null;
  const ids = [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return null;
  if (ids.length > MAX_SUBSET || !ids.every((id) => ID_RE.test(id))) return "invalid";
  return ids;
}

export type RefreshPlan =
  | { kind: "full" }
  | { kind: "subset"; ids: string[]; contactIds: string[] };

/** Lo que se acumula durante el respiro (debounce) antes de pedir. */
export class RefreshBatch {
  private full = false;
  private readonly ids = new Set<string>();
  private readonly contactIds = new Set<string>();

  /** Un aviso que no dice qué chat cambió: lista completa. */
  markFull() {
    this.full = true;
  }

  addConversation(id: string | null | undefined) {
    if (typeof id === "string" && id) this.ids.add(id);
    else this.full = true;
  }

  addContacts(ids: readonly unknown[] | null | undefined) {
    const ok = (ids ?? []).filter((x): x is string => typeof x === "string" && x.length > 0);
    if (ok.length === 0) this.full = true;
    for (const id of ok) this.contactIds.add(id);
  }

  get empty(): boolean {
    return !this.full && this.ids.size === 0 && this.contactIds.size === 0;
  }

  /** Lo pendiente como UNA petición, y vacía el lote. null = nada que pedir. */
  take(): RefreshPlan | null {
    if (this.empty) return null;
    const plan: RefreshPlan =
      this.full || this.ids.size > MAX_SUBSET || this.contactIds.size > MAX_SUBSET
        ? { kind: "full" }
        : { kind: "subset", ids: [...this.ids], contactIds: [...this.contactIds] };
    this.full = false;
    this.ids.clear();
    this.contactIds.clear();
    return plan;
  }
}

export function subsetQuery(plan: { ids: string[]; contactIds: string[] }): string {
  const q = new URLSearchParams();
  if (plan.ids.length) q.set("ids", plan.ids.join(","));
  if (plan.contactIds.length) q.set("contactIds", plan.contactIds.join(","));
  return q.toString();
}

/** La misma llave con la que ordena el servidor: último mensaje, o la creación. */
const sortKey = (c: Pick<ConversationDto, "lastMessageAt" | "createdAt">) => c.lastMessageAt ?? c.createdAt;

/** Del más reciente al más viejo. Estable: los empates conservan su lugar. */
export function sortConversations<T extends Pick<ConversationDto, "lastMessageAt" | "createdAt">>(list: T[]): T[] {
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ka = sortKey(a.c);
      const kb = sortKey(b.c);
      return ka === kb ? a.i - b.i : ka < kb ? 1 : -1;
    })
    .map((x) => x.c);
}

/**
 * Aplica la respuesta de un refresco parcial: lo pedido que el servidor NO
 * devolvió sale de la lista (eliminado, reasignado a otro, ahora en otra
 * vista); lo que sí devolvió reemplaza a su fila o entra nuevo. Después se
 * reordena como la lista completa.
 */
export function mergeSubset(
  list: ConversationDto[],
  plan: { ids: string[]; contactIds: string[] },
  returned: ConversationDto[]
): ConversationDto[] {
  const ids = new Set(plan.ids);
  const contactIds = new Set(plan.contactIds);
  const fresh = new Map(returned.map((c) => [c.id, c]));
  const kept: ConversationDto[] = [];
  for (const c of list) {
    const nuevo = fresh.get(c.id);
    if (nuevo) {
      kept.push(nuevo);
      fresh.delete(c.id);
    } else if (!ids.has(c.id) && !contactIds.has(c.contact.id)) {
      kept.push(c);
    }
  }
  return sortConversations([...kept, ...fresh.values()]);
}
