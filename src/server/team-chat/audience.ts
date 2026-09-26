import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { can } from "@/lib/auth/permissions";
import { describeError } from "@/lib/log-safe";
import type { TeamThreadKind } from "@/lib/team-chat";
import { publish, type TeamSseEvent } from "@/server/events/bus";
import { orgMembers } from "./people";
import { getTeamChatSettings } from "./settings";

/**
 * 025 — A quién le llega en tiempo real lo que pasa en un hilo.
 *
 * Pura (probada en tests/unit/team-chat-sse.test.ts): participantes que SIGUEN
 * en la organización (en avisos, todos los miembros) y, en directos y grupos,
 * quien supervisa si la supervisión está encendida. Nadie más: ni el
 * Coordinador por ver todos los chats de clientes, ni quien salió del equipo.
 */
export function computeAudience(input: {
  kind: TeamThreadKind;
  participantIds: readonly string[];
  members: readonly { userId: string; role: string }[];
  ownerOversight: boolean;
}): string[] {
  const current = new Set(input.members.map((m) => m.userId));
  if (input.kind === "announcements") return [...current];
  const out = new Set(input.participantIds.filter((id) => current.has(id)));
  if (input.ownerOversight) {
    for (const m of input.members) {
      if (can({ role: m.role }, "team_chat.oversee")) out.add(m.userId);
    }
  }
  return [...out];
}

/** La audiencia de un hilo, con la membresía y los ajustes de AHORA. */
export async function threadAudience(
  organizationId: string,
  thread: { id: string; kind: TeamThreadKind },
  extraParticipantIds: readonly string[] = []
): Promise<string[]> {
  const [members, settings, rows] = await Promise.all([
    orgMembers(organizationId),
    getTeamChatSettings(organizationId),
    thread.kind === "announcements"
      ? Promise.resolve([] as { userId: string }[])
      : getDb()
          .select({ userId: schema.teamChatMember.userId })
          .from(schema.teamChatMember)
          .where(scoped(schema.teamChatMember.organizationId, organizationId, eq(schema.teamChatMember.threadId, thread.id))),
  ]);
  return computeAudience({
    kind: thread.kind,
    // `extra`: quienes acaban de SALIR de un grupo también se enteran de que
    // salieron (para que desaparezca de su lista).
    participantIds: [...rows.map((r) => r.userId), ...extraParticipantIds],
    members,
    ownerOversight: settings.ownerOversight,
  });
}

/**
 * Publica DESPUÉS del commit. Un fallo al calcular la audiencia no deshace
 * lo guardado: se registra (sin datos) y el cliente se pone al día con su
 * refetch normal.
 */
export async function publishTeam(
  organizationId: string,
  thread: { id: string; kind: TeamThreadKind },
  event: Omit<TeamSseEvent, "audience">,
  extraParticipantIds: readonly string[] = []
): Promise<void> {
  try {
    const audience = await threadAudience(organizationId, thread, extraParticipantIds);
    publish(organizationId, { ...event, audience } as TeamSseEvent);
  } catch (err) {
    console.error("[team-chat] no se pudo publicar el evento:", describeError(err));
  }
}

/** A una sola persona (p. ej. "leíste en otra pestaña"). */
export function publishToUser(
  organizationId: string,
  userId: string,
  event: Omit<TeamSseEvent, "audience">
): void {
  publish(organizationId, { ...event, audience: [userId] } as TeamSseEvent);
}

/** A todo el equipo actual (p. ej. cambió la supervisión: todos refetchean). */
export async function publishToOrg(
  organizationId: string,
  event: Omit<TeamSseEvent, "audience">
): Promise<void> {
  try {
    const members = await orgMembers(organizationId);
    publish(organizationId, { ...event, audience: members.map((m) => m.userId) } as TeamSseEvent);
  } catch (err) {
    console.error("[team-chat] no se pudo publicar el evento:", describeError(err));
  }
}
