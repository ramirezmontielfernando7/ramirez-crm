import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { docScopeFor, MAX_DOC_GROUPS } from "@/lib/kb-docs";
import { runWithOrganization } from "@/lib/request-context";
import { embeddingsMock } from "@/server/dev/embeddings-mock";
import { forgetOrgModules } from "@/server/modules";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 037 (PR 1) — Grupos de documentos contra Postgres REAL, conectada como la
 * app (RLS), por las rutas de verdad:
 *
 * - General es `group_id IS NULL`: lo de antes queda ahí sin tocarlo.
 * - Crear, renombrar, mover y borrar grupos (moviendo o eliminando sus
 *   documentos); nombre único sin mayúsculas, «General» reservado, tope con
 *   altas a la vez.
 * - AISLAMIENTO: B no ve, no renombra, no borra ni sube a un grupo de A; RLS
 *   y WITH CHECK; FK compuestas hacia grupo y agente; CHECK de dueño único.
 * - La recuperación no cambia en este PR: todos leen todo lo de la empresa.
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
/** 037 — Lo de siempre: todos los documentos de la empresa (agente sin configurar). */
const TODOS = docScopeFor(null, undefined);

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
  const mod = (await import(`@/app/api/${route}/route`)) as Record<string, Handler>;
  const body = opts.form ?? (opts.json === undefined ? undefined : JSON.stringify(opts.json));
  const headers = opts.json === undefined ? undefined : { "content-type": "application/json" };
  const res = await mod[method]!(
    new Request(`http://localhost/api/${route}${opts.query ? `?${opts.query}` : ""}`, { method, body, headers }),
    { params: Promise.resolve({ id: opts.id ?? "" }) }
  );
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function subir(org: Org, user: string, nombre: string, contenido: string, groupId?: string) {
  como(org, user);
  const form = new FormData();
  form.append("file", new File([contenido], nombre, { type: "text/plain" }));
  if (groupId) form.append("groupId", groupId);
  const r = await llamar("lab/documents", "POST", { form });
  await whenIndexerIdle();
  return r;
}

async function crearGrupo(org: Org, user: string, name: string) {
  como(org, user);
  return llamar("lab/document-groups", "POST", { json: { name } });
}

async function documento(id: string) {
  const [d] = await sys().select().from(schema.kbDocument).where(eq(schema.kbDocument.id, id));
  return d;
}

async function persona(orgId: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name: "Dueño", email: `${id}@grupos.test`, emailVerified: true });
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

const err = (e: unknown) => e as { cause?: { code?: string }; code?: string };
const codigo = (e: { cause?: { code?: string }; code?: string } | null) => e?.cause?.code ?? e?.code;

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

  A = await crearOrganizacion("Grupos A");
  B = await crearOrganizacion("Grupos B");
  await modulos(A);
  await modulos(B);
  ownerA = await persona(A.id);
  ownerB = await persona(B.id);
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

describe("General y los grupos", () => {
  let antiguo: string;
  let ventas: string;
  let enVentas: string;

  it("sin grupos: solo General, y lo que se sube sin grupo queda ahí (group_id NULL)", async () => {
    const r = await subir(A, ownerA, "envios.md", "El envío es gratis en compras desde $1,234 pesos.");
    expect(r.status).toBe(201);
    antiguo = (r.data.document as { id: string }).id;
    expect((await documento(antiguo))?.groupId).toBeNull();
    como(A, ownerA);
    const g = await llamar("lab/document-groups", "GET");
    expect(g.status).toBe(200);
    expect(g.data.groups).toEqual([{ id: null, name: "General", documents: 1, agents: 0 }]);
  });

  it("crear Ventas; repetido (sin importar mayúsculas) 409; «General» 422; vacío 422", async () => {
    const r = await crearGrupo(A, ownerA, "  Ventas ");
    expect(r.status).toBe(201);
    ventas = (r.data.group as { id: string }).id;
    expect(ventas).toMatch(/^kdg_/);
    expect((await crearGrupo(A, ownerA, "VENTAS")).status).toBe(409);
    const reservado = await crearGrupo(A, ownerA, "general");
    expect(reservado.status).toBe(422);
    expect((reservado.data.error as { code: string }).code).toBe("group_name_reserved");
    expect((await crearGrupo(A, ownerA, "   ")).status).toBe(422);
  });

  it("subir a Ventas; ?group= filtra; sin group, todos los de la empresa", async () => {
    const r = await subir(A, ownerA, "precios.md", "La lista de precios: el taladro cuesta $4,321 pesos.", ventas);
    expect(r.status).toBe(201);
    enVentas = (r.data.document as { id: string; groupId: string }).id;
    expect((r.data.document as { groupId: string }).groupId).toBe(ventas);
    como(A, ownerA);
    const soloVentas = await llamar("lab/documents", "GET", { query: `group=${ventas}` });
    expect((soloVentas.data.documents as { id: string }[]).map((d) => d.id)).toEqual([enVentas]);
    const general = await llamar("lab/documents", "GET", { query: "group=general" });
    expect((general.data.documents as { id: string }[]).map((d) => d.id)).toEqual([antiguo]);
    const todos = await llamar("lab/documents", "GET");
    expect((todos.data.documents as { id: string }[]).map((d) => d.id).sort()).toEqual([antiguo, enVentas].sort());
    // El uso cuenta todo.
    expect(todos.data.usage).toMatchObject({ documents: 2 });
  });

  it("el mismo contenido otra vez: 409 que dice en qué grupo está", async () => {
    const r = await subir(A, ownerA, "otra-vez.md", "La lista de precios: el taladro cuesta $4,321 pesos.");
    expect(r.status).toBe(409);
    expect(r.data.error).toMatchObject({ code: "duplicate" });
    expect((r.data.error as { message: string }).message).toContain("«Ventas»");
  });

  it("subir a un grupo que no existe: 404 group_not_found y nada se crea", async () => {
    const r = await subir(A, ownerA, "nuevo.md", "Contenido nuevo que no debe quedar.", "kdg_noexiste");
    expect(r.status).toBe(404);
    expect(r.data.error).toMatchObject({ code: "group_not_found" });
    como(A, ownerA);
    expect(((await llamar("lab/documents", "GET")).data.usage as { documents: number }).documents).toBe(2);
  });

  it("la recuperación no cambia en este PR: encuentra lo de General y lo de Ventas", async () => {
    const enviar = await runWithOrganization(A.id, () => retrieveChunks(A.id, TODOS, "¿el envio es gratis?"));
    expect(enviar.some((x) => x.documentId === antiguo)).toBe(true);
    const precio = await runWithOrganization(A.id, () => retrieveChunks(A.id, TODOS, "¿cuánto cuesta el taladro?"));
    expect(precio.some((x) => x.documentId === enVentas)).toBe(true);
  });

  it("mover: a General y de vuelta; a un grupo que no existe 404; un documento que no existe 404", async () => {
    como(A, ownerA);
    const a = await llamar("lab/documents/[id]", "PATCH", { id: enVentas, json: { groupId: "general" } });
    expect(a.status).toBe(200);
    expect((await documento(enVentas))?.groupId).toBeNull();
    const b = await llamar("lab/documents/[id]", "PATCH", { id: enVentas, json: { groupId: ventas } });
    expect(b.status).toBe(200);
    expect((await documento(enVentas))?.groupId).toBe(ventas);
    expect((await llamar("lab/documents/[id]", "PATCH", { id: enVentas, json: { groupId: "kdg_noexiste" } })).status).toBe(404);
    expect((await documento(enVentas))?.groupId).toBe(ventas);
    expect((await llamar("lab/documents/[id]", "PATCH", { id: "kbd_noexiste", json: { groupId: null } })).status).toBe(404);
  });

  it("renombrar; a un nombre ya usado 409; a «General» 422", async () => {
    const otro = await crearGrupo(A, ownerA, "Dirección");
    const direccion = (otro.data.group as { id: string }).id;
    como(A, ownerA);
    const r = await llamar("lab/document-groups/[id]", "PATCH", { id: ventas, json: { name: "Ventas y cobranza" } });
    expect(r.status).toBe(200);
    expect((r.data.group as { name: string }).name).toBe("Ventas y cobranza");
    expect((await llamar("lab/document-groups/[id]", "PATCH", { id: direccion, json: { name: "ventas Y cobranza" } })).status).toBe(409);
    expect((await llamar("lab/document-groups/[id]", "PATCH", { id: direccion, json: { name: "General" } })).status).toBe(422);
    expect((await llamar("lab/document-groups/[id]", "PATCH", { id: "kdg_noexiste", json: { name: "Otro" } })).status).toBe(404);
    const g = await llamar("lab/document-groups", "GET");
    expect(g.data.groups).toEqual([
      { id: null, name: "General", documents: 1, agents: 0 },
      { id: ventas, name: "Ventas y cobranza", documents: 1, agents: 0 },
      { id: direccion, name: "Dirección", documents: 0, agents: 0 },
    ]);
  });

  describe("AISLAMIENTO entre organizaciones", () => {
    it("B solo ve su General; no renombra, no borra, no mueve a ni sube a un grupo de A", async () => {
      como(B, ownerB);
      const g = await llamar("lab/document-groups", "GET");
      expect(g.data.groups).toEqual([{ id: null, name: "General", documents: 0, agents: 0 }]);
      expect((await llamar("lab/document-groups/[id]", "PATCH", { id: ventas, json: { name: "Mío" } })).status).toBe(404);
      expect((await llamar("lab/document-groups/[id]", "DELETE", { id: ventas })).status).toBe(404);
      expect((await llamar("lab/documents/[id]", "PATCH", { id: enVentas, json: { groupId: null } })).status).toBe(404);
      const r = await subir(B, ownerB, "b.md", "Documento de la organización B.", ventas);
      expect(r.status).toBe(404);
      expect((await documento(enVentas))?.groupId).toBe(ventas);
      const [grupo] = await sys().select().from(schema.kbDocumentGroup).where(eq(schema.kbDocumentGroup.id, ventas));
      expect(grupo?.name).toBe("Ventas y cobranza");
    });

    it("B tiene su propio «Ventas» (el nombre es único por organización)", async () => {
      expect((await crearGrupo(B, ownerB, "Ventas")).status).toBe(201);
    });

    it("RLS: con B en el contexto no existe ningún grupo de A; sin organización, cero filas", async () => {
      const vistos = await runWithOrganization(B.id, () =>
        getDb().execute<{ n: number }>(sql`select count(*)::int as n from kb_document_group where organization_id = ${A.id}`)
      );
      expect(vistos[0]?.n).toBe(0);
      const { getSql } = await import("@/lib/db");
      const [sinOrg] = await getSql()<{ n: number }[]>`select count(*)::int as n from kb_document_group`;
      expect(sinOrg?.n).toBe(0);
    });

    it("B no puede crear un grupo a nombre de A (WITH CHECK)", async () => {
      const e = await runWithOrganization(B.id, () =>
        getDb().insert(schema.kbDocumentGroup).values({ id: newId("kbDocumentGroup"), organizationId: A.id, name: "Intruso" })
      ).then(() => null, err);
      expect(codigo(e)).toBe("42501");
    });

    it("FK compuestas: un documento de B no cuelga de un grupo ni de un agente de A (ni como plataforma)", async () => {
      const agenteA = newId("agent");
      await sys().insert(schema.agent).values({ id: agenteA, organizationId: A.id, internalName: "Ventas", draft: {} });
      const [docB] = await sys().select({ id: schema.kbDocument.id }).from(schema.kbDocument).where(eq(schema.kbDocument.organizationId, B.id));
      expect(docB).toBeUndefined();
      const base = {
        organizationId: B.id,
        title: "Intruso",
        filename: "x.md",
        mime: "text/markdown" as const,
        byteSize: 1,
        charCount: 1,
        text: "x",
      };
      const conGrupo = await sys()
        .insert(schema.kbDocument)
        .values({ ...base, id: newId("kbDocument"), contentSha256: "sha-1", groupId: ventas })
        .then(() => null, err);
      expect(codigo(conGrupo)).toBe("23503");
      const conAgente = await sys()
        .insert(schema.kbDocument)
        .values({ ...base, id: newId("kbDocument"), contentSha256: "sha-2", agentId: agenteA })
        .then(() => null, err);
      expect(codigo(conAgente)).toBe("23503");
    });

    it("CHECK: un documento no puede ser de un grupo y exclusivo a la vez", async () => {
      const agenteA = newId("agent");
      await sys().insert(schema.agent).values({ id: agenteA, organizationId: A.id, internalName: "Otro", draft: {} });
      const e = await sys()
        .insert(schema.kbDocument)
        .values({
          id: newId("kbDocument"),
          organizationId: A.id,
          title: "Ambos",
          filename: "x.md",
          mime: "text/markdown",
          byteSize: 1,
          charCount: 1,
          text: "x",
          contentSha256: "sha-ambos",
          groupId: ventas,
          agentId: agenteA,
        })
        .then(() => null, err);
      expect(codigo(e)).toBe("23514");
    });
  });

  it("eliminar moviendo (por defecto): sus documentos pasan a General con sus fragmentos, y se siguen recuperando", async () => {
    const chunksAntes = await sys().select().from(schema.kbChunk).where(eq(schema.kbChunk.documentId, enVentas));
    expect(chunksAntes.length).toBeGreaterThan(0);
    como(A, ownerA);
    const r = await llamar("lab/document-groups/[id]", "DELETE", { id: ventas });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ deleted: true, documents: 1, mode: "move" });
    const d = await documento(enVentas);
    expect(d?.groupId).toBeNull();
    expect(d?.organizationId).toBe(A.id);
    const chunksDespues = await sys().select().from(schema.kbChunk).where(eq(schema.kbChunk.documentId, enVentas));
    expect(chunksDespues.length).toBe(chunksAntes.length);
    const precio = await runWithOrganization(A.id, () => retrieveChunks(A.id, TODOS, "¿cuánto cuesta el taladro?"));
    expect(precio.some((x) => x.documentId === enVentas)).toBe(true);
    expect((await llamar("lab/document-groups/[id]", "DELETE", { id: ventas })).status).toBe(404);
  });

  it("eliminar con sus documentos: se borran (y sus fragmentos); los de otros grupos no", async () => {
    const r1 = await crearGrupo(A, ownerA, "Temporal");
    const temporal = (r1.data.group as { id: string }).id;
    const up = await subir(A, ownerA, "temporal.md", "Las vacaciones de verano empiezan el 15 de julio.", temporal);
    const doc = (up.data.document as { id: string }).id;
    como(A, ownerA);
    const r = await llamar("lab/document-groups/[id]", "DELETE", { id: temporal, query: "documents=delete" });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ documents: 1, mode: "delete" });
    expect(await documento(doc)).toBeUndefined();
    expect(await sys().select().from(schema.kbChunk).where(eq(schema.kbChunk.documentId, doc))).toEqual([]);
    expect(await documento(antiguo)).toBeDefined();
    expect(await documento(enVentas)).toBeDefined();
  });

  it("en la BD, borrar el grupo directo deja el documento en General (SET NULL solo de group_id)", async () => {
    const r1 = await crearGrupo(A, ownerA, "Directo");
    const directo = (r1.data.group as { id: string }).id;
    como(A, ownerA);
    expect((await llamar("lab/documents/[id]", "PATCH", { id: antiguo, json: { groupId: directo } })).status).toBe(200);
    await sys().delete(schema.kbDocumentGroup).where(eq(schema.kbDocumentGroup.id, directo));
    const d = await documento(antiguo);
    expect(d?.groupId).toBeNull();
    expect(d?.organizationId).toBe(A.id);
  });

  it(`tope de ${MAX_DOC_GROUPS} grupos: con altas a la vez, solo entran las que caben`, async () => {
    const org = await crearOrganizacion("Grupos tope");
    await modulos(org);
    const owner = await persona(org.id);
    try {
      for (let i = 0; i < MAX_DOC_GROUPS - 2; i++) expect((await crearGrupo(org, owner, `Grupo ${i}`)).status).toBe(201);
      como(org, owner);
      const mod = (await import("@/app/api/lab/document-groups/route")) as unknown as Record<string, Handler>;
      const intentos = await Promise.all(
        [0, 1, 2, 3, 4].map((i) =>
          mod.POST!(
            new Request("http://localhost/api/lab/document-groups", {
              method: "POST",
              body: JSON.stringify({ name: `Simultáneo ${i}` }),
              headers: { "content-type": "application/json" },
            }),
            { params: Promise.resolve({}) }
          ).then((r) => r.status)
        )
      );
      expect(intentos.filter((s) => s === 201)).toHaveLength(2);
      expect(intentos.filter((s) => s === 409)).toHaveLength(3);
      const [n] = await sys()
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.kbDocumentGroup)
        .where(eq(schema.kbDocumentGroup.organizationId, org.id));
      expect(n?.n).toBe(MAX_DOC_GROUPS);
    } finally {
      await borrarOrganizaciones([org.id]);
    }
  });
});

describe("permisos y módulos", () => {
  it("el Asesor: 403 al listar, crear, renombrar, borrar y mover", async () => {
    const asesor = newId("user");
    await sys().insert(schema.user).values({ id: asesor, name: "Asesor", email: `${asesor}@grupos.test`, emailVerified: true });
    await sys().insert(schema.member).values({ id: newId("member"), organizationId: A.id, userId: asesor, role: "asesor" });
    h.session = { userId: asesor, organizationId: A.id, role: "asesor", access: { organizationId: A.id, userId: asesor, seesAll: false } };
    expect((await llamar("lab/document-groups", "GET")).status).toBe(403);
    expect((await llamar("lab/document-groups", "POST", { json: { name: "X" } })).status).toBe(403);
    expect((await llamar("lab/document-groups/[id]", "PATCH", { id: "kdg_x", json: { name: "X" } })).status).toBe(403);
    expect((await llamar("lab/document-groups/[id]", "DELETE", { id: "kdg_x" })).status).toBe(403);
    expect((await llamar("lab/documents/[id]", "PATCH", { id: "kbd_x", json: { groupId: null } })).status).toBe(403);
  });

  it("con KB_DOCS apagado, las rutas de grupos dan 404", async () => {
    process.env.KB_DOCS = "";
    resetEnvCacheForTests();
    try {
      como(A, ownerA);
      expect((await llamar("lab/document-groups", "GET")).status).toBe(404);
      expect((await llamar("lab/document-groups", "POST", { json: { name: "X" } })).status).toBe(404);
    } finally {
      process.env.KB_DOCS = "on";
      resetEnvCacheForTests();
    }
  });
});
