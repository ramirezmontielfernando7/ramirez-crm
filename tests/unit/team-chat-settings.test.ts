import { describe, expect, it, vi } from "vitest";

/**
 * 025 — Ajustes del chat de equipo: la delegación de grupos al Coordinador y
 * el aviso de supervisión.
 */

const db = vi.hoisted(() => ({ calls: 0, row: null as null | Record<string, boolean>, fail: false }));

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: async () => {
      db.calls++;
      if (db.fail) {
        // Como llega con drizzle 0.45: DrizzleQueryError con el SQL y sus
        // parámetros en el mensaje, y el error de Postgres en `cause`.
        throw Object.assign(new Error("Failed query: select … where tel = $1\nparams: 5215555"), {
          query: "select … where tel = $1",
          params: ["5215555"],
          cause: Object.assign(new Error("boom"), { code: "57P01", severity: "FATAL" }),
        });
      }
      return db.row ? [db.row] : [];
    },
  };
  return { ...original, getDb: () => chain };
});

import {
  DEFAULT_TEAM_CHAT_SETTINGS,
  delegatedGrants,
  grantsFromSettings,
  oversightNoticeVisible,
} from "@/server/team-chat/settings";

describe("025 — aviso de supervisión", () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false], // el toggle del aviso encendido no basta sin supervisión
    [false, false, false],
  ])("supervisión=%s aviso=%s → se muestra=%s", (ownerOversight, showOversightNotice, visible) => {
    expect(
      oversightNoticeVisible({ ...DEFAULT_TEAM_CHAT_SETTINGS, ownerOversight, showOversightNotice })
    ).toBe(visible);
  });

  it("los defaults: supervisión encendida, aviso apagado, grupos solo del Propietario", () => {
    expect(DEFAULT_TEAM_CHAT_SETTINGS).toEqual({
      ownerOversight: true,
      showOversightNotice: false,
      coordinatorsCanCreateGroups: false,
    });
  });
});

describe("025 — delegación de grupos", () => {
  const on = { ...DEFAULT_TEAM_CHAT_SETTINGS, coordinatorsCanCreateGroups: true };

  it("encendida, el Coordinador recibe team_chat.create_groups; el Asesor no", () => {
    expect(grantsFromSettings("coordinador", on)).toEqual(["team_chat.create_groups"]);
    expect(grantsFromSettings("asesor", on)).toEqual([]);
    expect(grantsFromSettings("coordinador", DEFAULT_TEAM_CHAT_SETTINGS)).toEqual([]);
  });

  it("para roles que no pueden recibir delegaciones NO se consulta la BD", async () => {
    db.calls = 0;
    expect(await delegatedGrants("org_a", "asesor")).toEqual([]);
    expect(await delegatedGrants("org_a", "owner")).toEqual([]);
    expect(db.calls).toBe(0);
  });

  it("el Coordinador la lee de la organización", async () => {
    db.row = { ...on };
    expect(await delegatedGrants("org_a", "coordinador")).toEqual(["team_chat.create_groups"]);
    db.row = null;
    expect(await delegatedGrants("org_a", "coordinador")).toEqual([]);
  });

  it("si la BD falla, falla CERRADO y el log no trae SQL ni datos", async () => {
    db.fail = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await delegatedGrants("org_a", "coordinador")).toEqual([]);
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toContain("5215555");
    spy.mockRestore();
    db.fail = false;
  });
});
