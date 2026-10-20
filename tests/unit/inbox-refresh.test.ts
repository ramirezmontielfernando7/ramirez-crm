import { describe, expect, it } from "vitest";
import {
  MAX_SUBSET,
  mergeSubset,
  parseSubsetParam,
  RefreshBatch,
  sortConversations,
  subsetQuery,
} from "@/lib/inbox-refresh";
import type { ConversationDto } from "@/lib/types";

/** Una fila mínima: solo lo que miran estas reglas. */
function fila(id: string, contactId: string, lastMessageAt: string | null, extra: Partial<ConversationDto> = {}) {
  return {
    id,
    contact: { id: contactId, name: id, phone: null },
    lastMessageAt,
    createdAt: "2026-01-01T00:00:00.000Z",
    unreadCount: 0,
    ...extra,
  } as ConversationDto;
}

describe("Paso 2 — parámetros ?ids= / ?contactIds=", () => {
  it("ausente o vacío = no se pidió", () => {
    expect(parseSubsetParam(null)).toBeNull();
    expect(parseSubsetParam("")).toBeNull();
    expect(parseSubsetParam(" , ,")).toBeNull();
  });
  it("separa por comas, quita espacios y repetidos", () => {
    expect(parseSubsetParam("cv_a, cv_b,cv_a")).toEqual(["cv_a", "cv_b"]);
  });
  it("rechaza caracteres raros y más del tope", () => {
    expect(parseSubsetParam("cv_a,x'); drop table")).toBe("invalid");
    expect(parseSubsetParam(Array.from({ length: MAX_SUBSET + 1 }, (_, i) => `cv_${i}`).join(","))).toBe("invalid");
    expect(parseSubsetParam(Array.from({ length: MAX_SUBSET }, (_, i) => `cv_${i}`).join(","))).toHaveLength(MAX_SUBSET);
  });
});

describe("Paso 2 — el lote de una ráfaga", () => {
  it("vacío no pide nada", () => {
    expect(new RefreshBatch().take()).toBeNull();
  });
  it("junta ids de conversación y de contacto en UNA petición y se vacía", () => {
    const b = new RefreshBatch();
    b.addConversation("cv_1");
    b.addConversation("cv_1");
    b.addConversation("cv_2");
    b.addContacts(["ct_9"]);
    expect(b.take()).toEqual({ kind: "subset", ids: ["cv_1", "cv_2"], contactIds: ["ct_9"] });
    expect(b.take()).toBeNull();
  });
  it("un aviso sin id de chat cae a la lista completa", () => {
    const sinId = new RefreshBatch();
    sinId.addConversation(undefined);
    expect(sinId.take()).toEqual({ kind: "full" });
    const sinContactos = new RefreshBatch();
    sinContactos.addContacts([]);
    expect(sinContactos.take()).toEqual({ kind: "full" });
    const basura = new RefreshBatch();
    basura.addContacts([42, null] as unknown[]);
    expect(basura.take()).toEqual({ kind: "full" });
  });
  it("la lista completa gana sobre los ids de la misma ráfaga", () => {
    const b = new RefreshBatch();
    b.addConversation("cv_1");
    b.markFull();
    expect(b.take()).toEqual({ kind: "full" });
  });
  it("más ids que el tope: lista completa", () => {
    const b = new RefreshBatch();
    b.addContacts(Array.from({ length: MAX_SUBSET + 1 }, (_, i) => `ct_${i}`));
    expect(b.take()).toEqual({ kind: "full" });
  });
  it("arma la consulta", () => {
    expect(subsetQuery({ ids: ["cv_1", "cv_2"], contactIds: [] })).toBe("ids=cv_1%2Ccv_2");
    expect(subsetQuery({ ids: [], contactIds: ["ct_1"] })).toBe("contactIds=ct_1");
  });
});

describe("Paso 2 — aplicar un refresco parcial", () => {
  const base = [
    fila("cv_a", "ct_a", "2026-05-03T00:00:00.000Z"),
    fila("cv_b", "ct_b", "2026-05-02T00:00:00.000Z"),
    fila("cv_c", "ct_c", "2026-05-01T00:00:00.000Z"),
  ];

  it("la fila que cambió se reemplaza y sube por su último mensaje", () => {
    const nuevo = fila("cv_c", "ct_c", "2026-05-04T00:00:00.000Z", { unreadCount: 2 });
    const out = mergeSubset(base, { ids: ["cv_c"], contactIds: [] }, [nuevo]);
    expect(out.map((c) => c.id)).toEqual(["cv_c", "cv_a", "cv_b"]);
    expect(out[0]).toBe(nuevo);
  });
  it("lo pedido que no vuelve sale de la lista (eliminado, reasignado, a «Campañas»)", () => {
    const out = mergeSubset(base, { ids: ["cv_b"], contactIds: [] }, []);
    expect(out.map((c) => c.id)).toEqual(["cv_a", "cv_c"]);
  });
  it("por contacto: quita lo que ya no se ve y agrega lo que ahora sí", () => {
    const llega = fila("cv_z", "ct_z", "2026-05-02T12:00:00.000Z");
    const out = mergeSubset(base, { ids: [], contactIds: ["ct_a", "ct_z"] }, [llega]);
    expect(out.map((c) => c.id)).toEqual(["cv_z", "cv_b", "cv_c"]);
  });
  it("no toca lo que no se pidió", () => {
    const out = mergeSubset(base, { ids: ["cv_x"], contactIds: [] }, []);
    expect(out).toEqual(base);
  });
  it("ordena como el servidor: último mensaje, o la creación si no hay; empates estables", () => {
    const sinMensajes = fila("cv_n", "ct_n", null, { createdAt: "2026-05-02T06:00:00.000Z" });
    const empate1 = fila("cv_e1", "ct_e1", "2026-05-01T00:00:00.000Z");
    const empate2 = fila("cv_e2", "ct_e2", "2026-05-01T00:00:00.000Z");
    const out = sortConversations([empate1, base[0]!, empate2, sinMensajes]);
    expect(out.map((c) => c.id)).toEqual(["cv_a", "cv_n", "cv_e1", "cv_e2"]);
  });
});
