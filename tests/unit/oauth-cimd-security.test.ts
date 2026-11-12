import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { chatGptFallbackClient, isPrivateAddress, resolveClient } from "@/server/ai-connector/oauth";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));
const clientId = "https://client.example/metadata.json";
const metadata = { client_id: clientId, redirect_uris: ["https://client.example/callback"] };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("DF-10: solo direcciones globales", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.31.1.2", "192.168.1.1", "100.64.1.1",
    "192.0.0.1", "192.0.2.1", "192.88.99.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd00::1", "fe80::1", "febf::1", "ff02::1", "2001:db8::1", "2001::1", "2002:7f00:1::", "3fff::1", "64:ff9b::7f00:1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "::ffff:a00:1", "::ffff:c0a8:101", "::ffff:c000:201", "::127.0.0.1", "garbage",
  ])("bloquea %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));
  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:808:808"])("permite %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));
});

describe("DF-10: conexión CIMD fijada", () => {
  it("conecta a la IP validada conservando URL, SNI y verificación TLS", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(metadata)));
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(request).mockImplementation(((url: URL, options: import("node:https").RequestOptions, callback: (res: PassThrough) => void) => {
      expect(url.href).toBe(clientId);
      expect(options.agent).toBe(false);
      expect(options.family).toBe(4);
      expect(options.servername).toBe("client.example");
      expect(options.rejectUnauthorized).toBe(true);
      const cb = vi.fn();
      options.lookup!("client.example", {}, cb);
      expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
      const req = new EventEmitter();
      Object.assign(req, {
        end: () => {
          const res = Object.assign(new PassThrough(), { statusCode: 200 });
          callback(res);
          res.on("end", () => req.emit("close"));
          res.end(JSON.stringify(metadata));
        },
        destroy: (error: Error) => req.emit("error", error),
      });
      return req;
    }) as unknown as typeof request);
    expect(await resolveClient(clientId)).toMatchObject({ clientId });
    expect(request).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rechaza DNS mixto público/privado antes de conectar", async () => {
    vi.mocked(request).mockClear();
    vi.mocked(lookup).mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "::ffff:7f00:1", family: 6 }] as never);
    expect(await resolveClient(clientId)).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("047 — ChatGPT cuando no se pueden leer sus metadatos", () => {
  it("si chatgpt.com no responde, acepta SOLO sus regresos oficiales en chatgpt.com", async () => {
    vi.mocked(lookup).mockRejectedValue(new Error("bloqueado"));
    const stable = await resolveClient("https://chatgpt.com/oauth/client.json");
    expect(stable?.redirectUris).toEqual(["https://chatgpt.com/connector_platform_oauth_redirect"]);
    const own = await resolveClient("https://chatgpt.com/oauth/cb_Ab-12/client.json");
    expect(own?.redirectUris).toEqual([
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "https://chatgpt.com/connector/oauth/cb_Ab-12",
    ]);
    expect(own?.clientName).toBe("ChatGPT");
  });
  it("no reconoce imitaciones de ChatGPT", () => {
    for (const id of [
      "https://chatgpt.com.evil.example/oauth/client.json",
      "https://evil.example/chatgpt.com/oauth/client.json",
      "http://chatgpt.com/oauth/client.json",
      "https://chatgpt.com/oauth/a/b/client.json",
      "https://chatgpt.com/oauth/client.json?x=1",
    ]) expect(chatGptFallbackClient(id)).toBeNull();
  });
});
