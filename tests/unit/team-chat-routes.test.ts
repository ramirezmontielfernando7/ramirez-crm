import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 025 — Las rutas del chat de equipo con una BD falsa que no devuelve nada:
 * para quien no participa, todo hilo, mensaje o adjunto es 404 (nunca 403:
 * no se confirma que exista). La prueba contra Postgres de verdad vive en
 * `scripts/e2e-chat-equipo.mjs`.
 */

const state = vi.hoisted(() => ({
  session: null as unknown,
  touched: false,
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => state.session,
  getSessionOrNull: async () => state.session,
}));

function fakeDb(): unknown {
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve([]);
      if (prop === "transaction") return async (fn: (tx: unknown) => unknown) => fn(proxy);
      return () => proxy;
    },
  };
  const proxy: unknown = new Proxy({}, handler);
  return proxy;
}

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...original,
    getDb: () => {
      state.touched = true;
      return fakeDb();
    },
  };
});

type Handler = (...args: unknown[]) => Promise<Response>;

async function handler(route: string, method: string): Promise<Handler> {
  const mod = (await import(`@/app/api/${route}/route`)) as Record<string, Handler>;
  return mod[method]!;
}

function como(role: string, grants: string[] = []) {
  const userId = `usr_${role}`;
  state.session = {
    userId,
    organizationId: "org_a",
    role,
    grants,
    access: { organizationId: "org_a", userId, seesAll: role !== "asesor" },
  };
}

const ctx = { params: Promise.resolve({ id: "tct_ajeno" }) };

function req(method: string, body: unknown = {}) {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  state.touched = false;
});

describe("025 — recurso ajeno = 404, para cualquier rol", () => {
  const casos: [string, string, unknown][] = [
    ["team-chat/threads/[id]/messages", "GET", undefined],
    ["team-chat/threads/[id]/messages", "POST", { body: "hola" }],
    ["team-chat/threads/[id]/read", "POST", {}],
    ["team-chat/threads/[id]/messages/knowledge", "POST", { entryId: "kn_x", mode: "text" }],
    ["team-chat/messages/[id]", "PATCH", { body: "editado" }],
    ["team-chat/messages/[id]", "DELETE", {}],
    ["team-chat/messages/[id]/reactions", "PUT", { emoji: "👍" }],
    ["team-chat/messages/[id]/reactions", "DELETE", { emoji: "👍" }],
    ["team-chat/attachments/[id]", "GET", undefined],
  ];
  for (const role of ["asesor", "coordinador", "owner"]) {
    it.each(casos)(`${role}: %s %s → 404`, async (route, method, body) => {
      como(role);
      const res = await (await handler(route, method))(req(method, body), ctx);
      expect(res.status).toBe(404);
      const json = (await res.json()) as { error: { code: string } };
      expect(json.error.code).toBe("not_found");
    });
  }

  it("un grupo de otra organización (o que no existe) es 404 aunque se tenga el permiso", async () => {
    como("owner");
    const res = await (await handler("team-chat/groups/[id]", "PATCH"))(req("PATCH", { name: "X" }), ctx);
    expect(res.status).toBe(404);
  });

  it("abrir un directo con alguien que no es del equipo → 404", async () => {
    como("asesor");
    const res = await (await handler("team-chat/threads", "POST"))(req("POST", { userId: "usr_de_otra_org" }), ctx);
    expect(res.status).toBe(404);
  });
});

describe("025 — validación en el servidor", () => {
  it("historial: limit fuera de rango → 422 sin tocar la BD", async () => {
    como("asesor");
    const h = await handler("team-chat/threads/[id]/messages", "GET");
    const res = await h(new Request("http://localhost/api/x?limit=5000"), ctx);
    expect(res.status).toBe(422);
    expect(state.touched).toBe(false);
  });

  it("una reacción que no es emoji → 422", async () => {
    como("asesor");
    const res = await (await handler("team-chat/messages/[id]/reactions", "PUT"))(req("PUT", { emoji: "hola" }), ctx);
    expect(res.status).toBe(422);
  });

  it("los ajustes no aceptan campos desconocidos", async () => {
    como("owner");
    const res = await (await handler("team-chat/settings", "PUT"))(req("PUT", { cualquierCosa: true }), ctx);
    expect(res.status).toBe(422);
  });
});

describe("025 — delegación de grupos al Coordinador (servidor)", () => {
  it("sin la delegación: 403 antes de tocar la BD", async () => {
    como("coordinador");
    const res = await (await handler("team-chat/groups", "POST"))(req("POST", { name: "Ventas", memberIds: [] }), ctx);
    expect(res.status).toBe(403);
    expect(state.touched).toBe(false);
  });

  it("con la delegación encendida pasa el permiso (y la BD decide lo demás)", async () => {
    como("coordinador", ["team_chat.create_groups"]);
    const res = await (await handler("team-chat/groups", "POST"))(req("POST", { name: "Ventas", memberIds: [] }), ctx);
    expect(res.status).not.toBe(403);
    expect(state.touched).toBe(true);
  });

  it("el Asesor no puede aunque la sesión trajera el grant", async () => {
    como("asesor", ["team_chat.create_groups"]);
    const res = await (await handler("team-chat/groups", "POST"))(req("POST", { name: "Ventas", memberIds: [] }), ctx);
    expect(res.status).toBe(403);
  });
});
