import { gte, isNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { companyChat, scopedContacts, type Access } from "@/lib/db/tenant";
import type { AdvisorRowDto, TeamPanelDto } from "@/lib/analytics";
import { median, type ResolvedPeriod } from "@/server/analytics/period";
import { listAssignees } from "@/server/assignment/assign";

const conversacionId = sql.raw(`"conversation"."id"`);

/**
 * Productividad por asesor: de los chats que empezaron en el periodo con un
 * mensaje del cliente, cuántos tiene cada quien, cuántos contestó, cuántos
 * contestó pasado el límite y cuántos siguen sin respuesta pasado el límite.
 * Solo cuentan respuestas de PERSONAS (no la IA ni los avisos automáticos), con
 * el mismo criterio que «Atención del equipo».
 */
export async function teamPanel(organizationId: string, period: ResolvedPeriod, limitMinutes: number): Promise<TeamPanelDto> {
  const scope: Access = { organizationId, userId: "", seesAll: true };
  const limit = limitMinutes * 60;
  const primerEntrante = sql`(select min(m1."created_at") from "message" m1
    where m1."conversation_id" = ${conversacionId} and m1."direction" = 'in')`;
  const db = getDb();
  const rows = await db
    .select({
      uid: sql<string | null>`(select c."assigned_user_id" from "contact" c where c."id" = "conversation"."contact_id")`,
      sinRespuesta: sql<boolean>`not exists (
        select 1 from "message" ma
        where ma."conversation_id" = ${conversacionId} and ma."direction" = 'out'
          and ma."auto_kind" is null and ma."status" <> 'failed' and ma."created_at" >= ${primerEntrante}
      )`,
      espera: sql<number>`extract(epoch from (now() - ${primerEntrante}))`,
      segundos: sql<number | null>`extract(epoch from (
        (select min(m2."created_at") from "message" m2
          where m2."conversation_id" = ${conversacionId}
            and m2."direction" = 'out' and m2."origin" in ('operator', 'manual')
            and m2."ai_generated" = false and m2."auto_kind" is null
            and m2."status" <> 'failed'
            and m2."created_at" > ${primerEntrante})
        - ${primerEntrante}
      ))`,
    })
    .from(schema.conversation)
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        scope,
        schema.conversation.contactId,
        companyChat(),
        gte(schema.conversation.createdAt, period.start),
        lt(schema.conversation.createdAt, period.end),
        sql`${primerEntrante} is not null`
      )
    );

  const porPersona = new Map<string | null, { r: AdvisorRowDto; tiempos: number[] }>();
  const cubeta = (uid: string | null) => {
    let b = porPersona.get(uid);
    if (!b) {
      b = { r: { userId: uid, name: "", chats: 0, answered: 0, answeredLate: 0, waitingLate: 0, medianSeconds: null }, tiempos: [] };
      porPersona.set(uid, b);
    }
    return b;
  };
  for (const row of rows) {
    const b = cubeta(row.uid);
    b.r.chats += 1;
    const seg = row.segundos === null ? null : Number(row.segundos);
    if (seg !== null && seg >= 0) {
      b.r.answered += 1;
      b.tiempos.push(seg);
      if (seg > limit) b.r.answeredLate += 1;
    } else if (row.sinRespuesta && Number(row.espera) > limit) {
      b.r.waitingLate += 1;
    }
  }

  const gente = await listAssignees(organizationId);
  const nombre = new Map(gente.map((g) => [g.id, g.name]));
  const lista = [...porPersona.values()].map(({ r, tiempos }) => ({
    ...r,
    name: r.userId ? (nombre.get(r.userId) ?? "Persona que salió del equipo") : "Sin asignar",
    medianSeconds: median(tiempos),
  }));
  // Las personas por quien más se atrasa; «sin asignar» siempre al final.
  lista.sort((a, b) => {
    if ((a.userId === null) !== (b.userId === null)) return a.userId === null ? 1 : -1;
    return b.answeredLate + b.waitingLate - (a.answeredLate + a.waitingLate) || b.chats - a.chats;
  });

  const sinAsignar = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.conversation)
    .where(
      scopedContacts(
        schema.conversation.organizationId,
        scope,
        schema.conversation.contactId,
        companyChat(),
        isNull(schema.conversation.archivedAt),
        sql`(select c."assigned_user_id" from "contact" c where c."id" = "conversation"."contact_id") is null`,
        sql`exists (select 1 from "message" mi where mi."conversation_id" = ${conversacionId} and mi."direction" = 'in')`
      )
    );

  return { period: period.dto, limitMinutes, unassignedNow: sinAsignar[0]?.n ?? 0, rows: lista };
}
