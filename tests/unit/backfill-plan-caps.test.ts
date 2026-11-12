import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_CATALOG } from "@/lib/plan-catalog";
import { DEFAULTS, planFill } from "../../scripts/backfill-plan-caps.mjs";

describe("scripts/backfill-plan-caps.mjs", () => {
  it("los valores de fábrica del script son los del catálogo", () => {
    for (const k of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      const e = DEFAULT_PLAN_CATALOG[k];
      expect(DEFAULTS[k]).toEqual({ members: e.peopleLimit, storageGb: e.storageGb });
    }
  });

  it("solo rellena topes vacíos y nunca pisa uno puesto a mano", () => {
    const caps = DEFAULTS;
    const gb = 1024 ** 3;
    expect(planFill({ plan_key: "pro", max_members: null, storage_limit_bytes: null }, caps)).toEqual({ members: 5, storage: 30 * gb });
    expect(planFill({ plan_key: "pro", max_members: 8, storage_limit_bytes: null }, caps)).toEqual({ members: null, storage: 30 * gb });
    expect(planFill({ plan_key: "pro", max_members: 8, storage_limit_bytes: 1 }, caps)).toBeNull();
    expect(planFill({ plan_key: "custom", max_members: null, storage_limit_bytes: null }, caps)).toBeNull();
  });
});
