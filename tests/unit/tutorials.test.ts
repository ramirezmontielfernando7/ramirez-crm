import { describe, expect, it } from "vitest";
import { TOUR, TUTORIALS, visibleFor } from "@/lib/tutorials";

const all = { hasModule: () => true, can: () => true };

describe("tutoriales y recorrido", () => {
  it("claves únicas y todos con pasos y destino", () => {
    for (const list of [TOUR, TUTORIALS]) {
      expect(new Set(list.map((x) => x.key)).size).toBe(list.length);
      for (const x of list) expect(x.href.startsWith("/")).toBe(true);
    }
    for (const t of TUTORIALS) expect(t.steps.length).toBeGreaterThan(2);
  });
  it("esconde lo que el plan o el rol no tienen", () => {
    expect(visibleFor(TUTORIALS, all)).toHaveLength(TUTORIALS.length);
    const asesor = visibleFor(TUTORIALS, { hasModule: () => true, can: () => false }).map((t) => t.key);
    expect(asesor).toEqual(["inbox", "contacts", "pipeline"]);
    const sinAgente = visibleFor(TOUR, { hasModule: (m) => m !== "agent" && m !== "campaigns", can: () => true }).map((s) => s.key);
    expect(sinAgente).not.toContain("agent");
    expect(sinAgente).not.toContain("campaigns");
  });
});
