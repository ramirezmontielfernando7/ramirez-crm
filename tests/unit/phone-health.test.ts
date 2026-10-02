import { describe, expect, it } from "vitest";
import { computeHealthAlerts, parseMessagingLimit, type PhoneHealthSnapshot } from "@/lib/phone-health";
import { readingFromGraph } from "@/server/whatsapp/health";

const snap = (p: Partial<PhoneHealthSnapshot>): PhoneHealthSnapshot => ({
  day: "2026-10-02",
  qualityRating: "GREEN",
  messagingLimit: "TIER_1K",
  messagingLimitValue: 1000,
  status: "CONNECTED",
  throughputLevel: "STANDARD",
  nameStatus: "APPROVED",
  accountEvent: null,
  source: "sync",
  fetchedAt: new Date().toISOString(),
  ...p,
});

describe("salud del número", () => {
  it("el límite se lee de Meta, no se inventa", () => {
    expect(parseMessagingLimit("TIER_250")).toBe(250);
    expect(parseMessagingLimit("TIER_1K")).toBe(1000);
    expect(parseMessagingLimit("TIER_100K")).toBe(100_000);
    expect(parseMessagingLimit("TIER_UNLIMITED")).toBeNull();
    expect(parseMessagingLimit("UNLIMITED")).toBeNull();
    expect(parseMessagingLimit(null)).toBeNull();
  });

  it("prefiere el límite del portafolio y tolera formas distintas", () => {
    expect(
      readingFromGraph({ messaging_limit_tier: "TIER_250", whatsapp_business_manager_messaging_limit: "TIER_10K" })
        .messagingLimit
    ).toBe("TIER_10K");
    expect(readingFromGraph({ messaging_limit_tier: "tier_250" }).messagingLimit).toBe("TIER_250");
    expect(readingFromGraph({ throughput: { level: "HIGH" } }).throughputLevel).toBe("HIGH");
    expect(readingFromGraph({}).qualityRating).toBeNull();
  });

  it("todo bien → sin alertas", () => {
    expect(computeHealthAlerts({ today: snap({}), previous: snap({}), usage: 10, usageAlertPercent: 80 })).toEqual([]);
  });

  it("calidad baja, caída de calidad, estado del número y aviso de cuenta", () => {
    const codes = computeHealthAlerts({
      today: snap({ qualityRating: "RED", status: "FLAGGED", accountEvent: { event: "ACCOUNT_RESTRICTION" } }),
      previous: snap({ qualityRating: "GREEN" }),
      usage: 0,
      usageAlertPercent: 80,
    }).map((a) => a.code);
    expect(codes).toEqual(["quality_low", "quality_dropped", "number_status", "account_event"]);
  });

  it("uso del día cerca del límite: el umbral es configuración de la organización", () => {
    const at = (usage: number, pct: number) =>
      computeHealthAlerts({ today: snap({}), previous: null, usage, usageAlertPercent: pct }).map((a) => a.level);
    expect(at(799, 80)).toEqual([]);
    expect(at(800, 80)).toEqual(["warning"]);
    expect(at(1000, 80)).toEqual(["danger"]);
    expect(at(500, 50)).toEqual(["warning"]);
  });
});
