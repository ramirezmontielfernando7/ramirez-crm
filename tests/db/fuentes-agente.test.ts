import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { docScopeFor, lexicalQuery, type DocSources } from "@/lib/kb-docs";
import { runWithOrganization } from "@/lib/request-context";
import { embeddingsMock } from "@/server/dev/embeddings-mock";
import { forgetOrgModules } from "@/server/modules";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 037 (PR 2) — Cada agente recupera SOLO de sus fuentes, contra Postgres REAL
 * conectada como la app (RLS):
 *
 * - Matriz: todos / solo Ventas / solo General / sin grupos; un exclusivo de
 *   otro agente jamás aparece. Por texto Y por vectores (la caché de vectores
 *   es de toda la organización: el filtro por turno es lo que se prueba).
 * - Sin configurar nada: idéntico a antes de 037.
 * - El turno: el agente de la etapa usa SUS fuentes; el Laboratorio usa las
 *   del snapshot aunque el agente cambie después; la vista previa, las del
 *   formulario sin guardar.
 * - Guardar un grupo que no existe (o de otra organización) → 422; publicar
 *   quita los grupos que ya no existen.
 */

const h = vi.hoisted(() => ({
  session: null as null | {
    userId: string;
    organizationId: string;
    role: string;
    access: { organizationId: string; userId: string; seesAll: boolean };
  },
  llamadasLlm: [] as { role: string; content: string }[][],
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
const { retrieveChunks, forgetKbVectorCache, vectorCandidatesForTests } = await import("@/server/kb-docs/retrieve");
const { runAgentTurn } = await import("@/server/ai/pipeline");
const { runPreview } = await import("@/server/agents/preview");
const { buildRunSnapshot } = await import("@/server/agents/snapshot");
const agents = await import("@/server/agents/store");
const { assignStage } = await import("@/server/agents/assignments");
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
  method: "GET" | "POST" | "PUT",
  opts: { id?: string; form?: FormData; json?: unknown } = {}
): Promise<{ status: number; data: Record<string, unknown> }> {
  const mod = (await import(`@/app/api/${route}/route`)) as Record<string, Handler>;
  const body = opts.form ?? (opts.json === undefined ? undefined : JSON.stringify(opts.json));
  const headers = opts.json === undefined ? undefined : { "content-type": "application/json" };
  const res = await mod[method]!(new Request(`http://localhost/api/${route}`, { method, body, headers }), {
    params: Promise.resolve({ id: opts.id ?? "" }),
  });
  const text = await res.text();
  return { status: res.status, data: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

async function subir(org: Org, user: string, nombre: string, contenido: string, groupId?: string): Promise<string> {
  como(org, user);
  const form = new FormData();
  form.append("file", new File([contenido], nombre, { type: "text/plain" }));
  if (groupId) form.append("groupId", groupId);
  const r = await llamar("lab/documents", "POST", { form });
  expect(r.status, JSON.stringify(r.data)).toBe(201);
  await whenIndexerIdle();
  return (r.data.document as { id: string }).id;
}

async function persona(orgId: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name: "Dueño", email: `${id}@fuentes.test`, emailVerified: true });
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

/** Un agente publicado con estas fuentes. */
async function agente(nombre: string, docSources: DocSources): Promise<string> {
  const a = await runWithOrganization(A.id, () => agents.createAgent({ organizationId: A.id, actorUserId: ownerA, internalName: nombre }));
  await runWithOrganization(A.id, () => agents.saveDraft(A.id, a.id, { ...a.draft, docSources }));
  await runWithOrganization(A.id, () => agents.publishAgent(A.id, a.id, ownerA));
  return a.id;
}

// Cada documento lleva un dato único y las mismas palabras de relleno
// («información», «ayuda», «pueden»): con ellas se arma una pregunta que la
// búsqueda por TEXTO descarta entera y solo encuentra la de VECTORES.
const RELLENO = "Información y ayuda: pueden preguntar lo que quieran.";
const DATO = { general: "garantía de 6 meses", ventas: "taladro cuesta $4,321", direccion: "junta mensual del consejo", exclusivo: "guion de cierre ZETA" };
const SOLO_VECTORES = "informacion ayuda pueden";

let ventas: string;
let direccion: string;
const docs = { general: "", ventas: "", direccion: "", exclusivo: "", deB: "" };
let agTodos: string;
let agVentas: string;
let agGeneral: string;
let agNada: string;

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
  process.env.OPENROUTER_API_TOKEN = "sk-test-fuentes";
  process.env.OPENROUTER_MODEL = "mock/modelo";
  resetEnvCacheForTests();

  A = await crearOrganizacion("Fuentes A");
  B = await crearOrganizacion("Fuentes B");
  await modulos(A);
  await modulos(B);
  ownerA = await persona(A.id);
  ownerB = await persona(B.id);
  await runWithOrganization(A.id, () => ensureGeneralAgent(A.id));

  como(A, ownerA);
  ventas = ((await llamar("lab/document-groups", "POST", { json: { name: "Ventas" } })).data.group as { id: string }).id;
  direccion = ((await llamar("lab/document-groups", "POST", { json: { name: "Dirección" } })).data.group as { id: string }).id;

  docs.general = await subir(A, ownerA, "general.txt", `${RELLENO} Todas las herramientas tienen ${DATO.general}.`);
  docs.ventas = await subir(A, ownerA, "ventas.txt", `${RELLENO} Lista de precios: el ${DATO.ventas} con IVA.`, ventas);
  docs.direccion = await subir(A, ownerA, "direccion.txt", `${RELLENO} Calendario: la ${DATO.direccion} es el primer lunes.`, direccion);
  docs.exclusivo = await subir(A, ownerA, "exclusivo.txt", `${RELLENO} Para cerrar la venta usa el ${DATO.exclusivo}.`);
  docs.deB = await subir(B, ownerB, "b.txt", `${RELLENO} En B la ${DATO.general} no aplica.`);

  agTodos = await agente("Todos", { mode: "all" });
  agVentas = await agente("Solo Ventas", { mode: "groups", groupIds: [ventas] });
  agGeneral = await agente("Solo General", { mode: "groups", groupIds: ["general"] });
  agNada = await agente("Sin grupos", { mode: "groups", groupIds: [] });

  // Los exclusivos se suben desde el editor en el PR 3; aquí se marcan a mano
  // (pool de sistema: preparación de la prueba) para probar el filtro ya.
  await sys().update(schema.kbDocument).set({ agentId: agVentas, groupId: null }).where(eq(schema.kbDocument.id, docs.exclusivo));
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
  h.llamadasLlm = [];
});

/** Los documentos que recupera ese agente para esa pregunta. */
async function lee(agentId: string | null, sources: DocSources | undefined, pregunta: string): Promise<Set<string>> {
  const hits = await runWithOrganization(A.id, () => retrieveChunks(A.id, docScopeFor(agentId, sources), pregunta));
  return new Set(hits.map((x) => x.documentId));
}

const TODAS = `${DATO.general} ${DATO.ventas} ${DATO.direccion} ${DATO.exclusivo}`;

describe("matriz de fuentes", () => {
  it("la pregunta de solo-vectores de verdad no tiene búsqueda por texto", () => {
    expect(lexicalQuery(SOLO_VECTORES)).toBeNull();
  });

  for (const via of ["texto", "vectores"] as const) {
    const q = via === "texto" ? TODAS : SOLO_VECTORES;

    it(`[${via}] todos: los tres grupos, nunca el exclusivo de otro agente ni lo de B`, async () => {
      forgetKbVectorCache();
      const r = await lee(agTodos, { mode: "all" }, q);
      expect(r.has(docs.general) && r.has(docs.ventas) && r.has(docs.direccion)).toBe(true);
      expect(r.has(docs.exclusivo)).toBe(false);
      expect(r.has(docs.deB)).toBe(false);
    });

    it(`[${via}] solo Ventas: Ventas y su exclusivo; ni General ni Dirección`, async () => {
      // Caché caliente con TODO lo de la organización: el filtro por turno es lo que decide.
      await lee(agTodos, { mode: "all" }, q);
      const r = await lee(agVentas, { mode: "groups", groupIds: [ventas] }, q);
      expect([...r].sort()).toEqual([docs.ventas, docs.exclusivo].sort());
    });

    it(`[${via}] solo General: General; ni Ventas, ni Dirección, ni el exclusivo de otro`, async () => {
      await lee(agTodos, { mode: "all" }, q);
      const r = await lee(agGeneral, { mode: "groups", groupIds: ["general"] }, q);
      expect([...r]).toEqual([docs.general]);
    });

    it(`[${via}] sin grupos elegidos: nada de la empresa`, async () => {
      await lee(agTodos, { mode: "all" }, q);
      expect([...(await lee(agNada, { mode: "groups", groupIds: [] }, q))]).toEqual([]);
    });
  }

  it("la caché de vectores (de toda la organización) solo propone fragmentos que el agente puede leer", async () => {
    await lee(agTodos, { mode: "all" }, SOLO_VECTORES);
    const chunks = await sys()
      .select({ id: schema.kbChunk.id, documentId: schema.kbChunk.documentId })
      .from(schema.kbChunk)
      .where(eq(schema.kbChunk.organizationId, A.id));
    const docOf = new Map(chunks.map((c) => [c.id, c.documentId]));
    const ids = await runWithOrganization(A.id, () =>
      vectorCandidatesForTests(A.id, docScopeFor(agGeneral, { mode: "groups", groupIds: ["general"] }), SOLO_VECTORES)
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids.map((id) => docOf.get(id)))).toEqual(new Set([docs.general]));
  });

  it("sin configurar nada (agente sin docSources): lo mismo que antes de 037", async () => {
    const antes = await lee(null, undefined, TODAS);
    expect([...antes].sort()).toEqual([docs.general, docs.ventas, docs.direccion].sort());
  });

  it("mover un documento cambia quién lo lee desde el siguiente turno (sin caché vieja)", async () => {
    await lee(agGeneral, { mode: "groups", groupIds: ["general"] }, SOLO_VECTORES);
    como(A, ownerA);
    const mod = (await import("@/app/api/lab/documents/[id]/route")) as unknown as Record<string, Handler>;
    const res = await mod.PATCH!(
      new Request("http://localhost/api/lab/documents/x", {
        method: "PATCH",
        body: JSON.stringify({ groupId: "general" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ id: docs.ventas }) }
    );
    expect(res.status).toBe(200);
    try {
      for (const q of [TODAS, SOLO_VECTORES]) {
        const r = await lee(agGeneral, { mode: "groups", groupIds: ["general"] }, q);
        expect(r.has(docs.ventas), q).toBe(true);
        expect((await lee(agVentas, { mode: "groups", groupIds: [ventas] }, q)).has(docs.ventas), q).toBe(false);
      }
    } finally {
      await sys().update(schema.kbDocument).set({ groupId: ventas }).where(eq(schema.kbDocument.id, docs.ventas));
    }
  });
});

describe("el turno usa las fuentes del agente que responde", () => {
  async function conversacion(texto: string, opts: { isTest: boolean; stageIndex?: number }): Promise<string> {
    const db = sys();
    const contactId = newId("contact");
    const tel = `52155${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
    await db.insert(schema.contact).values({ id: contactId, organizationId: A.id, waIdentity: tel, phone: tel, name: "Cliente" });
    const stages = await db
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(eq(schema.pipelineStage.organizationId, A.id))
      .orderBy(asc(schema.pipelineStage.position));
    await db.insert(schema.lead).values({ id: newId("lead"), organizationId: A.id, contactId, stageId: stages[opts.stageIndex ?? 0]!.id });
    const id = newId("conversation");
    const now = new Date();
    await db.insert(schema.conversation).values({ id, organizationId: A.id, contactId, isTest: opts.isTest, aiEnabled: true, lastInboundAt: now, lastMessageAt: now });
    await db.insert(schema.message).values({
      id: newId("message"),
      organizationId: A.id,
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
  const sistema = () => h.llamadasLlm.at(-1)?.[0]?.content ?? "";

  it("conversación real en la etapa de «Solo Ventas»: ve Ventas y su exclusivo, no General", async () => {
    await sys().update(schema.agentProfile).set({ enabled: true }).where(eq(schema.agentProfile.organizationId, A.id));
    const [stage] = await sys()
      .select({ id: schema.pipelineStage.id })
      .from(schema.pipelineStage)
      .where(and(eq(schema.pipelineStage.organizationId, A.id), eq(schema.pipelineStage.position, 1)));
    await runWithOrganization(A.id, () => assignStage(A.id, { stageId: stage!.id, agentId: agVentas, actorUserId: ownerA }));
    const id = await conversacion(TODAS, { isTest: false, stageIndex: 1 });
    await runWithOrganization(A.id, () => runAgentTurn(id));
    expect(sistema()).toContain(DATO.ventas);
    expect(sistema()).toContain(DATO.exclusivo);
    expect(sistema()).not.toContain(DATO.general);
    expect(sistema()).not.toContain(DATO.direccion);
  });

  it("conversación real en una etapa sin agente: el general (sin configurar) lee todo lo de la empresa", async () => {
    const id = await conversacion(TODAS, { isTest: false, stageIndex: 0 });
    await runWithOrganization(A.id, () => runAgentTurn(id));
    for (const d of [DATO.general, DATO.ventas, DATO.direccion]) expect(sistema()).toContain(d);
    expect(sistema()).not.toContain(DATO.exclusivo);
  });

  it("Laboratorio: usa las fuentes CONGELADAS en el snapshot aunque el agente cambie después", async () => {
    const snap = await runWithOrganization(A.id, () => buildRunSnapshot(A.id, { agentId: agVentas, source: "published" }));
    expect(snap.config.docSources).toEqual({ mode: "groups", groupIds: [ventas] });
    expect(snap.docSourceNames).toEqual(["Ventas"]);
    // Ahora el agente pasa a «todos» y se publica...
    const a = await runWithOrganization(A.id, () => agents.getAgent(A.id, agVentas));
    await runWithOrganization(A.id, () => agents.saveDraft(A.id, agVentas, { ...a!.draft, docSources: { mode: "all" } }));
    await runWithOrganization(A.id, () => agents.publishAgent(A.id, agVentas, ownerA));
    try {
      // ...pero el turno de la evaluación usa lo congelado.
      const id = await conversacion(TODAS, { isTest: true });
      await runWithOrganization(A.id, () =>
        runAgentTurn(id, { agentOverride: { agentId: snap.agentId, config: snap.config, kb: snap.kb } })
      );
      expect(sistema()).toContain(DATO.ventas);
      expect(sistema()).not.toContain(DATO.general);
    } finally {
      const b = await runWithOrganization(A.id, () => agents.getAgent(A.id, agVentas));
      await runWithOrganization(A.id, () => agents.saveDraft(A.id, agVentas, { ...b!.draft, docSources: { mode: "groups", groupIds: [ventas] } }));
      await runWithOrganization(A.id, () => agents.publishAgent(A.id, agVentas, ownerA));
    }
  });

  it("vista previa: las fuentes del formulario aunque no estén guardadas; «Por qué» dice de dónde vino", async () => {
    const a = await runWithOrganization(A.id, () => agents.getAgent(A.id, agVentas));
    const r = await runWithOrganization(A.id, () =>
      runPreview({
        organizationId: A.id,
        agentId: agVentas,
        config: { ...a!.draft, docSources: { mode: "groups", groupIds: [direccion] } },
        history: [],
        message: TODAS,
      })
    );
    expect(sistema()).toContain(DATO.direccion);
    expect(sistema()).not.toContain(DATO.ventas);
    expect(sistema()).toContain(DATO.exclusivo);
    expect(r.ok && r.debug.docs?.map((d) => d.from).sort()).toEqual(["Dirección", "Exclusivo de este agente"]);
  });
});

describe("guardar y publicar la selección", () => {
  it("un grupo que no existe o de otra organización → 422 unknown_group; el borrador no cambia", async () => {
    como(B, ownerB);
    const deB = ((await llamar("lab/document-groups", "POST", { json: { name: "Ventas" } })).data.group as { id: string }).id;
    como(A, ownerA);
    const a = await runWithOrganization(A.id, () => agents.getAgent(A.id, agGeneral));
    for (const g of ["kdg_noexiste", deB]) {
      const r = await llamar("lab/agents/[id]/draft", "PUT", { id: agGeneral, json: { ...a!.draft, docSources: { mode: "groups", groupIds: [g] } } });
      expect(r.status, g).toBe(422);
      expect(r.data.error).toMatchObject({ code: "unknown_group" });
    }
    const despues = await runWithOrganization(A.id, () => agents.getAgent(A.id, agGeneral));
    expect(despues!.draft.docSources).toEqual({ mode: "groups", groupIds: ["general"] });
  });

  it("publicar quita los grupos que se borraron después de elegirlos; el conteo del diálogo los veía", async () => {
    como(A, ownerA);
    const tmp = ((await llamar("lab/document-groups", "POST", { json: { name: "Temporal" } })).data.group as { id: string }).id;
    const id = await agente("Con temporal", { mode: "groups", groupIds: [tmp, ventas] });
    const lista = await llamar("lab/document-groups", "GET");
    const fila = (lista.data.groups as { id: string | null; agents: number }[]).find((g) => g.id === tmp);
    expect(fila?.agents).toBe(1);
    const mod = (await import("@/app/api/lab/document-groups/[id]/route")) as unknown as Record<string, Handler>;
    const del = await mod.DELETE!(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ id: tmp }) });
    expect(del.status).toBe(200);
    await runWithOrganization(A.id, () => agents.publishAgent(A.id, id, ownerA));
    const a = await runWithOrganization(A.id, () => agents.getAgent(A.id, id));
    expect(a!.published?.docSources).toEqual({ mode: "groups", groupIds: [ventas] });
  });

  it("la reconciliación con «Agente» (agent_profile) conserva la selección del general", async () => {
    const general = await runWithOrganization(A.id, () => ensureGeneralAgent(A.id));
    await runWithOrganization(A.id, () => agents.saveDraft(A.id, general!.agent.id, { ...general!.published!, docSources: { mode: "groups", groupIds: ["general"] } }));
    await runWithOrganization(A.id, () => agents.publishAgent(A.id, general!.agent.id, ownerA));
    // Alguien cambia el perfil por fuera (la pantalla vieja «Agente»).
    await sys()
      .update(schema.agentProfile)
      .set({ tone: "Muy formal", updatedAt: new Date(Date.now() + 1000) })
      .where(eq(schema.agentProfile.organizationId, A.id));
    const otra = await runWithOrganization(A.id, () => ensureGeneralAgent(A.id));
    expect(otra!.published?.tone).toBe("Muy formal");
    expect(otra!.published?.docSources).toEqual({ mode: "groups", groupIds: ["general"] });
  });
});
