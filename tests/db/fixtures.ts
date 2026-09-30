import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { saveCredentials } from "@/server/whatsapp/credentials";

/**
 * Una organización mínima y completa (lo mismo que siembra el alta: etapas y
 * perfil del agente) con su número de WhatsApp. Sufijo aleatorio: cada
 * prueba trae sus propias organizaciones y no depende de las demás.
 */
export async function crearOrganizacion(nombre: string): Promise<{
  id: string;
  phoneNumberId: string;
  wabaId: string;
}> {
  const db = getDb();
  const sufijo = Math.random().toString(36).slice(2, 8);
  const id = newId("organization");
  await db.insert(schema.organization).values({
    id,
    name: `${nombre} ${sufijo}`,
    slug: `${nombre.toLowerCase().replace(/\W+/g, "-")}-${sufijo}`,
  });
  await db.insert(schema.pipelineStage).values(
    (["open", "open", "won", "lost"] as const).map((kind, i) => ({
      id: newId("stage"),
      organizationId: id,
      name: `Etapa ${i}`,
      position: i,
      kind,
    }))
  );
  await db.insert(schema.agentProfile).values({ id: newId("agentProfile"), organizationId: id });
  const phoneNumberId = `PN-${sufijo}`;
  const wabaId = `WABA-${sufijo}`;
  await saveCredentials({ organizationId: id, wabaId, phoneNumberId, token: `tok-${sufijo}` });
  return { id, phoneNumberId, wabaId };
}

export async function borrarOrganizaciones(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // Todo lo de dominio cuelga de organization con ON DELETE CASCADE.
  await getDb().delete(schema.organization).where(inArray(schema.organization.id, ids));
}

/** Filas de cada tabla de clientes que pertenecen a una organización. */
export async function contarDatosDeClientes(organizationId: string) {
  const db = getDb();
  const cuenta = async (t: typeof schema.contact | typeof schema.conversation | typeof schema.message | typeof schema.lead) =>
    (await db.select({ id: t.id }).from(t).where(eq(t.organizationId, organizationId))).length;
  return {
    contact: await cuenta(schema.contact),
    conversation: await cuenta(schema.conversation),
    message: await cuenta(schema.message),
    lead: await cuenta(schema.lead),
  };
}
