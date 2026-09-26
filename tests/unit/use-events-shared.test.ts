import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PR 0 (fluidez del menú) — Una sola conexión SSE por pestaña.
 *
 * Antes cada `useEvents` abría su propio EventSource: menú + pantalla = dos
 * conexiones largas por pestaña (HTTP/1.1 permite seis por origen). El chat
 * de equipo agrega más oyentes, así que esto tiene que quedar vigilado.
 */

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, ((ev: { data: string }) => void)[]>();
  closed = false;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) });
  }
  close() {
    this.closed = true;
  }
}

describe("useEvents — conexión compartida", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("dos suscriptores comparten UNA conexión y ambos reciben el evento", async () => {
    const { subscribeEvents } = await import("@/components/use-events");
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeEvents({ current: { onMessageNew: a } });
    const offB = subscribeEvents({ current: { onMessageNew: b } });
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0]!.emit("message.new", { conversationId: "cv_1", message: {} });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
    offA();
    offB();
  });

  it("un suscriptor que truena no deja sin el evento a los demás", async () => {
    const { subscribeEvents } = await import("@/components/use-events");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const b = vi.fn();
    const offA = subscribeEvents({
      current: {
        onMessageNew: () => {
          throw new Error("boom");
        },
      },
    });
    const offB = subscribeEvents({ current: { onMessageNew: b } });
    FakeEventSource.instances[0]!.emit("message.new", { conversationId: "cv_1", message: {} });
    expect(b).toHaveBeenCalledOnce();
    offA();
    offB();
    spy.mockRestore();
  });

  it("cambiar de pantalla (soltar y volver a suscribir en el acto) NO reabre la conexión", async () => {
    const { subscribeEvents } = await import("@/components/use-events");
    const off = subscribeEvents({ current: {} });
    off();
    const off2 = subscribeEvents({ current: {} });
    vi.advanceTimersByTime(5000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0]!.closed).toBe(false);
    off2();
  });

  it("sin suscriptores, la conexión se cierra tras la gracia", async () => {
    const { subscribeEvents } = await import("@/components/use-events");
    const off = subscribeEvents({ current: {} });
    off();
    expect(FakeEventSource.instances[0]!.closed).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    // Y una suscripción nueva abre otra.
    const off2 = subscribeEvents({ current: {} });
    expect(FakeEventSource.instances).toHaveLength(2);
    off2();
  });

  it("al reconectar tras un error avisa a todos (catch-up con refetch)", async () => {
    const { subscribeEvents } = await import("@/components/use-events");
    const r1 = vi.fn();
    const r2 = vi.fn();
    const off1 = subscribeEvents({ current: { onReconnect: r1 } });
    const off2 = subscribeEvents({ current: { onReconnect: r2 } });
    const es = FakeEventSource.instances[0]!;
    es.onopen?.();
    expect(r1).not.toHaveBeenCalled();
    es.onerror?.();
    es.onopen?.();
    expect(r1).toHaveBeenCalledOnce();
    expect(r2).toHaveBeenCalledOnce();
    off1();
    off2();
  });
});
