import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getSystemDb, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import type { TaskDto } from "@/lib/work";
import { assignContacts } from "@/server/assignment/assign";
import { forgetOrgModules, getOrgModules, seedOrgModules, updateOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 033, PR 1 — Trabajo (Tareas) contra Postgres real, conectada como la app
 * (RLS): aislamiento entre organizaciones, quién ve y edita qué (cada quien
 * lo suyo, `work.manage` todo), las rutas en 404 sin el módulo, Citas igual
 * que antes, y que una tarea NUNCA genera un envío (ni en un chat de prueba).
 */

const meta = vi.hoisted(() => ({ llamadas: 0 }));
vi.mock("@/lib/meta/client", async (orig) => {
  const real = await orig<typeof import("@/lib/meta/client")>();
  const espia = new Proxy(real as Record<string, unknown>, {
    get(target, prop) {
      const v = target[prop as string];
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        meta.llamadas++;
        return (v as (...a: unknown[]) => unknown)(...args);
      };
    },
  });
  return espia;
});

type Role = "owner" | "coordinador" | "asesor";
const state = vi.hoisted(() => ({
  session: null as null | {
    userId: string;
    organizationId: string;
    role: string;
    access: { organizationId: string; userId: string; seesAll: boolean };
  },
}));

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

function como(organizationId: string, userId: string, role: Role) {
  state.session = { userId, organizationId, role, access: { organizationId, userId, seesAll: role !== "asesor" } };
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function llamar(
  route: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  opts: { body?: unknown; query?: string; id?: string } = {}
): Promise<{ status: number; data: Record<string, unknown> }> {
  const mod = (await import(`@/app/api/${route}/route`)) as Record<string, Handler>;
  const res = await mod[method]!(
    new Request(`http://localhost/api/${route}${opts.query ?? ""}`, {
      method,
      headers: { "content-type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    { params: Promise.resolve({ id: opts.id ?? "" }) }
  );
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

const sys = () => getSystemDb();

async function persona(orgId: string, role: Role, nombre: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name: nombre, email: `${id}@trabajo.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role });
  return id;
}

async function chat(orgId: string, isTest = false): Promise<{ contactId: string; conversationId: string }> {
  const contactId = newId("contact");
  const tel = `52155${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  await sys().insert(schema.contact).values({ id: contactId, organizationId: orgId, waIdentity: tel, phone: tel, name: `Cliente ${tel.slice(-4)}` });
  const conversationId = newId("conversation");
  await sys().insert(schema.conversation).values({ id: conversationId, organizationId: orgId, contactId, isTest });
  return { contactId, conversationId };
}

let A: Awaited<ReturnType<typeof crearOrganizacion>>;
let B: Awaited<ReturnType<typeof crearOrganizacion>>;
const u = { owner: "", coord: "", ana: "", beto: "", ajenaB: "" };
let deAna: { contactId: string; conversationId: string };
let dePrueba: { contactId: string; conversationId: string };

beforeAll(async () => {
  A = await crearOrganizacion("Trabajo A");
  B = await crearOrganizacion("Trabajo B");
  u.owner = await persona(A.id, "owner", "Dueña A");
  u.coord = await persona(A.id, "coordinador", "Coordinador A");
  u.ana = await persona(A.id, "asesor", "Ana Asesora");
  u.beto = await persona(A.id, "asesor", "Beto Asesor");
  u.ajenaB = await persona(B.id, "asesor", "Asesora de B");
  for (const org of [A.id, B.id]) await updateOrgModules(org, { trabajo: true, agenda: true }, "prueba");
  deAna = await chat(A.id);
  dePrueba = await chat(A.id, true);
  await runWithOrganization(A.id, () =>
    assignContacts({
      organizationId: A.id,
      contactIds: [deAna.contactId, dePrueba.contactId],
      toUserId: u.ana,
      actorUserId: u.owner,
      source: "manual",
      reason: null,
    })
  );
});
afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
});
beforeEach(() => forgetOrgModules());

describe("033 — el módulo `trabajo`", () => {
  it("nace apagado (columna DEFAULT false); los perfiles Básico y Completo lo encienden", async () => {
    const creadas: string[] = [];
    try {
      for (const perfil of [undefined, "basico", "completo"] as const) {
        const org = await crearOrganizacion(`Perfil ${perfil ?? "ninguno"}`);
        creadas.push(org.id);
        await sys().delete(schema.organizationModule).where(eq(schema.organizationModule.organizationId, org.id));
        await sys().transaction((tx) => seedOrgModules(tx as never, org.id, perfil));
        forgetOrgModules(org.id);
        expect((await getOrgModules(org.id)).trabajo, String(perfil)).toBe(perfil !== undefined);
      }
      // Una fila que ya existía antes de la 0037 (sin la columna) queda en false.
      const [col] = await sys().execute<{ d: string }>(
        sql`select column_default as d from information_schema.columns where table_name = 'organization_module' and column_name = 'trabajo'`
      );
      expect(col?.d).toBe("false");
    } finally {
      await borrarOrganizaciones(creadas);
    }
  });

  it("sin el módulo, las rutas de Tareas responden 404 (aunque la persona sea Propietaria)", async () => {
    await updateOrgModules(A.id, { trabajo: false }, "prueba");
    try {
      como(A.id, u.owner, "owner");
      expect((await llamar("work/tasks", "GET")).status).toBe(404);
      expect((await llamar("work/tasks", "POST", { body: { title: "x" } })).status).toBe(404);
      expect((await llamar("work/tasks/[id]", "PATCH", { id: "tsk_x", body: { done: true } })).status).toBe(404);
      expect((await llamar("work/tasks/[id]", "DELETE", { id: "tsk_x" })).status).toBe(404);
      // Citas sigue funcionando igual: su módulo es `agenda`, no `trabajo`.
      expect((await llamar("bookings", "GET", { query: "?from=2026-10-01&to=2026-10-07" })).status).toBe(200);
    } finally {
      await updateOrgModules(A.id, { trabajo: true }, "prueba");
    }
  });

  it("Citas sin `agenda` sigue en 404 aunque Tareas esté encendido", async () => {
    await updateOrgModules(A.id, { agenda: false }, "prueba");
    try {
      como(A.id, u.owner, "owner");
      expect((await llamar("bookings", "GET", { query: "?from=2026-10-01&to=2026-10-07" })).status).toBe(404);
      expect((await llamar("work/tasks", "GET")).status).toBe(200);
    } finally {
      await updateOrgModules(A.id, { agenda: true }, "prueba");
    }
  });
});

describe("033 — quién ve y edita cada tarea", () => {
  let tareaDeAna: TaskDto;

  it("una asesora crea su tarea; sin responsable elegido queda a su cargo", async () => {
    como(A.id, u.ana, "asesor");
    const r = await llamar("work/tasks", "POST", {
      body: { title: "Llamar a la clienta", conversationId: deAna.conversationId, dueAt: new Date(Date.now() - 3600_000).toISOString() },
    });
    expect(r.status).toBe(201);
    tareaDeAna = r.data.task as TaskDto;
    expect(tareaDeAna.assignee?.id).toBe(u.ana);
    // La conversación trae su contacto (lo puede ver: está asignada a ella).
    expect(tareaDeAna.contact?.id).toBe(deAna.contactId);
    expect(tareaDeAna.conversationId).toBe(deAna.conversationId);
    const mias = (await llamar("work/tasks", "GET", { query: "?filter=mine" })).data.tasks as TaskDto[];
    expect(mias.map((t) => t.id)).toContain(tareaDeAna.id);
    const vencidas = (await llamar("work/tasks", "GET", { query: "?filter=overdue" })).data.tasks as TaskDto[];
    expect(vencidas.map((t) => t.id)).toContain(tareaDeAna.id);
  });

  it("otro asesor no la ve ni la puede tocar (404: para él no existe)", async () => {
    como(A.id, u.beto, "asesor");
    const todas = (await llamar("work/tasks", "GET", { query: "?filter=all" })).data.tasks as TaskDto[];
    expect(todas.map((t) => t.id)).not.toContain(tareaDeAna.id);
    expect((await llamar("work/tasks/[id]", "PATCH", { id: tareaDeAna.id, body: { done: true } })).status).toBe(404);
    expect((await llamar("work/tasks/[id]", "DELETE", { id: tareaDeAna.id })).status).toBe(404);
  });

  it("un asesor no puede ligar una tarea a un chat que no ve (422)", async () => {
    como(A.id, u.beto, "asesor");
    const r = await llamar("work/tasks", "POST", { body: { title: "Espiar", contactId: deAna.contactId } });
    expect(r.status).toBe(422);
    expect((r.data.error as { code: string }).code).toBe("invalid_link");
  });

  it("el Coordinador (work.manage) ve todas y la marca hecha de un toque", async () => {
    como(A.id, u.coord, "coordinador");
    const todas = (await llamar("work/tasks", "GET", { query: "?filter=all" })).data.tasks as TaskDto[];
    expect(todas.map((t) => t.id)).toContain(tareaDeAna.id);
    const r = await llamar("work/tasks/[id]", "PATCH", { id: tareaDeAna.id, body: { done: true } });
    expect(r.status).toBe(200);
    const hecha = r.data.task as TaskDto;
    expect(hecha.doneAt).not.toBeNull();
    expect(hecha.doneBy?.id).toBe(u.coord);
    como(A.id, u.ana, "asesor");
    const hechas = (await llamar("work/tasks", "GET", { query: "?filter=done" })).data.tasks as TaskDto[];
    expect(hechas.map((t) => t.id)).toContain(tareaDeAna.id);
    const pendientes = (await llamar("work/tasks", "GET", { query: "?filter=mine" })).data.tasks as TaskDto[];
    expect(pendientes.map((t) => t.id)).not.toContain(tareaDeAna.id);
  });

  it("el responsable la ve y la marca, pero solo quien la creó (o work.manage) la borra", async () => {
    como(A.id, u.ana, "asesor");
    const r = await llamar("work/tasks", "POST", { body: { title: "Para Beto", assigneeUserId: u.beto } });
    expect(r.status).toBe(201);
    const id = (r.data.task as TaskDto).id;
    como(A.id, u.beto, "asesor");
    const mias = (await llamar("work/tasks", "GET", { query: "?filter=mine" })).data.tasks as TaskDto[];
    const vista = mias.find((t) => t.id === id);
    expect(vista?.canEdit).toBe(true);
    expect(vista?.canDelete).toBe(false);
    expect((await llamar("work/tasks/[id]", "PATCH", { id, body: { done: true } })).status).toBe(200);
    expect((await llamar("work/tasks/[id]", "DELETE", { id })).status).toBe(403);
    como(A.id, u.ana, "asesor");
    expect((await llamar("work/tasks/[id]", "DELETE", { id })).status).toBe(204);
  });

  it("al responsable que no ve el contacto ligado no se le dice cuál es", async () => {
    como(A.id, u.coord, "coordinador");
    const r = await llamar("work/tasks", "POST", {
      body: { title: "Revisar pago", assigneeUserId: u.beto, contactId: deAna.contactId },
    });
    expect(r.status).toBe(201);
    como(A.id, u.beto, "asesor");
    const mias = (await llamar("work/tasks", "GET", { query: "?filter=mine" })).data.tasks as TaskDto[];
    const t = mias.find((x) => x.title === "Revisar pago");
    expect(t?.contact).toBeNull();
    expect(t?.hiddenContact).toBe(true);
    expect(JSON.stringify(t)).not.toContain(deAna.contactId);
  });

  it("el responsable debe ser del negocio: una persona de otra organización da 422", async () => {
    como(A.id, u.owner, "owner");
    const r = await llamar("work/tasks", "POST", { body: { title: "x", assigneeUserId: u.ajenaB } });
    expect(r.status).toBe(422);
    expect((r.data.error as { code: string }).code).toBe("invalid_assignee");
  });
});

describe("033 — RLS en work_task", () => {
  let tareaB: string;
  beforeAll(async () => {
    tareaB = newId("workTask");
    await sys().insert(schema.workTask).values({ id: tareaB, organizationId: B.id, title: "Secreto de B", createdBy: u.ajenaB });
  });

  it("con A en el contexto no se ve, ni se cambia, ni se borra la tarea de B", async () => {
    const vistas = await runWithOrganization(A.id, () =>
      getDb().select({ id: schema.workTask.id }).from(schema.workTask).where(eq(schema.workTask.id, tareaB))
    );
    expect(vistas).toEqual([]);
    const cambiadas = await withTenant(A.id, (tx) =>
      tx.update(schema.workTask).set({ title: "pisada" }).where(eq(schema.workTask.id, tareaB)).returning({ id: schema.workTask.id })
    );
    expect(cambiadas).toEqual([]);
    const borradas = await withTenant(A.id, (tx) =>
      tx.delete(schema.workTask).where(eq(schema.workTask.id, tareaB)).returning({ id: schema.workTask.id })
    );
    expect(borradas).toEqual([]);
    const [sigue] = await sys().select({ title: schema.workTask.title }).from(schema.workTask).where(eq(schema.workTask.id, tareaB));
    expect(sigue?.title).toBe("Secreto de B");
  });

  it("A no puede escribir una tarea a nombre de B (WITH CHECK)", async () => {
    const err = await runWithOrganization(A.id, () =>
      getDb().insert(schema.workTask).values({ id: newId("workTask"), organizationId: B.id, title: "intrusa" })
    ).then(
      () => null,
      (e: unknown) => e as Error & { cause?: { code?: string } }
    );
    expect(err?.cause?.code).toBe("42501");
  });

  it("la FK compuesta impide ligar una tarea de A a un contacto de B", async () => {
    const deB = await chat(B.id);
    const err = await sys()
      .insert(schema.workTask)
      .values({ id: newId("workTask"), organizationId: A.id, title: "cruzada", contactId: deB.contactId })
      .then(
        () => null,
        (e: unknown) => e as Error & { cause?: { code?: string } }
      );
    expect(err?.cause?.code).toBe("23503");
  });

  it("la API de B no ve las tareas de A", async () => {
    como(B.id, u.ajenaB, "owner");
    const todas = (await llamar("work/tasks", "GET", { query: "?filter=all" })).data.tasks as TaskDto[];
    expect(todas.every((t) => t.title !== "Llamar a la clienta")).toBe(true);
    expect(todas.map((t) => t.id)).toContain(tareaB);
  });

  it("borrar el contacto deja la tarea sin ligadura (no la borra)", async () => {
    const c = await chat(A.id);
    const id = newId("workTask");
    await sys().insert(schema.workTask).values({ id, organizationId: A.id, title: "Ligada", contactId: c.contactId, conversationId: c.conversationId });
    await sys().delete(schema.conversation).where(eq(schema.conversation.id, c.conversationId));
    await sys().delete(schema.contact).where(eq(schema.contact.id, c.contactId));
    const [t] = await sys().select().from(schema.workTask).where(eq(schema.workTask.id, id));
    expect(t?.organizationId).toBe(A.id);
    expect(t?.contactId).toBeNull();
    expect(t?.conversationId).toBeNull();
  });
});

describe("033 — una tarea es interna: nunca genera un envío", () => {
  it("crear, editar y marcar tareas de un chat real y de uno de prueba no crea mensajes ni llama a Meta", async () => {
    const mensajes = async () =>
      (await sys().select({ n: sql<number>`count(*)::int` }).from(schema.message).where(eq(schema.message.organizationId, A.id)))[0]!.n;
    const antes = await mensajes();
    meta.llamadas = 0;
    como(A.id, u.ana, "asesor");
    for (const conv of [deAna.conversationId, dePrueba.conversationId]) {
      const r = await llamar("work/tasks", "POST", { body: { title: "Mandar cotización", conversationId: conv } });
      expect(r.status).toBe(201);
      const id = (r.data.task as TaskDto).id;
      expect((await llamar("work/tasks/[id]", "PATCH", { id, body: { description: "con descuento", done: true } })).status).toBe(200);
    }
    expect(await mensajes()).toBe(antes);
    expect(meta.llamadas).toBe(0);
  });
});
