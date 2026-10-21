import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { forgetOrgModules } from "@/server/modules";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 040 — Biblioteca unificada contra Postgres REAL, por las rutas de verdad y
 * conectada como la app (RLS): UN archivo, DOS destinos.
 *
 * - Subir en Estudio de IA → Documentos con «Disponible en Bandeja»: aparece
 *   en el selector de la Bandeja (`GET /api/knowledge`, el `KnowledgePicker`)
 *   Y genera sus fragmentos `kb_chunk` para el agente, sin subirlo dos veces.
 * - Subir en la Biblioteca con «Entrenar también al Agente»: lo mismo al revés.
 * - Encender y apagar cada destino desde la tarjeta, sin volver a subir; un
 *   destino al menos; borrar uno deja el otro (SET NULL de la FK).
 * - AISLAMIENTO: otra organización no ve, no cambia ni ata nada de A.
 * - Sin el módulo Biblioteca, «Disponible en Bandeja» es 403.
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

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
let A: Org;
let B: Org;
let ownerA: string;
let ownerB: string;
let mediaDir: string;
const sys = () => getSystemDb();

function como(org: Org, userId: string, role = "owner") {
  h.session = { userId, organizationId: org.id, role, access: { organizationId: org.id, userId, seesAll: role !== "asesor" } };
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function llamar(
  route: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  opts: { id?: string; form?: FormData; json?: unknown; query?: string } = {}
): Promise<{ status: number; data: Record<string, unknown> }> {
  const mod = (await import(`@/app/api/${route}/route`)) as Record<string, Handler>;
  const body = opts.form ?? (opts.json === undefined ? undefined : JSON.stringify(opts.json));
  const res = await mod[method]!(
    new Request(`http://localhost/api/${route}${opts.query ?? ""}`, {
      method,
      body,
      headers: opts.json === undefined ? undefined : { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: opts.id ?? "" }) }
  );
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function archivo(nombre: string, contenido: string, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.append("file", new File([contenido], nombre, { type: "text/plain" }));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
}

async function persona(orgId: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name: "Dueña", email: `${id}@biblioteca.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role: "owner" });
  return id;
}

async function modulos(org: Org, set: { knowledge: boolean }) {
  const values = { agent: true, lab: true, agenda: false, ...set };
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: org.id, ...values })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: values });
  forgetOrgModules(org.id);
}

/** Lo que ve el selector de la Bandeja (`KnowledgePicker`): `GET /api/knowledge` sin más. */
async function picker(org: Org, user: string): Promise<{ id: string; title: string }[]> {
  como(org, user);
  const r = await llamar("knowledge", "GET");
  expect(r.status).toBe(200);
  return r.data.entries as { id: string; title: string }[];
}

async function doc(id: string) {
  const [d] = await sys().select().from(schema.kbDocument).where(eq(schema.kbDocument.id, id));
  return d;
}

async function entrada(id: string) {
  const [e] = await sys().select().from(schema.knowledgeEntry).where(eq(schema.knowledgeEntry.id, id));
  return e;
}

async function fragmentos(documentId: string): Promise<number> {
  const [r] = await sys()
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.kbChunk)
    .where(eq(schema.kbChunk.documentId, documentId));
  return r?.n ?? 0;
}

const CATALOGO = [
  "# Catálogo de primavera",
  "La mochila escolar cuesta $450 pesos y tiene garantía de un año.",
  "El estuche de colores cuesta $120 pesos.",
].join("\n\n");
const PLAN = ["Plan de estudios 2027", "Primer semestre: álgebra, química y redacción.", "Segundo semestre: cálculo y física."].join("\n\n");

beforeAll(async () => {
  mediaDir = mkdtempSync(path.join(tmpdir(), "vocero-biblioteca-"));
  process.env.MEDIA_DIR = mediaDir;
  process.env.KB_DOCS = "on";
  // Sin servicio de embeddings: «solo texto» (los fragmentos se crean igual).
  delete process.env.EMBEDDINGS_BASE_URL;
  resetEnvCacheForTests();
  A = await crearOrganizacion("Biblio A");
  B = await crearOrganizacion("Biblio B");
  await modulos(A, { knowledge: true });
  await modulos(B, { knowledge: true });
  ownerA = await persona(A.id);
  ownerB = await persona(B.id);
});

afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
  rmSync(mediaDir, { recursive: true, force: true });
  delete process.env.MEDIA_DIR;
  delete process.env.KB_DOCS;
  resetEnvCacheForTests();
});

describe("040 — desde Documentos: «Disponible en Bandeja»", () => {
  let docId: string;
  let entryId: string;

  it("un solo archivo: aparece en el selector de la Bandeja Y genera sus fragmentos para el agente", async () => {
    como(A, ownerA);
    const r = await llamar("lab/documents", "POST", { form: archivo("catalogo.md", CATALOGO, { chat: "true" }) });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    docId = (r.data.document as { id: string }).id;
    await whenIndexerIdle();
    const d = await doc(docId);
    expect(d?.status).toBe("ready");
    expect(d?.knowledgeEntryId).toBeTruthy();
    entryId = d!.knowledgeEntryId!;
    expect(await fragmentos(docId)).toBeGreaterThan(0);
    const e = await entrada(entryId);
    expect(e).toMatchObject({ organizationId: A.id, showInChat: true, fileName: "catalogo.md", fileMime: "text/plain" });
    expect((await picker(A, ownerA)).map((x) => x.id)).toContain(entryId);
    // La lista de Documentos lo dice.
    como(A, ownerA);
    const lista = await llamar("lab/documents", "GET");
    expect((lista.data.documents as { id: string; inChat: boolean }[]).find((x) => x.id === docId)?.inChat).toBe(true);
    expect(lista.data.library).toEqual({ chat: true });
  });

  it("apagar «Envío en chat» desde la tarjeta lo saca de la Bandeja (y no se puede enviar) sin tocar a la IA; encenderlo no pide subirlo", async () => {
    como(A, ownerA);
    const off = await llamar("lab/documents/[id]", "PATCH", { id: docId, json: { chat: false } });
    expect(off.status, JSON.stringify(off.data)).toBe(200);
    expect((await picker(A, ownerA)).map((x) => x.id)).not.toContain(entryId);
    expect((await entrada(entryId))?.filePath).toBeTruthy();
    const { getKnowledgeForChat } = await import("@/server/knowledge/store");
    expect(await withTenantRead(A.id, () => getKnowledgeForChat(A.id, entryId))).toBeNull();
    expect(await fragmentos(docId)).toBeGreaterThan(0);
    // La Biblioteca (quien administra) sí lo ve, con su «Lectura IA».
    como(A, ownerA);
    const lib = await llamar("knowledge", "GET", { query: "?scope=library" });
    const enLib = (lib.data.entries as { id: string; showInChat: boolean; rag: { documentId: string } | null }[]).find((x) => x.id === entryId);
    expect(enLib).toMatchObject({ showInChat: false, rag: { documentId: docId } });
    // Un Asesor, en cambio, solo ve lo que se envía.
    como(A, ownerA, "asesor");
    const asesor = await llamar("knowledge", "GET", { query: "?scope=library" });
    expect((asesor.data.entries as { id: string }[]).map((x) => x.id)).not.toContain(entryId);

    como(A, ownerA);
    expect((await llamar("lab/documents/[id]", "PATCH", { id: docId, json: { chat: true } })).status).toBe(200);
    expect((await picker(A, ownerA)).map((x) => x.id)).toContain(entryId);
  });

  it("sin «Disponible en Bandeja», el documento es solo IA y no se puede mandar al chat sin volver a subirlo (409)", async () => {
    como(A, ownerA);
    const r = await llamar("lab/documents", "POST", { form: archivo("solo-ia.txt", "Política interna de devoluciones: 30 días con ticket.") });
    expect(r.status).toBe(201);
    const id = (r.data.document as { id: string }).id;
    await whenIndexerIdle();
    expect((await doc(id))?.knowledgeEntryId).toBeNull();
    const on = await llamar("lab/documents/[id]", "PATCH", { id, json: { chat: true } });
    expect(on.status).toBe(409);
    expect((on.data.error as { code: string }).code).toBe("no_original");
  });

  it("borrar el documento con su original oculto borra también el original (no queda un huérfano)", async () => {
    como(A, ownerA);
    const r = await llamar("lab/documents", "POST", { form: archivo("temporal.txt", "Promoción de verano: 2x1 en cuadernos.", { chat: "true" }) });
    const id = (r.data.document as { id: string }).id;
    await whenIndexerIdle();
    const entry = (await doc(id))!.knowledgeEntryId!;
    await llamar("lab/documents/[id]", "PATCH", { id, json: { chat: false } });
    expect((await llamar("lab/documents/[id]", "DELETE", { id })).status).toBe(204);
    expect(await doc(id)).toBeUndefined();
    expect(await entrada(entry)).toBeUndefined();
  });

  it("sin el módulo Biblioteca, «Disponible en Bandeja» es 403 y no se crea nada", async () => {
    await modulos(B, { knowledge: false });
    como(B, ownerB);
    const r = await llamar("lab/documents", "POST", { form: archivo("b.txt", "Texto de B que no llega.", { chat: "true" }) });
    expect(r.status).toBe(403);
    const [n] = await sys().select({ n: sql<number>`count(*)::int` }).from(schema.kbDocument).where(eq(schema.kbDocument.organizationId, B.id));
    expect(n?.n).toBe(0);
    await modulos(B, { knowledge: true });
  });
});

describe("040 — desde la Biblioteca: «Entrenar también al Agente de IA»", () => {
  let entryId: string;

  it("crear con rag=true: la entrada va a la Bandeja Y el agente la lee (fragmentos), por la puerta oficial", async () => {
    como(A, ownerA);
    const r = await llamar("knowledge", "POST", { form: archivo("plan-de-estudios.txt", PLAN, { title: "Plan de estudios", rag: "true" }) });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect(r.data.ragError).toBeNull();
    const dto = r.data.entry as { id: string; showInChat: boolean; rag: { documentId: string } | null };
    entryId = dto.id;
    expect(dto.showInChat).toBe(true);
    expect(dto.rag?.documentId).toBeTruthy();
    await whenIndexerIdle();
    const d = await doc(dto.rag!.documentId);
    expect(d).toMatchObject({ knowledgeEntryId: entryId, status: "ready", groupId: null, organizationId: A.id });
    expect(await fragmentos(d!.id)).toBeGreaterThan(0);
    expect((await picker(A, ownerA)).map((x) => x.id)).toContain(entryId);
  });

  it("apagar y encender «Lectura IA» desde la tarjeta, sin volver a subir; un destino al menos", async () => {
    como(A, ownerA);
    const off = await llamar("knowledge/[id]/destinations", "PATCH", { id: entryId, json: { rag: false } });
    expect(off.status, JSON.stringify(off.data)).toBe(200);
    expect((off.data.entry as { rag: unknown }).rag).toBeNull();
    const [n] = await sys().select({ n: sql<number>`count(*)::int` }).from(schema.kbDocument).where(eq(schema.kbDocument.knowledgeEntryId, entryId));
    expect(n?.n).toBe(0);
    // Solo le queda el chat: apagarlo es 422.
    const ultimo = await llamar("knowledge/[id]/destinations", "PATCH", { id: entryId, json: { chat: false } });
    expect(ultimo.status).toBe(422);
    expect((ultimo.data.error as { code: string }).code).toBe("last_destination");
    expect((await llamar("knowledge/[id]/destinations", "PATCH", { id: entryId, json: { chat: false, rag: false } })).status).toBe(422);
    // Encender de nuevo vuelve a leer el archivo guardado.
    const on = await llamar("knowledge/[id]/destinations", "PATCH", { id: entryId, json: { rag: true } });
    expect(on.status, JSON.stringify(on.data)).toBe(200);
    await whenIndexerIdle();
    const docId = (on.data.entry as { rag: { documentId: string } }).rag.documentId;
    expect(await fragmentos(docId)).toBeGreaterThan(0);
  });

  it("el mismo texto que ya lee la IA: la entrada se queda y la respuesta dice por qué no (duplicado)", async () => {
    como(A, ownerA);
    const r = await llamar("knowledge", "POST", { form: archivo("copia.md", CATALOGO, { title: "Copia del catálogo", rag: "true" }) });
    expect(r.status).toBe(201);
    expect((r.data.ragError as { code: string }).code).toBe("duplicate");
    expect((r.data.entry as { rag: unknown }).rag).toBeNull();
  });

  it("044 — un archivo más grande que el tope de Documentos: la entrada se queda y la IA no lo abre (too_large)", async () => {
    await sys()
      .insert(schema.kbDocumentLimit)
      .values({ organizationId: A.id, maxFileBytes: 1024 })
      .onConflictDoUpdate({ target: [schema.kbDocumentLimit.organizationId], set: { maxFileBytes: 1024 } });
    como(A, ownerA);
    const grande = `Lista de precios 044.\n${"Tornillo de media pulgada a 3 pesos. ".repeat(80)}`;
    const r = await llamar("knowledge", "POST", { form: archivo("precios-044.md", grande, { title: "Precios grandes", rag: "true" }) });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    expect(r.data.ragError).toMatchObject({ code: "too_large" });
    expect((r.data.ragError as { message: string }).message).toMatch(/hasta 1 KB/);
    expect((r.data.entry as { rag: unknown; showInChat: boolean })).toMatchObject({ rag: null, showInChat: true });
    await sys().update(schema.kbDocumentLimit).set({ maxFileBytes: null }).where(eq(schema.kbDocumentLimit.organizationId, A.id));
  });

  it("044 — la Biblioteca rechaza HTML y SVG (415) sin guardar nada", async () => {
    como(A, ownerA);
    const antes = await sys().select({ n: sql<number>`count(*)::int` }).from(schema.knowledgeEntry).where(eq(schema.knowledgeEntry.organizationId, A.id));
    const r = await llamar("knowledge", "POST", { form: archivo("pagina.html", "<script>alert(1)</script>", { title: "Página" }) });
    expect(r.status).toBe(415);
    expect((r.data.error as { message: string }).message).toMatch(/SVG ni HTML/);
    const despues = await sys().select({ n: sql<number>`count(*)::int` }).from(schema.knowledgeEntry).where(eq(schema.knowledgeEntry.organizationId, A.id));
    expect(despues[0]?.n).toBe(antes[0]?.n);
  });

  it("una entrada solo de texto también entrena al agente (título + contenido)", async () => {
    como(A, ownerA);
    const r = await llamar("knowledge", "POST", {
      json: { title: "Horario", body: "Abrimos de lunes a viernes de 9 a 18 horas.", rag: true },
    });
    expect(r.status, JSON.stringify(r.data)).toBe(201);
    const id = (r.data.entry as { rag: { documentId: string } }).rag.documentId;
    expect((await doc(id))?.text).toContain("lunes a viernes");
  });

  it("borrar la entrada deja el documento como «solo IA» (ON DELETE SET NULL)", async () => {
    como(A, ownerA);
    const lib = await llamar("knowledge", "GET", { query: "?scope=library" });
    const e = (lib.data.entries as { id: string; rag: { documentId: string } | null }[]).find((x) => x.id === entryId)!;
    expect((await llamar("knowledge/[id]", "DELETE", { id: entryId })).status).toBe(204);
    const d = await doc(e.rag!.documentId);
    expect(d).toBeDefined();
    expect(d?.knowledgeEntryId).toBeNull();
  });

  it("un Asesor no puede entrenar al agente desde la Biblioteca (403)", async () => {
    como(A, ownerA, "asesor");
    expect((await llamar("knowledge", "POST", { json: { title: "x", body: "y", rag: true } })).status).toBe(403);
  });
});

describe("040 — AISLAMIENTO", () => {
  it("B no ve las entradas de A ni cambia sus destinos (404)", async () => {
    como(A, ownerA);
    const lib = await llamar("knowledge", "GET", { query: "?scope=library" });
    const deA = (lib.data.entries as { id: string }[])[0]!.id;
    expect((await picker(B, ownerB)).map((x) => x.id)).not.toContain(deA);
    como(B, ownerB);
    expect((await llamar("knowledge/[id]/destinations", "PATCH", { id: deA, json: { rag: true } })).status).toBe(404);
  });

  it("un documento de B no puede atarse a una entrada de A (FK compuesta) y sin organización no se ve nada (RLS)", async () => {
    const [deA] = await sys().select({ id: schema.knowledgeEntry.id }).from(schema.knowledgeEntry).where(eq(schema.knowledgeEntry.organizationId, A.id)).limit(1);
    await expect(
      sys().insert(schema.kbDocument).values({
        id: newId("kbDocument"),
        organizationId: B.id,
        title: "Intruso",
        filename: "x.txt",
        mime: "text/plain",
        byteSize: 1,
        charCount: 1,
        contentSha256: `sha-${Math.random()}`,
        text: "x",
        knowledgeEntryId: deA!.id,
      })
    ).rejects.toThrow();
    const desdeB = await withTenant(B.id, (tx) => tx.select().from(schema.knowledgeEntry).where(eq(schema.knowledgeEntry.organizationId, A.id)));
    expect(desdeB).toEqual([]);
  });
});

/** Lee a nombre de la organización (pool de la app, RLS). */
async function withTenantRead<T>(organizationId: string, fn: () => Promise<T>): Promise<T> {
  const { runWithOrganization } = await import("@/lib/request-context");
  return runWithOrganization(organizationId, fn);
}
