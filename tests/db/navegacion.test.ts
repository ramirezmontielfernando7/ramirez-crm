import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getSystemDb, schema, withTenant } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import { defaultLayout, type NavLayoutItem } from "@/lib/modules/nav-layout";
import { listPlatformAudit } from "@/server/platform-admin/audit";
import { changeOrganizationModules, createOrganization, PlatformError } from "@/server/platform-admin/organizations";
import { forgetOrgModules, getOrgModules } from "@/server/modules/store";
import { orgHasModule } from "@/server/modules";
import {
  getNavLayout,
  getNavLayouts,
  listNavLayoutEvents,
  NavLayoutError,
  resetNavLayout,
  saveNavLayout,
} from "@/server/navigation/store";
import { navForSession } from "@/server/navigation/resolve";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 030 (PR 4) — Módulos nuevos de la 0034 y menú por rol contra Postgres real:
 * dependencia Laboratorio → Agente, perfiles de alta, guardar/restaurar con
 * bitácora append-only y aislamiento entre organizaciones (RLS).
 */

const ACTOR = { userId: "usr_admin_nav", email: "admin@nav.test" };

type Sesion = {
  userId: string;
  organizationId: string;
  role: string;
  grants: never[];
  access: { organizationId: string; userId: string; seesAll: boolean };
};
const state = vi.hoisted(() => ({ session: null as null | Sesion }));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...real,
    requireSession: async () => {
      if (!state.session) throw new real.UnauthorizedError();
      return state.session;
    },
    getSessionOrNull: async () => state.session,
  };
});

function como(organizationId: string, role: "owner" | "coordinador" | "asesor", userId = `usr_${role}_${organizationId}`): Sesion {
  state.session = {
    userId,
    organizationId,
    role,
    grants: [],
    access: { organizationId, userId, seesAll: role !== "asesor" },
  };
  return state.session;
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function llamar(method: "GET" | "PUT" | "DELETE", route: string, body?: unknown): Promise<Response> {
  const mod = (await import(`@/app/api/${route.split("?")[0]}/route`)) as Record<string, Handler>;
  return mod[method]!(
    new Request(`http://localhost/api/${route}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  );
}

beforeEach(() => forgetOrgModules());

async function usuario(organizationId: string): Promise<string> {
  const id = `usr_nav_${Math.random().toString(36).slice(2, 8)}`;
  await getSystemDb().insert(schema.user).values({ id, name: "Dueña Nav", email: `${id}@nav.test` });
  await getSystemDb().insert(schema.member).values({ id: `mem_${id}`, organizationId, userId: id, role: "owner" });
  return id;
}

const asesorSoloBandeja = (): NavLayoutItem[] => [
  { key: "contacts", hidden: false },
  { key: "inbox", hidden: false },
  { key: "team_chat", hidden: true },
  { key: "knowledge", hidden: true },
];

describe("módulos de la 0034", () => {
  const creadas: string[] = [];
  afterAll(() => borrarOrganizaciones(creadas));

  it("una organización con fila de antes conserva lo suyo y recibe los nuevos encendidos", async () => {
    const O = await crearOrganizacion("NavViejo");
    creadas.push(O.id);
    await changeOrganizationModules(O.id, { campaigns: true }, ACTOR, null);
    const m = await getOrgModules(O.id);
    expect(m).toMatchObject({ campaigns: true, knowledge: true, lab: true, agent: true, teamChat: true, results: true, customNav: false });
  });

  it("apagar el Agente apaga el Laboratorio (y lo registra); encender el Laboratorio sin Agente → 422", async () => {
    const O = await crearOrganizacion("NavAgente");
    creadas.push(O.id);
    const dto = await changeOrganizationModules(O.id, { agent: false }, ACTOR, null);
    expect(dto).toMatchObject({ agent: false, lab: false });
    expect(await orgHasModule(O.id, "lab")).toBe(false);
    const [ultimo] = await listPlatformAudit({ organizationId: O.id });
    expect(ultimo?.detail).toMatchObject({ agent: { de: true, a: false }, lab: { de: true, a: false } });
    await expect(changeOrganizationModules(O.id, { lab: true }, ACTOR, null)).rejects.toMatchObject(
      new PlatformError(422, "module_dependency", "El Laboratorio requiere el Agente: enciende primero el Agente")
    );
    expect(await changeOrganizationModules(O.id, { agent: true, lab: true }, ACTOR, null)).toMatchObject({ agent: true, lab: true });
    // La BD también lo impide.
    await expect(
      getSystemDb().update(schema.organizationModule).set({ agent: false }).where(eq(schema.organizationModule.organizationId, O.id))
    ).rejects.toThrow();
  });

  it("los perfiles Básico y Completo son solo la plantilla del alta", async () => {
    for (const profile of ["basico", "completo"] as const) {
      const email = `dueno-${profile}@nav.test`;
      const r = await createOrganization({ name: `Perfil ${profile}`, ownerName: "Dueño", ownerEmail: email, profile }, ACTOR, null);
      creadas.push(r.organizationId);
      const m = await getOrgModules(r.organizationId);
      if (profile === "basico") {
        expect(m).toMatchObject({ agent: false, lab: false, campaigns: false, knowledge: true, teamChat: true, customNav: false });
      } else {
        expect(m).toMatchObject({ agent: true, lab: true, campaigns: true, agenda: true, customNav: true });
      }
      // Después, cada interruptor es independiente.
      await changeOrganizationModules(r.organizationId, { customNav: profile === "basico" }, ACTOR, null);
      expect((await getOrgModules(r.organizationId)).customNav).toBe(profile === "basico");
      await getSystemDb().delete(schema.user).where(eq(schema.user.email, email));
    }
  });
});

describe("menú por rol: guardar, restaurar y bitácora", () => {
  let A: { id: string };
  let B: { id: string };
  let dueña: string;
  beforeAll(async () => {
    A = await crearOrganizacion("NavA");
    B = await crearOrganizacion("NavB");
    dueña = await usuario(A.id);
  });
  afterAll(async () => {
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, dueña));
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("guarda el del Asesor, lo deja en la bitácora y restaurar vuelve al de fábrica", async () => {
    const items = await saveNavLayout({ organizationId: A.id, role: "asesor", items: asesorSoloBandeja(), actorUserId: dueña });
    expect(items.slice(0, 3).map((i) => i.key)).toEqual(["contacts", "inbox", "team_chat"]);
    const guardado = await runWithOrganization(A.id, () => getNavLayouts(A.id));
    expect(guardado.asesor?.find((i) => i.key === "team_chat")?.hidden).toBe(true);
    expect(guardado.coordinador).toBeNull();

    // Guardar lo mismo otra vez no escribe nada.
    await saveNavLayout({ organizationId: A.id, role: "asesor", items: asesorSoloBandeja(), actorUserId: dueña });
    await resetNavLayout({ organizationId: A.id, role: "asesor", actorUserId: dueña });
    expect(await runWithOrganization(A.id, () => getNavLayout(A.id, "asesor"))).toBeNull();

    const eventos = await runWithOrganization(A.id, () => listNavLayoutEvents(A.id));
    expect(eventos.map((e) => [e.role, e.action])).toEqual([
      ["asesor", "reset"],
      ["asesor", "saved"],
    ]);
    expect(eventos[0]?.actorName).toBe("Dueña Nav");
    const [fila] = await withTenant(A.id, (tx) =>
      tx.select().from(schema.navLayoutEvent).where(eq(schema.navLayoutEvent.id, eventos[1]!.id))
    );
    expect(fila).toMatchObject({ before: null });
    expect((fila?.after as NavLayoutItem[])[0]).toEqual({ key: "contacts", hidden: false });
  });

  it("guardar el de fábrica no deja fila", async () => {
    await saveNavLayout({ organizationId: A.id, role: "coordinador", items: defaultLayout("coordinador"), actorUserId: dueña });
    expect(await runWithOrganization(A.id, () => getNavLayout(A.id, "coordinador"))).toBeNull();
  });

  it("reglas: el Propietario no se oculta Ajustes; cada rol conserva una entrada", async () => {
    const sinAjustes = defaultLayout("owner").map((i) => (i.key === "settings" ? { ...i, hidden: true } : i));
    await expect(saveNavLayout({ organizationId: A.id, role: "owner", items: sinAjustes, actorUserId: dueña })).rejects.toBeInstanceOf(
      NavLayoutError
    );
    const nada = defaultLayout("asesor").map((i) => ({ ...i, hidden: true }));
    await expect(saveNavLayout({ organizationId: A.id, role: "asesor", items: nada, actorUserId: dueña })).rejects.toMatchObject({
      problem: { code: "empty" },
    });
  });

  it("la bitácora es append-only", async () => {
    await saveNavLayout({ organizationId: A.id, role: "asesor", items: asesorSoloBandeja(), actorUserId: dueña });
    await expect(
      withTenant(A.id, (tx) => tx.update(schema.navLayoutEvent).set({ role: "owner" }).where(eq(schema.navLayoutEvent.organizationId, A.id)))
    ).rejects.toThrow();
  });

  it("aislamiento: B no ve, no cambia y no escribe el menú de A", async () => {
    await saveNavLayout({ organizationId: A.id, role: "asesor", items: asesorSoloBandeja(), actorUserId: dueña });
    // Con B en el contexto, cero filas de A (RLS), aunque se pida por la organización de A.
    const visto = await withTenant(B.id, (tx) => tx.select().from(schema.navLayout).where(sql`true`));
    expect(visto).toEqual([]);
    const eventosVistos = await withTenant(B.id, (tx) => tx.select().from(schema.navLayoutEvent).where(sql`true`));
    expect(eventosVistos).toEqual([]);
    const cambiadas = await withTenant(B.id, (tx) =>
      tx.update(schema.navLayout).set({ items: [] }).where(eq(schema.navLayout.organizationId, A.id)).returning()
    );
    expect(cambiadas).toEqual([]);
    await expect(
      withTenant(B.id, (tx) => tx.insert(schema.navLayout).values({ organizationId: A.id, role: "owner", items: [] }))
    ).rejects.toThrow();
    // Sin organización en el contexto, la app no ve nada.
    const sinContexto = await getDb().execute(sql`select count(*)::int as n from nav_layout`).catch(() => null);
    if (sinContexto) expect((sinContexto as unknown as { n: number }[])[0]?.n).toBe(0);
    // A sigue intacto.
    expect((await runWithOrganization(A.id, () => getNavLayout(A.id, "asesor")))?.length).toBeGreaterThan(0);
  });

  it("purgar la organización borra su menú y su bitácora en cascada", async () => {
    const C = await crearOrganizacion("NavC");
    const dueñaC = await usuario(C.id);
    await saveNavLayout({ organizationId: C.id, role: "asesor", items: asesorSoloBandeja(), actorUserId: dueñaC });
    await borrarOrganizaciones([C.id]);
    const quedan = await getSystemDb().select().from(schema.navLayoutEvent).where(eq(schema.navLayoutEvent.organizationId, C.id));
    expect(quedan).toEqual([]);
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, dueñaC));
  });
});

describe("API de Ajustes → Navegación y lo que cada rol ve", () => {
  let A: { id: string };
  let B: { id: string };
  let dueñaA: string;
  let dueñaB: string;
  beforeAll(async () => {
    A = await crearOrganizacion("NavApiA");
    B = await crearOrganizacion("NavApiB");
    dueñaA = await usuario(A.id);
    dueñaB = await usuario(B.id);
  });
  afterAll(async () => {
    state.session = null;
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, dueñaA));
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, dueñaB));
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("sin custom_nav: 404 al Propietario; el Coordinador recibe 403 antes", async () => {
    como(A.id, "owner", dueñaA);
    expect((await llamar("GET", "settings/navigation")).status).toBe(404);
    expect((await llamar("PUT", "settings/navigation", { role: "asesor", items: asesorSoloBandeja() })).status).toBe(404);
    como(A.id, "coordinador");
    expect((await llamar("GET", "settings/navigation")).status).toBe(403);
    const nav = await navForSession(como(A.id, "owner", dueñaA));
    expect(nav.customNav).toBe(false);
  });

  it("con custom_nav: el Propietario oculta y el rol deja de verlo, pero la ruta sigue respondiendo", async () => {
    await changeOrganizationModules(A.id, { customNav: true }, ACTOR, null);
    como(A.id, "owner", dueñaA);
    const res = await llamar("PUT", "settings/navigation", { role: "asesor", items: asesorSoloBandeja() });
    expect(res.status).toBe(200);
    const asesor = await navForSession(como(A.id, "asesor"));
    expect(asesor.main.map((m) => m.key)).not.toContain("knowledge");
    expect(asesor.main.map((m) => m.key).slice(0, 2)).toEqual(["contacts", "inbox"]);
    // Oculto ≠ prohibido: Conocimientos sigue respondiendo al Asesor.
    expect((await llamar("GET", "knowledge")).status).toBe(200);
    // Y mostrar algo sin permiso no lo abre: Resultados sigue en 403.
    como(A.id, "owner", dueñaA);
    const visibleTodo = (await (await llamar("GET", "settings/navigation")).json()) as {
      roles: Record<string, { items: NavLayoutItem[]; available: string[]; customized: boolean }>;
    };
    expect(visibleTodo.roles.asesor?.customized).toBe(true);
    expect(visibleTodo.roles.asesor?.available).not.toContain("results");
    await llamar("PUT", "settings/navigation", {
      role: "asesor",
      items: visibleTodo.roles.asesor!.items.map((i) => ({ ...i, hidden: false })),
    });
    como(A.id, "asesor");
    expect((await navForSession(state.session!)).main.map((m) => m.key)).not.toContain("results");
    expect((await llamar("GET", "analytics/sales?from=2026-01-01&to=2026-01-31")).status).toBe(403);
    // Los otros roles no cambian.
    const coord = await navForSession(como(A.id, "coordinador"));
    expect(coord.main.map((m) => m.key)).toContain("knowledge");
  });

  it("reglas en la API: 422 si el Propietario se oculta Ajustes o un rol queda sin nada", async () => {
    como(A.id, "owner", dueñaA);
    const sinAjustes = defaultLayout("owner").map((i) => (i.key === "settings" ? { ...i, hidden: true } : i));
    const r1 = await llamar("PUT", "settings/navigation", { role: "owner", items: sinAjustes });
    expect(r1.status).toBe(422);
    const r2 = await llamar("PUT", "settings/navigation", {
      role: "coordinador",
      items: defaultLayout("coordinador").map((i) => ({ ...i, hidden: true })),
    });
    expect(((await r2.json()) as { error: { code: string } }).error.code).toBe("empty");
    expect((await llamar("PUT", "settings/navigation", { role: "x", items: [] })).status).toBe(422);
  });

  it("restaurar deja el de fábrica y queda en la bitácora", async () => {
    como(A.id, "owner", dueñaA);
    expect((await llamar("DELETE", "settings/navigation?role=asesor")).status).toBe(200);
    const asesor = await navForSession(como(A.id, "asesor"));
    expect(asesor.main.map((m) => m.key)).toContain("knowledge");
    como(A.id, "owner", dueñaA);
    const body = (await (await llamar("GET", "settings/navigation")).json()) as { events: { action: string; role: string }[] };
    expect(body.events[0]).toMatchObject({ role: "asesor", action: "reset" });
  });

  it("un módulo apagado no aparece ni responde, aunque el menú lo muestre (403 primero si falta permiso)", async () => {
    await changeOrganizationModules(A.id, { knowledge: false, results: false }, ACTOR, null);
    const owner = await navForSession(como(A.id, "owner", dueñaA));
    expect(owner.main.map((m) => m.key)).not.toContain("knowledge");
    expect(owner.main.map((m) => m.key)).not.toContain("results");
    expect((await llamar("GET", "knowledge")).status).toBe(404);
    expect((await llamar("GET", "analytics/sales?from=2026-01-01&to=2026-01-31")).status).toBe(404);
    como(A.id, "asesor");
    expect((await llamar("GET", "knowledge")).status).toBe(404);
    expect((await llamar("GET", "analytics/sales?from=2026-01-01&to=2026-01-31")).status).toBe(403);
    // El editor tampoco lo ofrece como disponible.
    como(A.id, "owner", dueñaA);
    const body = (await (await llamar("GET", "settings/navigation")).json()) as { roles: Record<string, { available: string[] }> };
    expect(body.roles.owner?.available).not.toContain("knowledge");
    await changeOrganizationModules(A.id, { knowledge: true, results: true }, ACTOR, null);
  });

  it("aislamiento: B no ve ni cambia el menú de A", async () => {
    como(A.id, "owner", dueñaA);
    await llamar("PUT", "settings/navigation", { role: "asesor", items: asesorSoloBandeja() });
    await changeOrganizationModules(B.id, { customNav: true }, ACTOR, null);
    como(B.id, "owner", dueñaB);
    const deB = (await (await llamar("GET", "settings/navigation")).json()) as {
      roles: Record<string, { customized: boolean }>;
      events: unknown[];
    };
    expect(deB.roles.asesor?.customized).toBe(false);
    expect(deB.events).toEqual([]);
    await llamar("DELETE", "settings/navigation?role=asesor");
    const asesorA = await navForSession(como(A.id, "asesor"));
    expect(asesorA.main.map((m) => m.key).slice(0, 2)).toEqual(["contacts", "inbox"]);
    const asesorB = await navForSession(como(B.id, "asesor"));
    expect(asesorB.main.map((m) => m.key)[0]).toBe("inbox");
  });
});
