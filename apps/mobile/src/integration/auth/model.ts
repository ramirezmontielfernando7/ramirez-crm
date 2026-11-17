import { mobileRole, type CrmRole, type Scope } from "../contracts";
export type AuthCode =
  | "invalid"
  | "unauthorized"
  | "forbidden"
  | "offline"
  | "server"
  | "storage"
  | "stale"
  | "blocked"
  | "unsupported"
  | "redirect"
  | "cleanup";
export class AuthFault extends Error {
  constructor(readonly code: AuthCode) {
    super(code);
    this.name = "AuthFault";
  }
}
export type AuthContext = Readonly<{
  scope: Scope;
  role: CrmRole;
  permissions: readonly string[];
  canRenew: boolean;
  canSwitchOrganization: boolean;
}>;
/** Fixture credential only. A real Better Auth cookie parser/bridge is intentionally absent. */
export type FixtureSession = Readonly<{
  version: 1;
  environment: "i2p-memory";
  credential: string;
  context: AuthContext;
}>;
const fixtureId = (v: unknown) =>
  typeof v === "string" && /^fixture-[\w-]{1,100}$/.test(v);
export function decodeSession(raw: unknown, now: number): FixtureSession {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new AuthFault("invalid");
  const b = raw as FixtureSession,
    c = b.context,
    s = c?.scope;
  if (
    b.version !== 1 ||
    b.environment !== "i2p-memory" ||
    typeof b.credential !== "string" ||
    !/^fixture-cookie-[\w-]{1,160}$/.test(b.credential) ||
    !s ||
    typeof c !== "object" ||
    Array.isArray(c) ||
    typeof s !== "object" ||
    Array.isArray(s) ||
    ![s.userId, s.organizationId, s.sessionId].every(fixtureId) ||
    !Number.isSafeInteger(s.expiresAt) ||
    s.expiresAt <= now ||
    !["owner", "coordinador", "asesor"].includes(c.role) ||
    !Array.isArray(c.permissions) ||
    c.permissions.length > 80 ||
    !c.permissions.every(
      (p) => typeof p === "string" && /^[a-z_]+\.[a-z_]+$/.test(p),
    ) ||
    typeof c.canRenew !== "boolean" ||
    typeof c.canSwitchOrganization !== "boolean"
  )
    throw new AuthFault("invalid");
  mobileRole(c.role);
  return Object.freeze({
    version: 1,
    environment: "i2p-memory",
    credential: b.credential,
    context: Object.freeze({
      scope: Object.freeze({
        userId: s.userId,
        organizationId: s.organizationId,
        sessionId: s.sessionId,
        expiresAt: s.expiresAt,
      }),
      role: c.role,
      permissions: Object.freeze([...c.permissions]),
      canRenew: c.canRenew,
      canSwitchOrganization: c.canSwitchOrganization,
    }),
  });
}
export interface AuthAuthority {
  login(
    email: string,
    password: string,
    signal: AbortSignal,
  ): Promise<FixtureSession>;
  validate(
    session: FixtureSession,
    signal: AbortSignal,
  ): Promise<FixtureSession>;
  renew(session: FixtureSession, signal: AbortSignal): Promise<FixtureSession>;
  switchOrganization(
    session: FixtureSession,
    org: string,
    signal: AbortSignal,
  ): Promise<FixtureSession>;
  revoke(session: FixtureSession): Promise<void>;
  /** Fixture capability only: a real server must separately authenticate and authorize this reference. */
  revokeReference?(reference: RevocationReference): Promise<void>;
}
export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
/** Cache/drafts/media/notifications must detach synchronously before another scope can be installed. */
export interface SessionBoundary {
  detach(): void;
  attach(context: AuthContext): void;
  cleanupFailures?(): readonly CleanupFailure[];
}
export type State = Readonly<{
  status:
    | "anonymous"
    | "authenticating"
    | "restoring"
    | "authenticated"
    | "stale"
    | "blocked";
  context: AuthContext | null;
  error: AuthCode | null;
  remoteRevocation: RevocationState;
  cleanupFailures: readonly CleanupFailure[];
  observerFailures: number;
}>;

export type RevocationState =
  "none" | "confirmed" | "pending" | "failed" | "unknown";
export type CleanupFailure =
  | "boundary"
  | "cache"
  | "drafts"
  | "media"
  | "notifications"
  | "credential-delete"
  | "restore-barrier"
  | "revocation-read"
  | "revocation-write";
export type RevocationReference = Readonly<{
  userId: string;
  organizationId: string;
  sessionId: string;
}>;
export function revocationReference(raw: unknown): RevocationReference {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new AuthFault("invalid");
  const r = raw as RevocationReference;
  if (![r.userId, r.organizationId, r.sessionId].every(fixtureId))
    throw new AuthFault("invalid");
  return Object.freeze({
    userId: r.userId,
    organizationId: r.organizationId,
    sessionId: r.sessionId,
  });
}
export type RevocationRecord = Readonly<{
  reference: RevocationReference;
  outcome: "pending" | "failed" | "unknown";
}>;
