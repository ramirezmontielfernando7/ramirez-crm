import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { nextInTurn } from "@/lib/assignment-mode";
import { getAssignmentMode } from "./settings";

type AssignmentStrategy = {
  name: "manual" | "round_robin";
  /** userId que recibe el lead, o null = sin asignar. */
  pick(input: { organizationId: string; contactId: string }): Promise<string | null>;
};

const manualStrategy: AssignmentStrategy = {
  name: "manual",
  pick: async () => null,
};

/**
 * Por turnos entre los asesores. El candado `for update` sobre la fila de
 * ajustes hace que dos leads simultáneos no caigan en la misma persona.
 * Un contacto privado de «Mi número» nunca se reparte.
 */
const roundRobinStrategy: AssignmentStrategy = {
  name: "round_robin",
  pick: async ({ organizationId, contactId }) => {
    const db = getDb();
    const c = await db
      .select({ priv: schema.contact.privateToNumberId })
      .from(schema.contact)
      .where(scoped(schema.contact.organizationId, organizationId, eq(schema.contact.id, contactId)))
      .limit(1);
    if (!c[0] || c[0].priv) return null;

    return db.transaction(async (tx) => {
      const cfg = await tx
        .select({ cursor: schema.assignmentSettings.cursorUserId })
        .from(schema.assignmentSettings)
        .where(eq(schema.assignmentSettings.organizationId, organizationId))
        .for("update");
      if (!cfg[0]) return null;
      const members = await tx
        .select({ userId: schema.member.userId })
        .from(schema.member)
        .where(scoped(schema.member.organizationId, organizationId, eq(schema.member.role, "asesor")))
        .orderBy(asc(schema.member.createdAt), asc(schema.member.userId));
      const next = nextInTurn(
        members.map((m) => m.userId),
        cfg[0].cursor
      );
      if (!next) return null;
      await tx
        .update(schema.assignmentSettings)
        .set({ cursorUserId: next, updatedAt: new Date() })
        .where(eq(schema.assignmentSettings.organizationId, organizationId));
      return next;
    });
  },
};

export async function strategyFor(organizationId: string): Promise<AssignmentStrategy> {
  return (await getAssignmentMode(organizationId)) === "round_robin" ? roundRobinStrategy : manualStrategy;
}
