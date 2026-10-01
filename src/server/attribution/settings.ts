import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { getOrgCredentialsOrNull, sealForStorage, type CapiSettings } from "@/server/credentials";
import { scoped } from "@/lib/db/tenant";

/**
 * 016 — La conexión del negocio con su dataset de Meta.
 *
 * El token se cifra con el MISMO mecanismo que el de WhatsApp (`lib/crypto`,
 * AES-256-GCM), no con un segundo: dos formas de guardar un secreto es una de
 * más que auditar.
 */

export type { CapiSettings };

/** Lo que puede ver el cliente. El token NUNCA sale: solo sus últimos 4. */
export type CapiSettingsView = {
  datasetId: string;
  status: "connected" | "error";
  tokenLast4: string;
  qualifiedStageId: string | null;
};

/** La conexión de la organización, o null. Descifra la puerta única (`src/server/credentials/`). */
export async function getCapiSettings(
  organizationId: string
): Promise<CapiSettings | null> {
  return getOrgCredentialsOrNull(organizationId, "capi");
}

export async function getCapiSettingsView(
  organizationId: string
): Promise<CapiSettingsView | null> {
  const settings = await getCapiSettings(organizationId);
  if (!settings) return null;
  return {
    datasetId: settings.datasetId,
    status: settings.status,
    tokenLast4: settings.token.slice(-4),
    qualifiedStageId: settings.qualifiedStageId,
  };
}

export async function saveCapiSettings(input: {
  organizationId: string;
  datasetId: string;
  token: string;
  qualifiedStageId: string | null;
}): Promise<void> {
  const db = getDb();
  const enc = sealForStorage(input.token);
  await db
    .insert(schema.capiSettings)
    .values({
      id: newId("capiSettings"),
      organizationId: input.organizationId,
      datasetId: input.datasetId,
      tokenCipher: enc.cipher,
      tokenIv: enc.iv,
      tokenTag: enc.tag,
      keyVersion: enc.keyVersion,
      qualifiedStageId: input.qualifiedStageId,
      status: "connected",
    })
    .onConflictDoUpdate({
      target: [schema.capiSettings.organizationId],
      set: {
        datasetId: input.datasetId,
        tokenCipher: enc.cipher,
        tokenIv: enc.iv,
        tokenTag: enc.tag,
        keyVersion: enc.keyVersion,
        qualifiedStageId: input.qualifiedStageId,
        status: "connected",
        updatedAt: new Date(),
      },
    });
}

export async function deleteCapiSettings(
  organizationId: string
): Promise<void> {
  const db = getDb();
  // Los eventos ya registrados NO se borran: son la bitácora de lo que se le
  // dijo a Meta, y eso no deja de ser cierto porque el negocio desconecte.
  await db
    .delete(schema.capiSettings)
    .where(scoped(schema.capiSettings.organizationId, organizationId));
}

/** ¿Esa etapa es de esta organización? (multi-tenancy: III). */
export async function stageBelongsToOrg(
  organizationId: string,
  stageId: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.pipelineStage.id })
    .from(schema.pipelineStage)
    .where(
      scoped(schema.pipelineStage.organizationId, organizationId,
        eq(schema.pipelineStage.id, stageId)
      )
    )
    .limit(1);
  return rows.length > 0;
}
