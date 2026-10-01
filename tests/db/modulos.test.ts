import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemDb, schema, withTenant } from "@/lib/db";
import { listPlatformAudit } from "@/server/platform-admin/audit";
import {
  changeOrganizationModules,
  createOrganization,
  listOrganizations,
  PlatformError,
} from "@/server/platform-admin/organizations";
import { agendaEnabled } from "@/server/agenda/flag";
import { atribucionEnabled } from "@/server/attribution/flag";
import { campaignSendRate, campaignsEnabled } from "@/server/campaigns/flag";
import { enabledChannels, isChannelEnabled, someOrgHasChannel } from "@/server/channels/enabled";
import { backfillOrgModules, forgetOrgModules, getOrgModules } from "@/server/modules/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Fase 3, PR 3 — Módulos por organización contra Postgres real: cada
 * organización con los suyos, el entorno solo como valor por defecto, el
 * relleno al arrancar que respeta lo de hoy, y un módulo apagado en B que
 * responde 404 en el SERVIDOR aunque A lo tenga encendido.
 */

const ACTOR = { userId: "usr_admin_modulos", email: "admin@plataforma.test" };

const state = vi.hoisted(() => ({
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
      if (!state.session) throw new real.UnauthorizedError();
      return state.session;
    },
    getSessionOrNull: async () => state.session,
  };
});

function como(organizationId: string, role: "owner" | "asesor") {
  const userId = `usr_${role}_${organizationId}`;
  state.session = {
    userId,
    organizationId,
    role,
    access: { organizationId, userId, seesAll: role !== "asesor" },
  };
}

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
async function get(route: string): Promise<number> {
  const mod = (await import(`@/app/api/${route}/route`)) as Record<string, Handler>;
  const res = await mod.GET!(new Request(`http://localhost/api/${route}`), { params: Promise.resolve({}) });
  return res.status;
}

const ENV = ["CAMPAIGNS", "AGENDA", "ATRIBUCION", "CHANNELS", "CAMPAIGN_SEND_RATE"] as const;
const guardado: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV) guardado[k] = process.env[k];
});
afterAll(() => {
  for (const k of ENV) {
    if (guardado[k] === undefined) delete process.env[k];
    else process.env[k] = guardado[k];
  }
});
beforeEach(() => forgetOrgModules());

describe("el entorno es solo el valor por defecto", () => {
  const creadas: string[] = [];
  afterAll(() => borrarOrganizaciones(creadas));

  it("sin fila valen las variables; con fila, la fila (aunque el entorno cambie)", async () => {
    const A = await crearOrganizacion("ModSinFila");
    creadas.push(A.id);
    process.env.AGENDA = "on";
    process.env.CAMPAIGNS = "";
    process.env.CHANNELS = "whatsapp,messenger";
    expect(await agendaEnabled(A.id)).toBe(true);
    expect(await campaignsEnabled(A.id)).toBe(false);
    expect([...(await enabledChannels(A.id))].sort()).toEqual(["messenger", "whatsapp"]);

    await changeOrganizationModules(A.id, { agenda: false, campaigns: true, messenger: false }, ACTOR, null);
    process.env.AGENDA = "on";
    forgetOrgModules();
    expect(await agendaEnabled(A.id)).toBe(false);
    expect(await campaignsEnabled(A.id)).toBe(true);
    expect(await isChannelEnabled(A.id, "messenger")).toBe(false);
    expect(await isChannelEnabled(A.id, "whatsapp")).toBe(true);
  });

  it("el alta desde /platform siembra los módulos del entorno", async () => {
    process.env.CAMPAIGNS = "on";
    process.env.AGENDA = "";
    process.env.ATRIBUCION = "on";
    process.env.CHANNELS = "instagram";
    const r = await createOrganization(
      { name: "Negocio Con Módulos", ownerName: "Dueño", ownerEmail: "dueno@modulos.test" },
      ACTOR,
      null
    );
    creadas.push(r.organizationId);
    const [fila] = await getSystemDb()
      .select()
      .from(schema.organizationModule)
      .where(eq(schema.organizationModule.organizationId, r.organizationId));
    expect(fila).toMatchObject({
      campaigns: true,
      agenda: false,
      atribucion: true,
      channels: ["instagram"],
      campaignSendRate: null,
    });
    await getSystemDb().delete(schema.user).where(eq(schema.user.email, "dueno@modulos.test"));
  });
});

describe("relleno al arrancar", () => {
  const creadas: string[] = [];
  afterAll(() => borrarOrganizaciones(creadas));

  it("a la organización sin fila le pone lo de hoy, y NO pisa la que ya tiene", async () => {
    const hoy = await crearOrganizacion("ModHoy");
    const cambiada = await crearOrganizacion("ModCambiada");
    creadas.push(hoy.id, cambiada.id);
    await changeOrganizationModules(cambiada.id, { agenda: false, campaigns: false }, ACTOR, null);

    process.env.AGENDA = "on";
    process.env.CAMPAIGNS = "on";
    process.env.ATRIBUCION = "";
    process.env.CHANNELS = "whatsapp";
    const antes = await getOrgModules(hoy.id);
    expect(await backfillOrgModules()).toBeGreaterThanOrEqual(1);
    // Dos veces: idempotente.
    expect(await backfillOrgModules()).toBe(0);

    const filas = await getSystemDb()
      .select()
      .from(schema.organizationModule)
      .where(inArray(schema.organizationModule.organizationId, [hoy.id, cambiada.id]));
    const deHoy = filas.find((f) => f.organizationId === hoy.id)!;
    expect(deHoy).toMatchObject({ agenda: true, campaigns: true, atribucion: false, channels: [], updatedBy: "entorno" });
    // Lo que veía antes del relleno es exactamente lo que ve después.
    forgetOrgModules();
    expect(await getOrgModules(hoy.id)).toEqual(antes);
    expect(filas.find((f) => f.organizationId === cambiada.id)).toMatchObject({ agenda: false, campaigns: false });
  });
});

describe("un módulo apagado en B responde 404 aunque A lo tenga encendido", () => {
  let A: { id: string };
  let B: { id: string };
  beforeAll(async () => {
    A = await crearOrganizacion("ModA");
    B = await crearOrganizacion("ModB");
    await changeOrganizationModules(
      A.id,
      { campaigns: true, agenda: true, atribucion: true, messenger: true, instagram: true },
      ACTOR,
      null
    );
    await changeOrganizationModules(
      B.id,
      { campaigns: false, agenda: false, atribucion: false, messenger: false, instagram: false },
      ACTOR,
      null
    );
  });
  afterAll(async () => {
    state.session = null;
    await borrarOrganizaciones([A.id, B.id]);
  });

  const RUTAS: [string, string][] = [
    ["campaigns", "Campañas"],
    ["bookings", "Agenda (citas)"],
    ["calendar/settings", "Agenda (horario)"],
    ["settings/zoom", "Agenda (Zoom)"],
    ["settings/capi", "Atribución"],
    ["settings/messenger", "Messenger"],
    ["settings/instagram", "Instagram"],
  ];

  it.each(RUTAS)("GET /api/%s (%s): A ≠ 404, B = 404", async (route) => {
    como(A.id, "owner");
    expect(await get(route)).not.toBe(404);
    como(B.id, "owner");
    expect(await get(route)).toBe(404);
  });

  it("sin permiso es 403 antes que nada (el Asesor de A en Campañas)", async () => {
    como(A.id, "asesor");
    expect(await get("campaigns")).toBe(403);
  });

  it("las preguntas del servidor contestan por organización", async () => {
    expect(await campaignsEnabled(A.id)).toBe(true);
    expect(await campaignsEnabled(B.id)).toBe(false);
    expect(await atribucionEnabled(A.id)).toBe(true);
    expect(await atribucionEnabled(B.id)).toBe(false);
    expect(await isChannelEnabled(B.id, "messenger")).toBe(false);
    // La URL del webhook de Messenger es de la plataforma: existe si alguien lo tiene.
    expect(await someOrgHasChannel("messenger")).toBe(true);
  });

  it("el ritmo de campañas es de cada organización (1–80), nulo vuelve al entorno", async () => {
    process.env.CAMPAIGN_SEND_RATE = "";
    await changeOrganizationModules(A.id, { campaignSendRate: 25 }, ACTOR, null);
    expect(await campaignSendRate(A.id)).toBe(25);
    expect(await campaignSendRate(B.id)).toBe(10);
    await changeOrganizationModules(A.id, { campaignSendRate: null }, ACTOR, null);
    expect(await campaignSendRate(A.id)).toBe(10);
    await expect(
      getSystemDb()
        .update(schema.organizationModule)
        .set({ campaignSendRate: 500 })
        .where(eq(schema.organizationModule.organizationId, A.id))
    ).rejects.toThrow();
  });
});

describe("edición desde /platform", () => {
  const creadas: string[] = [];
  afterAll(() => borrarOrganizaciones(creadas));

  it("cada cambio queda en la bitácora con el antes y el después; sin cambios, nada", async () => {
    const O = await crearOrganizacion("ModBitacora");
    creadas.push(O.id);
    await changeOrganizationModules(O.id, { agenda: false, messenger: false }, ACTOR, "10.0.0.9");
    const antes = (await listPlatformAudit({ organizationId: O.id })).length;
    await changeOrganizationModules(O.id, { agenda: true, messenger: true }, ACTOR, "10.0.0.9");
    const bitacora = await listPlatformAudit({ organizationId: O.id });
    expect(bitacora.length).toBe(antes + 1);
    expect(bitacora[0]).toMatchObject({
      action: "organization.modules_changed",
      actorEmail: ACTOR.email,
      ip: "10.0.0.9",
      detail: { agenda: { de: false, a: true }, messenger: { de: false, a: true } },
    });
    await changeOrganizationModules(O.id, { agenda: true }, ACTOR, null);
    expect((await listPlatformAudit({ organizationId: O.id })).length).toBe(antes + 1);

    const listado = (await listOrganizations()).find((o) => o.id === O.id);
    expect(listado?.modules).toMatchObject({ agenda: true, messenger: true });
  });

  it("una organización que no existe → 404", async () => {
    await expect(changeOrganizationModules("org_no_existe", { agenda: true }, ACTOR, null)).rejects.toMatchObject(
      new PlatformError(404, "not_found", "Organización no encontrada")
    );
  });
});

describe("aislamiento y parent_id", () => {
  const creadas: string[] = [];
  afterAll(async () => {
    for (const id of creadas) {
      await getSystemDb().update(schema.organization).set({ parentId: null }).where(eq(schema.organization.id, id));
    }
    await borrarOrganizaciones(creadas);
  });

  it("vocero_app solo ve la fila de módulos de SU organización (RLS)", async () => {
    const A = await crearOrganizacion("ModRlsA");
    const B = await crearOrganizacion("ModRlsB");
    creadas.push(A.id, B.id);
    await backfillOrgModules();
    const vistas = await withTenant(A.id, (db) => db.select().from(schema.organizationModule));
    expect(vistas.map((f) => f.organizationId)).toEqual([A.id]);
  });

  it("parent_id es opcional, no puede apuntar a sí misma y la madre no se borra con hijas", async () => {
    const madre = await crearOrganizacion("ModMadre");
    const hija = await crearOrganizacion("ModHija");
    creadas.push(madre.id, hija.id);
    const db = getSystemDb();
    await expect(
      db.update(schema.organization).set({ parentId: madre.id }).where(eq(schema.organization.id, madre.id))
    ).rejects.toThrow();
    await db.update(schema.organization).set({ parentId: madre.id }).where(eq(schema.organization.id, hija.id));
    await expect(db.delete(schema.organization).where(eq(schema.organization.id, madre.id))).rejects.toThrow();
    const [h] = await db.select({ parentId: schema.organization.parentId }).from(schema.organization).where(eq(schema.organization.id, hija.id));
    expect(h?.parentId).toBe(madre.id);
  });
});
