/** Disconnected domain proposals for remaining screens. Not current backend DTOs. */
import { IntegrationError, type Scope, type CrmRole } from "./contracts";
const fixtureId = (id: string) => {
  if (!/^fixture-[\w-]{1,100}$/.test(id)) throw new IntegrationError("invalid");
};
export type Recipient = Readonly<{
  id: string;
  organizationId: string;
  consent: "opt-in" | "unknown" | "opt-out";
  assigned: string | null;
}>;
export function campaignPreview(
  scope: Scope,
  role: CrmRole,
  recipients: readonly Recipient[],
  template: Readonly<{ id: string; organizationId: string; approved: boolean }>,
  now = Date.now(),
) {
  if (scope.expiresAt <= now) throw new IntegrationError("unauthorized");
  if (role === "asesor") throw new IntegrationError("forbidden");
  fixtureId(template.id);
  if (template.organizationId !== scope.organizationId || !template.approved)
    throw new IntegrationError("forbidden");
  if (recipients.length > 10000) throw new IntegrationError("invalid");
  const seen = new Set<string>(),
    eligible: string[] = [],
    excluded: string[] = [];
  for (const r of recipients) {
    fixtureId(r.id);
    if (r.organizationId !== scope.organizationId)
      throw new IntegrationError("forbidden");
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    (r.consent === "opt-in" ? eligible : excluded).push(r.id);
  }
  return Object.freeze({
    eligible: Object.freeze(eligible),
    excluded: Object.freeze(excluded),
    templateId: template.id,
    transportEnabled: false,
    canSend: false,
    quoteConfirmed: false,
  });
}
export type Booking = Readonly<{
  id: string;
  organizationId: string;
  assignee: string;
  startsAt: number;
  endsAt: number;
  cancelled: boolean;
  version: number;
}>;
export class BookingSimulation {
  private rows = new Map<string, Booking>();
  constructor(
    private scope: Scope,
    private role: CrmRole,
    private now = Date.now,
  ) {}
  private authorize(row: Booking) {
    fixtureId(row.id);
    if (this.scope.expiresAt <= this.now())
      throw new IntegrationError("unauthorized");
    if (
      row.organizationId !== this.scope.organizationId ||
      (this.role === "asesor" && row.assignee !== this.scope.userId)
    )
      throw new IntegrationError("forbidden");
  }
  put(row: Booking, expectedVersion: number | null) {
    this.authorize(row);
    const old = this.rows.get(row.id);
    if ((old?.version ?? null) !== expectedVersion)
      throw new IntegrationError("conflict");
    if (
      !Number.isFinite(row.startsAt) ||
      !Number.isFinite(row.endsAt) ||
      row.startsAt >= row.endsAt ||
      row.endsAt - row.startsAt > 24 * 3600000 ||
      row.version !== (old?.version ?? 0) + 1
    )
      throw new IntegrationError("invalid");
    if (
      !row.cancelled &&
      [...this.rows.values()].some(
        (r) =>
          r.id !== row.id &&
          !r.cancelled &&
          r.assignee === row.assignee &&
          r.startsAt < row.endsAt &&
          row.startsAt < r.endsAt,
      )
    )
      throw new IntegrationError("conflict");
    this.rows.set(row.id, Object.freeze({ ...row }));
  }
  list() {
    if (this.scope.expiresAt <= this.now())
      throw new IntegrationError("unauthorized");
    return [...this.rows.values()];
  }
  clear() {
    this.rows.clear();
  }
}
export function teamDestination(
  scope: Scope,
  role: CrmRole,
  group: Readonly<{
    id: string;
    organizationId: string;
    members: readonly string[];
    announcement: boolean;
  }>,
  supervision: boolean,
  write: boolean,
) {
  fixtureId(group.id);
  if (scope.expiresAt <= Date.now()) throw new IntegrationError("unauthorized");
  if (group.organizationId !== scope.organizationId)
    throw new IntegrationError("forbidden");
  if (supervision) {
    if (role === "asesor" || write) throw new IntegrationError("forbidden");
    return Object.freeze({ id: group.id, readOnly: true, auditRequired: true });
  }
  if (
    !group.members.includes(scope.userId) ||
    (write && group.announcement && role === "asesor")
  )
    throw new IntegrationError("forbidden");
  return Object.freeze({
    id: group.id,
    readOnly: group.announcement && role === "asesor",
    auditRequired: false,
  });
}
export type AgentVersion = Readonly<{
  organizationId: string;
  id: string;
  version: number;
  body: string;
}>;
export class AgentSimulation {
  private versions: readonly AgentVersion[] = [];
  constructor(
    private scope: Scope,
    private role: CrmRole,
  ) {}
  publish(draft: AgentVersion) {
    fixtureId(draft.id);
    if (this.scope.expiresAt <= Date.now())
      throw new IntegrationError("unauthorized");
    if (
      this.role !== "owner" ||
      draft.organizationId !== this.scope.organizationId
    )
      throw new IntegrationError("forbidden");
    if (
      draft.version !== this.versions.length + 1 ||
      !draft.body.trim() ||
      draft.body.length > 10000 ||
      this.versions.length >= 30
    )
      throw new IntegrationError("conflict");
    this.versions = Object.freeze([
      ...this.versions,
      Object.freeze({ ...draft }),
    ]);
    return { simulated: true, providerEnabled: false };
  }
  snapshot() {
    return this.versions;
  }
  clear() {
    this.versions = [];
  }
}
