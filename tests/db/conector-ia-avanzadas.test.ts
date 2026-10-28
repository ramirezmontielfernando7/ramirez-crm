/* eslint-disable @typescript-eslint/no-explicit-any -- respuestas JSON-RPC sin tipar en la prueba */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_ADVANCED_SETTINGS, type AdvancedSettings } from "@/lib/ai-connector";
import { getSystemDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sessionContext } from "@/lib/auth/session";
import { runWithOrganization } from "@/lib/request-context";
import { createPersonalKey } from "@/server/ai-connector/keys";
import { getConnectorSettings, saveConnectorSettings } from "@/server/ai-connector/settings";
import { forgetOrgModules } from "@/server/modules/store";
import { POST } from "@/app/api/mcp/route";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 047 PR 6 — «Funciones avanzadas» contra Postgres real: apagadas de
 * fábrica; el Propietario siempre, el Coordinador solo si se le dio, el
 * Asesor nunca; cada una además con el permiso del CRM; campañas en
 * borrador salvo «Puede lanzar campañas»; agentes solo en borrador.
 */

type Role = "owner" | "coordinador" | "asesor";
const sys = () => getSystemDb();

let A: Awaited<ReturnType<typeof crearOrganizacion>>;
let B: Awaited<ReturnType<typeof crearOrganizacion>>;
const u = { owner: "", coord: "", ana: "" };
const k = { owner: "", coord: "", ana: "" };
const contactos = { a1: "", a2: "", deB: "" };

const ADVANCED = [
  "export_contacts",
  "import_contacts",
  "list_templates",
  "list_campaigns",
  "prepare_campaign",
  "launch_campaign",
  "create_tag",
  "update_tag",
  "tag_contacts",
  "list_agents",
  "read_agent",
  "update_agent_draft",
  "create_quick_reply",
  "update_quick_reply",
  "create_loss_reason",
  "rename_loss_reason",
];

async function persona(orgId: string, role: Role, name: string): Promise<string> {
  const id = newId("user");
  await sys().insert(schema.user).values({ id, name, email: `${id}@avanzadas.test`, emailVerified: true });
  await sys().insert(schema.member).values({ id: newId("member"), organizationId: orgId, userId: id, role });
  return id;
}

async function contacto(orgId: string, name: string, consent: "opt_in" | "desconocido" = "opt_in") {
  const id = newId("contact");
  const tel = `52155${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
  await sys()
    .insert(schema.contact)
    .values({ id, organizationId: orgId, waIdentity: tel, phone: tel, name, waConsent: consent });
  return id;
}

async function llave(userId: string, role: Role) {
  const made = await runWithOrganization(A.id, () =>
    createPersonalKey(sessionContext(userId, A.id, role), { name: "Claude de prueba", scopes: ["read", "write"] })
  );
  if (!made) throw new Error("no se pudo crear la llave");
  return made.key;
}

async function avanzadas(advanced: AdvancedSettings) {
  await runWithOrganization(A.id, () =>
    saveConnectorSettings(A.id, u.owner, {
      enabled: true,
      allowedRoles: ["coordinador", "asesor"],
      dailyMessageLimit: 100,
      advanced,
    })
  );
}

const TODAS: AdvancedSettings = {
  enabled: true,
  roles: ["coordinador"],
  areas: ["contacts", "campaigns", "tags", "agents", "settings"],
  launchCampaigns: false,
};

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

async function avanzadasDe(key: string) {
  const all = ((await rpc(key, "tools/list")).result.tools as { name: string }[]).map((t) => t.name);
  return all.filter((n) => ADVANCED.includes(n));
}

beforeAll(async () => {
  A = await crearOrganizacion("Avanzadas A");
  B = await crearOrganizacion("Avanzadas B");
  u.owner = await persona(A.id, "owner", "Dueña");
  u.coord = await persona(A.id, "coordinador", "Coco");
  u.ana = await persona(A.id, "asesor", "Ana");
  contactos.a1 = await contacto(A.id, "Alicia");
  contactos.a2 = await contacto(A.id, "Bruno", "desconocido");
  contactos.deB = await contacto(B.id, "De otra empresa");
  await sys().insert(schema.contactTag).values({ id: newId("contactTag"), organizationId: A.id, name: "VIP" });
  await sys().insert(schema.template).values({
    id: newId("template"),
    organizationId: A.id,
    name: "promo_otono",
    language: "es_MX",
    category: "MARKETING",
    body: "Hola {{1}}, tenemos promoción",
    status: "approved",
  });
  await sys()
    .insert(schema.organizationModule)
    .values({ organizationId: A.id, conectorIa: true, campaigns: true, lab: true, agent: true })
    .onConflictDoUpdate({
      target: [schema.organizationModule.organizationId],
      set: { conectorIa: true, campaigns: true, lab: true, agent: true },
    });
  forgetOrgModules(A.id);
  await runWithOrganization(A.id, () =>
    saveConnectorSettings(A.id, u.owner, { enabled: true, allowedRoles: ["coordinador", "asesor"], dailyMessageLimit: 100 })
  );
  k.owner = await llave(u.owner, "owner");
  k.coord = await llave(u.coord, "coordinador");
  k.ana = await llave(u.ana, "asesor");
});

afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
  for (const id of Object.values(u)) await sys().delete(schema.user).where(eq(schema.user.id, id));
});

describe("funciones avanzadas — quién y qué", () => {
  it("vienen apagadas: nadie ve herramientas avanzadas", async () => {
    const s = await runWithOrganization(A.id, () => getConnectorSettings(A.id));
    expect(s.advanced).toEqual(DEFAULT_ADVANCED_SETTINGS);
    expect(await avanzadasDe(k.owner)).toEqual([]);
    expect(await avanzadasDe(k.coord)).toEqual([]);
  });

  it("guardar sin `advanced` (pantallas viejas) no las toca", async () => {
    await avanzadas({ ...TODAS, roles: [] });
    await runWithOrganization(A.id, () =>
      saveConnectorSettings(A.id, u.owner, { enabled: true, allowedRoles: ["coordinador", "asesor"], dailyMessageLimit: 50 })
    );
    const s = await runWithOrganization(A.id, () => getConnectorSettings(A.id));
    expect(s.advanced.enabled).toBe(true);
    expect(s.dailyMessageLimit).toBe(50);
  });

  it("solo el Propietario si no se dio al Coordinador; el Asesor nunca", async () => {
    await avanzadas({ ...TODAS, roles: [] });
    const owner = await avanzadasDe(k.owner);
    expect(owner).toEqual(expect.arrayContaining(["export_contacts", "prepare_campaign", "update_agent_draft"]));
    expect(owner).not.toContain("launch_campaign");
    expect(await avanzadasDe(k.coord)).toEqual([]);
    expect(await avanzadasDe(k.ana)).toEqual([]);
  });

  it("con el Coordinador: lo de su rol, nunca agentes (agent.manage es del Propietario)", async () => {
    await avanzadas(TODAS);
    const coord = await avanzadasDe(k.coord);
    expect(coord).toEqual(expect.arrayContaining(["export_contacts", "tag_contacts", "prepare_campaign", "create_quick_reply"]));
    expect(coord).not.toContain("update_agent_draft");
    expect(coord).not.toContain("list_agents");
    expect(await avanzadasDe(k.ana)).toEqual([]);
  });

  it("cada área se apaga sola", async () => {
    await avanzadas({ ...TODAS, areas: ["tags"] });
    expect((await avanzadasDe(k.owner)).sort()).toEqual(["create_tag", "tag_contacts", "update_tag"]);
    const r = await rpc(k.owner, "tools/call", { name: "export_contacts", arguments: {} });
    expect(r.error ?? r.result?.isError).toBeTruthy();
  });

  it("«Puede lanzar campañas» aparece solo encendido y con el área de campañas", async () => {
    await avanzadas({ ...TODAS, launchCampaigns: true });
    expect(await avanzadasDe(k.owner)).toContain("launch_campaign");
    await avanzadas({ ...TODAS, areas: ["tags"], launchCampaigns: true });
    expect(await avanzadasDe(k.owner)).not.toContain("launch_campaign");
  });

  it("la base rechaza dar avanzadas al Asesor", async () => {
    await expect(
      sys()
        .update(schema.aiConnectorSettings)
        .set({ advancedRoles: ["asesor"] })
        .where(eq(schema.aiConnectorSettings.organizationId, A.id))
    ).rejects.toThrow();
  });
});

describe("funciones avanzadas — lo que hacen", () => {
  it("exporta en CSV y queda en la bitácora como exportación", async () => {
    await avanzadas(TODAS);
    const r = await herramienta(k.owner, "export_contacts");
    expect(r.isError).toBe(false);
    expect(r.structuredContent.count).toBe(2);
    expect(r.structuredContent.csv).toContain("Alicia");
    expect(r.structuredContent.csv).not.toContain("De otra empresa");
    const [log] = await sys()
      .select()
      .from(schema.aiActionLog)
      .where(
        and(
          eq(schema.aiActionLog.organizationId, A.id),
          eq(schema.aiActionLog.tool, "export_contacts"),
          eq(schema.aiActionLog.outcome, "ok")
        )
      );
    expect(log?.summary).toBe("exportó 2 contactos");
  });

  it("importa con la pregunta de consentimiento", async () => {
    const r = await herramienta(k.owner, "import_contacts", {
      contacts: [{ name: "Carla Nueva", phone: "+52 462 555 0101", tags: ["VIP"] }],
      consent: "unknown",
    });
    expect(r.isError, JSON.stringify(r.structuredContent)).toBe(false);
    expect(r.structuredContent.created, JSON.stringify(r.structuredContent)).toBe(1);
    const [c] = await sys()
      .select()
      .from(schema.contact)
      .where(and(eq(schema.contact.organizationId, A.id), eq(schema.contact.name, "Carla Nueva")));
    expect(c?.waConsent).toBe("desconocido");
    const sin = await rpc(k.owner, "tools/call", {
      name: "import_contacts",
      arguments: { contacts: [{ phone: "+52 462 555 0102" }] },
    });
    expect(sin.error ?? sin.result.isError).toBeTruthy();
  });

  it("crea, edita y pone etiquetas solo a contactos que ve", async () => {
    expect((await herramienta(k.coord, "create_tag", { name: "Otoño", color: "verde" })).isError).toBe(false);
    expect((await herramienta(k.coord, "update_tag", { name: "Otoño", new_name: "Otoño 2026" })).isError).toBe(false);
    const r = await herramienta(k.coord, "tag_contacts", {
      tag: "Otoño 2026",
      contact_ids: [contactos.a1, contactos.a2, contactos.deB],
    });
    expect(r.structuredContent).toMatchObject({ ok: true, changed: 2, not_found: 1 });
    const quitado = await herramienta(k.coord, "tag_contacts", { tag: "Otoño 2026", contact_ids: [contactos.a2], remove: true });
    expect(quitado.structuredContent.changed).toBe(1);
  });

  it("prepara la campaña como borrador y no envía nada", async () => {
    const r = await herramienta(k.coord, "prepare_campaign", {
      name: "Promo otoño",
      template: "promo_otono",
      variables: [{ kind: "contact_name" }],
      tags: ["VIP"],
    });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.status).toBe("draft");
    const [c] = await sys()
      .select()
      .from(schema.campaign)
      .where(eq(schema.campaign.id, r.structuredContent.campaign_id));
    expect(c?.status).toBe("draft");
    expect(c?.startedAt).toBeNull();
    const mala = await herramienta(k.coord, "prepare_campaign", { name: "X", template: "no_existe" });
    expect(mala.isError).toBe(true);
  });

  it("edita el borrador del agente y lo publicado no cambia", async () => {
    const list = await herramienta(k.owner, "list_agents");
    const general = (list.structuredContent.agents as any[]).find((a) => a.general);
    expect(general).toBeTruthy();
    const before = await herramienta(k.owner, "read_agent", { agent_id: general.id });
    const r = await herramienta(k.owner, "update_agent_draft", { agent_id: general.id, tone: "Cálido y breve" });
    expect(r.isError).toBe(false);
    expect(r.structuredContent.draft.tone).toBe("Cálido y breve");
    const after = await herramienta(k.owner, "read_agent", { agent_id: general.id });
    expect(after.structuredContent.published).toEqual(before.structuredContent.published);
  });

  it("respuestas rápidas y motivos de pérdida", async () => {
    expect((await herramienta(k.coord, "create_quick_reply", { shortcut: "Horario", body: "Abrimos 9 a 6, {nombre}" })).isError).toBe(false);
    expect((await herramienta(k.coord, "create_quick_reply", { shortcut: "horario", body: "otra" })).isError).toBe(true);
    expect((await herramienta(k.coord, "update_quick_reply", { shortcut: "/horario", body: "Abrimos 9 a 7" })).isError).toBe(false);
    expect((await herramienta(k.coord, "create_loss_reason", { label: "Se fue con la competencia" })).isError).toBe(false);
    expect(
      (await herramienta(k.coord, "rename_loss_reason", { label: "Se fue con la competencia", new_label: "Competencia" })).isError
    ).toBe(false);
  });
});
