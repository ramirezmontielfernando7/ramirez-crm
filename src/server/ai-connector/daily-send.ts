import type { SessionContext } from "@/lib/auth/session";
import { reserveDailySend, settleDailySend, type SENDING_TOOLS } from "@/server/ai-connector/log";
import type { ToolOutcome } from "@/server/ai-connector/tools";

/**
 * Auditoría DF-07 — Envuelve un envío de la IA conectada con la reserva
 * atómica del tope diario (`reserveDailySend`): todas las herramientas que
 * envían comparten el mismo contador, también entre procesos. El envío que
 * falla libera su lugar; la bitácora la deja la reserva (`logged`), así que
 * el conector no anota otra fila.
 */
export async function withDailySend(
  ctx: {
    session: SessionContext;
    connectionId: string;
    tool: (typeof SENDING_TOOLS)[number];
    limit: number;
    ids: { conversationId: string; contactId: string };
  },
  run: (sent: number) => Promise<ToolOutcome>
): Promise<ToolOutcome> {
  const { session, connectionId, tool, limit, ids } = ctx;
  const r = await reserveDailySend({
    organizationId: session.organizationId,
    userId: session.userId,
    connectionId,
    tool,
    limit,
    ...ids,
  });
  if (!r.ok) {
    return {
      data: { error: `Llegaste al tope de ${limit} mensajes en 24 horas para tu IA. Escríbelos desde la Bandeja o espera.` },
      summary: `tope diario (${limit})`,
      isError: true,
      outcome: "limited",
      ...ids,
    };
  }
  let out: ToolOutcome;
  try {
    out = await run(r.sent);
  } catch (err) {
    await settleDailySend(session.organizationId, r.reservationId, { outcome: "error", summary: "error interno" });
    throw err;
  }
  await settleDailySend(session.organizationId, r.reservationId, {
    outcome: out.outcome ?? (out.isError ? "error" : "ok"),
    summary: out.summary,
  });
  return { ...out, logged: true };
}
