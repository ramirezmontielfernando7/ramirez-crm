import { Zip, ZipDeflate, strToU8 } from "fflate";
import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import type { SessionContext } from "@/lib/auth/session";
import { toCsv } from "@/lib/csv";
import { getDb, schema } from "@/lib/db";
import { companyChat, scoped, scopedContacts } from "@/lib/db/tenant";
import { logger } from "@/lib/log";
import { notLabContact } from "@/server/analytics/shared";

const log = logger("exportar-datos");

const PAGE = 2000;

type Access = Pick<SessionContext, "organizationId" | "access">;
type Cell = string | number | null | undefined;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");

/** Quién escribió un saliente, en palabras del negocio. */
export function senderLabel(m: {
  direction: string;
  origin: string;
  aiGenerated: boolean;
  autoKind: string | null;
}): string {
  if (m.direction === "in") return "cliente";
  if (m.autoKind) return "automático";
  if (m.aiGenerated || m.origin === "ai") return "IA";
  if (m.origin === "template") return "plantilla";
  if (m.origin === "manual") return "teléfono del negocio";
  return "equipo";
}

/** Un archivo del ZIP que se va escribiendo por páginas (nunca todo en memoria). */
class Sink {
  private file: ZipDeflate;
  private header: string[];
  private first = true;
  constructor(
    private zip: Zip,
    name: string,
    header: string[]
  ) {
    this.file = new ZipDeflate(name, { level: 6 });
    zip.add(this.file);
    this.header = header;
  }
  /** `toCsv` pone el BOM y el salto final: se parte para unir páginas. */
  write(rows: Cell[][], last = false) {
    const text = toCsv(this.header, rows);
    const lines = text.replace(/^﻿/, "").split("\r\n");
    lines.pop(); // vacío tras el último salto
    const header = lines.shift()!;
    let out = "";
    if (this.first) {
      out += `﻿${header}\r\n`;
      this.first = false;
    }
    if (lines.length) out += `${lines.join("\r\n")}\r\n`;
    this.file.push(strToU8(out), last);
  }
  end() {
    if (this.first) this.write([], true);
    else this.file.push(new Uint8Array(0), true);
  }
}

/**
 * 049 — «Exportar todos mis datos»: un ZIP con contactos, embudo,
 * conversaciones y mensajes en CSV (UTF-8, se abren en Excel), más un LEEME.
 * Solo chats reales del número de la empresa (ni Laboratorio ni «Mi número»).
 * Los archivos (fotos, documentos) NO van dentro: pesarían gigas; el LEEME lo
 * dice. Se arma por páginas y sale en flujo.
 */
export function buildDataExportStream(session: Access): ReadableStream<Uint8Array> {
  const org = session.organizationId;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const zip = new Zip((err, chunk, final) => {
          if (err) {
            controller.error(err);
            return;
          }
          controller.enqueue(chunk);
          if (final) controller.close();
        });
        const db = getDb();
        const counts = { contactos: 0, embudo: 0, conversaciones: 0, mensajes: 0 };

        // ── contactos ────────────────────────────────────────────────
        const tagRows = await db
          .select({ contactId: schema.contactTagAssignment.contactId, name: schema.contactTag.name })
          .from(schema.contactTagAssignment)
          .innerJoin(schema.contactTag, eq(schema.contactTag.id, schema.contactTagAssignment.tagId))
          .where(scoped(schema.contactTagAssignment.organizationId, org));
        const tags = new Map<string, string[]>();
        for (const t of tagRows) tags.set(t.contactId, [...(tags.get(t.contactId) ?? []), t.name]);
        const stageRows = await db
          .select({ contactId: schema.lead.contactId, stage: schema.pipelineStage.name })
          .from(schema.lead)
          .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
          .where(scoped(schema.lead.organizationId, org));
        const stageOf = new Map(stageRows.map((r) => [r.contactId, r.stage]));

        const contacts = new Sink(zip, "contactos.csv", [
          "nombre", "telefono", "identidad_whatsapp", "fuente", "consentimiento", "origen_consentimiento",
          "etiquetas", "etapa", "asignado_a", "archivado", "creado",
        ]);
        for (let after = ""; ; ) {
          const rows = await db
            .select({
              id: schema.contact.id,
              name: schema.contact.name,
              phone: schema.contact.phone,
              wa: schema.contact.waIdentity,
              source: schema.contact.source,
              consent: schema.contact.waConsent,
              consentSource: schema.contact.waConsentSource,
              archivedAt: schema.contact.archivedAt,
              createdAt: schema.contact.createdAt,
              assignee: schema.user.name,
            })
            .from(schema.contact)
            .leftJoin(schema.user, eq(schema.user.id, schema.contact.assignedUserId))
            .where(
              scopedContacts(
                schema.contact.organizationId,
                session.access,
                schema.contact.id,
                after ? gt(schema.contact.id, after) : undefined,
                notLabContact(schema.contact.id)
              )
            )
            .orderBy(asc(schema.contact.id))
            .limit(PAGE);
          if (rows.length === 0) break;
          contacts.write(
            rows.map((c) => [
              c.name, c.phone, c.wa, c.source, c.consent, c.consentSource,
              (tags.get(c.id) ?? []).join(", "), stageOf.get(c.id) ?? "", c.assignee ?? "",
              c.archivedAt ? "si" : "", iso(c.createdAt),
            ])
          );
          counts.contactos += rows.length;
          after = rows[rows.length - 1]!.id;
          if (rows.length < PAGE) break;
        }
        contacts.end();

        // ── embudo ───────────────────────────────────────────────────
        const funnel = new Sink(zip, "embudo.csv", [
          "nombre", "telefono", "etapa", "tipo_de_etapa", "monto", "moneda", "prioridad", "ultima_actividad", "creado",
        ]);
        for (let after = ""; ; ) {
          const rows = await db
            .select({
              id: schema.lead.id,
              name: schema.contact.name,
              phone: schema.contact.phone,
              stage: schema.pipelineStage.name,
              kind: schema.pipelineStage.kind,
              amount: schema.lead.amountCents,
              currency: schema.lead.currency,
              priority: schema.lead.priority,
              lastActivityAt: schema.lead.lastActivityAt,
              createdAt: schema.lead.createdAt,
            })
            .from(schema.lead)
            .innerJoin(schema.contact, eq(schema.contact.id, schema.lead.contactId))
            .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, schema.lead.stageId))
            .where(
              scopedContacts(
                schema.lead.organizationId,
                session.access,
                schema.lead.contactId,
                after ? gt(schema.lead.id, after) : undefined
              )
            )
            .orderBy(asc(schema.lead.id))
            .limit(PAGE);
          if (rows.length === 0) break;
          funnel.write(
            rows.map((r) => [
              r.name, r.phone, r.stage, r.kind === "won" ? "ganada" : r.kind === "lost" ? "perdida" : "abierta",
              r.amount === null ? "" : (r.amount / 100).toFixed(2), r.currency, r.priority,
              iso(r.lastActivityAt), iso(r.createdAt),
            ])
          );
          counts.embudo += rows.length;
          after = rows[rows.length - 1]!.id;
          if (rows.length < PAGE) break;
        }
        funnel.end();

        // ── conversaciones ───────────────────────────────────────────
        const convs = new Sink(zip, "conversaciones.csv", [
          "id_conversacion", "nombre", "telefono", "canal", "ultimo_mensaje_del_cliente", "ultimo_mensaje", "archivada", "creada",
        ]);
        for (let after = ""; ; ) {
          const rows = await db
            .select({
              id: schema.conversation.id,
              name: schema.contact.name,
              phone: schema.contact.phone,
              channel: schema.conversation.channel,
              lastInboundAt: schema.conversation.lastInboundAt,
              lastMessageAt: schema.conversation.lastMessageAt,
              archivedAt: schema.conversation.archivedAt,
              createdAt: schema.conversation.createdAt,
            })
            .from(schema.conversation)
            .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
            .where(
              scopedContacts(
                schema.conversation.organizationId,
                session.access,
                schema.conversation.contactId,
                companyChat(),
                after ? gt(schema.conversation.id, after) : undefined
              )
            )
            .orderBy(asc(schema.conversation.id))
            .limit(PAGE);
          if (rows.length === 0) break;
          convs.write(
            rows.map((r) => [
              r.id, r.name, r.phone, r.channel, iso(r.lastInboundAt), iso(r.lastMessageAt),
              r.archivedAt ? "si" : "", iso(r.createdAt),
            ])
          );
          counts.conversaciones += rows.length;
          after = rows[rows.length - 1]!.id;
          if (rows.length < PAGE) break;
        }
        convs.end();

        // ── mensajes (paginados por fecha e id) ──────────────────────
        const msgs = new Sink(zip, "mensajes.csv", [
          "id_conversacion", "nombre", "telefono", "fecha", "quien", "tipo", "texto", "archivo", "estado",
        ]);
        let cursor: { at: Date; id: string } | null = null;
        for (;;) {
          const rows: {
            id: string; conversationId: string; name: string; phone: string | null; at: Date;
            direction: string; origin: string; aiGenerated: boolean; autoKind: string | null;
            type: string; text: string | null; media: boolean; status: string;
          }[] = await db
            .select({
              id: schema.message.id,
              conversationId: schema.message.conversationId,
              name: schema.contact.name,
              phone: schema.contact.phone,
              at: schema.message.createdAt,
              direction: schema.message.direction,
              origin: schema.message.origin,
              aiGenerated: schema.message.aiGenerated,
              autoKind: schema.message.autoKind,
              type: schema.message.type,
              text: schema.message.text,
              media: sql<boolean>`${schema.message.mediaAssetId} is not null`,
              status: schema.message.status,
            })
            .from(schema.message)
            .innerJoin(schema.conversation, eq(schema.conversation.id, schema.message.conversationId))
            .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
            .where(
              scopedContacts(
                schema.message.organizationId,
                session.access,
                schema.conversation.contactId,
                companyChat(),
                cursor
                  ? or(
                      sql`${schema.message.createdAt} > ${cursor.at.toISOString()}::timestamp`,
                      and(sql`${schema.message.createdAt} = ${cursor.at.toISOString()}::timestamp`, gt(schema.message.id, cursor.id))
                    )
                  : undefined
              )
            )
            .orderBy(asc(schema.message.createdAt), asc(schema.message.id))
            .limit(PAGE);
          if (rows.length === 0) break;
          msgs.write(
            rows.map((m) => [
              m.conversationId, m.name, m.phone, iso(m.at), senderLabel(m), m.type, m.text,
              m.media ? "si (no incluido)" : "", m.status,
            ])
          );
          counts.mensajes += rows.length;
          const lastRow = rows[rows.length - 1]!;
          cursor = { at: lastRow.at, id: lastRow.id };
          if (rows.length < PAGE) break;
        }
        msgs.end();

        // ── LEEME ────────────────────────────────────────────────────
        const readme = new ZipDeflate("LEEME.txt", { level: 6 });
        zip.add(readme);
        readme.push(
          strToU8(
            [
              "Exportación de tus datos de Dashfort",
              `Generada el ${new Date().toISOString()}`,
              "",
              "contactos.csv       Tus contactos: datos, consentimiento, etiquetas, etapa y asesor.",
              "embudo.csv          Tus oportunidades: etapa, monto, prioridad.",
              "conversaciones.csv  Un renglón por chat.",
              "mensajes.csv        Todos los mensajes, del más viejo al más nuevo. 'quien' dice si fue cliente, equipo, IA o automático.",
              "",
              `Contactos: ${counts.contactos} · Oportunidades: ${counts.embudo} · Conversaciones: ${counts.conversaciones} · Mensajes: ${counts.mensajes}`,
              "",
              "Los archivos (fotos, audios, documentos) no van dentro de este ZIP porque pesarían mucho.",
              "Si los necesitas, pídenos una copia aparte.",
              "Los chats de pruebas y los de 'Mi número' (WhatsApp personal de cada persona) no se incluyen.",
              "Los CSV están en UTF-8: en Excel usa Datos > Obtener datos > Desde texto/CSV si ves letras raras.",
              "",
            ].join("\r\n")
          ),
          true
        );
        zip.end();
        log.info("exportación de datos terminada", { org, ...counts });
      } catch (err) {
        log.error("la exportación de datos falló", { org, err });
        controller.error(err);
      }
    },
  });
}
