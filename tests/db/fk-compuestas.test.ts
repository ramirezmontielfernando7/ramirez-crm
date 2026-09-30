import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, getSql, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { processMessagesValue } from "@/server/inbox/ingest";
import type { WebhookValue } from "@/server/inbox/webhook";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * Fase 1 multitenant, PR 2 (H6) — FK compuestas contra Postgres real.
 *
 * 1. Una fila de A NO puede colgar de un padre de B: la BD lo rechaza aunque
 *    el código se equivoque (23503).
 * 2. Borrar el padre hace EXACTAMENTE lo de antes: CASCADE borra, SET NULL
 *    pone en NULL solo la columna del padre (nunca organization_id), NO
 *    ACTION/RESTRICT impiden borrar.
 * 3. Borrar la organización entera sigue funcionando (cascada de todo).
 */

type Org = Awaited<ReturnType<typeof crearOrganizacion>>;

function entrante(phoneNumberId: string, from: string): WebhookValue {
  return {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "5215500000000", phone_number_id: phoneNumberId },
    contacts: [{ profile: { name: `Cliente ${from}` }, wa_id: from }],
    messages: [
      {
        from,
        id: `wamid.fk.${from}.${Math.random().toString(36).slice(2)}`,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body: "hola" },
      },
    ],
  } as WebhookValue;
}

/** Un cliente con contacto, conversación, mensaje y lead en la organización. */
async function sembrar(org: Org, tel: string) {
  await processMessagesValue(entrante(org.phoneNumberId, tel));
  const db = getDb();
  const [conv] = await db
    .select()
    .from(schema.conversation)
    .where(eq(schema.conversation.organizationId, org.id))
    .orderBy(schema.conversation.createdAt);
  const [msg] = await db
    .select()
    .from(schema.message)
    .where(and(eq(schema.message.organizationId, org.id), eq(schema.message.conversationId, conv!.id)));
  const [stage] = await db
    .select()
    .from(schema.pipelineStage)
    .where(eq(schema.pipelineStage.organizationId, org.id));
  const media = newId("mediaAsset");
  await db.insert(schema.mediaAsset).values({ id: media, organizationId: org.id, kind: "image" });
  const tpl = newId("template");
  await db.insert(schema.template).values({
    id: tpl,
    organizationId: org.id,
    name: `tpl_${tel}`,
    language: "es_MX",
    category: "UTILITY",
    body: "hola",
    status: "approved",
  });
  return { conv: conv!, msg: msg!, stage: stage!, media, tpl };
}

/** El código SQLSTATE del error de Postgres (drizzle lo envuelve en `cause`). */
async function codigo(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code ?? "desconocido";
  }
}

describe("FK compuestas de riesgo alto (0024)", () => {
  let A: Org;
  let B: Org;
  let a: Awaited<ReturnType<typeof sembrar>>;
  let b: Awaited<ReturnType<typeof sembrar>>;

  beforeAll(async () => {
    A = await crearOrganizacion("FK A");
    B = await crearOrganizacion("FK B");
    a = await sembrar(A, "5215512340001");
    b = await sembrar(B, "5215512340002");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("un mensaje de A no puede apuntar a una conversación de B", async () => {
    const db = getDb();
    expect(
      await codigo(db.update(schema.message).set({ conversationId: b.conv.id }).where(eq(schema.message.id, a.msg.id)))
    ).toBe("23503");
  });

  it("ni a un adjunto de B; ni una conversación de A a un contacto de B", async () => {
    const db = getDb();
    expect(
      await codigo(db.update(schema.message).set({ mediaAssetId: b.media }).where(eq(schema.message.id, a.msg.id)))
    ).toBe("23503");
    expect(
      await codigo(
        db.update(schema.conversation).set({ contactId: b.conv.contactId }).where(eq(schema.conversation.id, a.conv.id))
      )
    ).toBe("23503");
  });

  it("un lead de A no puede quedar en una etapa de B; una campaña de A no usa plantilla de B", async () => {
    const db = getDb();
    expect(
      await codigo(
        db.update(schema.lead).set({ stageId: b.stage.id }).where(eq(schema.lead.organizationId, A.id))
      )
    ).toBe("23503");
    expect(
      await codigo(
        db.insert(schema.campaign).values({
          id: newId("campaign"),
          organizationId: A.id,
          templateId: b.tpl,
          name: "cruce",
          variables: [],
        })
      )
    ).toBe("23503");
  });

  it("una etiqueta de B no se asigna a un contacto de A; una cita de A no cuelga de un lead de B", async () => {
    const db = getDb();
    const tagB = newId("contactTag");
    await db.insert(schema.contactTag).values({ id: tagB, organizationId: B.id, name: `tag ${tagB}` });
    expect(
      await codigo(
        db.insert(schema.contactTagAssignment).values({
          organizationId: A.id,
          contactId: a.conv.contactId,
          tagId: tagB,
        })
      )
    ).toBe("23503");
    const [leadB] = await db.select().from(schema.lead).where(eq(schema.lead.organizationId, B.id));
    expect(
      await codigo(
        db.insert(schema.booking).values({
          id: newId("booking"),
          organizationId: A.id,
          kind: "block",
          leadId: leadB!.id,
          scheduledAt: new Date(),
          durationMinutes: 30,
        })
      )
    ).toBe("23503");
  });

  it("borrar el adjunto pone en NULL solo media_asset_id del mensaje (no su organization_id)", async () => {
    const db = getDb();
    await db.update(schema.message).set({ mediaAssetId: a.media }).where(eq(schema.message.id, a.msg.id));
    await db.delete(schema.mediaAsset).where(eq(schema.mediaAsset.id, a.media));
    const [m] = await db.select().from(schema.message).where(eq(schema.message.id, a.msg.id));
    expect(m!.mediaAssetId).toBeNull();
    expect(m!.organizationId).toBe(A.id);
  });

  it("una plantilla con campañas no se borra (RESTRICT) y una etapa con leads tampoco (NO ACTION)", async () => {
    const db = getDb();
    await db.insert(schema.campaign).values({
      id: newId("campaign"),
      organizationId: A.id,
      templateId: a.tpl,
      name: "propia",
      variables: [],
    });
    expect(await codigo(db.delete(schema.template).where(eq(schema.template.id, a.tpl)))).toBe("23503");
    const [leadA] = await db.select().from(schema.lead).where(eq(schema.lead.organizationId, A.id));
    expect(
      await codigo(db.delete(schema.pipelineStage).where(eq(schema.pipelineStage.id, leadA!.stageId)))
    ).toBe("23503");
  });

  it("borrar la conversación borra en cascada sus mensajes (igual que antes)", async () => {
    const db = getDb();
    await db.delete(schema.conversation).where(eq(schema.conversation.id, a.conv.id));
    const quedan = await db.select().from(schema.message).where(eq(schema.message.conversationId, a.conv.id));
    expect(quedan).toHaveLength(0);
  });

  it("las definiciones en la BD: SET NULL con lista de columnas, nunca sobre organization_id", async () => {
    const filas = await getSql()<{ conname: string; def: string }[]>`
      select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where contype = 'f' and conname like '%\\_org\\_%\\_fk' escape '\\'`;
    const setNull = filas.filter((f) => f.def.includes("SET NULL"));
    expect(setNull.length).toBeGreaterThan(0);
    for (const f of setNull) {
      expect(f.def, f.conname).toMatch(/ON DELETE SET NULL \([a-z_]+\)$/);
      expect(f.def, f.conname).not.toMatch(/SET NULL \(organization_id/);
    }
  });

  it("borrar la organización entera sigue funcionando", async () => {
    const extra = await crearOrganizacion("FK borrar");
    await sembrar(extra, "5215512340003");
    await borrarOrganizaciones([extra.id]);
    const [n] = await getSql()<{ n: number }[]>`
      select count(*)::int as n from "message" where organization_id = ${extra.id}`;
    expect(n!.n).toBe(0);
  });
});

/**
 * Guardarraíl (0025 en adelante): TODA FK entre dos tablas de dominio es
 * compuesta (organization_id, x) → padre(organization_id, id). Si agregas
 * una tabla o una relación nueva, declárala con foreignKey({ columns:
 * [t.organizationId, t.xId], … }) en schema.ts. Excepciones con motivo:
 */
const FK_SIMPLES_PERMITIDAS: Record<string, string> = {
  member_sales_team_id_sales_team_id_fk:
    "member es de better-auth (la escribe su adaptador) y sales_team no tiene interfaz todavía; RLS (PR 4) la acota",
};

describe("guardarraíl: FK entre tablas de dominio", () => {
  it("toda FK hacia una tabla de dominio es compuesta con organization_id", async () => {
    const filas = await getSql()<{ conname: string; hijo: string; padre: string; cols: string[] }[]>`
      select c.conname, c.conrelid::regclass::text as hijo, c.confrelid::regclass::text as padre,
             array(select a.attname::text from unnest(c.conkey) with ordinality k(n, i)
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.i) as cols
      from pg_constraint c
      join pg_namespace ns on ns.oid = c.connamespace and ns.nspname = 'public'
      where c.contype = 'f'
        and exists (select 1 from pg_attribute a where a.attrelid = c.confrelid and a.attname = 'organization_id')`;
    const simples = filas
      .filter((f) => f.cols[0] !== "organization_id" || f.cols.length < 2)
      .filter((f) => !(f.conname in FK_SIMPLES_PERMITIDAS))
      .map((f) => `${f.hijo}(${f.cols.join(",")}) → ${f.padre}  [${f.conname}]`);
    expect(simples, "FK simples entre tablas de dominio:\n" + simples.join("\n")).toEqual([]);
    expect(filas.length).toBeGreaterThan(30);
  });
});

describe("FK compuestas de riesgo medio (0025)", () => {
  let A: Org;
  let B: Org;
  let a: Awaited<ReturnType<typeof sembrar>>;
  let b: Awaited<ReturnType<typeof sembrar>>;

  beforeAll(async () => {
    A = await crearOrganizacion("FK medio A");
    B = await crearOrganizacion("FK medio B");
    a = await sembrar(A, "5215512340011");
    b = await sembrar(B, "5215512340012");
  });
  afterAll(async () => {
    await borrarOrganizaciones([A.id, B.id]);
  });

  it("un mensaje del chat de equipo de A no cae en un hilo de B; un hueco ofrecido tampoco en un chat de B", async () => {
    const db = getDb();
    const hiloB = newId("teamChatThread");
    await db.insert(schema.teamChatThread).values({ id: hiloB, organizationId: B.id, kind: "group", name: "B" });
    expect(
      await codigo(
        db.insert(schema.teamChatMessage).values({
          id: newId("teamChatMessage"),
          organizationId: A.id,
          threadId: hiloB,
          body: "intruso",
        })
      )
    ).toBe("23503");
    expect(
      await codigo(
        db.insert(schema.offeredSlot).values({
          id: newId("offeredSlot"),
          organizationId: A.id,
          conversationId: b.conv.id,
          startUtc: new Date(),
          label: "x",
        })
      )
    ).toBe("23503");
  });

  it("la bitácora de etapas no apunta a una etapa de B; borrar la etapa pone en NULL solo esa columna", async () => {
    const db = getDb();
    const [leadA] = await db.select().from(schema.lead).where(eq(schema.lead.organizationId, A.id));
    const base = {
      organizationId: A.id,
      leadId: leadA!.id,
      contactId: leadA!.contactId,
      toStageName: "x",
    };
    expect(
      await codigo(db.insert(schema.leadStageEvent).values({ id: newId("leadStageEvent"), ...base, toStageId: b.stage.id }))
    ).toBe("23503");
    const etapa = newId("stage");
    await db.insert(schema.pipelineStage).values({ id: etapa, organizationId: A.id, name: "temporal", position: 99, kind: "open" });
    const ev = newId("leadStageEvent");
    await db.insert(schema.leadStageEvent).values({ id: ev, ...base, toStageId: etapa });
    await db.delete(schema.pipelineStage).where(eq(schema.pipelineStage.id, etapa));
    const [fila] = await db.select().from(schema.leadStageEvent).where(eq(schema.leadStageEvent.id, ev));
    expect(fila!.toStageId).toBeNull();
    expect(fila!.organizationId).toBe(A.id);
  });
});
