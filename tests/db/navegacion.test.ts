import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb, getSystemDb, schema, withTenant } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import { defaultLayout, type NavLayoutItem } from "@/lib/modules/nav-layout";
import { listPlatformAudit } from "@/server/platform-admin/audit";
import { changeOrganizationModules, createOrganization, PlatformError } from "@/server/platform-admin/organizations";
import { forgetOrgModules, getOrgModules } from "@/server/modules/store";
import { orgHasModule } from "@/server/modules";
import {
  getNavLayout,
  getNavLayouts,
  listNavLayoutEvents,
  NavLayoutError,
  resetNavLayout,
  saveNavLayout,
} from "@/server/navigation/store";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 030 (PR 4) — Módulos nuevos de la 0034 y menú por rol contra Postgres real:
 * dependencia Laboratorio → Agente, perfiles de alta, guardar/restaurar con
 * bitácora append-only y aislamiento entre organizaciones (RLS).
 */

const ACTOR = { userId: "usr_admin_nav", email: "admin@nav.test" };

beforeEach(() => forgetOrgModules());

async function usuario(organizationId: string): Promise<string> {
  const id = `usr_nav_${Math.random().toString(36).slice(2, 8)}`;
  await getSystemDb().insert(schema.user).values({ id, name: "Dueña Nav", email: `${id}@nav.test` });
  await getSystemDb().insert(schema.member).values({ id: `mem_${id}`, organizationId, userId: id, role: "owner" });
  return id;
}

const asesorSoloBandeja = (): NavLayoutItem[] => [
  { key: "contacts", hidden: false },
  { key: "inbox", hidden: false },
  { key: "team_chat", hidden: true },
  { key: "knowledge", hidden: true },
];

describe("módulos de la 0034", () => {
  const creadas: string[] = [];
  afterAll(() => borrarOrganizaciones(creadas));

  it("una organización con fila de antes conserva lo suyo y recibe los nuevos encendidos", async () => {
    const O = await crearOrganizacion("NavViejo");
    creadas.push(O.id);
    await changeOrganizationModules(O.id, { campaigns: true }, ACTOR, null);
    const m = await getOrgModules(O.id);
    expect(m).toMatchObject({ campaigns: true, knowledge: true, lab: true, agent: true, teamChat: true, results: true, customNav: false });
  });

  it("apagar el Agente apaga el Laboratorio (y lo registra); encender el Laboratorio sin Agente → 422", async () => {
    const O = await crearOrganizacion("NavAgente");
    creadas.push(O.id);
    const dto = await changeOrganizationModules(O.id, { agent: false }, ACTOR, null);
    expect(dto).toMatchObject({ agent: false, lab: false });
    expect(await orgHasModule(O.id, "lab")).toBe(false);
    const [ultimo] = await listPlatformAudit({ organizationId: O.id });
    expect(ultimo?.detail).toMatchObject({ agent: { de: true, a: false }, lab: { de: true, a: false } });
    await expect(changeOrganizationModules(O.id, { lab: true }, ACTOR, null)).rejects.toMatchObject(
      new PlatformError(422, "module_dependency", "El Laboratorio requiere el Agente: enciende primero el Agente")
    );
    expect(await changeOrganizationModules(O.id, { agent: true, lab: true }, ACTOR, null)).toMatchObject({ agent: true, lab: true });
    // La BD también lo impide.
    await expect(
      getSystemDb().update(schema.organizationModule).set({ agent: false }).where(eq(schema.organizationModule.organizationId, O.id))
    ).rejects.toThrow();
  });

  it("los perfiles Básico y Completo son solo la plantilla del alta", async () => {
    for (const profile of ["basico", "completo"] as const) {
      const email = `dueno-${profile}@nav.test`;
      const r = await createOrganization({ name: `Perfil ${profile}`, ownerName: "Dueño", ownerEmail: email, profile }, ACTOR, null);
      creadas.push(r.organizationId);
      const m = await getOrgModules(r.organizationId);
      if (profile === "basico") {
        expect(m).toMatchObject({ agent: false, lab: false, campaigns: false, knowledge: true, teamChat: true, customNav: false });
      } else {
        expect(m).toMatchObject({ agent: true, lab: true, campaigns: true, agenda: true, customNav: true });
      }
      // Después, cada interruptor es independiente.
      await changeOrganizationModules(r.organizationId, { customNav: profile === "basico" }, ACTOR, null);
      expect((await getOrgModules(r.organizationId)).customNav).toBe(profile === "basico");
      await getSystemDb().delete(schema.user).where(eq(schema.user.email, email));
    }
  });
});

describe("menú por rol: guardar, restaurar y bitácora", () => {
  let A: { id: string };
  let B: { id: string };
  let dueña: string;
  beforeAll(async () => {
    A = await crearOrganizacion("NavA");
    B = await crearOrganizacion("NavB");
    dueña = await usuario(A.id);
  });
  afterAll(async () => {
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, dueña));
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("guarda el del Asesor, lo deja en la bitácora y restaurar vuelve al de fábrica", async () => {
    const items = await saveNavLayout({ organizationId: A.id, role: "asesor", items: asesorSoloBandeja(), actorUserId: dueña });
    expect(items.slice(0, 3).map((i) => i.key)).toEqual(["contacts", "inbox", "team_chat"]);
    const guardado = await runWithOrganization(A.id, () => getNavLayouts(A.id));
    expect(guardado.asesor?.find((i) => i.key === "team_chat")?.hidden).toBe(true);
    expect(guardado.coordinador).toBeNull();

    // Guardar lo mismo otra vez no escribe nada.
    await saveNavLayout({ organizationId: A.id, role: "asesor", items: asesorSoloBandeja(), actorUserId: dueña });
    await resetNavLayout({ organizationId: A.id, role: "asesor", actorUserId: dueña });
    expect(await runWithOrganization(A.id, () => getNavLayout(A.id, "asesor"))).toBeNull();

    const eventos = await runWithOrganization(A.id, () => listNavLayoutEvents(A.id));
    expect(eventos.map((e) => [e.role, e.action])).toEqual([
      ["asesor", "reset"],
      ["asesor", "saved"],
    ]);
    expect(eventos[0]?.actorName).toBe("Dueña Nav");
    const [fila] = await withTenant(A.id, (tx) =>
      tx.select().from(schema.navLayoutEvent).where(eq(schema.navLayoutEvent.id, eventos[1]!.id))
    );
    expect(fila).toMatchObject({ before: null });
    expect((fila?.after as NavLayoutItem[])[0]).toEqual({ key: "contacts", hidden: false });
  });

  it("guardar el de fábrica no deja fila", async () => {
    await saveNavLayout({ organizationId: A.id, role: "coordinador", items: defaultLayout("coordinador"), actorUserId: dueña });
    expect(await runWithOrganization(A.id, () => getNavLayout(A.id, "coordinador"))).toBeNull();
  });

  it("reglas: el Propietario no se oculta Ajustes; cada rol conserva una entrada", async () => {
    const sinAjustes = defaultLayout("owner").map((i) => (i.key === "settings" ? { ...i, hidden: true } : i));
    await expect(saveNavLayout({ organizationId: A.id, role: "owner", items: sinAjustes, actorUserId: dueña })).rejects.toBeInstanceOf(
      NavLayoutError
    );
    const nada = defaultLayout("asesor").map((i) => ({ ...i, hidden: true }));
    await expect(saveNavLayout({ organizationId: A.id, role: "asesor", items: nada, actorUserId: dueña })).rejects.toMatchObject({
      problem: { code: "empty" },
    });
  });

  it("la bitácora es append-only", async () => {
    await saveNavLayout({ organizationId: A.id, role: "asesor", items: asesorSoloBandeja(), actorUserId: dueña });
    await expect(
      withTenant(A.id, (tx) => tx.update(schema.navLayoutEvent).set({ role: "owner" }).where(eq(schema.navLayoutEvent.organizationId, A.id)))
    ).rejects.toThrow();
  });

  it("aislamiento: B no ve, no cambia y no escribe el menú de A", async () => {
    await saveNavLayout({ organizationId: A.id, role: "asesor", items: asesorSoloBandeja(), actorUserId: dueña });
    // Con B en el contexto, cero filas de A (RLS), aunque se pida por la organización de A.
    const visto = await withTenant(B.id, (tx) => tx.select().from(schema.navLayout).where(sql`true`));
    expect(visto).toEqual([]);
    const eventosVistos = await withTenant(B.id, (tx) => tx.select().from(schema.navLayoutEvent).where(sql`true`));
    expect(eventosVistos).toEqual([]);
    const cambiadas = await withTenant(B.id, (tx) =>
      tx.update(schema.navLayout).set({ items: [] }).where(eq(schema.navLayout.organizationId, A.id)).returning()
    );
    expect(cambiadas).toEqual([]);
    await expect(
      withTenant(B.id, (tx) => tx.insert(schema.navLayout).values({ organizationId: A.id, role: "owner", items: [] }))
    ).rejects.toThrow();
    // Sin organización en el contexto, la app no ve nada.
    const sinContexto = await getDb().execute(sql`select count(*)::int as n from nav_layout`).catch(() => null);
    if (sinContexto) expect((sinContexto as unknown as { n: number }[])[0]?.n).toBe(0);
    // A sigue intacto.
    expect((await runWithOrganization(A.id, () => getNavLayout(A.id, "asesor")))?.length).toBeGreaterThan(0);
  });

  it("purgar la organización borra su menú y su bitácora en cascada", async () => {
    const C = await crearOrganizacion("NavC");
    const dueñaC = await usuario(C.id);
    await saveNavLayout({ organizationId: C.id, role: "asesor", items: asesorSoloBandeja(), actorUserId: dueñaC });
    await borrarOrganizaciones([C.id]);
    const quedan = await getSystemDb().select().from(schema.navLayoutEvent).where(eq(schema.navLayoutEvent.organizationId, C.id));
    expect(quedan).toEqual([]);
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, dueñaC));
  });
});
