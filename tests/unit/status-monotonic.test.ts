import { describe, expect, it } from "vitest";
import { isUpgrade, pricingOf, statusTime } from "@/server/inbox/status";

describe("estados monotónicos del mensaje (FR-004)", () => {
  it("progresión normal: pending → sent → delivered → read", () => {
    expect(isUpgrade("pending", "sent")).toBe(true);
    expect(isUpgrade("sent", "delivered")).toBe(true);
    expect(isUpgrade("delivered", "read")).toBe(true);
  });

  it("nunca degrada: un delivered tardío no pisa read", () => {
    expect(isUpgrade("read", "delivered")).toBe(false);
    expect(isUpgrade("delivered", "sent")).toBe(false);
    expect(isUpgrade("sent", "pending")).toBe(false);
  });

  it("mismo estado no re-aplica", () => {
    expect(isUpgrade("delivered", "delivered")).toBe(false);
  });

  it("failed aplica desde pending o sent, una sola vez", () => {
    expect(isUpgrade("pending", "failed")).toBe(true);
    expect(isUpgrade("sent", "failed")).toBe(true);
    expect(isUpgrade("failed", "failed")).toBe(false);
  });

  it("Campañas v2: un failed tardío NO pisa delivered ni read", () => {
    expect(isUpgrade("delivered", "failed")).toBe(false);
    expect(isUpgrade("read", "failed")).toBe(false);
  });

  it("failed es terminal: nada lo saca de ahí", () => {
    expect(isUpgrade("failed", "sent")).toBe(false);
    expect(isUpgrade("failed", "delivered")).toBe(false);
    expect(isUpgrade("failed", "read")).toBe(false);
  });

  it("read puede llegar sin delivered previo (fuera de orden)", () => {
    expect(isUpgrade("sent", "read")).toBe(true);
    expect(isUpgrade("pending", "read")).toBe(true);
  });

  it("estados desconocidos se ignoran", () => {
    expect(isUpgrade("sent", "warning")).toBe(false);
  });
});

describe("datos del webhook de estados (Campañas v2)", () => {
  it("la hora viene en segundos Unix", () => {
    expect(statusTime("1790000000")?.toISOString()).toBe(new Date(1790000000 * 1000).toISOString());
    expect(statusTime("no-es-hora")).toBeNull();
    expect(statusTime(undefined)).toBeNull();
  });

  it("pricing se guarda tal cual lo manda Meta", () => {
    expect(
      pricingOf({
        id: "w",
        status: "sent",
        timestamp: "1",
        pricing: { billable: true, pricing_model: "PMP", category: "marketing", type: "regular" },
      })
    ).toEqual({ billable: true, category: "marketing", model: "PMP", type: "regular" });
  });

  it("sin pricing o con campos raros no inventa nada", () => {
    expect(pricingOf({ id: "w", status: "sent", timestamp: "1" })).toBeNull();
    expect(
      pricingOf({ id: "w", status: "sent", timestamp: "1", pricing: { billable: "sí" as unknown as boolean } })
    ).toEqual({ billable: null, category: null, model: null, type: null });
  });
});
