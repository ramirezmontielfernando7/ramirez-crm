import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

/**
 * 020 — Un asesor NUNCA lee el lead, el chat, los mensajes, la cita ni el
 * adjunto de otro.
 *
 * La BD es falsa: cada consulta devuelve "nada" y guarda su WHERE. Así se
 * prueban dos cosas de cada ruta a la vez: que responde 404 (no confirma que
 * el recurso de otro existe) y que la consulta que hizo LLEVA el filtro de
 * asignación con el id del asesor — el mismo SQL que correría contra la BD
 * real. La prueba contra Postgres de verdad vive en `scripts/e2e-roles.mjs`.
 */

const state = vi.hoisted(() => ({
  session: null as unknown,
  wheres: [] as unknown[],
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => state.session,
  getSessionOrNull: async () => state.session,
}));

vi.mock("@/server/agenda/flag", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/agenda/flag")>();
  return { ...original, agendaEnabled: () => true };
});

/** Cadena de drizzle que se traga todo, guarda el WHERE y resuelve a []. */
function fakeDb(): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve([]);
      }
      if (prop === "transaction") {
        return async (fn: (tx: unknown) => unknown) => fn(proxy);
      }
      return (...args: unknown[]) => {
        if (prop === "where") state.wheres.push(args[0]);
        return proxy;
      };
    },
  };
  const proxy: unknown = new Proxy({}, handler);
  return proxy;
}

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb: () => fakeDb() };
});

const dialect = new PgDialect();
function rendered(): { sql: string; params: unknown[] }[] {
  return state.wheres
    .filter((w): w is SQL => !!w && typeof w === "object")
    .map((w) => dialect.sqlToQuery(w));
}

const ASESOR_A = "usr_asesor_a";

function como(role: "asesor" | "owner", userId = ASESOR_A) {
  state.session = {
    userId,
    organizationId: "org_a",
    role,
    access: { organizationId: "org_a", userId, seesAll: role !== "asesor" },
  };
}

type Handler = (...args: unknown[]) => Promise<Response>;
async function route(path: string, method: string): Promise<Handler> {
  const mod = (await import(`@/app/api/${path}/route`)) as Record<string, Handler>;
  return mod[method]!;
}
const ctx = { params: Promise.resolve({ id: "ajeno", assetId: "ma_ajeno" }) };
function json(method: string, body: unknown): Request {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** El filtro de asignación, amarrado al asesor que pregunta. */
function llevaFiltroDelAsesor(q: { sql: string; params: unknown[] }): boolean {
  return /"assigned_user_id" = \$\d+/.test(q.sql) && q.params.includes(ASESOR_A);
}

beforeEach(() => {
  state.wheres = [];
  como("asesor");
});

const DETALLES: [string, string, string, Request][] = [
  ["lead de otro (mover etapa)", "pipeline/leads/[id]", "PATCH", json("PATCH", { priority: "alta" })],
  ["ficha del contacto de otro", "contacts/[id]", "GET", new Request("http://localhost/api/x")],
  ["editar contacto de otro", "contacts/[id]", "PATCH", json("PATCH", { notes: "x" })],
  ["historial de asignación de otro", "contacts/[id]/assignments", "GET", new Request("http://localhost/api/x")],
  ["abrir conversación con contacto de otro", "contacts/[id]/start-conversation", "POST", json("POST", { templateId: "tpl_1" })],
  ["mensajes del chat de otro", "conversations/[id]/messages", "GET", new Request("http://localhost/api/x")],
  ["escribir en el chat de otro", "conversations/[id]/messages", "POST", json("POST", { text: "hola" })],
  ["plantilla en el chat de otro", "conversations/[id]/messages/template", "POST", json("POST", { templateId: "tpl_1" })],
  ["marcar leído el chat de otro", "conversations/[id]", "PATCH", json("PATCH", { markRead: true })],
  ["cita del cliente de otro", "bookings/[id]", "PATCH", json("PATCH", { action: "cancel" })],
  ["adjunto del chat de otro", "media/[assetId]", "GET", new Request("http://localhost/api/x")],
  // 022 — la línea de tiempo y las notas del contacto de otro no existen.
  ["línea de tiempo del contacto de otro", "contacts/[id]/timeline", "GET", new Request("http://localhost/api/x")],
  ["nota en el contacto de otro", "contacts/[id]/notes", "POST", json("POST", { text: "hola" })],
  ["etiquetar al contacto de otro", "contacts/[id]/tags", "PUT", json("PUT", { tagIds: [] })],
];

describe("020 — el asesor recibe 404 en lo de otro, y la consulta lleva su filtro", () => {
  it.each(DETALLES)("%s → 404", async (_nombre, path, method, request) => {
    const h = await route(path, method);
    const res = await h(request, ctx);
    expect(res.status).toBe(404);
    const consultas = rendered();
    expect(consultas.length).toBeGreaterThan(0);
    // La PRIMERA consulta ya es la de visibilidad: nada se lee ni se escribe
    // antes de saber si el recurso es suyo.
    expect(llevaFiltroDelAsesor(consultas[0]!), consultas[0]!.sql).toBe(true);
  });
});

const LISTAS: [string, string, string][] = [
  ["bandeja", "conversations", "http://localhost/api/conversations"],
  ["tablero del pipeline", "pipeline/board", "http://localhost/api/pipeline/board"],
  ["directorio de contactos", "contacts", "http://localhost/api/contacts"],
  ["citas", "bookings", "http://localhost/api/bookings"],
];

describe("020 — las listas del asesor solo traen lo suyo", () => {
  it.each(LISTAS)("%s", async (_nombre, path, url) => {
    const h = await route(path, "GET");
    const res = await h(new Request(url), ctx);
    expect(res.status).toBe(200);
    const consultas = rendered();
    // Cada consulta sobre datos de clientes lleva el filtro (las de etapas y
    // ajustes del negocio no tocan clientes y no lo necesitan).
    const deClientes = consultas.filter((q) =>
      /"(lead|contact|conversation|booking)"\."organization_id"/.test(q.sql)
    );
    expect(deClientes.length).toBeGreaterThan(0);
    for (const q of deClientes) {
      expect(llevaFiltroDelAsesor(q), q.sql).toBe(true);
    }
  });
});

// 022: el Asesor ya no entra a Resultados (403, en permissions-routes). Lo
// que sigue en pie es el filtro por persona: quien reparte pide los números
// de UN asesor con `?userId=` y solo cuentan los clientes de ese asesor.
describe("020 — los resultados de un asesor (pedidos por quien reparte) son los suyos", () => {
  it.each(["sales", "ads", "bot", "hygiene"])("analytics/%s", async (bloque) => {
    como("owner", "usr_owner");
    const h = await route(`analytics/${bloque}`, "GET");
    await h(
      new Request(`http://localhost/api/analytics/${bloque}?from=2026-01-01&to=2026-01-31&userId=${ASESOR_A}`),
      ctx
    );
    const deClientes = rendered().filter((q) =>
      /"(lead|lead_stage_event|contact|conversation|booking|ad_attribution|message)"\."organization_id"/.test(q.sql)
    );
    expect(deClientes.length).toBeGreaterThan(0);
    for (const q of deClientes) {
      expect(llevaFiltroDelAsesor(q), q.sql).toBe(true);
    }
  });
});

describe("020 — quien ve todo no paga el filtro", () => {
  it("el propietario lista la bandeja sin condición de asignación", async () => {
    como("owner", "usr_owner");
    const h = await route("conversations", "GET");
    await h(new Request("http://localhost/api/conversations"), ctx);
    for (const q of rendered()) {
      expect(q.sql).not.toMatch(/"assigned_user_id" = /);
    }
  });

  it("el propietario puede filtrar por un asesor", async () => {
    como("owner", "usr_owner");
    const h = await route("conversations", "GET");
    await h(new Request(`http://localhost/api/conversations?assigned=${ASESOR_A}`), ctx);
    expect(rendered().some((q) => q.params.includes(ASESOR_A))).toBe(true);
  });

  it("a un asesor el filtro por otra persona no le abre nada", async () => {
    const h = await route("conversations", "GET");
    await h(new Request("http://localhost/api/conversations?assigned=usr_otro"), ctx);
    for (const q of rendered()) {
      expect(q.params).not.toContain("usr_otro");
      expect(llevaFiltroDelAsesor(q)).toBe(true);
    }
  });
});
