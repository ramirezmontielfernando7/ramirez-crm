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
 * 047 — La Biblioteca y los grupos de documentos para la IA conectada:
 * etiquetas, destinos (Bandeja / lectura de la IA), grupos y mover; dentro de
 * «Ajustar agentes de IA» y sin borrar nada.
 */

type Role = "owner" | "coordinador" | "asesor";
const sys = () => getSystemDb();
const LIBRARY = ["list_library", "add_to_library", "update_library_entry", "create_document_group", "rename_document_group", "move_document"];

let A: Awaited<ReturnType<typeof crearOrganizacion>>;
let B: Awaited<ReturnType<typeof crearOrganizacion>>;
const u = { owner: "", coord: "" };
const k = { owner: "", coord: "" };

async function persona(orgId: string, role: Role, name: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@biblioteca.test`, emailVerified: true });
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

async function deBiblioteca(key: string) {
  const all = ((await rpc(key, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);
  return all.filter((n) => LIBRARY.includes(n));
}

beforeAll(async () => {
  process.env.KB_DOCS = "on";
  delete process.env.EMBEDDINGS_BASE_URL;
  resetEnvCacheForTests();
  A = await crearOrganizacion("Biblioteca A");
  B = await crearOrganizacion("Biblioteca B");
  u.owner = await persona(A.id, "owner", "Dueña");
  u.coord = await persona(A.id, "coordinador", "Coco");
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: A.id, conectorIa: true, lab: true, agent: true, knowledge: true })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { conectorIa: true, lab: true, agent: true, knowledge: true } });
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

describe("Biblioteca por la IA conectada", () => {
  it("apagada de fábrica; con «Ajustar agentes» el Propietario y el Coordinador con el área; sin borrar", async () => {
    expect(await deBiblioteca(k.owner)).toEqual([]);
    await ajustes(["agents"]);
    expect((await deBiblioteca(k.owner)).sort()).toEqual([...LIBRARY].sort());
    // El Coordinador tiene knowledge.manage pero no agent.manage: Biblioteca sí, grupos no.
    expect((await deBiblioteca(k.coord)).sort()).toEqual(["add_to_library", "list_library", "update_library_entry"]);
    const all = ((await rpc(k.owner, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);
    expect(all.filter((n) => /delete|remove|archive/.test(n))).toEqual([]);
  });

  it("agrega con etiquetas y lectura de la IA en un grupo; edita etiquetas y destinos", async () => {
    await ajustes(["agents"]);
    const g = await herramienta(k.owner, "create_document_group", { name: "Planes de estudio" });
    expect(g.isError).toBe(false);
    expect((await herramienta(k.owner, "create_document_group", { name: "General" })).isError).toBe(true);

    const add = await herramienta(k.owner, "add_to_library", {
      title: "Plan LX Derecho",
      text: "Primer semestre: introducción al derecho, latín jurídico.",
      tags: ["Planes", "UG"],
      rag: true,
      rag_group: "Planes de estudio",
    });
    expect(add.isError).toBe(false);
    const id = add.structuredContent.id;

    let list = await herramienta(k.owner, "list_library", { tag: "UG" });
    let e = (list.structuredContent.entries as any[]).find((x) => x.id === id);
    expect(e.tags).toEqual(["Planes", "UG"]);
    expect(e.in_chat).toBe(true);
    expect(e.rag.group).toBe("Planes de estudio");
    expect(list.structuredContent.tags).toEqual(expect.arrayContaining(["Planes", "UG"]));

    const upd = await herramienta(k.owner, "update_library_entry", { entry_id: id, add_tags: ["2027"], remove_tags: ["ug"], in_chat: false });
    expect(upd.isError).toBe(false);
    list = await herramienta(k.owner, "list_library");
    e = (list.structuredContent.entries as any[]).find((x) => x.id === id);
    expect(e.tags).toEqual(["Planes", "2027"]);
    expect(e.in_chat).toBe(false);
    // Un destino al menos: apagar la IA cuando ya no está en la Bandeja no se puede.
    expect((await herramienta(k.owner, "update_library_entry", { entry_id: id, rag: false })).isError).toBe(true);

    // Mover su documento a General y renombrar el grupo.
    const mv = await herramienta(k.owner, "move_document", { document_id: e.rag.document_id, group: "General" });
    expect(mv.isError).toBe(false);
    expect((await herramienta(k.owner, "rename_document_group", { group: "Planes de estudio", name: "Planes 2027" })).isError).toBe(false);
    expect((await herramienta(k.owner, "move_document", { document_id: e.rag.document_id, group: "No existe" })).isError).toBe(true);
  });

  it("el Coordinador agrega a la Bandeja pero no entrena a la IA", async () => {
    await ajustes(["agents"]);
    const ok = await herramienta(k.coord, "add_to_library", { title: "Costos", text: "Inscripción 2,000", tags: ["Precios"] });
    expect(ok.isError).toBe(false);
    const no = await herramienta(k.coord, "add_to_library", { title: "Costos IA", text: "x", rag: true });
    expect(no.isError).toBe(true);
    expect((await herramienta(k.coord, "add_to_library", { title: "Nada", text: "x", in_chat: false })).isError).toBe(true);
  });

  it("no toca la Biblioteca de otra empresa", async () => {
    const otro = newId("knowledgeEntry");
    await sys().insert(schema.knowledgeEntry).values({ id: otro, organizationId: B.id, title: "De B", body: "secreto", tags: [] });
    const r = await herramienta(k.owner, "update_library_entry", { entry_id: otro, title: "hackeado" });
    expect(r.isError).toBe(true);
    const [row] = await sys().select().from(schema.knowledgeEntry).where(eq(schema.knowledgeEntry.id, otro));
    expect(row?.title).toBe("De B");
  });
});
