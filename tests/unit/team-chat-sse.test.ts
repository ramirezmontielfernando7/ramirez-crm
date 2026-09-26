import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 025 — Tiempo real del chat de equipo: un evento le llega SOLO a su
 * audiencia. Se prueba la regla (quién está en la audiencia) y el camino
 * completo de `/api/events` con un suscriptor de verdad: el Coordinador ve
 * todos los chats de clientes pero NO los directos del equipo, y la lista de
 * la audiencia nunca viaja al cliente.
 */

const state = vi.hoisted(() => ({ session: null as unknown }));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => state.session,
}));

import { computeAudience } from "@/server/team-chat/audience";
import { canSeeEvent } from "@/server/events/visibility";
import { publish, type SseEvent } from "@/server/events/bus";
import { GET } from "@/app/api/events/route";

const MEMBERS = [
  { userId: "usr_owner", role: "owner" },
  { userId: "usr_coord", role: "coordinador" },
  { userId: "usr_a", role: "asesor" },
  { userId: "usr_b", role: "asesor" },
];

describe("quién está en la audiencia", () => {
  const directAB = { kind: "direct" as const, participantIds: ["usr_a", "usr_b"], members: MEMBERS };

  it("un directo: sus dos participantes y, con supervisión, el Propietario", () => {
    expect(computeAudience({ ...directAB, ownerOversight: true }).sort()).toEqual(["usr_a", "usr_b", "usr_owner"]);
  });

  it("con la supervisión APAGADA el Propietario no recibe directos ajenos", () => {
    expect(computeAudience({ ...directAB, ownerOversight: false }).sort()).toEqual(["usr_a", "usr_b"]);
  });

  it("el Coordinador (que ve todos los chats de clientes) no está si no participa", () => {
    expect(computeAudience({ ...directAB, ownerOversight: true })).not.toContain("usr_coord");
  });

  it("quien salió de la organización deja de recibir, aunque siga como participante", () => {
    const sinB = MEMBERS.filter((m) => m.userId !== "usr_b");
    expect(computeAudience({ ...directAB, members: sinB, ownerOversight: false })).toEqual(["usr_a"]);
  });

  it("avisos: todo el equipo actual", () => {
    expect(
      computeAudience({ kind: "announcements", participantIds: [], members: MEMBERS, ownerOversight: false }).sort()
    ).toEqual(["usr_a", "usr_b", "usr_coord", "usr_owner"]);
  });
});

const teamEvent = (audience: string[], body = "secreto del directo"): SseEvent => ({
  type: "team.message",
  data: { threadId: "tct_x", change: "new", message: { id: "tcm_1", body } },
  audience,
});

describe("canSeeEvent con eventos del equipo", () => {
  it("seesAll NO alcanza: se decide por audiencia", async () => {
    const coord = { organizationId: "org_a", userId: "usr_coord", seesAll: true };
    expect(await canSeeEvent(coord, teamEvent(["usr_a", "usr_b"]))).toBe(false);
    expect(await canSeeEvent(coord, teamEvent(["usr_coord"]))).toBe(true);
  });
});

/** Abre /api/events como `userId` y junta lo que llega. */
async function suscribir(userId: string, role: string) {
  state.session = {
    userId,
    organizationId: "org_sse",
    role,
    access: { organizationId: "org_sse", userId, seesAll: role !== "asesor" },
  };
  const ctl = new AbortController();
  const res = await GET(new Request("http://localhost/api/events", { signal: ctl.signal }));
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = "";
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
      }
    } catch {
      /* abortado */
    }
  })();
  return {
    texto: () => text,
    cerrar: async () => {
      ctl.abort();
      await reader.cancel().catch(() => {});
      await pump;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("/api/events con el chat de equipo", () => {
  const abiertos: { cerrar: () => Promise<void> }[] = [];
  afterEach(async () => {
    await Promise.all(abiertos.splice(0).map((s) => s.cerrar()));
  });

  it("un NO participante no recibe nada del hilo (asesor y Coordinador)", async () => {
    const a = await suscribir("usr_a", "asesor");
    const coord = await suscribir("usr_coord", "coordinador");
    const extraño = await suscribir("usr_c", "asesor");
    abiertos.push(a, coord, extraño);
    publish("org_sse", teamEvent(["usr_a", "usr_b"]));
    await tick();
    expect(a.texto()).toContain("event: team.message");
    expect(coord.texto()).not.toContain("team.message");
    expect(extraño.texto()).not.toContain("team.message");
    expect(coord.texto()).not.toContain("secreto del directo");
  });

  it("la audiencia nunca viaja al cliente", async () => {
    const a = await suscribir("usr_a", "asesor");
    abiertos.push(a);
    publish("org_sse", teamEvent(["usr_a", "usr_zz_otro"]));
    await tick();
    expect(a.texto()).toContain("team.message");
    expect(a.texto()).not.toContain("audience");
    expect(a.texto()).not.toContain("usr_zz_otro");
  });

  it("con la supervisión apagada el Propietario no recibe (no está en la audiencia)", async () => {
    const owner = await suscribir("usr_owner", "owner");
    abiertos.push(owner);
    const audience = computeAudience({
      kind: "direct",
      participantIds: ["usr_a", "usr_b"],
      members: MEMBERS,
      ownerOversight: false,
    });
    publish("org_sse", teamEvent(audience));
    await tick();
    expect(owner.texto()).not.toContain("team.message");
  });

  it("de otra organización no llega nada, aunque el id coincida", async () => {
    const a = await suscribir("usr_a", "asesor");
    abiertos.push(a);
    publish("org_otra", teamEvent(["usr_a"]));
    await tick();
    expect(a.texto()).not.toContain("team.message");
  });
});
