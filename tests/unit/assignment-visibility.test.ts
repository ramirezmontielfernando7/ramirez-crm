import { describe, expect, it, vi } from "vitest";

/**
 * 020 — Quién recibe qué por SSE y de quién son los números de Resultados.
 * (La BD no se toca en estos casos: los decide la regla, sin consulta.)
 */

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return {
    ...original,
    getDb: () => {
      throw new Error("no debería consultar la BD");
    },
  };
});

import { canSeeEvent } from "@/server/events/visibility";
import { resultsScope } from "@/server/analytics/scope";
import type { SessionContext } from "@/lib/auth/session";

const asesor = { organizationId: "org_a", userId: "usr_a", seesAll: false };
const coordinador = { organizationId: "org_a", userId: "usr_c", seesAll: true };

describe("SSE: canSeeEvent", () => {
  it("quien ve todo recibe todo, sin consultar", async () => {
    expect(
      await canSeeEvent(coordinador, {
        type: "lab.run",
        data: { runId: "r", status: "done", progress: { done: 1, total: 1 } },
      })
    ).toBe(true);
  });

  it("el asesor no recibe el Laboratorio", async () => {
    expect(
      await canSeeEvent(asesor, {
        type: "lab.run",
        data: { runId: "r", status: "done", progress: { done: 1, total: 1 } },
      })
    ).toBe(false);
  });

  it("asignaciones: al que recibe y al que pierde, a nadie más", async () => {
    const ev = (toUserId: string | null, fromUserIds: string[]) => ({
      type: "assignment.changed" as const,
      data: { contactIds: ["ct_1"], toUserId, fromUserIds },
    });
    expect(await canSeeEvent(asesor, ev("usr_a", []))).toBe(true);
    expect(await canSeeEvent(asesor, ev("usr_b", ["usr_a"]))).toBe(true);
    expect(await canSeeEvent(asesor, ev("usr_b", ["usr_c"]))).toBe(false);
    expect(await canSeeEvent(asesor, ev(null, []))).toBe(false);
  });

  it("un evento sin conversación identificable no se reenvía (falla cerrado)", async () => {
    expect(
      await canSeeEvent(asesor, { type: "conversation.updated", data: { conversation: null } })
    ).toBe(false);
  });
});

function sesion(role: string, userId: string): SessionContext {
  return {
    userId,
    organizationId: "org_a",
    role,
    access: { organizationId: "org_a", userId, seesAll: role !== "asesor" },
  };
}
const url = (q = "") => new URL(`http://localhost/api/analytics/sales?from=2026-01-01&to=2026-01-31${q}`);

describe("Resultados: resultsScope", () => {
  it("asesor: siempre los suyos", () => {
    const r = resultsScope(sesion("asesor", "usr_a"), url());
    expect(r).toEqual({ ok: true, scope: { organizationId: "org_a", userId: "usr_a", seesAll: false } });
  });

  it("asesor pidiendo los de otro: rechazado, no ignorado", () => {
    expect(resultsScope(sesion("asesor", "usr_a"), url("&userId=usr_b"))).toEqual({ ok: false });
  });

  it("coordinador: todo el equipo, o un asesor", () => {
    expect(resultsScope(sesion("coordinador", "usr_c"), url())).toEqual({
      ok: true,
      scope: { organizationId: "org_a", userId: "usr_c", seesAll: true },
    });
    expect(resultsScope(sesion("coordinador", "usr_c"), url("&userId=usr_a"))).toEqual({
      ok: true,
      scope: { organizationId: "org_a", userId: "usr_a", seesAll: false },
    });
  });
});
