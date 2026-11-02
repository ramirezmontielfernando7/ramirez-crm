import type { ReactElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { EmbeddedSignupCard } from "@/components/settings/embedded-signup-card";

const hooks = vi.hoisted(() => ({ cleanups: [] as Array<() => void> }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => () => void) => { hooks.cleanups.push(effect()); },
}));
afterEach(() => {
  hooks.cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

function connectButton(node: ReactElement<Record<string, unknown>>): { onClick: () => void } | null {
  if (node.props["data-testid"] === "boton-conectar-facebook") return node.props as { onClick: () => void };
  const children = node.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child && typeof child === "object" && "props" in child) {
      const button = connectButton(child);
      if (button) return button;
    }
  }
  return null;
}

it("DF-17: captura el popup del SDK, restaura window.open y deja de aceptar mensajes al terminar", async () => {
  const popup = {} as Window;
  const listeners = new Set<(event: MessageEvent) => void>();
  const open = vi.fn(() => popup);
  let loginCallback!: (res: { authResponse: { code: string } }) => void;
  const fakeWindow = {
    open, fbAsyncInit: () => {},
    FB: { init: vi.fn(), login: vi.fn((callback: typeof loginCallback) => {
      fakeWindow.open();
      loginCallback = callback;
    }) },
    addEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
  };
  vi.stubGlobal("window", fakeWindow);
  vi.stubGlobal("document", { createElement: () => ({}), body: { appendChild: () => fakeWindow.fbAsyncInit() } });
  const fetch = vi.fn(async () => Response.json({ displayPhoneNumber: "local mock" }));
  vi.stubGlobal("fetch", fetch);
  const card = EmbeddedSignupCard({ config: { appId: "test", configId: "test", graphApiVersion: "v25.0" }, connected: false, onConnected: vi.fn() });
  const send = (source: MessageEventSource | null) => listeners.forEach((listener) => listener({
    source, origin: "https://www.facebook.com",
    data: { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { waba_id: "waba", phone_number_id: "phone" } },
  } as MessageEvent));
  send(popup);
  expect(fetch).not.toHaveBeenCalled();
  connectButton(card)!.onClick();
  await Promise.resolve();
  expect(open).toHaveBeenCalledOnce();
  expect(fakeWindow.open).toBe(open);
  loginCallback({ authResponse: { code: "test-code" } });
  send({} as Window);
  send(null);
  expect(fetch).not.toHaveBeenCalled();
  send(popup);
  expect(fetch).toHaveBeenCalledOnce();
  send(popup);
  expect(fetch).toHaveBeenCalledOnce();
});
