import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Auditoría DF-14 — guardar el acceso no es lo mismo que recibir mensajes:
 * el resultado dice aparte si Meta aceptó avisarnos y si aceptó mandar el
 * historial, y la pantalla no dice «listo» cuando falta algo.
 */

const { subscribe, saveCredentials } = vi.hoisted(() => ({ subscribe: vi.fn(), saveCredentials: vi.fn() }));
vi.mock("@/server/whatsapp/connect", () => ({
  subscribeAppToWaba: subscribe,
  testConnection: vi.fn(),
  verifyPhoneInWaba: vi.fn(),
}));
vi.mock("@/server/whatsapp/credentials", () => ({ saveCredentials }));
vi.mock("@/server/credentials/resolve", () => ({ whatsappOwnedElsewhere: vi.fn() }));

import { storeConnection } from "@/server/whatsapp/save-connection";
import { connectionWarnings } from "@/components/settings/embedded-signup-card";

const input = { organizationId: "org", wabaId: "1", phoneNumberId: "2", token: "t", displayPhoneNumber: "+52", verifiedName: null };

beforeEach(() => {
  subscribe.mockReset();
  saveCredentials.mockReset();
});

describe("storeConnection: el estado de la suscripción", () => {
  it("suscrita a la primera", async () => {
    subscribe.mockResolvedValue("subscribed");
    expect(await storeConnection(input)).toEqual({ ok: true, webhook: "subscribed" });
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
  it("si falla, la reintenta una vez", async () => {
    subscribe.mockResolvedValueOnce("failed").mockResolvedValueOnce("subscribed");
    expect(await storeConnection(input)).toEqual({ ok: true, webhook: "subscribed" });
    expect(subscribe).toHaveBeenCalledTimes(2);
  });
  it("si vuelve a fallar, lo dice (no «conectado» a secas)", async () => {
    subscribe.mockResolvedValue("failed");
    expect(await storeConnection(input)).toEqual({ ok: true, webhook: "failed" });
  });
  it("un override se respeta y no se reintenta", async () => {
    subscribe.mockResolvedValue("override_kept");
    expect(await storeConnection(input)).toEqual({ ok: true, webhook: "override_kept" });
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});

describe("connectionWarnings: qué le falta a la conexión", () => {
  it("todo bien → sin avisos", () => {
    expect(connectionWarnings({ webhook: "subscribed", coexistence: true, historyRequested: true, contactsRequested: true })).toEqual([]);
    expect(connectionWarnings({ webhook: "override_kept", coexistence: false })).toEqual([]);
  });
  it("sin suscripción → aviso de mensajes", () => {
    expect(connectionWarnings({ webhook: "failed" })).toHaveLength(1);
  });
  it("coexistencia sin historial → aviso de chats y contactos", () => {
    const w = connectionWarnings({ webhook: "subscribed", coexistence: true, historyRequested: false, contactsRequested: true });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/24 horas/);
  });
});
