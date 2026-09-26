import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema } from "@/lib/db";
import { scopedContacts, scopedConversations, scopedMediaAssets, type Access } from "@/lib/db/tenant";
import { canSeeEvent } from "@/server/events/visibility";
import type { SseEvent } from "@/server/events/bus";
import { describeTimelineItem } from "@/lib/timeline";

/**
 * 026 — Participantes en chats de cliente.
 *
 * - Un participante VE el chat: los cuatro filtros de `tenant.ts` (contacto,
 *   subconsulta por contacto, conversación y adjuntos) aceptan "asignado a
 *   mí O participo". Quien ve todo no paga nada.
 * - El AVISO de handoff es del asignado (y de quien ve todo), nunca de un
 *   participante.
 * - Una sola puerta escribe `contact_participant` y su bitácora.
 */

const dialect = new PgDialect();
const ASESOR: Access = { organizationId: "org_a", userId: "usr_part", seesAll: false };
const COORD: Access = { organizationId: "org_a", userId: "usr_coord", seesAll: true };

function render(sql: unknown): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(sql as never);
}

describe("visibilidad: asignado O participante", () => {
  it.each([
    ["contacto (directo)", () => scopedContacts(schema.contact.organizationId, ASESOR, schema.contact.id)],
    ["tabla con contact_id", () => scopedContacts(schema.lead.organizationId, ASESOR, schema.lead.contactId)],
    ["conversación", () => scopedConversations(schema.message.organizationId, ASESOR, schema.message.conversationId)],
    ["adjuntos", () => scopedMediaAssets(schema.mediaAsset.organizationId, ASESOR, schema.mediaAsset.id)],
  ])("%s: incluye contact_participant con el id del asesor", (_n, build) => {
    const q = render(build());
    expect(q.sql).toContain('"contact_participant"');
    expect(q.sql).toContain("assigned_user_id");
    expect(q.params).toContain("usr_part");
  });

  it("quien ve todo no lleva filtro de asignación ni de participantes", () => {
    const q = render(scopedContacts(schema.contact.organizationId, COORD, schema.contact.id));
    expect(q.sql).not.toContain("contact_participant");
    expect(q.sql).not.toContain("assigned_user_id");
  });
});

const handoff = (assignedUserId: string | null): SseEvent => ({
  type: "handoff.requested",
  data: { conversationId: "cv_1", contactId: "ct_1", contactName: "Cliente", reason: "cliente", assignedUserId },
});

describe("aviso de handoff", () => {
  it("chat asignado: le llega al asignado", async () => {
    expect(await canSeeEvent({ ...ASESOR, userId: "usr_asignado" }, handoff("usr_asignado"))).toBe(true);
  });

  it("un PARTICIPANTE (que ve el chat) no recibe el aviso", async () => {
    expect(await canSeeEvent(ASESOR, handoff("usr_asignado"))).toBe(false);
  });

  it("Coordinador y Propietario (ven todo) lo reciben, asignado o no", async () => {
    expect(await canSeeEvent(COORD, handoff("usr_asignado"))).toBe(true);
    expect(await canSeeEvent(COORD, handoff(null))).toBe(true);
  });

  it("chat sin asignar: ningún asesor lo recibe", async () => {
    expect(await canSeeEvent(ASESOR, handoff(null))).toBe(false);
  });
});

describe("participants.changed", () => {
  const ev: SseEvent = { type: "participants.changed", data: { contactIds: ["ct_1"], userIds: ["usr_part"] } };
  it("le llega al que entra o sale, y a quien ve todo", async () => {
    expect(await canSeeEvent(ASESOR, ev)).toBe(true);
    expect(await canSeeEvent(COORD, ev)).toBe(true);
    expect(await canSeeEvent({ ...ASESOR, userId: "usr_otro" }, ev)).toBe(false);
  });
});

describe("línea de tiempo", () => {
  it("dice quién entró o salió y quién lo hizo", () => {
    const base = { id: "cpe_1", at: "2026-09-26T00:00:00Z", actor: { type: "user" as const, id: "u", name: "Laura" } };
    expect(describeTimelineItem({ ...base, kind: "participant_added", detail: { user: "Carlos" } }).title).toBe(
      "Carlos se sumó como participante por Laura"
    );
    expect(describeTimelineItem({ ...base, kind: "participant_removed", detail: { user: "Carlos" } }).title).toBe(
      "Carlos dejó de ser participante por Laura"
    );
  });
});

describe("guardarraíl: una sola puerta de participantes", () => {
  const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
  const PUERTA = path.join("server", "assignment", "participants.ts");
  function archivos(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) out.push(...archivos(full));
      else if (/\.(ts|tsx)$/.test(e)) out.push(full);
    }
    return out;
  }
  it("nadie fuera de participants.ts inserta, borra o actualiza contact_participant(_event)", () => {
    const infractores = archivos(SRC)
      .filter((f) => !f.endsWith(PUERTA) && !f.endsWith(path.join("lib", "db", "schema.ts")))
      .filter((f) =>
        /\.(insert|delete|update)\(\s*schema\.contactParticipant(Event)?\b/.test(readFileSync(f, "utf8"))
      )
      .map((f) => path.relative(SRC, f));
    expect(infractores).toEqual([]);
  });
});
