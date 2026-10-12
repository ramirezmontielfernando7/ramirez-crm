import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { docScopeFor } from "@/lib/kb-docs";
import { runWithOrganization } from "@/lib/request-context";
import { embeddingsMock } from "@/server/dev/embeddings-mock";
import { forgetOrgModules } from "@/server/modules";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 037 (PR 3) — Documentos exclusivos de un agente, contra Postgres REAL
 * conectada como la app (RLS), por las rutas de verdad:
 *
 * - Subir desde el editor (`agentId`): queda sin grupo, no aparece en las
 *   listas de la empresa, cuenta contra los límites; solo lo recupera su
 *   agente. Agente archivado, inexistente o de otra organización → 404.
 * - No se mueve de grupo; el duplicado dice que ya es exclusivo.
 * - Archivar (D3, misma transacción): por defecto se borran (con sus
 *   fragmentos); con `?documents=general` pasan a General y los lee quien
 *   use «Todos los documentos de la empresa».
 */

const h = vi.hoisted(() => ({
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
      if (!h.session) throw new real.UnauthorizedError();
      return h.session;
    },
    getSessionOrNull: async () => h.session,
  };
});

const { whenIndexerIdle } = await import("@/server/kb-docs/indexer");
const { retrieveChunks, forgetKbVectorCache } = await import("@/server/kb-docs/retrieve");
const agents = await import("@/server/agents/store");
const { ensureGeneralAgent } = await import("@/server/agents/ensure");

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
let A: Org;
let B: Org;
let ownerA: string;
let ownerB: string;
let server: Server;

const sys = () => getSystemDb();

function como(org: Org, userId: string) {
  h.session = { userId, organizationId: org.id, role: "owner", access: { organizationId: org.id, userId, seesAll: true } };
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function llamar(
  route: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  opts: { id?: string; form?: FormData; json?: unknown; query?: string } = {}
): Promise<{ status: number; data: Record<string, unknown> }> {
  const mod = (await import(`@/app/api/${route}/route`)) as unknown as Record<string, Handler>;
  const body = opts.form ?? (opts.json === undefined ? undefined : JSON.stringify(opts.json));
  const headers = opts.json === undefined ? undefined : { "content-type": "application/json" };
  const res = await mod[method]!(
    new Request(`http://localhost/api/${route}${opts.query ? `?${opts.query}` : ""}`, { method, body, headers }),
    { params: Promise.resolve({ id: opts.id ?? "" }) }
  );
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function subir(org: Org, user: string, nombre: string, contenido: string, extra: Record<string, string> = {}) {
  como(org, user);
  const form = new FormData();
  form.append("file", new File([contenido], nombre, { type: "text/plain" }));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const r = await llamar("lab/documents", "POST", { form });
  await whenIndexerIdle();
  return r;
}

async function documento(id: string) {
  const [d] = await sys().select().from(schema.kbDocument).where(eq(schema.kbDocument.id, id));
  return d;
}

async function persona(orgId: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name: "Dueño", email: `${id}@exclusivos.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role: "owner" });
  return id;
}

async function modulos(org: Org) {
  const set = { agenda: false, agent: true, lab: true };
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: org.id, ...set })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set });
  forgetOrgModules(org.id);
}

async function agente(org: Org, owner: string, nombre: string): Promise<string> {
  const a = await runWithOrganization(org.id, () => agents.createAgent({ organizationId: org.id, actorUserId: owner, internalName: nombre }));
  await runWithOrganization(org.id, () => agents.publishAgent(org.id, a.id, owner));
  return a.id;
}

async function lee(agentId: string | null, q: string): Promise<Set<string>> {
  const hits = await runWithOrganization(A.id, () => retrieveChunks(A.id, docScopeFor(agentId, { mode: "all" }), q));
  return new Set(hits.map((x) => x.documentId));
}

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const r = embeddingsMock(JSON.parse(raw || "{}"));
      res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  process.env.KB_DOCS = "on";
  process.env.EMBEDDINGS_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.EMBEDDINGS_MODEL = "intfloat/multilingual-e5-small";
  process.env.KB_DOCS_MIN_SIMILARITY = "0.2";
  resetEnvCacheForTests();

  A = await crearOrganizacion("Exclusivos A");
  B = await crearOrganizacion("Exclusivos B");
  await modulos(A);
  await modulos(B);
  ownerA = await persona(A.id);
  ownerB = await persona(B.id);
  await runWithOrganization(A.id, () => ensureGeneralAgent(A.id));
});

afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
  await new Promise((ok) => server.close(ok));
  for (const k of ["KB_DOCS", "EMBEDDINGS_BASE_URL", "EMBEDDINGS_MODEL", "KB_DOCS_MIN_SIMILARITY"]) delete process.env[k];
  resetEnvCacheForTests();
});

beforeEach(() => {
  forgetKbVectorCache();
});

describe("subir y leer exclusivos", () => {
  let cierre: string;
  let otro: string;
  let doc: string;
  const DATO = "guion de cierre OMEGA";

  it("subir con agentId: queda exclusivo y sin grupo; fuera de las listas de la empresa; en la del agente", async () => {
    cierre = await agente(A, ownerA, "Cierre");
    otro = await agente(A, ownerA, "Otro");
    const r = await subir(A, ownerA, "cierre.txt", `Para cerrar la venta usa el ${DATO}.`, { agentId: cierre });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    doc = (r.data.document as { id: string }).id;
    const d = await documento(doc);
    expect(d?.agentId).toBe(cierre);
    expect(d?.groupId).toBeNull();
    como(A, ownerA);
    expect(((await llamar("lab/documents", "GET")).data.documents as { id: string }[]).map((x) => x.id)).not.toContain(doc);
    expect(((await llamar("lab/documents", "GET", { query: "group=general" })).data.documents as { id: string }[]).map((x) => x.id)).not.toContain(doc);
    const propios = await llamar("lab/documents", "GET", { query: `agentId=${cierre}` });
    expect((propios.data.documents as { id: string }[]).map((x) => x.id)).toEqual([doc]);
    expect(((await llamar("lab/documents", "GET", { query: `agentId=${otro}` })).data.documents as unknown[]).length).toBe(0);
    // Cuenta contra los límites de la organización, y la pantalla sabe cuántos son exclusivos.
    expect(propios.data.usage).toMatchObject({ documents: 1, exclusive: 1 });
    // Cuenta en «Grupos»: General no lo incluye.
    const g = await llamar("lab/document-groups", "GET");
    expect((g.data.groups as { documents: number }[])[0]?.documents).toBe(0);
  });

  it("solo lo recupera su agente (por texto y por vectores); ni otro agente ni el general", async () => {
    const general = await runWithOrganization(A.id, () => ensureGeneralAgent(A.id));
    for (const q of [DATO, "cerrar venta usa guion"]) {
      expect((await lee(cierre, q)).has(doc), q).toBe(true);
      expect((await lee(otro, q)).has(doc), q).toBe(false);
      expect((await lee(general!.agent.id, q)).has(doc), q).toBe(false);
      expect((await lee(null, q)).has(doc), q).toBe(false);
    }
  });

  it("no se mueve de grupo (404) y el duplicado dice que ya es exclusivo", async () => {
    como(A, ownerA);
    expect((await llamar("lab/documents/[id]", "PATCH", { id: doc, json: { groupId: "general" } })).status).toBe(404);
    expect((await documento(doc))?.agentId).toBe(cierre);
    const dup = await subir(A, ownerA, "otra.txt", `Para cerrar la venta usa el ${DATO}.`);
    expect(dup.status).toBe(409);
    expect((dup.data.error as { message: string }).message).toContain("exclusivo de un agente");
  });

  it("agente inexistente, archivado o de otra organización → 404; grupo y agente a la vez → 422", async () => {
    expect((await subir(A, ownerA, "x1.txt", "Texto uno de prueba.", { agentId: "agt_noexiste" })).status).toBe(404);
    const archivado = await agente(A, ownerA, "Archivado");
    await runWithOrganization(A.id, () => agents.archiveAgent(A.id, archivado));
    expect((await subir(A, ownerA, "x2.txt", "Texto dos de prueba.", { agentId: archivado })).status).toBe(404);
    expect((await subir(B, ownerB, "x3.txt", "Texto tres de prueba.", { agentId: cierre })).status).toBe(404);
    expect((await subir(A, ownerA, "x4.txt", "Texto cuatro de prueba.", { agentId: cierre, groupId: "general" })).status).toBe(422);
    // B tampoco lista los exclusivos de un agente de A.
    como(B, ownerB);
    expect(((await llamar("lab/documents", "GET", { query: `agentId=${cierre}` })).data.documents as unknown[]).length).toBe(0);
  });

  it("cuenta contra el tope de documentos de la organización", async () => {
    await sys()
      .insert(schema.kbDocumentLimit)
      .values({ organizationId: A.id, maxDocuments: 1 })
      .onConflictDoUpdate({ target: [schema.kbDocumentLimit.organizationId], set: { maxDocuments: 1 } });
    try {
      const r = await subir(A, ownerA, "tope.txt", "Un documento que ya no cabe.", { agentId: otro });
      expect(r.status).toBe(409);
      expect(r.data.error).toMatchObject({ code: "document_limit" });
    } finally {
      await sys().delete(schema.kbDocumentLimit).where(eq(schema.kbDocumentLimit.organizationId, A.id));
    }
  });
});

describe("archivar un agente con exclusivos (D3, misma transacción)", () => {
  it("por defecto se borran, con sus fragmentos; el agente queda archivado", async () => {
    const ag = await agente(A, ownerA, "Se va borrando");
    const r = await subir(A, ownerA, "borrar.txt", "Política de descuentos del agente que se archiva: 7 por ciento.", { agentId: ag });
    const doc = (r.data.document as { id: string }).id;
    expect((await sys().select().from(schema.kbChunk).where(eq(schema.kbChunk.documentId, doc))).length).toBeGreaterThan(0);
    como(A, ownerA);
    const del = await llamar("lab/agents/[id]", "DELETE", { id: ag });
    expect(del.status).toBe(200);
    expect(await documento(doc)).toBeUndefined();
    expect(await sys().select().from(schema.kbChunk).where(eq(schema.kbChunk.documentId, doc))).toEqual([]);
    const [fila] = await sys().select({ archivedAt: schema.agent.archivedAt }).from(schema.agent).where(eq(schema.agent.id, ag));
    expect(fila?.archivedAt).not.toBeNull();
  });

  it("con ?documents=general pasan a General y los lee quien usa «todos los documentos de la empresa»", async () => {
    const ag = await agente(A, ownerA, "Se va conservando");
    const r = await subir(A, ownerA, "conservar.txt", "El horario especial de inventario es el sábado a las 7.", { agentId: ag });
    const doc = (r.data.document as { id: string }).id;
    const general = await runWithOrganization(A.id, () => ensureGeneralAgent(A.id));
    expect((await lee(general!.agent.id, "horario especial de inventario")).has(doc)).toBe(false);
    como(A, ownerA);
    expect((await llamar("lab/agents/[id]", "DELETE", { id: ag, query: "documents=general" })).status).toBe(200);
    const d = await documento(doc);
    expect(d?.agentId).toBeNull();
    expect(d?.groupId).toBeNull();
    expect(d?.status).toBe("ready");
    expect((await lee(general!.agent.id, "horario especial de inventario")).has(doc)).toBe(true);
    const lista = await llamar("lab/documents", "GET", { query: "group=general" });
    expect((lista.data.documents as { id: string }[]).map((x) => x.id)).toContain(doc);
  });

  it("si archivar falla (el general), sus exclusivos no se tocan", async () => {
    const general = await runWithOrganization(A.id, () => ensureGeneralAgent(A.id));
    const r = await subir(A, ownerA, "del-general.txt", "Nota exclusiva del agente general sobre garantías extendidas.", { agentId: general!.agent.id });
    const doc = (r.data.document as { id: string }).id;
    como(A, ownerA);
    expect((await llamar("lab/agents/[id]", "DELETE", { id: general!.agent.id })).status).toBe(409);
    expect((await documento(doc))?.agentId).toBe(general!.agent.id);
  });
});
