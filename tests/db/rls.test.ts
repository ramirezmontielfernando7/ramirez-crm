import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, getSql, getSystemDb, getSystemSql, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { runWithOrganization } from "@/lib/request-context";
import { processMessagesValue } from "@/server/inbox/ingest";
import type { WebhookValue } from "@/server/inbox/webhook";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Fase 1 multitenant, PR 4 — RLS (migración 0027).
 *
 * 1. Guardarraíl: toda tabla de `public` tiene RLS activo y FORZADO con la
 *    política de organización, o está en EXCEPCIONES con su motivo. Una tabla
 *    nueva sin política pone esto en rojo en CI.
 * 2. Fugas, conectada como `vocero_app` (como en CI): con la organización A
 *    en el contexto, nada de B se ve, se cambia ni se escribe; sin
 *    organización, cero filas.
 */

const EXCEPCIONES: Record<string, string> = {
  user: "better-auth; sin organization_id: una persona no es de un negocio sino de sus membresías (member, que sí tiene RLS)",
  session: "better-auth; sin organization_id; solo la lee y escribe el pool de sistema",
  account: "better-auth (credenciales de login); sin organization_id; solo el pool de sistema",
  verification: "better-auth (tokens de verificación); sin organization_id; solo el pool de sistema",
  platform_admin: "Fase 3 PR 2: administradores de la plataforma, por encima de las organizaciones; solo el pool de sistema",
  platform_audit_log: "Fase 3 PR 2: bitácora del administrador de plataforma, sobrevive al borrado de la organización; solo el pool de sistema",
  account_link_token: "Fase 3 PR 2: enlaces de un solo uso para poner contraseña, antes de tener sesión; solo el pool de sistema",
  webhook_unrouted: "Fase 3 PR 1: eventos de Meta sin organización conocida (justo no se pudo enrutar); solo el pool de sistema, cifrados, 7 días",
};

const POLITICA = "aislamiento_por_organizacion";
const usaRoles = new URL(process.env.DATABASE_URL!).username === "vocero_app";

type Tabla = { tabla: string; rls: boolean; forzado: boolean; tiene_org: boolean };

async function tablas(): Promise<Tabla[]> {
  return getSystemSql()<Tabla[]>`
    select c.relname as tabla, c.relrowsecurity as rls, c.relforcerowsecurity as forzado,
      exists (select 1 from information_schema.columns k
              where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'organization_id') as tiene_org
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by 1
  `;
}

describe("RLS: toda tabla protegida o justificada", () => {
  it("cada tabla tiene RLS forzado con la política, o es una excepción declarada", async () => {
    const todas = await tablas();
    expect(todas.length).toBeGreaterThan(40);
    const politicas = await getSystemSql()<{ tablename: string; cmd: string; qual: string; with_check: string }[]>`
      select tablename, cmd, qual, with_check from pg_policies
      where schemaname = 'public' and policyname = ${POLITICA}
    `;
    const porTabla = new Map(politicas.map((p) => [p.tablename, p]));
    const mal: string[] = [];
    for (const t of todas) {
      if (t.tabla in EXCEPCIONES) {
        if (t.tiene_org) mal.push(`${t.tabla}: es excepción pero tiene organization_id`);
        continue;
      }
      if (!t.rls || !t.forzado) mal.push(`${t.tabla}: sin ENABLE + FORCE ROW LEVEL SECURITY`);
      const p = porTabla.get(t.tabla);
      const columna = t.tabla === "organization" ? "id" : "organization_id";
      const esperado = `(${columna} = current_setting('app.org_id'::text, true))`;
      if (!p) mal.push(`${t.tabla}: sin la política ${POLITICA}`);
      else if (p.cmd !== "ALL" || p.qual !== esperado || p.with_check !== esperado) {
        mal.push(`${t.tabla}: política distinta (${p.cmd} ${p.qual} / ${p.with_check})`);
      }
    }
    expect(mal, mal.join("\n")).toEqual([]);
  });

  it("no hay más políticas que la de organización (una PERMISSIVE extra abriría la puerta)", async () => {
    const otras = await getSystemSql()<{ tablename: string; policyname: string }[]>`
      select tablename, policyname from pg_policies
      where schemaname = 'public' and policyname <> ${POLITICA}
    `;
    expect(otras).toEqual([]);
  });

  it("la lista de excepciones no tiene tablas que ya no existen", async () => {
    const nombres = new Set((await tablas()).map((t) => t.tabla));
    expect(Object.keys(EXCEPCIONES).filter((n) => !nombres.has(n))).toEqual([]);
  });
});

function entrante(phoneNumberId: string, from: string): WebhookValue {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "5215500000000", phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: `Cliente ${from}` }, wa_id: from }],
    messages: [
      {
        from,
        id: `wamid.rls.${from}.${Math.random().toString(36).slice(2)}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: "hola" },
      },
    ],
  } as WebhookValue;
}

describe.skipIf(!usaRoles)("RLS: sin fugas entre organizaciones (conectada como vocero_app)", () => {
  let A: Awaited<ReturnType<typeof crearOrganizacion>>;
  let B: Awaited<ReturnType<typeof crearOrganizacion>>;
  let contactoB: string;
  let conversacionB: string;

  beforeAll(async () => {
    A = await crearOrganizacion("RLS A");
    B = await crearOrganizacion("RLS B");
    // Datos de clientes en las dos, por el camino real de la ingesta.
    await processMessagesValue(entrante(A.phoneNumberId, "5215522220001"));
    await processMessagesValue(entrante(B.phoneNumberId, "5215522220002"));
    const [c] = await getSystemSql()<{ id: string; conv: string }[]>`
      select ct.id, cv.id as conv from contact ct join conversation cv on cv.contact_id = ct.id
      where ct.organization_id = ${B.id} limit 1
    `;
    contactoB = c!.id;
    conversacionB = c!.conv;
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("con A en el contexto, ninguna tabla deja ver una fila de otra organización", async () => {
    const protegidas = (await tablas()).filter((t) => !(t.tabla in EXCEPCIONES));
    const fugas: string[] = [];
    await runWithOrganization(A.id, async () => {
      for (const t of protegidas) {
        const col = t.tabla === "organization" ? "id" : "organization_id";
        const [r] = await getDb().execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.identifier(t.tabla)} where ${sql.identifier(col)} <> ${A.id}`
        );
        if ((r?.n ?? 0) > 0) fugas.push(`${t.tabla}: ${r?.n} fila(s) ajenas`);
      }
    });
    expect(fugas, fugas.join("\n")).toEqual([]);
  });

  it("las filas de B existen (el sistema las ve) pero A no las encuentra ni por id", async () => {
    const [sis] = await getSystemSql()<{ n: number }[]>`select count(*)::int as n from contact where id = ${contactoB}`;
    expect(sis?.n).toBe(1);
    const vistos = await runWithOrganization(A.id, () =>
      getDb().select({ id: schema.contact.id }).from(schema.contact).where(sql`${schema.contact.id} = ${contactoB}`)
    );
    expect(vistos).toEqual([]);
  });

  it("A no puede cambiar ni borrar filas de B (0 filas afectadas)", async () => {
    const cambiadas = await runWithOrganization(A.id, () =>
      getDb()
        .update(schema.conversation)
        .set({ aiEnabled: false })
        .where(sql`${schema.conversation.id} = ${conversacionB}`)
        .returning({ id: schema.conversation.id })
    );
    expect(cambiadas).toEqual([]);
    const borradas = await withTenant(A.id, (tx) =>
      tx.delete(schema.contact).where(sql`${schema.contact.id} = ${contactoB}`).returning({ id: schema.contact.id })
    );
    expect(borradas).toEqual([]);
    const [sigue] = await getSystemSql()<{ ai: boolean }[]>`select ai_enabled as ai from conversation where id = ${conversacionB}`;
    expect(sigue?.ai).toBe(true);
  });

  it("A no puede escribir una fila a nombre de B (WITH CHECK)", async () => {
    const err = await runWithOrganization(A.id, () =>
      getDb().insert(schema.contactTag).values({ id: newId("contactTag"), organizationId: B.id, name: "intruso" })
    ).then(
      () => null,
      (e: unknown) => e as Error & { cause?: { code?: string; message?: string } }
    );
    expect(err?.cause?.code).toBe("42501");
    expect(err?.cause?.message).toMatch(/row-level security/);
  });

  it("A solo ve su propia organización", async () => {
    const orgs = await runWithOrganization(A.id, () =>
      getDb().select({ id: schema.organization.id }).from(schema.organization)
    );
    expect(orgs.map((o) => o.id)).toEqual([A.id]);
  });

  it("sin organización en el contexto, el pool de la app no ve nada (y el de sistema sí)", async () => {
    const [app] = await getSql()<{ n: number }[]>`select count(*)::int as n from contact`;
    const [sis] = await getSystemSql()<{ n: number }[]>`select count(*)::int as n from contact`;
    expect(app?.n).toBe(0);
    expect(sis?.n).toBeGreaterThanOrEqual(2);
    const [org] = await getSql()<{ n: number }[]>`select count(*)::int as n from organization`;
    expect(org?.n).toBe(0);
  });

  it("el pool de sistema sigue viendo todo (enrutamiento, arranque)", async () => {
    const filas = await getSystemDb()
      .select({ org: schema.contact.organizationId })
      .from(schema.contact)
      .where(sql`${schema.contact.organizationId} in (${A.id}, ${B.id})`);
    expect(new Set(filas.map((f) => f.org))).toEqual(new Set([A.id, B.id]));
  });
});
