import type { AuthContext } from "./model";
/** Future bridge contract, not a deployed bootstrap DTO or executable HTTP implementation. */
export type SecureBindingRef = Readonly<{
  environmentId: string;
  installationId: string;
  reference: string;
}>;
export type VerifiedSession = Readonly<{
  context: AuthContext;
  binding: SecureBindingRef;
}>;
export interface BetterAuthSessionBridge {
  /** Use Better Auth's own protocol; no local password hash/JWT or OAuth MCP key. */
  signIn(
    input: { email: string; password: string },
    signal: AbortSignal,
  ): Promise<VerifiedSession>;
  /** Must validate with server, including actual org, membership, delegated permissions and suspension. */
  restore(
    binding: SecureBindingRef,
    signal: AbortSignal,
  ): Promise<VerifiedSession | null>;
  /** Session/cookie revalidation, not an invented OAuth refresh-token endpoint. */
  revalidate(
    binding: SecureBindingRef,
    signal: AbortSignal,
  ): Promise<VerifiedSession>;
  signOut(binding: SecureBindingRef, signal: AbortSignal): Promise<void>;
  /** Optional capability; server organization plugin is currently blocked. */
  selectOrganization?(
    binding: SecureBindingRef,
    organizationId: string,
    signal: AbortSignal,
  ): Promise<VerifiedSession>;
}
/** Must be backed by native secure storage; no implementation accepting real values exists in I2-P. */
export interface BetterAuthCredentialStorage {
  load(binding: SecureBindingRef): Promise<Uint8Array | null>;
  replace(
    binding: SecureBindingRef,
    opaqueCookieMaterial: Uint8Array,
  ): Promise<void>;
  revokeLocal(binding: SecureBindingRef): Promise<void>;
}
