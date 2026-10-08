import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { emptyStorageUsage } from "@/lib/usage";
import { getAllOrgsStorageUsage, getOrgStorageUsage } from "@/server/usage/storage";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 036 (PR 2) — Almacenamiento aproximado por organización, contra Postgres
 * real: la de una organización con el pool de la app (RLS) y la de todas con
 * el pool de sistema dan lo mismo; lo que no está en disco no cuenta; los
 * documentos del agente suman texto + fragmentos + 4 bytes por número del
 * vector; y una organización no ve el almacenamiento de otra.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

/** Siembra archivos de cada tipo con tamaños conocidos (como plataforma: pool de sistema). */
async function sembrar(org: string, base: number) {
  const db = getSystemDb();
  await db.insert(schema.mediaAsset).values([
    // En disco, con tamaño: cuenta.
    { id: newId("mediaAsset"), organizationId: org, kind: "image", fileSize: base, storagePath: `${org}/a`, fetchStatus: "available" },
    { id: newId("mediaAsset"), organizationId: org, kind: "audio", fileSize: base * 2, storagePath: `${org}/b`, fetchStatus: "available" },
    // Pendiente (aún no está en disco): no cuenta aunque Meta dijera su tamaño.
    { id: newId("mediaAsset"), organizationId: org, kind: "video", fileSize: 999_999, fetchStatus: "pending" },
    // En disco sin tamaño registrado: no suma, se cuenta aparte.
    { id: newId("mediaAsset"), organizationId: org, kind: "document", storagePath: `${org}/c`, fetchStatus: "available" },
    // Ubicación (sin archivo): no cuenta.
    { id: newId("mediaAsset"), organizationId: org, kind: "location", payload: { latitude: 1, longitude: 2 } },
  ]);
  await db.insert(schema.knowledgeEntry).values([
    { id: newId("knowledgeEntry"), organizationId: org, title: "Catálogo", filePath: `${org}/k`, fileName: "c.pdf", fileMime: "application/pdf", fileSize: base * 3 },
    // Solo texto: no ocupa archivo.
    { id: newId("knowledgeEntry"), organizationId: org, title: "Respuesta tipo", body: "x".repeat(5000) },
  ]);
  const hilo = newId("teamChatThread");
  await db.insert(schema.teamChatThread).values({ id: hilo, organizationId: org, kind: "group", name: "Equipo" });
  await db.insert(schema.teamChatAttachment).values({
    id: newId("teamChatAttachment"),
    organizationId: org,
    threadId: hilo,
    mimeType: "image/png",
    fileName: "f.png",
    fileSize: base * 4,
    storagePath: `team-chat/${org}/${hilo}/f`,
  });
  // Documento del agente: «Envío señal» = 11 caracteres, 13 bytes en UTF-8.
  const doc = newId("kbDocument");
  await db.insert(schema.kbDocument).values({
    id: doc,
    organizationId: org,
    title: "Precios",
    filename: "precios.md",
    mime: "text/markdown",
    byteSize: 50_000, // el archivo original (no se guarda): NO cuenta
    charCount: 11,
    contentSha256: `sha-${org}`,
    text: "Envío señal",
    status: "ready",
  });
  await db.insert(schema.kbChunk).values([
    { id: newId("kbChunk"), organizationId: org, documentId: doc, ordinal: 0, content: "Envío", embedding: [0.1, 0.2, 0.3, 0.4] },
    { id: newId("kbChunk"), organizationId: org, documentId: doc, ordinal: 1, content: "señal", embedding: null },
  ]);
}

/** Lo esperado para `sembrar(org, base)`. */
function esperado(base: number) {
  const documents = Buffer.byteLength("Envío señal") + Buffer.byteLength("Envío") + Buffer.byteLength("señal") + 4 * 4;
  const byCategory = { whatsapp: base * 3, knowledge: base * 3, teamChat: base * 4, documents };
  return {
    byCategory,
    totalBytes: byCategory.whatsapp + byCategory.knowledge + byCategory.teamChat + documents,
    filesWithoutSize: 1,
  };
}

describe("almacenamiento (aprox.) por organización", () => {
  let A: Org;
  let B: Org;
  let vacia: Org;

  beforeAll(async () => {
    A = await crearOrganizacion("Almacen A");
    B = await crearOrganizacion("Almacen B");
    vacia = await crearOrganizacion("Almacen vacia");
    await sembrar(A.id, 1000);
    await sembrar(B.id, 70_000);
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id, vacia.id]);
  });

  it("la de una organización (pool de la app): archivos en disco + documentos con su fórmula", async () => {
    expect(await as(A.id, () => getOrgStorageUsage(A.id))).toEqual(esperado(1000));
    expect(await as(B.id, () => getOrgStorageUsage(B.id))).toEqual(esperado(70_000));
  });

  it("los documentos se miden en BYTES (UTF-8), no en caracteres", () => {
    expect(esperado(0).byCategory.documents).toBe(13 + 6 + 6 + 16);
  });

  it("una organización sin archivos: todo en cero", async () => {
    expect(await as(vacia.id, () => getOrgStorageUsage(vacia.id))).toEqual(emptyStorageUsage());
  });

  it("RLS: con A en el contexto, el almacenamiento de B da cero (no se ve nada de B)", async () => {
    expect(await as(A.id, () => getOrgStorageUsage(B.id))).toEqual(emptyStorageUsage());
  });

  it("la de todas (pool de sistema) coincide con la de cada una; sin archivos, no aparece", async () => {
    const todas = await getAllOrgsStorageUsage();
    expect(todas.get(A.id)).toEqual(esperado(1000));
    expect(todas.get(B.id)).toEqual(esperado(70_000));
    expect(todas.has(vacia.id)).toBe(false);
  });

  it("solo lee: medir no cambia nada", async () => {
    const antes = await as(A.id, () => getOrgStorageUsage(A.id));
    await getAllOrgsStorageUsage();
    expect(await as(A.id, () => getOrgStorageUsage(A.id))).toEqual(antes);
  });

  it("borrar un documento del agente baja el almacenamiento (sus fragmentos se van en cascada)", async () => {
    const C = await crearOrganizacion("Almacen C");
    try {
      await sembrar(C.id, 10);
      await getSystemDb().delete(schema.kbDocument).where(eq(schema.kbDocument.organizationId, C.id));
      const u = await as(C.id, () => getOrgStorageUsage(C.id));
      expect(u.byCategory.documents).toBe(0);
      expect(u.totalBytes).toBe(esperado(10).totalBytes - esperado(10).byCategory.documents);
    } finally {
      await borrarOrganizaciones([C.id]);
    }
  });
});
