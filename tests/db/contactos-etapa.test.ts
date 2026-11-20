import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sessionContext, type SessionContext } from "@/lib/auth/session";
import { GET } from "@/app/api/contacts/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Contactos: la etapa se filtra en la consulta y se lee solo para la página
 * (antes se bajaban las etapas de TODOS los contactos en cada visita). Lo que
 * se ve no cambia: mismo filtro, mismo total, misma etapa en cada fila, y el
 * asesor sigue viendo solo lo suyo.
 */
const h = vi.hoisted(() => ({ session: null as SessionContext | null }));
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...real,
    requireSession: async () => {
      if (!h.session) throw new real.UnauthorizedError();
      return h.session;
    },
    getSessionOrNull: async () => h.session,
  };
});

const sys = () => getSystemDb();
let A: Awaited<ReturnType<typeof crearOrganizacion>>;
let B: Awaited<ReturnType<typeof crearOrganizacion>>;
const owner = newId("user");
const asesor = newId("user");
const etapas: { id: string; name: string }[] = [];

async function contacto(org: string, nombre: string, etapa: number | null, asignado?: string) {
  const id = newId("contact");
  const tel = `52155${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  await sys().insert(schema.contact).values({ id, organizationId: org, waIdentity: tel, phone: tel, name: nombre, assignedUserId: asignado ?? null });
  if (etapa !== null) {
    const stages = await sys().select().from(schema.pipelineStage).where(eq(schema.pipelineStage.organizationId, org));
    const stage = stages.find((s) => s.position === etapa)!;
    await sys().insert(schema.lead).values({ id: newId("lead"), organizationId: org, contactId: id, stageId: stage.id });
  }
  return id;
}

async function pedir(query: string) {
  const res = await GET(new Request(`http://localhost/api/contacts${query}`));
  expect(res.status).toBe(200);
  return (await res.json()) as { contacts: { name: string | null; stageName: string | null }[]; total: number };
}

beforeAll(async () => {
  A = await crearOrganizacion("Contactos etapa");
  B = await crearOrganizacion("Contactos otra");
  for (const [id, name] of [[owner, "Dueña"], [asesor, "Asesor"]] as const) {
    await sys().insert(schema.user).values({ id, name, email: `${id}@etapa.test`, emailVerified: true });
  }
  await sys().insert(schema.member).values([
    { id: newId("member"), organizationId: A.id, userId: owner, role: "owner" },
    { id: newId("member"), organizationId: A.id, userId: asesor, role: "asesor" },
  ]);
  etapas.push(...(await sys().select().from(schema.pipelineStage).where(eq(schema.pipelineStage.organizationId, A.id))));
  await contacto(A.id, "Uno cero", 0);
  await contacto(A.id, "Dos cero", 0, asesor);
  await contacto(A.id, "Tres uno", 1, asesor);
  await contacto(A.id, "Cuatro sin lead", null);
  // Misma etapa por nombre en otra empresa: nunca se cuela.
  await contacto(B.id, "Ajeno cero", 0);
});

afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
  for (const id of [owner, asesor]) await sys().delete(schema.user).where(eq(schema.user.id, id));
});

describe("contactos por etapa", () => {
  it("quien ve todo: filtra por etapa con su total y cada fila trae su etapa", async () => {
    h.session = sessionContext(owner, A.id, "owner");
    const todos = await pedir("");
    expect(todos.total).toBe(4);
    const porNombre = Object.fromEntries(todos.contacts.map((c) => [c.name, c.stageName]));
    expect(porNombre).toEqual({ "Uno cero": "Etapa 0", "Dos cero": "Etapa 0", "Tres uno": "Etapa 1", "Cuatro sin lead": null });

    const cero = await pedir("?stage=Etapa%200");
    expect(cero.total).toBe(2);
    expect(cero.contacts.map((c) => c.name).sort()).toEqual(["Dos cero", "Uno cero"]);
    expect(cero.contacts.every((c) => c.stageName === "Etapa 0")).toBe(true);

    const nada = await pedir("?stage=No%20existe");
    expect(nada).toMatchObject({ contacts: [], total: 0 });
  });

  it("la página corta después del filtro y el total es de toda la etapa", async () => {
    h.session = sessionContext(owner, A.id, "owner");
    const p1 = await pedir("?stage=Etapa%200&pageSize=1&page=1");
    const p2 = await pedir("?stage=Etapa%200&pageSize=1&page=2");
    expect([p1.total, p2.total]).toEqual([2, 2]);
    expect([...p1.contacts, ...p2.contacts].map((c) => c.name).sort()).toEqual(["Dos cero", "Uno cero"]);
  });

  it("el asesor: solo lo suyo, también filtrando por etapa", async () => {
    h.session = sessionContext(asesor, A.id, "asesor");
    const suyos = await pedir("");
    expect(suyos.contacts.map((c) => c.name).sort()).toEqual(["Dos cero", "Tres uno"]);
    const cero = await pedir("?stage=Etapa%200");
    expect(cero).toMatchObject({ total: 1, contacts: [{ name: "Dos cero", stageName: "Etapa 0" }] });
  });
});
