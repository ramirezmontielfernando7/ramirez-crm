import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@/lib/auth/permissions";

/**
 * 020 — Cada ruta protegida devuelve 403 al rol que no tiene el permiso, en
 * el SERVIDOR, antes de tocar nada. Y ninguna ruta nueva puede nacer sin que
 * alguien decida en qué lista va (test de cobertura al final).
 */

const state = vi.hoisted(() => ({
  session: {
    userId: "usr_asesor",
    organizationId: "org_a",
    role: "asesor",
    access: { organizationId: "org_a", userId: "usr_asesor", seesAll: false },
  },
  dbTouched: false,
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => state.session,
  getSessionOrNull: async () => state.session,
}));

// Si una ruta protegida llegara a la BD sería un 403 que llega tarde: el test
// lo detecta porque cualquier uso de la BD marca `dbTouched`.
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...original,
    getDb: () => {
      state.dbTouched = true;
      throw new Error("la ruta tocó la BD antes de validar el permiso");
    },
  };
});

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Handler = (...args: unknown[]) => Promise<Response>;

/** Rutas con permiso de rol. La llave es la carpeta bajo `src/app/api`. */
const PROTEGIDAS: [string, Method, Permission][] = [
  // Configuración: solo el Propietario.
  ["settings/branding", "PUT", "settings.manage"],
  ["settings/branding/favicon", "PUT", "settings.manage"],
  ["settings/branding/favicon", "DELETE", "settings.manage"],
  ["settings/whatsapp", "GET", "settings.manage"],
  ["settings/whatsapp", "PUT", "settings.manage"],
  ["settings/whatsapp/test", "POST", "settings.manage"],
  ["settings/webhook", "GET", "settings.manage"],
  ["settings/instagram", "GET", "settings.manage"],
  ["settings/instagram", "PUT", "settings.manage"],
  ["settings/messenger", "GET", "settings.manage"],
  ["settings/messenger", "PUT", "settings.manage"],
  ["settings/capi", "GET", "settings.manage"],
  ["settings/capi", "PUT", "settings.manage"],
  ["settings/capi", "DELETE", "settings.manage"],
  ["settings/capi/events", "GET", "settings.manage"],
  ["settings/zoom", "GET", "settings.manage"],
  ["settings/zoom", "PUT", "settings.manage"],
  ["settings/zoom", "DELETE", "settings.manage"],
  ["settings/zoom/test", "POST", "settings.manage"],
  ["settings/google", "GET", "settings.manage"],
  ["settings/google", "PUT", "settings.manage"],
  ["settings/google", "DELETE", "settings.manage"],
  ["settings/google/test", "POST", "settings.manage"],
  ["calendar/settings", "GET", "settings.manage"],
  ["calendar/settings", "PUT", "settings.manage"],
  ["seed/demo", "POST", "settings.manage"],
  // Agente de IA, base de conocimiento y Laboratorio.
  ["agent/profile", "GET", "agent.manage"],
  ["agent/profile", "PUT", "agent.manage"],
  ["kb", "GET", "agent.manage"],
  ["kb", "POST", "agent.manage"],
  ["kb/[id]", "PATCH", "agent.manage"],
  ["kb/[id]", "DELETE", "agent.manage"],
  ["kb/size", "GET", "agent.manage"],
  ["lab/runs", "GET", "agent.manage"],
  ["lab/runs", "POST", "agent.manage"],
  ["lab/runs/[id]", "GET", "agent.manage"],
  ["lab/suggestions/apply", "POST", "agent.manage"],
  // Usuarios.
  ["settings/team", "GET", "users.read"],
  ["settings/team", "POST", "users.manage"],
  ["settings/team/[id]", "PATCH", "users.manage"],
  ["settings/team/[id]", "DELETE", "users.manage"],
  // Pipeline y plantillas.
  ["pipeline/stages", "POST", "pipeline.edit"],
  ["pipeline/stages/[id]", "PATCH", "pipeline.edit"],
  ["pipeline/stages/[id]", "DELETE", "pipeline.edit"],
  ["templates", "POST", "templates.manage"],
  ["templates/sync", "POST", "templates.manage"],
  // Asignación.
  ["assignments", "POST", "assignment.manage"],
  ["assignments/bulk", "POST", "assignment.manage"],
  // 021 — Etiquetas, importar/exportar y campañas.
  ["contact-tags", "POST", "tags.manage"],
  ["contact-tags/[id]", "PATCH", "tags.manage"],
  ["contact-tags/[id]", "DELETE", "tags.manage"],
  ["contacts/import", "POST", "contacts.import"],
  ["contacts/export", "GET", "contacts.export"],
  ["campaigns", "GET", "campaigns.manage"],
  ["campaigns", "POST", "campaigns.manage"],
  ["campaigns/preview", "POST", "campaigns.manage"],
  ["campaigns/[id]", "GET", "campaigns.manage"],
  ["campaigns/[id]", "DELETE", "campaigns.manage"],
  ["campaigns/[id]/send", "POST", "campaigns.manage"],
  ["campaigns/[id]/recipients", "GET", "campaigns.manage"],
];

/**
 * Rutas que cualquier rol usa, pero cuyos DATOS se filtran por asignación
 * (`scopedContacts`). Su prueba vive en `assignment-scope.test.ts`.
 */
const FILTRADAS: [string, Method][] = [
  ["conversations", "GET"],
  ["conversations/[id]", "PATCH"],
  ["conversations/[id]/messages", "GET"],
  ["conversations/[id]/messages", "POST"],
  ["conversations/[id]/messages/media", "POST"],
  ["conversations/[id]/messages/template", "POST"],
  ["contacts", "GET"],
  ["contacts", "POST"],
  ["contacts/[id]", "GET"],
  ["contacts/[id]", "PATCH"],
  ["contacts/[id]/start-conversation", "POST"],
  ["contacts/[id]/assignments", "GET"],
  // 021: etiquetar a un contacto = poder verlo (getContactById con scopedContacts).
  ["contacts/[id]/tags", "PUT"],
  ["pipeline/board", "GET"],
  ["pipeline/leads/[id]", "PATCH"],
  ["bookings", "GET"],
  ["bookings", "POST"],
  ["bookings/[id]", "PATCH"],
  ["media/[assetId]", "GET"],
  ["analytics/sales", "GET"],
  ["analytics/ads", "GET"],
  ["analytics/bot", "GET"],
  ["analytics/hygiene", "GET"],
  // SSE: filtra evento por evento (`server/events/visibility.ts`).
  ["events", "GET"],
];

/** Del negocio, sin datos de clientes: cualquier rol con sesión. */
const DEL_NEGOCIO: [string, Method][] = [
  ["agent/brain-status", "GET"],
  ["pipeline/stages", "GET"],
  ["templates", "GET"],
  // 021: la lista de etiquetas es del negocio (filtrar y etiquetar).
  ["contact-tags", "GET"],
  ["calendar/availability", "GET"],
  ["settings/branding", "GET"],
];

/** Sin sesión de usuario: tienen su propia autenticación o son públicas. */
const EXENTAS_PREFIJOS = ["auth/", "bot/", "webhooks/", "dev/", "health", "branding/favicon"];

async function handler(route: string, method: Method): Promise<Handler> {
  const mod = (await import(`@/app/api/${route}/route`)) as Record<string, Handler>;
  const h = mod[method];
  if (!h) throw new Error(`${route} no exporta ${method}`);
  return h;
}

function req(method: Method): Request {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : "{}",
  });
}

const ctx = { params: Promise.resolve({ id: "x", assetId: "x", mediaId: "x" }) };

function como(role: "asesor" | "coordinador" | "owner") {
  const userId = `usr_${role}`;
  state.session = {
    userId,
    organizationId: "org_a",
    role,
    access: { organizationId: "org_a", userId, seesAll: role !== "asesor" },
  };
}

beforeEach(() => {
  state.dbTouched = false;
  como("asesor");
});

describe("020 — un ASESOR recibe 403 en cada ruta protegida", () => {
  it.each(PROTEGIDAS)("%s %s → 403", async (route, method) => {
    const h = await handler(route, method);
    const res = await h(req(method), ctx);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("forbidden");
    expect(state.dbTouched).toBe(false);
  });
});

describe("020 — un COORDINADOR recibe 403 en lo que es solo del Propietario", () => {
  const soloOwner = PROTEGIDAS.filter(([, , p]) =>
    ["settings.manage", "agent.manage", "users.manage", "contacts.export"].includes(p)
  );
  it.each(soloOwner)("%s %s → 403", async (route, method) => {
    como("coordinador");
    const h = await handler(route, method);
    const res = await h(req(method), ctx);
    expect(res.status).toBe(403);
    expect(state.dbTouched).toBe(false);
  });
});

describe("020 — un asesor no puede pedir los resultados de otro", () => {
  it.each(["sales", "ads", "bot", "hygiene"])("analytics/%s?userId=otro → 403", async (b) => {
    const h = await handler(`analytics/${b}`, "GET");
    const res = await h(
      new Request(`http://localhost/api/analytics/${b}?from=2026-01-01&to=2026-01-31&userId=usr_otro`),
      ctx
    );
    expect(res.status).toBe(403);
    expect(state.dbTouched).toBe(false);
  });
});

/* ------------------------------------------------------------------ */

const API = path.resolve(import.meta.dirname, "..", "..", "src", "app", "api");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("020 — cobertura: ninguna ruta sin decidir su permiso", () => {
  it("cada handler exportado está en PROTEGIDAS, FILTRADAS, DEL_NEGOCIO o es exento", () => {
    const conocidas = new Set(
      [...PROTEGIDAS, ...FILTRADAS, ...DEL_NEGOCIO].map(([r, m]) => `${r} ${m}`)
    );
    const sinDecidir: string[] = [];
    for (const file of routeFiles(API)) {
      const route = path.relative(API, path.dirname(file)).split(path.sep).join("/");
      if (EXENTAS_PREFIJOS.some((p) => route === p || route.startsWith(p))) continue;
      const code = readFileSync(file, "utf8");
      const methods = [
        ...code.matchAll(/export (?:const|async function) (GET|POST|PUT|PATCH|DELETE)\b/g),
      ].map((m) => m[1]);
      for (const method of methods) {
        if (!conocidas.has(`${route} ${method}`)) sinDecidir.push(`${route} ${method}`);
      }
    }
    expect(
      sinDecidir,
      "Rutas nuevas sin permiso decidido. Agrégalas a la lista que les toca en " +
        "tests/unit/permissions-routes.test.ts (y protégelas con withAuth(..., { permission }) " +
        "o con scopedContacts):\n" +
        sinDecidir.map((r) => `  · ${r}`).join("\n")
    ).toEqual([]);
  });

  it("cada ruta PROTEGIDA declara su permiso en el código", () => {
    for (const [route, method, permission] of PROTEGIDAS) {
      const code = readFileSync(path.join(API, route, "route.ts"), "utf8");
      const start = code.search(new RegExp(`export const ${method} = withAuth\\(`));
      expect(start, `${route} ${method}`).toBeGreaterThanOrEqual(0);
      const next = code.slice(start + 10).search(/\nexport /);
      const bloque = next === -1 ? code.slice(start) : code.slice(start, start + 10 + next);
      expect(bloque, `${route} ${method}`).toContain(`permission: "${permission}"`);
    }
  });
});
