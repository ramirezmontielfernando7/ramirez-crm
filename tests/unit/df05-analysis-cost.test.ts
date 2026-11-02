import { expect, it } from "vitest";
import { costByKind, type Pricing } from "@/lib/costs";
it("DF-05: análisis usa su tarifa y no la del asistente", () => {
 const p = { chatInputUsdPerMtok: 100, chatOutputUsdPerMtok: 200, analysisInputUsdPerMtok: 1, analysisOutputUsdPerMtok: 2 } as Pricing;
 const rows = costByKind([{ kind: "analysis", promptTokens: 1000000, completionTokens: 1000000, costUsd: 4 }], p);
 expect(rows).toEqual([{ kind: "analysis", tokens: 2000000, estimatedUsd: 3, realUsd: 4 }]);
});
