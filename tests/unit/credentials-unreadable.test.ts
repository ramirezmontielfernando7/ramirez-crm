import { describe, expect, it } from "vitest";
import { credentialsUnreadable } from "@/lib/api";
import { CredentialUnavailableError } from "@/server/credentials";

/**
 * Fase 3, PR 1 — Credenciales que no se pueden abrir (llave faltante o
 * equivocada): la API responde 503 con qué hacer, no un 500 genérico, y sin
 * ningún valor secreto.
 */
describe("credenciales ilegibles → 503 claro", () => {
  it("key_unavailable y decrypt_failed → 503 credentials_unreadable", async () => {
    for (const code of ["key_unavailable", "decrypt_failed"] as const) {
      const res = credentialsUnreadable(new CredentialUnavailableError("whatsapp", code));
      expect(res?.status).toBe(503);
      const body = await res!.json();
      expect(body.error.code).toBe("credentials_unreadable");
      expect(body.error.message).toMatch(/ENCRYPTION_KEY/);
    }
  });

  it("cualquier otro error sigue su camino (500 genérico)", () => {
    expect(credentialsUnreadable(new Error("otra cosa"))).toBeNull();
    expect(credentialsUnreadable(new CredentialUnavailableError("whatsapp", "reconnect_required"))).toBeNull();
  });
});
