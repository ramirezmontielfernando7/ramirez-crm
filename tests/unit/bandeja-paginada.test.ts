import { describe, expect, it } from "vitest";
import {
  appendPage,
  compareRows,
  DEFAULT_FILTERS,
  fitsLoadedWindow,
  listQueryParams,
  matchesListQuery,
  mergeSubsetPaged,
  parseLimit,
  parseListFilters,
  parseListStatus,
  type ListQuery,
} from "@/lib/inbox-list";
import { decodeCursor, encodeCursor } from "@/server/inbox/cursor";
import type { ConversationDto } from "@/lib/types";

/** Fluidez PR 3 — reglas puras de la Bandeja paginada. */

function fila(id: string, minutos: number, over: Partial<ConversationDto> = {}): ConversationDto {
  const t = new Date(Date.UTC(2026, 9, 21, 12, 0) - minutos * 60_000).toISOString();
  return {
    id,
    channel: "whatsapp",
    contact: { id: `ct_${id}`, name: `Cliente ${id}`, phone: "5215512345678" },
    assignee: null,
    stageName: null,
    stageColor: null,
    leadId: null,
    stageId: null,
    tags: [],
    archivedAt: null,
    aiAvailable: false,
    aiEnabled: true,
    handoffAt: null,
    handoffReason: null,
    lastInboundAt: t,
    lastMessageAt: t,
    createdAt: t,
    unreadCount: 0,
    windowOpen: true,
    windowRemainingMs: 1,
    preview: null,
    anuncio: null,
    campaign: null,
    ...over,
  };
}

const q = (over: Partial<ListQuery> = {}): ListQuery => ({ view: "main", status: "all", ...DEFAULT_FILTERS, ...over });

describe("parámetros de la lista", () => {
  it("solo viaja lo que filtra, y el servidor lo lee igual", () => {
    expect(listQueryParams(q()).toString()).toBe("");
    const p = listQueryParams(q({ status: "unread", q: "  José ", stage: "Nuevo", tag: "tg_1", owner: "mine", channel: "messenger" }));
    expect(p.get("status")).toBe("unread");
    expect(parseListFilters(p)).toEqual({ q: "José", stage: "Nuevo", tag: "tg_1", owner: "mine", channel: "messenger" });
    expect(parseListStatus(p.get("status"))).toBe("unread");
  });

  it("«Campañas» es una vista, no un estado", () => {
    const p = listQueryParams(q({ view: "campaigns", status: "unread" }));
    expect(p.get("view")).toBe("campaigns");
    expect(p.has("status")).toBe(false);
  });

  it("lo raro se ignora o se rechaza", () => {
    const p = new URLSearchParams({ channel: "telegram", q: "x".repeat(500), status: "todo" });
    expect(parseListFilters(p).channel).toBe("all");
    expect(parseListFilters(p).q.length).toBe(100);
    expect(parseListStatus(p.get("status"))).toBe("all");
    expect(parseLimit(null)).toBeNull();
    expect(parseLimit("50")).toBe(50);
    for (const v of ["0", "-1", "501", "2.5", "abc"]) expect(parseLimit(v)).toBe("invalid");
  });
});

describe("cursor", () => {
  it("ida y vuelta, con microsegundos", () => {
    const c = { key: "2026-10-21 12:34:56.123456", id: "cv_abc-1" };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(null)).toBeNull();
  });
  it("lo que no es nuestro es inválido", () => {
    for (const v of ["x", Buffer.from("hola|cv_1").toString("base64url"), Buffer.from("2026-10-21 12:34:56|a b").toString("base64url"), "a".repeat(300)]) {
      expect(decodeCursor(v)).toBe("invalid");
    }
  });
});

describe("matchesListQuery (la regla del servidor, en el navegador)", () => {
  const archivada = fila("a", 1, { archivedAt: "2026-10-21T00:00:00.000Z", unreadCount: 2 });
  const pendiente = fila("p", 1, { campaign: { state: "pending", name: null } });
  const respondio = fila("r", 1, { campaign: { state: "replied", name: null } });
  it("archivados solo en «Archivados»; los demás estados los dejan fuera", () => {
    expect(matchesListQuery(archivada, q(), "u")).toBe(false);
    expect(matchesListQuery(archivada, q({ status: "unread" }), "u")).toBe(false);
    expect(matchesListQuery(archivada, q({ status: "archived" }), "u")).toBe(true);
  });
  it("los de campaña pendiente solo en «Campañas»", () => {
    expect(matchesListQuery(pendiente, q(), "u")).toBe(false);
    expect(matchesListQuery(pendiente, q({ view: "campaigns" }), "u")).toBe(true);
    expect(matchesListQuery(respondio, q(), "u")).toBe(true);
    expect(matchesListQuery(respondio, q({ view: "campaigns" }), "u")).toBe(false);
  });
  it("búsqueda, etapa, etiqueta, persona y bandeja", () => {
    const c = fila("x", 1, {
      contact: { id: "ct", name: "José Núñez", phone: "524621349768" },
      stageName: "Nuevo",
      tags: [{ id: "tg_1", name: "VIP", color: "azul" }],
      assignee: { id: "u1", name: "Ana" },
      channel: "messenger",
    });
    expect(matchesListQuery(c, q({ q: "jose" }), "u")).toBe(true);
    expect(matchesListQuery(c, q({ q: "462 134" }), "u")).toBe(true);
    expect(matchesListQuery(c, q({ stage: "Otra" }), "u")).toBe(false);
    expect(matchesListQuery(c, q({ tag: "tg_2" }), "u")).toBe(false);
    expect(matchesListQuery(c, q({ owner: "mine" }), "u1")).toBe(true);
    expect(matchesListQuery(c, q({ owner: "unassigned" }), "u1")).toBe(false);
    expect(matchesListQuery(c, q({ channel: "whatsapp" }), "u")).toBe(false);
  });
});

describe("páginas y refresco por chat", () => {
  it("orden: más reciente primero; en empate, id descendente", () => {
    const l = [fila("a", 5), fila("c", 1), fila("b", 1)].sort(compareRows);
    expect(l.map((c) => c.id)).toEqual(["c", "b", "a"]);
  });

  it("la página siguiente no repite lo ya cargado", () => {
    const l = appendPage([fila("a", 1), fila("b", 2)], [fila("b", 2), fila("c", 3)]);
    expect(l.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("un chat nuevo entra si cae dentro de lo cargado, o si ya no hay más páginas", () => {
    const cargado = [fila("a", 1), fila("b", 10)];
    expect(fitsLoadedWindow(fila("arriba", 0), cargado, true)).toBe(true);
    expect(fitsLoadedWindow(fila("abajo", 99), cargado, true)).toBe(false);
    expect(fitsLoadedWindow(fila("abajo", 99), cargado, false)).toBe(true);
  });

  it("mergeSubsetPaged: reemplaza, quita lo que no volvió y solo mete lo que cabe", () => {
    const cargado = [fila("a", 1), fila("b", 5), fila("c", 10)];
    const plan = { ids: ["b", "c", "nuevo-arriba", "nuevo-abajo"], contactIds: [] };
    const vuelto = [fila("b", 0, { unreadCount: 3 }), fila("nuevo-arriba", 2), fila("nuevo-abajo", 50)];
    const r = mergeSubsetPaged(cargado, plan, vuelto, true);
    // b subió a la cima, c (pedido y no vuelto) salió, nuevo-abajo espera su página.
    expect(r.map((c) => c.id)).toEqual(["b", "a", "nuevo-arriba"]);
    expect(r[0]!.unreadCount).toBe(3);
    // Sin más páginas, todo lo vuelto entra.
    expect(mergeSubsetPaged(cargado, plan, vuelto, false).map((c) => c.id)).toEqual(["b", "a", "nuevo-arriba", "nuevo-abajo"]);
  });

  it("por contacto: lo que no volvió de ese contacto sale", () => {
    const cargado = [fila("a", 1), fila("b", 5)];
    const r = mergeSubsetPaged(cargado, { ids: [], contactIds: ["ct_a"] }, [], true);
    expect(r.map((c) => c.id)).toEqual(["b"]);
  });
});
