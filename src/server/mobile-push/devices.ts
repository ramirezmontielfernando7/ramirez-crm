import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { SessionContext } from "@/lib/auth/session";
import { getDb, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { sealForStorage } from "@/server/credentials";

const devices = schema.mobilePushDevices;
const maxDevices = 5;
export const retentionMs = 60 * 24 * 60 * 60 * 1000;
type Binding = Pick<SessionContext, "organizationId" | "userId"> & { sessionId: string };

function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function registerPushDevice(scope: Binding, token: string) {
  const { organizationId, userId, sessionId } = scope;
  const tokenHash = digest(token);
  const encrypted = sealForStorage(token);
  const time = new Date();
  try {
    await withTenant(organizationId, async (tx) => {
      // Serialize concurrent registrations for the same person, including token rotation.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"mobile-push:" + organizationId + ":" + userId}, 0))`);
      const row = {
        sessionId, platform: "android" as const, tokenCipher: encrypted.cipher,
        tokenIv: encrypted.iv, tokenTag: encrypted.tag, keyVersion: encrypted.keyVersion,
        lastSeenAt: time, revokedAt: null,
      };
      const [updated] = await tx.insert(devices).values({
        id: newId("mobilePushDevice"), organizationId, userId, tokenHash, ...row,
      }).onConflictDoUpdate({ target: [devices.organizationId, devices.userId, devices.tokenHash], set: row })
        .returning({ id: devices.id });
      const older = await tx.select({ id: devices.id }).from(devices)
        .where(and(eq(devices.organizationId, organizationId), eq(devices.userId, userId),
          isNull(devices.revokedAt), sql`${devices.id} <> ${updated!.id}`))
        .orderBy(desc(devices.lastSeenAt), desc(devices.id)).offset(maxDevices - 1);
      if (older.length) await tx.update(devices).set({ revokedAt: time })
        .where(and(eq(devices.organizationId, organizationId), eq(devices.userId, userId),
          inArray(devices.id, older.map(({ id }) => id))));
    });
    return true;
  } catch (reason) {
    // Never propagate a query error (its parameters can contain credentials).
    const err = reason as { code?: string; cause?: { code?: string } };
    if (err?.cause?.code === "23505" || err?.code === "23505") return false;
    throw new Error("Push registration unavailable");
  }
}

export async function unregisterPushDevice(scope: Binding, token: string) {
  const { organizationId, userId, sessionId } = scope;
  await getDb().delete(devices).where(and(
    eq(devices.organizationId, organizationId), eq(devices.userId, userId),
    eq(devices.sessionId, sessionId), eq(devices.tokenHash, digest(token)),
  ));
}

export async function revokeRejectedDevice(device: Pick<typeof devices.$inferSelect, "id" | "organizationId" | "sessionId" | "lastSeenAt">) {
  await getDb().update(devices).set({ revokedAt: new Date() }).where(and(
    eq(devices.id, device.id), eq(devices.organizationId, device.organizationId),
    eq(devices.sessionId, device.sessionId), eq(devices.lastSeenAt, device.lastSeenAt),
  ));
}

export function activePushDevices(organizationId: string, userIds: string[]) {
  return getDb().select().from(devices).where(and(
    eq(devices.organizationId, organizationId), inArray(devices.userId, userIds),
    isNull(devices.revokedAt), sql`${devices.lastSeenAt} >= ${new Date(Date.now() - retentionMs).toISOString()}::timestamp`,
  )).orderBy(desc(devices.lastSeenAt)).limit(100);
}

export async function purgeOrgPushDevices(organizationId: string) {
  await getDb().delete(devices).where(and(eq(devices.organizationId, organizationId),
    lt(devices.lastSeenAt, new Date(Date.now() - retentionMs))));
}
