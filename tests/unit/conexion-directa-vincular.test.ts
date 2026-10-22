import { describe, expect, it, vi } from "vitest";
import { parseQr, parseState, phoneFromJid, qrImage } from "@/server/direct-connection/evolution-api";
import { hashToken, instanceNameOf, patchForState } from "@/server/direct-connection/link";

const NOW = new Date("2026-10-22T12:00:00Z");
const row = (o: Partial<Parameters<typeof patchForState>[0]> = {}) => ({
  status: "connected" as const,
  disconnectCount: 0,
  disconnectWindowStart: null,
  pausedUntil: null,
  ...o,
});

describe("Conexión directa PR 2 — lectura de lo que dice el servidor", () => {
  it("estado: acepta las dos formas y descarta lo raro", () => {
    expect(parseState({ instance: { state: "open" } })).toBe("open");
    expect(parseState({ state: "close" })).toBe("close");
    expect(parseState({ state: "banana" })).toBeNull();
    expect(parseState(null)).toBeNull();
  });
  it("número: solo dígitos del JID", () => {
    expect(phoneFromJid("5215512345678:12@s.whatsapp.net")).toBe("5215512345678");
    expect(phoneFromJid("x")).toBeNull();
    expect(phoneFromJid(5)).toBeNull();
  });
  it("QR: con o sin prefijo data:", () => {
    expect(qrImage("a".repeat(30))).toMatch(/^data:image\/png;base64,/);
    expect(qrImage("data:image/png;base64,AAAA" + "A".repeat(30))).toMatch(/^data:image\/png/);
    expect(qrImage("")).toBeNull();
    expect(parseQr({ base64: "a".repeat(30), pairingCode: "ABCD1234" }).pairingCode).toBe("ABCD1234");
    expect(parseQr({}).image).toBeNull();
  });
  it("nombre de instancia estable y sin caracteres raros; hash de 64 hex", () => {
    expect(instanceNameOf("org_AbC-123")).toBe("df-orgabc123");
    expect(hashToken("x")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("Conexión directa PR 2 — estados y freno de emergencia", () => {
  it("open: conectado y anota la hora la primera vez", () => {
    const p = patchForState(row({ status: "connecting" }), "open", NOW)!;
    expect(p.status).toBe("connected");
    expect(p.connectedAt).toEqual(NOW);
    expect(patchForState(row(), "open", NOW)!.connectedAt).toBeUndefined();
  });
  it("close sin estar vinculado no cuenta como desconexión", () => {
    expect(patchForState(row({ status: "connecting" }), "close", NOW)).toBeNull();
    expect(patchForState(row({ status: "pending" }), "close", NOW)).toBeNull();
  });
  it("primera desconexión del día: desconectado, sin pausa", () => {
    const p = patchForState(row(), "close", NOW)!;
    expect(p).toMatchObject({ status: "disconnected", disconnectCount: 1 });
    expect(p.pausedUntil).toBeUndefined();
  });
  it("segunda en 24 h: pausa 24 h por desconexiones", () => {
    const p = patchForState(row({ disconnectCount: 1, disconnectWindowStart: new Date(NOW.getTime() - 3_600_000) }), "close", NOW)!;
    expect(p.disconnectCount).toBe(2);
    expect(p.pauseReason).toBe("disconnects");
    expect(p.pausedUntil!.getTime() - NOW.getTime()).toBe(24 * 3_600_000);
  });
  it("una desconexión de hace más de un día reinicia la cuenta", () => {
    const p = patchForState(row({ disconnectCount: 1, disconnectWindowStart: new Date(NOW.getTime() - 25 * 3_600_000) }), "close", NOW)!;
    expect(p.disconnectCount).toBe(1);
    expect(p.pausedUntil).toBeUndefined();
  });
  it("connecting no pisa un dispositivo ya vinculado", () => {
    expect(patchForState(row(), "connecting", NOW)).toBeNull();
    expect(patchForState(row({ status: "disconnected" }), "connecting", NOW)).toEqual({ status: "connecting" });
  });
});

describe("Conexión directa PR 2 — cliente HTTP", () => {
  it("manda la llave en la cabecera y no la deja en el error", async () => {
    const { connectionState } = await import("@/server/direct-connection/evolution-api");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ instance: { state: "open" } }), { status: 200 }));
    const r = await connectionState({ baseUrl: "https://e.example", apiKey: "SECRETO" }, "df-x");
    expect(r).toEqual({ ok: true, data: "open" });
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toBe("https://e.example/instance/connectionState/df-x");
    expect((init!.headers as Record<string, string>).apikey).toBe("SECRETO");
    spy.mockResolvedValue(new Response("x", { status: 500 }));
    expect(JSON.stringify(await connectionState({ baseUrl: "https://e.example", apiKey: "SECRETO" }, "df-x"))).not.toContain("SECRETO");
    spy.mockRestore();
  });
  it("sin respuesta del servidor: unreachable", async () => {
    const { connectionState } = await import("@/server/direct-connection/evolution-api");
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("down"));
    expect(await connectionState({ baseUrl: "https://e.example", apiKey: "k" }, "df-x")).toMatchObject({ ok: false, error: "unreachable" });
    spy.mockRestore();
  });
});
