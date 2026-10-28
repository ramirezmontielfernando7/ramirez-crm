/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON-RPC sin tipar en la prueba */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sessionContext } from "@/lib/auth/session";
import { runWithOrganization } from "@/lib/request-context";
import { createPersonalKey } from "@/server/ai-connector/keys";
import { saveConnectorSettings } from "@/server/ai-connector/settings";
import { forgetOrgModules } from "@/server/modules/store";
import { POST } from "@/app/api/mcp/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 047 — Material de la Bandeja, Resultados y crear plantillas por la IA
 * conectada: con los mismos permisos y módulos que la pantalla.
 */

type Role = "owner" | "coordinador" | "asesor";
const sys = () => getSystemDb();

let A: Awaited<ReturnType<typeof crearOrganizacion>>;
const u = { owner: "", ana: "" };
const k = { owner: "", ana: "" };
const metaCalls: { url: string; body: string }[] = [];

async function persona(orgId: string, role: Role, name: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@material.test`, emailVerified: true });
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

async function ajustes(areas: ("campaigns" | "contacts")[]) {
  await runWithOrganization(A.id, () =>
    saveConnectorSettings(A.id, u.owner, {
      enabled: true,
      allowedRoles: ["coordinador", "asesor"],
      dailyMessageLimit: 50,
      advanced: { enabled: areas.length > 0, roles: [], areas, launchCampaigns: false },
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
  return (r.result ?? { isError: true, structuredContent: r.error }) as { structuredContent: Record<string, any>; isError: boolean };
}

async function nombres(key: string) {
  return ((await rpc(key, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);
}

beforeAll(async () => {
  A = await crearOrganizacion("Material A");
  u.owner = await persona(A.id, "owner", "Dueña");
  u.ana = await persona(A.id, "asesor", "Ana");
  await sys().insert(schema.knowledgeEntry).values([
    { id: newId("knowledgeEntry"), organizationId: A.id, title: "Costos 2027", body: "Inscripción: 2,000 pesos", tags: ["precios"], showInChat: true },
    { id: newId("knowledgeEntry"), organizationId: A.id, title: "Borrador interno", body: "No sale", tags: [], showInChat: false },
  ]);
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: A.id, conectorIa: true, knowledge: true, results: true })
    .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { conectorIa: true, knowledge: true, results: true } });
  forgetOrgModules(A.id);
  await ajustes([]);
  k.owner = await llave(u.owner, "owner");
  k.ana = await llave(u.ana, "asesor");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      metaCalls.push({ url: String(input), body: String(init?.body ?? "") });
      return Response.json({ id: `tpl-${Math.random().toString(36).slice(2)}`, status: "PENDING", category: "UTILITY" });
    })
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await borrarOrganizaciones([A.id]);
  for (const id of Object.values(u)) await sys().delete(schema.user).where(eq(schema.user.id, id));
});

describe("047 — material, resultados y plantillas", () => {
  it("material: solo lo que aparece en la Bandeja, para cualquier rol", async () => {
    const r = await herramienta(k.ana, "list_materials");
    expect(r.isError).toBe(false);
    expect(r.structuredContent.materials.map((m: any) => m.title)).toEqual(["Costos 2027"]);
    const q = await herramienta(k.ana, "list_materials", { query: "inscripcion" });
    expect(q.structuredContent.materials).toHaveLength(1);
  });

  it("resultados: el Propietario sí, el Asesor no (como la pantalla)", async () => {
    expect(await nombres(k.ana)).not.toContain("get_results");
    const r = await herramienta(k.owner, "get_results", { from: "2026-10-01", to: "2026-10-28" });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.whose).toBe("todo el equipo");
    expect(r.structuredContent.sales).toBeTruthy();
    expect(r.structuredContent.agent).toBeTruthy();
    expect(r.structuredContent.hygiene).toBeTruthy();
    const solo = await herramienta(k.owner, "get_results", { sections: ["sales"] });
    expect(solo.structuredContent.agent).toBeUndefined();
    expect((await herramienta(k.owner, "get_results", { from: "2026-02-31" })).isError).toBe(true);
  });

  it("plantillas: solo con el área de campañas; se mandan a Meta como pendientes", async () => {
    expect(await nombres(k.owner)).not.toContain("create_template");
    await ajustes(["campaigns"]);
    expect(await nombres(k.owner)).toContain("create_template");
    expect(await nombres(k.ana)).not.toContain("create_template");

    const r = await herramienta(k.owner, "create_template", {
      name: "Aviso inscripcion",
      category: "UTILITY",
      body: "Hola {{1}}, tu inscripción está lista.",
      body_examples: ["Laura"],
      header_text: "Inscripciones",
      buttons: [{ type: "QUICK_REPLY", text: "Gracias" }],
    });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.name).toBe("aviso_inscripcion");
    expect(r.structuredContent.status).toBe("pending");
    expect(metaCalls.some((c) => c.url.includes("message_templates"))).toBe(true);
    const [row] = await sys()
      .select()
      .from(schema.template)
      .where(and(eq(schema.template.organizationId, A.id), eq(schema.template.name, "aviso_inscripcion")));
    expect(row).toBeTruthy();

    const bad = await herramienta(k.owner, "create_template", { name: "x", category: "UTILITY", body: "Hola {{1}}" });
    expect(bad.isError).toBe(true);
  });
});
