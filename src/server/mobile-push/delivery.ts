import { and, eq, gt, isNull } from "drizzle-orm";
import { can } from "@/lib/auth/permissions";
import { getDb, getSystemDb, schema } from "@/lib/db";
import { companyChat, scoped, scopedConversations } from "@/lib/db/tenant";
import { runWithOrganization } from "@/lib/request-context";
import { resolveMembership } from "@/server/auth/on-signup";
import { openFromStorage } from "@/server/credentials";
import { activePushDevices, retentionMs, revokeRejectedDevice } from "./devices";
import { mobilePushProvider, type MobilePushProvider } from "./fcm";

type Inbound = { organizationId: string; conversationId: string; messageId: string };
const allCustomers = { userId: "", seesAll: true };

async function chatFor(input: Inbound) {
  const c = schema.conversation;
  const m = schema.message;
  const contact = schema.contact;
  const [state] = await getDb().select({ assignee: contact.assignedUserId })
    .from(c)
    .innerJoin(contact, and(eq(contact.id, c.contactId), eq(contact.organizationId, c.organizationId)))
    .innerJoin(m, and(eq(m.conversationId, c.id), eq(m.organizationId, c.organizationId)))
    .innerJoin(schema.organization, eq(schema.organization.id, c.organizationId))
    .where(scopedConversations(c.organizationId, { organizationId: input.organizationId, ...allCustomers }, c.id,
      eq(c.id, input.conversationId), eq(m.id, input.messageId), eq(m.direction, "in"),
      companyChat(), isNull(contact.privateToNumberId), eq(schema.organization.status, "active"),
    )).limit(1);
  return state;
}

export function inPushAudience(userId: string, role: string, assignee: string | null) {
  return can({ role }, "scope.all") || (role === "asesor" && assignee === userId);
}

async function liveMembership(sessionId: string, userId: string) {
  // The app role is intentionally denied SELECT on Better Auth's session table.
  // Read only routing data, never the session token.
  const [session] = await getSystemDb().select({ activeOrg: schema.session.activeOrganizationId })
    .from(schema.session)
    .where(and(eq(schema.session.id, sessionId), eq(schema.session.userId, userId),
      gt(schema.session.expiresAt, new Date()))).limit(1);
  return session ? resolveMembership(userId, session.activeOrg) : null;
}

export async function deliverMobilePush(input: Inbound, push: MobilePushProvider | null = mobilePushProvider()) {
  if (!push) return;
  await runWithOrganization(input.organizationId, async () => {
    const initial = await chatFor(input);
    if (!initial) return;
    const members = await getDb().select({ userId: schema.member.userId, role: schema.member.role })
      .from(schema.member).where(scoped(schema.member.organizationId, input.organizationId));
    const userIds = members.filter((row) => inPushAudience(row.userId, row.role, initial.assignee)).map((row) => row.userId);
    if (!userIds.length) return;
    const devices = await activePushDevices(input.organizationId, userIds);
    for (let i = 0; i < devices.length; i += 5) {
      await Promise.all(devices.slice(i, i + 5).map(async (device) => {
        const { mobilePushDevices: table } = schema;
        const [row] = await getDb().select({ id: table.id }).from(table)
          .where(and(eq(table.id, device.id), eq(table.organizationId, input.organizationId),
            eq(table.sessionId, device.sessionId), eq(table.lastSeenAt, device.lastSeenAt),
            gt(table.lastSeenAt, new Date(Date.now() - retentionMs)), isNull(table.revokedAt))).limit(1);
        if (!row) return;
        const member = await liveMembership(device.sessionId, device.userId);
        if (member?.organizationId !== input.organizationId) return;
        const live = await chatFor(input);
        if (!live || !inPushAudience(device.userId, member.role, live.assignee)) return;
        const opened = openFromStorage(device.tokenCipher, device.tokenIv, device.tokenTag, device.keyVersion);
        if (!opened.ok) return;
        const outcome = await push.send(opened.value, input.conversationId);
        if (outcome === "invalid_token") await revokeRejectedDevice(device);
      }));
    }
  });
}
