import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getSystemDb, schema } from "@/lib/db";
import { runWithOrganization } from "@/lib/request-context";
import { recordAnalysisModel } from "@/server/ai-quota/quota";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";
it("DF-05: conserva función y cada modelo de análisis por separado", async () => {
  const org = await crearOrganizacion("DF-05 modelos");
  try {
    const now = new Date();
    await runWithOrganization(org.id, async () => {
      await recordAnalysisModel(org.id, "modelo-a", { promptTokens: 10, completionTokens: 2 }, now);
      await recordAnalysisModel(org.id, "modelo-b", { promptTokens: 20, completionTokens: 3 }, now);
    });
    const rows = await getSystemDb().select().from(schema.aiUsageModel).where(eq(schema.aiUsageModel.organizationId, org.id));
    expect(rows.map((r) => ({ kind: r.kind, model: r.model, tokens: r.promptTokens + r.completionTokens })).sort((a,b) => a.model.localeCompare(b.model))).toEqual([
      { kind: "analysis", model: "modelo-a", tokens: 12 },
      { kind: "analysis", model: "modelo-b", tokens: 23 },
    ]);
  } finally { await borrarOrganizaciones([org.id]); }
});
