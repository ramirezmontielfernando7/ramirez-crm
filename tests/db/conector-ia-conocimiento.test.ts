/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON-RPC sin tipar en la prueba */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { sessionContext } from "@/lib/auth/session";
import { runWithOrganization } from "@/lib/request-context";
import { createPersonalKey } from "@/server/ai-connector/keys";
import { saveConnectorSettings } from "@/server/ai-connector/settings";
import { forgetOrgModules } from "@/server/modules/store";
import { POST } from "@/app/api/mcp/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 047 — Conocimiento y documentos del Estudio de IA para la IA conectada:
 * dentro de «Ajustar agentes de IA» (Funciones avanzadas), con `agent.manage`
 * (solo el Propietario), por las puertas de siempre y sin borrar nada.
 */

type Role = "owner" | "coordinador" | "asesor";
const sys = () => getSystemDb();
const KNOWLEDGE = ["list_knowledge", "add_knowledge", "update_knowledge", "list_documents", "read_document", "add_document"];

let A: Awaited<ReturnType<typeof crearOrganizacion>>;
let B: Awaited<ReturnType<typeof crearOrganizacion>>;
const u = { owner: "", coord: "" };
const k = { owner: "", coord: "" };

async function persona(orgId: string, role: Role, name: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@conocimiento.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role });
  return id;
}

async function llave(userId: string, role: Role) {
  const made = await runWithOrganization(A.id, () =>
    createPersonalKey(sessionContext(userId, A.id, role), { name: "Claude de prueba", scopes: ["read", "write"] })
  );
  if (!made) throw new Error("no se pudo crear la llave");
  return made.key;
}

async function ajustes(areas: ("agents" | "contacts")[]) {
  await runWithOrganization(A.id, () =>
    saveConnectorSettings(A.id, u.owner, {
      enabled: true,
      allowedRoles: ["coordinador", "asesor"],
      dailyMessageLimit: 100,
      advanced: { enabled: true, roles: ["coordinador"], areas, launchCampaigns: false },
    })
  );
}

let seq = 0;
async function rpc(key: string, method: string, params?: Record<string, unknown>) {
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++seq, method, ...(params ? { params } : {}) }),
    })
  );
  return (await res.json()) as Record<string, any>;
}

async function herramienta(key: string, name: string, args: Record<string, unknown> = {}) {
  const r = await rpc(key, "tools/call", { name, arguments: args });
  return r.result as { structuredContent: Record<string, any>; isError: boolean };
}

async function deConocimiento(key: string) {
  const all = ((await rpc(key, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);
  return all.filter((n) => KNOWLEDGE.includes(n));
}

beforeAll(async () => {
  process.env.KB_DOCS = "on";
  delete process.env.EMBEDDINGS_BASE_URL;
  resetEnvCacheForTests();
  A = await crearOrganizacion("Conocimiento A");
  B = await crearOrganizacion("Conocimiento B");
  u.owner = await persona(A.id, "owner", "Dueña");
  u.coord = await persona(A.id, "coordinador", "Coco");
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: A.id, conectorIa: true, lab: true, agent: true })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { conectorIa: true, lab: true, agent: true } });
  forgetOrgModules(A.id);
  await runWithOrganization(A.id, () =>
    saveConnectorSettings(A.id, u.owner, { enabled: true, allowedRoles: ["coordinador", "asesor"], dailyMessageLimit: 100 })
  );
  k.owner = await llave(u.owner, "owner");
  k.coord = await llave(u.coord, "coordinador");
});

afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
  for (const id of Object.values(u)) await sys().delete(schema.user).where(eq(schema.user.id, id));
  delete process.env.KB_DOCS;
  resetEnvCacheForTests();
});

describe("conocimiento del Estudio de IA por la IA conectada", () => {
  it("apagado de fábrica; con «Ajustar agentes» solo el Propietario; nunca herramientas de borrar", async () => {
    expect(await deConocimiento(k.owner)).toEqual([]);
    await ajustes(["contacts"]);
    expect(await deConocimiento(k.owner)).toEqual([]);
    await ajustes(["agents"]);
    expect((await deConocimiento(k.owner)).sort()).toEqual([...KNOWLEDGE].sort());
    expect(await deConocimiento(k.coord)).toEqual([]);
    const all = ((await rpc(k.owner, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);
    expect(all.filter((n) => /delete|remove|archive/.test(n))).toEqual([]);
  });

  it("agrega, lista y edita conocimiento compartido y de un agente", async () => {
    await ajustes(["agents"]);
    const add = await herramienta(k.owner, "add_knowledge", { question: "¿Horario?", answer: "De 9 a 6" });
    expect(add.isError).toBe(false);
    const block = await herramienta(k.owner, "add_knowledge", { content: "Estacionamiento gratis" });
    expect(block.isError).toBe(false);
    const bad = await herramienta(k.owner, "add_knowledge", { question: "Sola" });
    expect(bad.isError).toBe(true);

    let list = await herramienta(k.owner, "list_knowledge");
    expect(list.structuredContent.entries).toHaveLength(2);

    const upd = await herramienta(k.owner, "update_knowledge", { entry_id: add.structuredContent.id, answer: "De 9 a 7" });
    expect(upd.isError).toBe(false);
    list = await herramienta(k.owner, "list_knowledge");
    expect(list.structuredContent.entries.find((e: any) => e.id === add.structuredContent.id).answer).toBe("De 9 a 7");

    const agents = await herramienta(k.owner, "list_agents");
    const general = (agents.structuredContent.agents as any[]).find((a) => a.general);
    const own = await herramienta(k.owner, "add_knowledge", { agent_id: general.id, content: "Solo para el general" });
    expect(own.isError).toBe(false);
    const ofAgent = await herramienta(k.owner, "list_knowledge", { agent_id: general.id });
    expect(ofAgent.structuredContent.entries.map((e: any) => e.content)).toContain("Solo para el general");

    expect((await herramienta(k.owner, "list_knowledge", { agent_id: "ag_noexiste" })).isError).toBe(true);
  });

  it("no alcanza el conocimiento de otra empresa", async () => {
    const otro = newId("kbEntry");
    await sys().insert(schema.kbEntry).values({ id: otro, organizationId: B.id, kind: "block", content: "Secreto de B" });
    const r = await herramienta(k.owner, "update_knowledge", { entry_id: otro, content: "hackeado" });
    expect(r.isError).toBe(true);
    const [row] = await sys().select().from(schema.kbEntry).where(eq(schema.kbEntry.id, otro));
    expect(row?.content).toBe("Secreto de B");
  });

  it("carga un documento de texto, lo lista y lo lee por páginas", async () => {
    const texto = "Lista de precios 2027\n\n" + "Curso de inglés: 1,200 pesos al mes. ".repeat(800);
    const add = await herramienta(k.owner, "add_document", { title: "Precios", text: texto });
    expect(add.isError).toBe(false);
    const list = await herramienta(k.owner, "list_documents");
    const doc = (list.structuredContent.documents as any[]).find((d) => d.id === add.structuredContent.id);
    expect(doc.title).toBe("Precios");
    expect(doc.group).toBe("General");

    const p1 = await herramienta(k.owner, "read_document", { document_id: doc.id });
    expect(p1.structuredContent.text.startsWith("Lista de precios 2027")).toBe(true);
    expect(p1.structuredContent.next_offset).toBeGreaterThan(0);
    const p2 = await herramienta(k.owner, "read_document", { document_id: doc.id, offset: p1.structuredContent.next_offset });
    expect(p2.isError).toBe(false);

    const grupoMalo = await herramienta(k.owner, "add_document", { title: "X", text: "algo", group: "No existe" });
    expect(grupoMalo.isError).toBe(true);

    const [log] = await sys()
      .select()
      .from(schema.aiActionLog)
      .where(eq(schema.aiActionLog.tool, "add_document"));
    expect(log).toBeTruthy();
  });
});
