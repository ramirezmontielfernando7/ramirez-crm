/**
 * Fluidez PR 3 — Reglas puras de la Bandeja PAGINADA. Sin React ni BD.
 *
 * La lista ya no baja entera: el servidor filtra (qué mostrar, búsqueda,
 * etapa, etiqueta, quién atiende, bandeja) y entrega de a una página,
 * ordenada por último mensaje (o creación) y luego por id. La página
 * siguiente se pide con el cursor de la última fila (`nextCursor`), así un
 * chat que sube a la cima mientras se baja no duplica ni salta filas.
 *
 * Los contadores de los filtros salen aparte (`GET /api/conversations/counts`)
 * con los MISMOS filtros, porque la lista cargada ya no alcanza para contar.
 *
 * El navegador aplica además `matchesListQuery` sobre lo cargado: un cambio
 * propio (archivar, mover de etapa, leer) se refleja al instante, igual que
 * cuando toda la lista vivía en el navegador, sin esperar al servidor.
 */

import type { ConversationDto } from "@/lib/types";
import type { InboxView } from "@/lib/campaign-inbox";
import { isChannel, type Channel } from "@/lib/channels";
import { matchesQuery } from "@/lib/search";
import { ALL_TAGS, isArchived, matchesTag } from "@/lib/inbox-filters";

/** Filas por página. Con la lista virtual se ven ~18; 50 dan margen al bajar. */
export const PAGE_SIZE = 50;
/** Tope por petición: un refresco completo pide lo ya cargado, no más de esto. */
export const MAX_PAGE_SIZE = 500;
/** Más largo que esto no es una búsqueda de nombre o teléfono. */
export const MAX_QUERY_LENGTH = 100;

/** «Qué mostrar» dentro de la principal. «Campañas» es otra vista, no un estado. */
export type ListStatus = "all" | "unread" | "archived" | "humano" | "anuncios";

export function parseListStatus(value: string | null | undefined): ListStatus {
  return value === "unread" || value === "archived" || value === "humano" || value === "anuncios"
    ? value
    : "all";
}

/**
 * Los filtros que antes aplicaba el navegador sobre la lista completa. Valores
 * "all" (o vacío) = sin filtro, como en la pantalla.
 */
export type ListFilters = {
  /** Nombre o teléfono (la misma regla de `matchesQuery`). */
  q: string;
  /** Nombre de la etapa del lead. */
  stage: string;
  /** Id de etiqueta. */
  tag: string;
  /** "all" | "mine" | "unassigned" | <userId>. Solo cambia algo para quien ve todo. */
  owner: string;
  channel: Channel | "all";
};

export type ListQuery = ListFilters & { view: InboxView; status: ListStatus };

export const DEFAULT_FILTERS: ListFilters = { q: "", stage: "all", tag: ALL_TAGS, owner: "all", channel: "all" };

/** Lo que la Bandeja pide, como parámetros de URL (solo lo que filtra). */
export function listQueryParams(q: Partial<ListQuery>): URLSearchParams {
  const p = new URLSearchParams();
  if (q.view === "campaigns") p.set("view", "campaigns");
  else if (q.status && q.status !== "all") p.set("status", q.status);
  const text = q.q?.trim();
  if (text) p.set("q", text);
  if (q.stage && q.stage !== "all") p.set("stage", q.stage);
  if (q.tag && q.tag !== ALL_TAGS) p.set("tag", q.tag);
  if (q.owner && q.owner !== "all") p.set("assigned", q.owner);
  if (q.channel && q.channel !== "all") p.set("channel", q.channel);
  return p;
}

/** Del lado del servidor: los filtros de la URL, recortados y sin sorpresas. */
export function parseListFilters(p: URLSearchParams): ListFilters {
  const channel = p.get("channel");
  return {
    q: (p.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH),
    stage: (p.get("stage") ?? "").slice(0, 200) || "all",
    tag: (p.get("tag") ?? "").slice(0, 64) || ALL_TAGS,
    owner: (p.get("assigned") ?? "").slice(0, 64) || "all",
    channel: channel && isChannel(channel) ? channel : "all",
  };
}

/** `?limit=` → filas por página; null = sin paginar (la lista entera, como antes). */
export function parseLimit(value: string | null): number | null | "invalid" {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_SIZE) return "invalid";
  return n;
}

/**
 * La MISMA regla del servidor, sobre una fila ya cargada (ver arriba). Un chat
 * de «Campañas» solo pasa en esa vista; en la principal, el estado decide.
 */
export function matchesListQuery(c: ConversationDto, q: ListQuery, viewerId: string): boolean {
  if (q.view === "campaigns" ? !c.campaign || c.campaign.state !== "pending" : c.campaign?.state === "pending") {
    return false;
  }
  if (!matchesQuery(q.q, { text: [c.contact.name], phone: c.contact.phone })) return false;
  if (q.stage !== "all" && c.stageName !== q.stage) return false;
  if (!matchesTag(c, q.tag)) return false;
  if (q.owner !== "all") {
    const ok =
      q.owner === "mine"
        ? c.assignee?.id === viewerId
        : q.owner === "unassigned"
          ? !c.assignee
          : c.assignee?.id === q.owner;
    if (!ok) return false;
  }
  if (q.channel !== "all" && c.channel !== q.channel) return false;
  if (q.view === "campaigns") return true;
  if (q.status === "archived") return isArchived(c);
  if (isArchived(c)) return false;
  if (q.status === "unread") return c.unreadCount > 0;
  if (q.status === "humano") return c.handoffAt !== null;
  if (q.status === "anuncios") return c.anuncio !== null;
  return true;
}

/** Llave de orden del lado del navegador (milisegundos; basta para comparar). */
const sortKey = (c: Pick<ConversationDto, "lastMessageAt" | "createdAt">) => c.lastMessageAt ?? c.createdAt;

/** Del más reciente al más viejo y, en empate, por id descendente (como el servidor). */
export function compareRows(a: ConversationDto, b: ConversationDto): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  if (ka !== kb) return ka < kb ? 1 : -1;
  return a.id === b.id ? 0 : a.id < b.id ? 1 : -1;
}

/** Agrega la página siguiente: lo ya cargado manda (puede ser más nuevo). */
export function appendPage(list: ConversationDto[], page: ConversationDto[]): ConversationDto[] {
  const seen = new Set(list.map((c) => c.id));
  return [...list, ...page.filter((c) => !seen.has(c.id))];
}

/**
 * ¿Una fila que el refresco por chat trajo y que NO estaba cargada entra en lo
 * cargado? Sí si ya no quedan páginas, o si cae arriba de la última fila
 * cargada (un chat que recibió mensaje sube a la cima). Si cae más abajo, la
 * traerá la página que le toque al bajar: meterla ahora dejaría un hueco.
 */
export function fitsLoadedWindow(
  c: ConversationDto,
  list: ConversationDto[],
  hasMore: boolean
): boolean {
  if (!hasMore) return true;
  const last = list[list.length - 1];
  return !last || compareRows(c, last) < 0;
}

/** Lo que dice `GET /api/conversations/counts`. */
export type InboxCounts = {
  /** Eco de la búsqueda con que se contó (para no usar cifras de otra). */
  q: string;
  /** Toda la principal (con archivados), sin filtros: ¿la Bandeja está vacía? */
  total: number;
  /** Con búsqueda, etapa, etiqueta y quién atiende, dentro de la bandeja elegida. */
  all: number;
  unread: number;
  archived: number;
  humano: number;
  anuncios: number;
  /** «Campañas» con los mismos filtros (la pestaña abierta cuenta lo que muestra). */
  campaigns: number;
  /** «Campañas» sin filtros de pantalla (la pestaña cerrada). */
  campaignPending: number;
  /** Por bandeja (canal), sin archivados y con los filtros, sin el de canal. */
  channels: Partial<Record<Channel, number>>;
  /** ¿Algún chat de la principal coincide con la búsqueda? (número no registrado). */
  queryHits: number;
  /** Etapas presentes, de la más reciente a la más vieja. */
  stages: string[];
  /** Etiquetas presentes [id, nombre]. */
  tags: [string, string][];
  /** Personas asignadas en la Bandeja [id, nombre]. */
  owners: [string, string][];
};

/**
 * El refresco por chat (`mergeSubset` de inbox-refresh.ts) sobre una lista
 * PAGINADA: lo pedido que no volvió sale; lo que volvió reemplaza su fila o,
 * si no estaba cargado, entra solo si cae dentro de lo cargado
 * (`fitsLoadedWindow`). Después, el orden del servidor.
 */
export function mergeSubsetPaged(
  list: ConversationDto[],
  plan: { ids: string[]; contactIds: string[] },
  returned: ConversationDto[],
  hasMore: boolean
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
  kept.sort(compareRows);
  // El borde es la última fila que se HABÍA cargado (hasta ahí llegó el
  // cursor), aunque el refresco la haya quitado o subido.
  const entran = [...fresh.values()].filter((c) => fitsLoadedWindow(c, list, hasMore));
  return entran.length ? [...kept, ...entran].sort(compareRows) : kept;
}
