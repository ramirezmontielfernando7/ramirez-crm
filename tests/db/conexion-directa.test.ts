import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb, getSystemDb, getSystemSql, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { DEFAULT_DIRECT_SETTINGS } from "@/lib/direct-connection";
import { runWithOrganization } from "@/lib/request-context";
import { openServerKey, serverForNewOrganization } from "@/server/credentials/direct";
import { runCredentialMaintenance } from "@/server/credentials/maintenance";
import { directConnectionGrants } from "@/server/direct-connection/grants";
import { getDirectSettings } from "@/server/direct-connection/settings";
import { conexionDirectaOff, forgetOrgModules, getOrgModules } from "@/server/modules";
import { addServer, changeServer, listServers, removeServer } from "@/server/platform-admin/direct-servers";
import { changeOrganizationModules, PlatformError } from "@/server/platform-admin/organizations";
import { getEffectiveLimits } from "@/server/limits";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Conexión directa (PR 1) — módulo y datos contra Postgres real (la app como
 * `vocero_app`, con RLS):
 *
 * - El complemento nace apagado; sin él, sus rutas son 404 y no hay
 *   delegaciones. /platform lo enciende sin tocar el plan.
 * - Los DEFAULT de la 0055 son los de `DEFAULT_DIRECT_SETTINGS`.
 * - Los ajustes y la conexión de una organización no se ven desde otra.
 * - Servidores: la llave se guarda cifrada (nunca en claro), sale solo con
 *   sus últimos 4, se lee de vuelta, rota con ENCRYPTION_KEY y queda en la
 *   bitácora sin su valor. La app (`vocero_app`) no puede leer la tabla.
 * - Las columnas nuevas de chat, mensaje y contacto rechazan valores fuera de
 *   lo previsto.
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);
const actor = { userId: "", email: "fer@plataforma.test" };
const LLAVE_ORIGINAL = process.env.ENCRYPTION_KEY!;

function usarLlaves(env: Record<string, string | undefined>) {
  for (const k of ["ENCRYPTION_KEY", "ENCRYPTION_KEY_VERSION", "ENCRYPTION_KEY_OLD", "ENCRYPTION_KEY_OLD_VERSION"]) {
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  resetEnvCacheForTests();
}

describe("conexión directa — módulo y datos", () => {
  let A: Org;
  let B: Org;
  const servidores: string[] = [];

  beforeAll(async () => {
    A = await crearOrganizacion("Directa A");
    B = await crearOrganizacion("Directa B");
    actor.userId = newId("user");
    await getSystemDb()
      .insert(schema.user)
      .values({ id: actor.userId, name: "Fer", email: `${actor.userId}@x.test`, emailVerified: true });
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
    if (servidores.length > 0) {
      await getSystemDb().delete(schema.evolutionServer).where(inArray(schema.evolutionServer.id, servidores));
    }
    await getSystemDb().delete(schema.user).where(eq(schema.user.id, actor.userId));
    usarLlaves({ ENCRYPTION_KEY: LLAVE_ORIGINAL });
  });

  it("nace apagado: sus rutas son 404 y no hay delegaciones", async () => {
    forgetOrgModules(A.id);
    expect((await getOrgModules(A.id)).conexionDirecta).toBe(false);
    expect((await conexionDirectaOff(A.id))?.status).toBe(404);
    expect(await as(A.id, () => directConnectionGrants(A.id, "coordinador"))).toEqual([]);
  });

  it("/platform lo enciende sin cambiar el plan ni el conteo de módulos", async () => {
    const planAntes = (await as(A.id, () => getEffectiveLimits(A.id))).planKey;
    const m = await changeOrganizationModules(A.id, { conexionDirecta: true }, actor, null);
    expect(m.conexionDirecta).toBe(true);
    expect((await as(A.id, () => getEffectiveLimits(A.id))).planKey).toBe(planAntes);
    expect(await conexionDirectaOff(A.id)).toBeNull();
    // B sigue sin nada.
    expect((await getOrgModules(B.id)).conexionDirecta).toBe(false);
    // Mover otro interruptor no lo apaga.
    const conPlan = await changeOrganizationModules(A.id, { campaigns: false }, actor, null);
    expect(conPlan.conexionDirecta).toBe(true);
    const [bitacora] = await getSystemDb()
      .select({ detail: schema.platformAuditLog.detail })
      .from(schema.platformAuditLog)
      .where(eq(schema.platformAuditLog.targetOrgId, A.id))
      .limit(1);
    expect(JSON.stringify(bitacora?.detail ?? {})).toContain("conexionDirecta");
  });

  it("sin fila, los ajustes por defecto; los DEFAULT de la 0055 son los mismos", async () => {
    expect(await as(A.id, () => getDirectSettings(A.id))).toEqual(DEFAULT_DIRECT_SETTINGS);
    await as(A.id, () => getDb().insert(schema.directConnectionSettings).values({ organizationId: A.id }));
    const leidos = await as(A.id, () => getDirectSettings(A.id));
    expect(leidos).toEqual(DEFAULT_DIRECT_SETTINGS);
  });

  it("con el módulo, el Coordinador recibe «cambiar el modo» de fábrica; el Asesor, lo que le delegan", async () => {
    forgetOrgModules(A.id);
    expect(await as(A.id, () => directConnectionGrants(A.id, "coordinador"))).toEqual(["direct_connection.mode"]);
    expect(await as(A.id, () => directConnectionGrants(A.id, "asesor"))).toEqual([]);
    await as(A.id, () =>
      getDb()
        .update(schema.directConnectionSettings)
        .set({ linkRoles: ["asesor"], limitsRoles: ["asesor"] })
        .where(eq(schema.directConnectionSettings.organizationId, A.id))
    );
    expect(await as(A.id, () => directConnectionGrants(A.id, "asesor"))).toEqual([
      "direct_connection.link",
      "direct_connection.limits",
    ]);
  });

  it("la BD rechaza ajustes fuera de rango y roles que no se delegan", async () => {
    const mal = [
      { minIntervalSeconds: -1 },
      { perChatPerMinute: 0 },
      { perHour: 20_000 },
      { modeRoles: ["owner"] },
      { defaultMode: "otra" as "meta" },
    ];
    for (const set of mal) {
      await expect(
        as(A.id, () =>
          getDb().update(schema.directConnectionSettings).set(set).where(eq(schema.directConnectionSettings.organizationId, A.id))
        )
      ).rejects.toThrow();
    }
  });

  it("los ajustes y la conexión de A no se ven ni se tocan desde B", async () => {
    const desdeB = await as(B.id, () => getDb().select().from(schema.directConnectionSettings));
    expect(desdeB.find((r) => r.organizationId === A.id)).toBeUndefined();
    await expect(
      as(B.id, () => getDb().insert(schema.directConnectionSettings).values({ organizationId: A.id }))
    ).rejects.toThrow();
  });

  it("servidores: la llave queda cifrada, sale solo con sus últimos 4 y se lee de vuelta", async () => {
    const llave = "llave-maestra-secreta-1234ABCD";
    const s = await addServer(
      { name: "Principal", baseUrl: "https://directa-a.ejemplo.test/", apiKey: llave },
      actor,
      null
    );
    servidores.push(s.id);
    expect(s).toMatchObject({ baseUrl: "https://directa-a.ejemplo.test", apiKeyLast4: "ABCD", maxInstances: 25, status: "active", used: 0 });
    expect(JSON.stringify(s)).not.toContain(llave);
    const [fila] = await getSystemDb().select().from(schema.evolutionServer).where(eq(schema.evolutionServer.id, s.id));
    expect(JSON.stringify(fila)).not.toContain(llave);
    expect(await openServerKey(s.id)).toEqual({ ok: true, baseUrl: "https://directa-a.ejemplo.test", apiKey: llave });
    expect((await listServers()).some((x) => x.id === s.id)).toBe(true);

    // Duplicado y dirección insegura: rechazados.
    await expect(addServer({ name: "Otra", baseUrl: "https://directa-a.ejemplo.test", apiKey: "otra-llave-123" }, actor, null)).rejects.toMatchObject({
      status: 409,
    });
    await expect(addServer({ name: "Mala", baseUrl: "http://directa.ejemplo.test", apiKey: "otra-llave-123" }, actor, null)).rejects.toBeInstanceOf(PlatformError);

    // Cambiar la llave: la bitácora dice que cambió (últimos 4), nunca su valor.
    const nueva = "otra-llave-maestra-9999WXYZ";
    const cambiado = await changeServer(s.id, { apiKey: nueva, maxInstances: 15 }, actor, null);
    expect(cambiado).toMatchObject({ apiKeyLast4: "WXYZ", maxInstances: 15 });
    expect(await openServerKey(s.id)).toMatchObject({ ok: true, apiKey: nueva });
    const entradas = await getSystemDb()
      .select({ action: schema.platformAuditLog.action, detail: schema.platformAuditLog.detail })
      .from(schema.platformAuditLog)
      .where(inArray(schema.platformAuditLog.action, ["direct_server.added", "direct_server.changed"]));
    const texto = JSON.stringify(entradas);
    expect(texto).toContain(s.id);
    expect(texto).not.toContain(llave);
    expect(texto).not.toContain(nueva);
  });

  it("la app atendiendo a una organización no puede leer los servidores", async () => {
    const usaRoles = new URL(process.env.DATABASE_URL!).username === "vocero_app";
    if (!usaRoles) return;
    await expect(as(A.id, () => getDb().select().from(schema.evolutionServer))).rejects.toThrow();
  });

  it("un servidor con empresas no se borra; sin empresas, sí", async () => {
    const id = servidores[0]!;
    await as(A.id, () =>
      getDb().insert(schema.directConnection).values({ id: newId("directConnection"), organizationId: A.id, serverId: id, instanceName: `org-${A.id}` })
    );
    expect((await listServers()).find((x) => x.id === id)?.used).toBe(1);
    await expect(removeServer(id, actor, null)).rejects.toMatchObject({ status: 409 });
    // Una empresa nueva cae en el que tenga lugar (este, con 14 libres).
    expect((await serverForNewOrganization())?.id).toBeTruthy();
    await as(A.id, () => getDb().delete(schema.directConnection).where(eq(schema.directConnection.organizationId, A.id)));
    await removeServer(id, actor, null);
    servidores.splice(0, 1);
    expect((await listServers()).some((x) => x.id === id)).toBe(false);
  });

  it("la conexión de una organización es una sola por ahora, y la llave va completa o vacía", async () => {
    const s = await addServer({ name: "Segundo", baseUrl: "https://directa-b.ejemplo.test", apiKey: "llave-segundo-0000" }, actor, null);
    servidores.push(s.id);
    const base = { organizationId: B.id, serverId: s.id };
    await as(B.id, () => getDb().insert(schema.directConnection).values({ id: newId("directConnection"), ...base, instanceName: "b-1" }));
    await expect(
      as(B.id, () => getDb().insert(schema.directConnection).values({ id: newId("directConnection"), ...base, instanceName: "b-2" }))
    ).rejects.toThrow();
    await expect(
      as(B.id, () =>
        getDb().update(schema.directConnection).set({ instanceKeyCipher: "x" }).where(eq(schema.directConnection.organizationId, B.id))
      )
    ).rejects.toThrow();
    await as(B.id, () => getDb().delete(schema.directConnection).where(eq(schema.directConnection.organizationId, B.id)));
  });

  it("rotación de ENCRYPTION_KEY: la llave del servidor se re-cifra y se sigue leyendo", async () => {
    const id = servidores[servidores.length - 1]!;
    const nueva = randomBytes(32).toString("base64");
    usarLlaves({ ENCRYPTION_KEY: nueva, ENCRYPTION_KEY_VERSION: "2", ENCRYPTION_KEY_OLD: LLAVE_ORIGINAL, ENCRYPTION_KEY_OLD_VERSION: "1" });
    const reportes = await runCredentialMaintenance();
    expect(reportes?.find((r) => r.table === "evolution_server")?.rotated).toBeGreaterThanOrEqual(1);
    expect(reportes?.some((r) => r.table === "direct_connection")).toBe(true);
    usarLlaves({ ENCRYPTION_KEY: nueva, ENCRYPTION_KEY_VERSION: "2" });
    expect(await openServerKey(id)).toMatchObject({ ok: true, apiKey: "llave-segundo-0000" });
    // De regreso a la llave original para el resto de la suite.
    usarLlaves({ ENCRYPTION_KEY: LLAVE_ORIGINAL, ENCRYPTION_KEY_OLD: nueva, ENCRYPTION_KEY_OLD_VERSION: "2" });
    await runCredentialMaintenance();
    usarLlaves({ ENCRYPTION_KEY: LLAVE_ORIGINAL });
    expect(await openServerKey(id)).toMatchObject({ ok: true, apiKey: "llave-segundo-0000" });
  });

  it("chat, mensaje y contacto: columnas nuevas vacías por defecto y con valores cerrados", async () => {
    const [col] = await getSystemSql()<{ n: number }[]>`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and (
        (table_name = 'conversation' and column_name in ('connection_mode', 'connection_mode_changed_at')) or
        (table_name = 'message' and column_name in ('transport', 'alt_message_id', 'queued_until')) or
        (table_name = 'contact' and column_name = 'wa_lid') or
        (table_name = 'organization_module' and column_name = 'conexion_directa'))`;
    expect(col?.n).toBe(7);
    const sql = getSystemSql();
    const ct = newId("contact");
    const cv = newId("conversation");
    const msg = newId("message");
    await sql`insert into contact (id, organization_id, wa_identity, name) values (${ct}, ${A.id}, '5215500001111', 'Cliente')`;
    await sql`insert into conversation (id, organization_id, contact_id) values (${cv}, ${A.id}, ${ct})`;
    await sql`insert into message (id, organization_id, conversation_id, direction) values (${msg}, ${A.id}, ${cv}, 'out')`;
    const [antes] = await sql<{ mode: string | null; transport: string | null; lid: string | null }[]>`
      select c.connection_mode as mode, m.transport, k.wa_lid as lid
      from conversation c join message m on m.conversation_id = c.id join contact k on k.id = c.contact_id
      where c.id = ${cv}`;
    expect(antes).toEqual({ mode: null, transport: null, lid: null });
    await expect(sql`update conversation set connection_mode = 'otra' where id = ${cv}`).rejects.toThrow();
    await expect(sql`update message set transport = 'otra' where id = ${msg}`).rejects.toThrow();
    await sql`update conversation set connection_mode = 'mixta' where id = ${cv}`;
    await sql`update message set transport = 'directa', alt_message_id = 'ALT-1' where id = ${msg}`;
    // Un `@lid` es de un solo contacto en la organización.
    await sql`update contact set wa_lid = '123@lid' where id = ${ct}`;
    await expect(
      sql`insert into contact (id, organization_id, wa_identity, name, wa_lid) values (${newId("contact")}, ${A.id}, '5215500002222', 'Otro', '123@lid')`
    ).rejects.toThrow();
  });
});
