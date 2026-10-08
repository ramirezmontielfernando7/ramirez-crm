import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getSystemDb, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { docScopeFor } from "@/lib/kb-docs";
import { runWithOrganization } from "@/lib/request-context";
import { embeddingsMock, embedMockStats } from "@/server/dev/embeddings-mock";
import { forgetOrgModules } from "@/server/modules";
import { makePdf } from "../fixtures/pdf";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 035 — Documentos del agente contra Postgres REAL, conectada como la app
 * (RLS), por las rutas de verdad:
 *
 * - Subir → fragmentos + vectores (con los prefijos e5 que exige el mock).
 * - AISLAMIENTO: B no ve, no recupera, no lee por id ni borra lo de A; una
 *   fila de B no puede colgar de un documento de A (FK compuesta); sin
 *   organización en el contexto, cero filas (RLS).
 * - Límites: documentos (también con subidas a la vez), fragmentos, tamaño,
 *   duplicados.
 * - Sin servicio de embeddings: «solo texto», y la recuperación sigue.
 * - El turno real del agente: con documentos los ve en su sección; sin
 *   documentos, el prompt de siempre.
 */

const h = vi.hoisted(() => ({
  session: null as null | {
    userId: string;
    organizationId: string;
    role: string;
    access: { organizationId: string; userId: string; seesAll: boolean };
  },
  llamadasLlm: [] as { role: string; content: string }[][],
  embedFalla: false,
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

// Solo se simula el modelo de chat (y el envío a Meta): lo demás corre de verdad.
vi.mock("@/lib/ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...real,
    chatJson: async (_schema: unknown, messages: { role: string; content: string }[]) => {
      h.llamadasLlm.push(messages);
      return { ok: true, data: { action: "none" }, raw: "", usage: { promptTokens: 1, completionTokens: 1 } };
    },
  };
});

const { whenIndexerIdle } = await import("@/server/kb-docs/indexer");
const { retrieveChunks, forgetKbVectorCache } = await import("@/server/kb-docs/retrieve");
/** 037 — Lo de siempre: todos los documentos de la empresa (agente sin configurar). */
const TODOS = docScopeFor(null, undefined);
const { runAgentTurn } = await import("@/server/ai/pipeline");
const { DOCS_MARKER } = await import("@/server/ai/prompts");

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
  method: "GET" | "POST" | "DELETE",
  opts: { id?: string; form?: FormData } = {}
): Promise<{ status: number; data: Record<string, unknown> }> {
  const mod = (await import(`@/app/api/${route}/route`)) as Record<string, Handler>;
  const res = await mod[method]!(
    new Request(`http://localhost/api/${route}`, { method, body: opts.form }),
    { params: Promise.resolve({ id: opts.id ?? "" }) }
  );
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function archivo(nombre: string, contenido: string | Uint8Array<ArrayBuffer>, tipo = "text/plain"): FormData {
  const form = new FormData();
  form.append("file", new File([contenido], nombre, { type: tipo }));
  return form;
}

async function subir(org: Org, user: string, nombre: string, contenido: string | Uint8Array<ArrayBuffer>) {
  como(org, user);
  const r = await llamar("lab/documents", "POST", { form: archivo(nombre, contenido) });
  await whenIndexerIdle();
  return r;
}

async function documento(id: string) {
  const [d] = await sys().select().from(schema.kbDocument).where(eq(schema.kbDocument.id, id));
  return d;
}

async function persona(orgId: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name: "Dueño", email: `${id}@docs.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role: "owner" });
  return id;
}

async function modulos(org: Org, set: { agent: boolean; lab: boolean }) {
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: org.id, agenda: false, ...set })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { agenda: false, ...set } });
  forgetOrgModules(org.id);
}

async function limites(org: Org, set: { maxFileBytes?: number | null; maxDocuments?: number | null; maxChunks?: number | null }) {
  await sys()
    .insert(schema.kbDocumentLimit)
    .values({ organizationId: org.id, ...set })
    .onConflictDoUpdate({ target: [schema.kbDocumentLimit.organizationId], set: { ...set } });
}

const MANUAL_A = [
  "# Envíos",
  "Hacemos envíos a todo México. El envío es gratis en compras desde $1,234 pesos; si no, cuesta $99.",
  "## Garantía",
  "Todas las herramientas eléctricas tienen garantía de 6 meses con su ticket de compra.",
].join("\n\n");

beforeAll(async () => {
  // Servicio de embeddings de mentira, pero por HTTP de verdad (el mismo del self-test).
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (h.embedFalla) {
        res.writeHead(503).end("caído");
        return;
      }
      const r = embeddingsMock(JSON.parse(raw || "{}"));
      res.writeHead(r.status, { "content-type": "application/json" }).end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;

  process.env.KB_DOCS = "on";
  process.env.EMBEDDINGS_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.EMBEDDINGS_MODEL = "intfloat/multilingual-e5-small";
  // El coseno del mock (bolsa de palabras) es más bajo que el de un e5 real.
  process.env.KB_DOCS_MIN_SIMILARITY = "0.2";
  process.env.OPENROUTER_API_TOKEN = "sk-test-documentos";
  process.env.OPENROUTER_MODEL = "mock/modelo";
  resetEnvCacheForTests();

  A = await crearOrganizacion("Docs A");
  B = await crearOrganizacion("Docs B");
  await modulos(A, { agent: true, lab: true });
  await modulos(B, { agent: true, lab: true });
  ownerA = await persona(A.id);
  ownerB = await persona(B.id);
});

afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
  await new Promise((ok) => server.close(ok));
  for (const k of ["KB_DOCS", "EMBEDDINGS_BASE_URL", "EMBEDDINGS_MODEL", "KB_DOCS_MIN_SIMILARITY", "OPENROUTER_API_TOKEN", "OPENROUTER_MODEL"]) {
    delete process.env[k];
  }
  resetEnvCacheForTests();
});

beforeEach(() => {
  h.embedFalla = false;
  h.llamadasLlm = [];
  forgetKbVectorCache();
});

describe("subir e indexar", () => {
  let docA: string;

  it("un .md de A queda Listo, con fragmentos, vectores y prefijo «passage: » en cada uno", async () => {
    const antes = embedMockStats().passages;
    const r = await subir(A, ownerA, "manual.md", MANUAL_A);
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    docA = (r.data.document as { id: string }).id;
    const d = await documento(docA);
    expect(d?.status).toBe("ready");
    expect(d?.embeddingModel).toBe("intfloat/multilingual-e5-small");
    const chunks = await sys().select().from(schema.kbChunk).where(eq(schema.kbChunk.documentId, docA));
    expect(chunks.length).toBe(d?.chunkCount);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => Array.isArray(c.embedding) && c.embedding.length === 384)).toBe(true);
    // El mock rechaza (400) cualquier texto sin prefijo: si llegaron, llevaban «passage: ».
    expect(embedMockStats().passages - antes).toBe(chunks.length);
  });

  it("el uso de embeddings se cuenta por organización, aparte del total de IA", async () => {
    const rows = await sys().select().from(schema.aiUsage).where(eq(schema.aiUsage.organizationId, A.id));
    const embed = rows.find((r) => r.kind === "embed");
    expect(embed?.turns).toBeGreaterThan(0);
    expect(embed?.promptTokens).toBeGreaterThan(0);
    expect(rows.find((r) => r.kind === "total")).toBeUndefined();
  });

  it("A recupera su fragmento (por texto y por similitud)", async () => {
    const hits = await runWithOrganization(A.id, () => retrieveChunks(A.id, TODOS, "¿el envio es gratis?"));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.content).toContain("$1,234");
    expect(hits.every((x) => x.documentId === docA)).toBe(true);
  });

  it("un PDF con texto también entra", async () => {
    const r = await subir(A, ownerA, "horario.pdf", makePdf(["Horario de tienda: lunes a sabado de 9 a 19 horas."]));
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect((await documento((r.data.document as { id: string }).id))?.status).toBe("ready");
  });

  it("el mismo archivo otra vez: 409 duplicate", async () => {
    const r = await subir(A, ownerA, "copia.md", MANUAL_A);
    expect(r.status).toBe(409);
    expect((r.data.error as { code: string }).code).toBe("duplicate");
  });

  it("rechazos con su motivo: tipo, PDF escaneado, vacío", async () => {
    expect((await subir(A, ownerA, "contrato.docx", "PK\u0003\u0004")).status).toBe(415);
    const escaneo = await subir(A, ownerA, "escaneo.pdf", makePdf([]));
    expect(escaneo.status).toBe(422);
    expect((escaneo.data.error as { code: string }).code).toBe("no_text");
    expect((await subir(A, ownerA, "vacio.txt", "")).status).toBe(422);
  });

  describe("AISLAMIENTO entre organizaciones", () => {
    it("B no ve el documento de A en su lista", async () => {
      como(B, ownerB);
      const r = await llamar("lab/documents", "GET");
      expect(r.status).toBe(200);
      expect((r.data.documents as { id: string }[]).map((d) => d.id)).not.toContain(docA);
      expect(r.data.usage).toEqual({ documents: 0, chunks: 0 });
    });

    it("B no lo lee por id, no lo reindexa ni lo borra (404) y A lo sigue teniendo", async () => {
      como(B, ownerB);
      expect((await llamar("lab/documents/[id]", "GET", { id: docA })).status).toBe(404);
      expect((await llamar("lab/documents/[id]/reindex", "POST", { id: docA })).status).toBe(404);
      expect((await llamar("lab/documents/[id]", "DELETE", { id: docA })).status).toBe(404);
      expect((await documento(docA))?.status).toBe("ready");
    });

    it("B no recupera los fragmentos de A aunque pregunte exactamente lo que dicen", async () => {
      const hits = await runWithOrganization(B.id, () => retrieveChunks(B.id, TODOS, "envío gratis en compras desde $1,234 pesos"));
      expect(hits).toEqual([]);
    });

    it("RLS: con B en el contexto no existe ninguna fila de A; sin organización, cero filas", async () => {
      const vistos = await runWithOrganization(B.id, async () => ({
        docs: await getDb().execute<{ n: number }>(sql`select count(*)::int as n from kb_document where organization_id = ${A.id}`),
        chunks: await getDb().execute<{ n: number }>(sql`select count(*)::int as n from kb_chunk where organization_id = ${A.id}`),
      }));
      expect(vistos.docs[0]?.n).toBe(0);
      expect(vistos.chunks[0]?.n).toBe(0);
      const borrados = await withTenant(B.id, (tx) =>
        tx.delete(schema.kbDocument).where(eq(schema.kbDocument.id, docA)).returning({ id: schema.kbDocument.id })
      );
      expect(borrados).toEqual([]);
      const { getSql } = await import("@/lib/db");
      const [sinOrg] = await getSql()<{ n: number }[]>`select count(*)::int as n from kb_chunk`;
      expect(sinOrg?.n).toBe(0);
    });

    it("B no puede escribir un fragmento a nombre de A (WITH CHECK)", async () => {
      const err = await runWithOrganization(B.id, () =>
        getDb().insert(schema.kbChunk).values({ id: newId("kbChunk"), organizationId: A.id, documentId: docA, ordinal: 99, content: "intruso" })
      ).then(
        () => null,
        (e: unknown) => e as { cause?: { code?: string } }
      );
      expect(err?.cause?.code).toBe("42501");
    });

    it("FK compuesta: un fragmento de B no puede colgar de un documento de A (ni como plataforma)", async () => {
      const err = await sys()
        .insert(schema.kbChunk)
        .values({ id: newId("kbChunk"), organizationId: B.id, documentId: docA, ordinal: 0, content: "intruso" })
        .then(
          () => null,
          (e: unknown) => e as { cause?: { code?: string } }
        );
      expect(err?.cause?.code).toBe("23503");
    });
  });

  it("borrar el documento borra sus fragmentos y A deja de recuperarlo", async () => {
    como(A, ownerA);
    expect((await llamar("lab/documents/[id]", "DELETE", { id: docA })).status).toBe(204);
    expect(await documento(docA)).toBeUndefined();
    const quedan = await sys().select().from(schema.kbChunk).where(eq(schema.kbChunk.documentId, docA));
    expect(quedan).toEqual([]);
    const hits = await runWithOrganization(A.id, () => retrieveChunks(A.id, TODOS, "¿el envio es gratis?"));
    expect(hits.some((x) => x.documentId === docA)).toBe(false);
  });
});

describe("límites por organización", () => {
  it("tamaño por archivo: 413 con el máximo en el mensaje", async () => {
    await limites(B, { maxFileBytes: 1000 });
    const r = await subir(B, ownerB, "grande.txt", "palabra ".repeat(500));
    expect(r.status).toBe(413);
    expect((r.data.error as { message: string }).message).toMatch(/KB/);
    await limites(B, { maxFileBytes: null });
  });

  it("documentos: con subidas a la vez, solo entran las que caben", async () => {
    await limites(B, { maxDocuments: 2 });
    como(B, ownerB);
    const rs = await Promise.all(
      [1, 2, 3, 4].map((i) => llamar("lab/documents", "POST", { form: archivo(`d${i}.txt`, `Documento número ${i} con su texto propio.`) }))
    );
    await whenIndexerIdle();
    expect(rs.filter((r) => r.status === 201)).toHaveLength(2);
    const rechazos = rs.filter((r) => r.status === 409);
    expect(rechazos).toHaveLength(2);
    expect(rechazos.every((r) => (r.data.error as { code: string }).code === "document_limit")).toBe(true);
    const [n] = await sys().select({ n: sql<number>`count(*)::int` }).from(schema.kbDocument).where(eq(schema.kbDocument.organizationId, B.id));
    expect(n?.n).toBe(2);
    await limites(B, { maxDocuments: null });
  });

  it("fragmentos: el documento que no cabe queda Falló (chunk_limit) y no deja fragmentos", async () => {
    await limites(B, { maxChunks: 3 });
    const largo = Array.from({ length: 40 }, (_, i) => `Párrafo ${i} con bastante texto para ocupar espacio en el fragmento del documento.`).join("\n\n");
    const r = await subir(B, ownerB, "largo.txt", largo);
    expect(r.status).toBe(201);
    const id = (r.data.document as { id: string }).id;
    const d = await documento(id);
    expect(d?.status).toBe("failed");
    expect(d?.errorCode).toBe("chunk_limit");
    expect(await sys().select().from(schema.kbChunk).where(eq(schema.kbChunk.documentId, id))).toEqual([]);
    await limites(B, { maxChunks: null });
  });
});

describe("sin servicio de embeddings", () => {
  it("el documento queda «solo texto» y se recupera por texto aunque la pregunta tampoco se pueda embeber", async () => {
    h.embedFalla = true;
    const r = await subir(A, ownerA, "politicas.txt", "Política de devoluciones: aceptamos cambios dentro de 15 días naturales.");
    expect(r.status).toBe(201);
    const id = (r.data.document as { id: string }).id;
    const d = await documento(id);
    expect(d?.status).toBe("ready");
    expect(d?.embeddingModel).toBeNull();
    como(A, ownerA);
    const view = await llamar("lab/documents/[id]", "GET", { id });
    expect((view.data.document as { statusLabel: string }).statusLabel).toBe("Listo (solo texto)");
    const hits = await runWithOrganization(A.id, () => retrieveChunks(A.id, TODOS, "¿aceptan devoluciones?"));
    expect(hits.map((x) => x.documentId)).toContain(id);
  });

  it("al volver el servicio, Reindexar le pone los vectores", async () => {
    const [d] = await sys()
      .select()
      .from(schema.kbDocument)
      .where(and(eq(schema.kbDocument.organizationId, A.id), eq(schema.kbDocument.filename, "politicas.txt")));
    como(A, ownerA);
    expect((await llamar("lab/documents/[id]/reindex", "POST", { id: d!.id })).status).toBe(202);
    await whenIndexerIdle();
    expect((await documento(d!.id))?.embeddingModel).toBe("intfloat/multilingual-e5-small");
  });
});

describe("el turno real del agente", () => {
  async function conversacion(org: Org, texto: string): Promise<string> {
    const db = sys();
    const contactId = newId("contact");
    const tel = `52155${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
    await db.insert(schema.contact).values({ id: contactId, organizationId: org.id, waIdentity: tel, phone: tel, name: "Cliente" });
    const [stage] = await db
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(eq(schema.pipelineStage.organizationId, org.id))
      .orderBy(asc(schema.pipelineStage.position));
    await db.insert(schema.lead).values({ id: newId("lead"), organizationId: org.id, contactId, stageId: stage!.id });
    const id = newId("conversation");
    const now = new Date();
    await db.insert(schema.conversation).values({ id, organizationId: org.id, contactId, isTest: true, aiEnabled: true, lastInboundAt: now, lastMessageAt: now });
    await db.insert(schema.message).values({
      id: newId("message"),
      organizationId: org.id,
      conversationId: id,
      direction: "in",
      type: "text",
      text: texto,
      status: "delivered",
      waTimestamp: now,
      createdAt: now,
    });
    return id;
  }

  it("A: el modelo recibe la sección de documentos con el fragmento que viene al caso", async () => {
    const id = await conversacion(A, "¿Aceptan devoluciones?");
    await runWithOrganization(A.id, () => runAgentTurn(id));
    const system = h.llamadasLlm.at(-1)?.[0]?.content ?? "";
    expect(system).toContain(DOCS_MARKER);
    expect(system).toContain("15 días naturales");
    expect(system).toMatch(/<<FIN DOC 1 · [0-9a-f]{12}>>/);
  });

  it("B (sin documentos que vengan al caso): el prompt de siempre, sin sección", async () => {
    const id = await conversacion(B, "¿Aceptan devoluciones?");
    await runWithOrganization(B.id, () => runAgentTurn(id));
    const system = h.llamadasLlm.at(-1)?.[0]?.content ?? "";
    expect(system).not.toContain(DOCS_MARKER);
    expect(system).not.toContain("15 días naturales");
    expect(system).toContain("CONOCIMIENTO DEL NEGOCIO");
  });

  it("con KB_DOCS apagado, A tampoco consulta documentos (y las rutas dan 404)", async () => {
    process.env.KB_DOCS = "";
    resetEnvCacheForTests();
    try {
      const id = await conversacion(A, "¿Aceptan devoluciones?");
      await runWithOrganization(A.id, () => runAgentTurn(id));
      expect(h.llamadasLlm.at(-1)?.[0]?.content ?? "").not.toContain(DOCS_MARKER);
      como(A, ownerA);
      expect((await llamar("lab/documents", "GET")).status).toBe(404);
    } finally {
      process.env.KB_DOCS = "on";
      resetEnvCacheForTests();
    }
  });

  it("sin el módulo Laboratorio: 404 y sin documentos en el turno", async () => {
    await modulos(A, { agent: true, lab: false });
    try {
      como(A, ownerA);
      expect((await llamar("lab/documents", "GET")).status).toBe(404);
      expect(await runWithOrganization(A.id, () => retrieveChunks(A.id, TODOS, "¿Aceptan devoluciones?"))).toEqual([]);
    } finally {
      await modulos(A, { agent: true, lab: true });
    }
  });
});
