import { describe, expect, it } from "vitest";
import { creditsPace, formatMtok, functionCost, mtokToUsd, usdToMtok } from "@/lib/ai-plans";

const haiku = { inputUsdPerMtok: 0.1, outputUsdPerMtok: 0.5 };

describe("IA: modelos y costos (reglas puras)", () => {
  it("dólares ↔ millones de tokens van y vuelven", () => {
    const m = usdToMtok(5, haiku)!;
    expect(m).toBeCloseTo(5 / 0.14, 6);
    expect(mtokToUsd(m, haiku)).toBeCloseTo(5, 6);
    expect(usdToMtok(5, null)).toBeNull();
    expect(formatMtok(35.71)).toBe("35.7 M tokens");
  });

  it("costo aproximado por función", () => {
    // 1,000 respuestas de 4,000 + 250 tokens con Haiku.
    expect(functionCost("agent", haiku)).toBeCloseTo(0.525, 6);
    expect(functionCost("assistant", null)).toBeNull();
  });

  it("créditos: cuánto quedan, hasta cuándo y si vas bien", () => {
    const now = new Date(Date.UTC(2026, 10, 15));
    const p = creditsPace({ budgetUsd: 40, creditsUsd: 1120, spentSinceCredits: 20, spentThisMonth: 10, now });
    expect(p.remainingUsd).toBe(1100);
    expect(p.lastsUntil).toBe("2029-02-01");
    expect(p.tone).toBe("ok");
    expect(creditsPace({ budgetUsd: 40, creditsUsd: null, spentSinceCredits: null, spentThisMonth: 30, now }).tone).toBe("warning");
    expect(creditsPace({ budgetUsd: 40, creditsUsd: null, spentSinceCredits: null, spentThisMonth: 41, now }).tone).toBe("danger");
    expect(creditsPace({ budgetUsd: null, creditsUsd: 10, spentSinceCredits: 0, spentThisMonth: 1, now }).tone).toBeNull();
  });
});
