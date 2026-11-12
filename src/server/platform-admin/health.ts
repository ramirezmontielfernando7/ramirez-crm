import { sql } from "drizzle-orm";
import { getSystemDb } from "@/lib/db";

/**
 * 048 — Datos del semáforo de clientes para la lista de /platform, de TODAS
 * las organizaciones en lecturas agrupadas (no crece con una consulta por
 * empresa). Solo fechas y conteos: nunca contenido. La regla vive en
 * `src/lib/platform-health.ts`.
 */

export type HealthSignals = {
  lastMessageAt: Date | null;
  lastLoginAt: Date | null;
  sent7d: number;
  failed7d: number;
  agentOn: boolean;
};

/** Uno solo por archivo, para que el guardarraíl lo cuente una vez. */
function sys() {
  return getSystemDb();
}

const DAY_MS = 86_400_000;

type Row = Record<string, unknown> & { org: string };

const toDate = (v: unknown): Date | null => (v instanceof Date ? v : typeof v === "string" ? new Date(v) : null);

export async function listHealthSignals(ids: string[], now = new Date()): Promise<Map<string, HealthSignals>> {
  const out = new Map<string, HealthSignals>();
  if (ids.length === 0) return out;
  for (const id of ids) out.set(id, { lastMessageAt: null, lastLoginAt: null, sent7d: 0, failed7d: 0, agentOn: false });
  // En texto ISO: el driver no recibe un Date suelto dentro de `sql` crudo.
  const since = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  );
  const db = sys();
  const [last, sends, logins, agents] = await Promise.all([
    db.execute(sql`
      select organization_id as org, max(last_message_at) as at
      from conversation
      where organization_id in (${list}) and is_test = false
      group by organization_id`),
    // Solo las conversaciones con movimiento en 7 días (índice por última
    // actividad) y sus mensajes de 7 días (índice organización, chat, fecha).
    db.execute(sql`
      select c.organization_id as org,
             count(*)::int as sent,
             count(*) filter (where m.status = 'failed')::int as failed
      from conversation c
      join message m on m.organization_id = c.organization_id and m.conversation_id = c.id and m.created_at > ${since}::timestamptz
      where c.organization_id in (${list}) and c.is_test = false and c.last_message_at > ${since}::timestamptz and m.direction = 'out'
      group by c.organization_id`),
    db.execute(sql`
      select m.organization_id as org, max(s.updated_at) as at
      from session s join member m on m.user_id = s.user_id
      where m.organization_id in (${list})
      group by m.organization_id`),
    db.execute(sql`
      select organization_id as org, bool_or(enabled and paused_at is null) as on
      from agent_profile
      where organization_id in (${list})
      group by organization_id`),
  ]);
  const rows = (r: unknown) => ((r as { rows?: Row[] }).rows ?? (r as Row[])) as Row[];
  for (const r of rows(last)) {
    const s = out.get(r.org);
    if (s) s.lastMessageAt = toDate(r.at);
  }
  for (const r of rows(sends)) {
    const s = out.get(r.org);
    if (s) {
      s.sent7d = Number(r.sent ?? 0);
      s.failed7d = Number(r.failed ?? 0);
    }
  }
  for (const r of rows(logins)) {
    const s = out.get(r.org);
    if (s) s.lastLoginAt = toDate(r.at);
  }
  for (const r of rows(agents)) {
    const s = out.get(r.org);
    if (s) s.agentOn = r.on === true;
  }
  return out;
}
