/** I1 proposals, used only by the in-memory harness. Not current CRM HTTP DTOs. */
export type CrmRole = "owner" | "coordinador" | "asesor";
export type Scope = Readonly<{
  userId: string;
  organizationId: string;
  sessionId: string;
  expiresAt: number;
}>;
export type IntegrationMode = "demo" | "isolated-test" | "production";
export class IntegrationError extends Error {
  constructor(
    readonly code:
      | "unauthorized"
      | "forbidden"
      | "not_found"
      | "offline"
      | "conflict"
      | "uncertain"
      | "invalid"
      | "server"
      | "blocked",
  ) {
    super(code);
  }
}
export function environment(mode: IntegrationMode, origin?: string) {
  if (!["demo", "isolated-test"].includes(mode) || origin !== undefined)
    throw new IntegrationError("blocked");
  return Object.freeze({
    mode,
    transport: "memory-only" as const,
    remoteEnabled: false as const,
  });
}
export function mobileRole(role: CrmRole): "owner" | "coordinator" | "advisor" {
  if (role === "owner") return "owner";
  if (role === "coordinador") return "coordinator";
  if (role === "asesor") return "advisor";
  throw new IntegrationError("invalid");
}
/** Future credential lifecycle. I1 never stores a real cookie/token/password. */
export interface CredentialVault {
  read(binding: string): Promise<string | null>;
  write(binding: string, secret: string): Promise<void>;
  remove(binding: string): Promise<void>;
}
export interface AuthPort {
  login(email: string, password: string): Promise<Scope>;
  validate(scope: Scope): Promise<Scope>;
  refresh(scope: Scope): Promise<Scope>;
  logout(scope: Scope): Promise<void>;
  switchOrganization(scope: Scope, organizationId: string): Promise<Scope>;
}
export type Entity = Readonly<{
  organizationId: string;
  id: string;
  version: number;
  text: string;
  deleted: boolean;
}>;
/** Durable revision/cursor/tombstones are a SERVER PROPOSAL, not an existing endpoint. */
export type ChangePage = Readonly<{
  organizationId: string;
  cursor: number;
  serverTime: number;
  rows: readonly Entity[];
}>;
export interface SyncPort {
  changes(scope: Scope, cursor: number): Promise<ChangePage>;
}
export type SendCommand = Readonly<{
  conversationId: string;
  text: string;
  idempotencyKey: string;
}>;
export interface SendPort {
  send(scope: Scope, command: SendCommand): Promise<{ messageId: string }>;
}
/** Current CRM POST does not accept an idempotency key. Never auto-retry an uncertain send. */
export function retryDecision(
  status: number | "network",
  writeMayHaveReachedServer: boolean,
):
  "reauthenticate" | "invalidate" | "reconcile-only" | "manual" | "retry-read" {
  if (status === 401) return "reauthenticate";
  if (status === 403 || status === 404) return "invalidate";
  if (writeMayHaveReachedServer) return "reconcile-only";
  return status === 429 || status === 503 || status === "network"
    ? "retry-read"
    : "manual";
}
