import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { scoped } from "@/lib/db/tenant";

/** El chat de este número con este contacto (uno solo; la IA nace apagada). `created`: este llamado lo creó. */
export async function numberConversation(organizationId: string, directNumberId: string, contactId: string) {
  const db = getDb();
  const [created] = await db
    .insert(schema.conversation)
    .values({ id: newId("conversation"), organizationId, contactId, directNumberId, aiEnabled: false })
    .onConflictDoNothing({
      target: [schema.conversation.organizationId, schema.conversation.directNumberId, schema.conversation.contactId],
      where: isNotNull(schema.conversation.directNumberId),
    })
    .returning();
  if (created) return { conversation: created, created: true };
  const [existing] = await db
    .select()
    .from(schema.conversation)
    .where(
      scoped(
        schema.conversation.organizationId,
        organizationId,
        and(eq(schema.conversation.directNumberId, directNumberId), eq(schema.conversation.contactId, contactId))
      )
    )
    .limit(1);
  if (!existing) throw new Error("chat del número no encontrado tras upsert");
  return { conversation: existing, created: false };
}
