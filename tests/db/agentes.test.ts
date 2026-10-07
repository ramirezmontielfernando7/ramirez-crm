import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSystemDb, getSystemSql, schema, withTenant } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { resetEnvCacheForTests } from "@/lib/env";
import { resetRateLimit } from "@/lib/rate-limit";
import { runWithOrganization } from "@/lib/request-context";
import { emptyConfig, type AgentConfig } from "@/server/agents/config";
import { ensureGeneralAgent } from "@/server/agents/ensure";
import { createKbEntry, kbForAgent } from "@/server/agents/kb";
import {
  AgentError,
  archiveAgent,
  createAgent,
  getAgent,
  getLegacyProfile,
  listVersions,
  makeGeneral,
  MAX_ACTIVE_AGENTS,
  publishAgent,
  putLegacyProfile,
  restoreVersion,
  saveDraft,
} from "@/server/agents/store";
import { buildRunSnapshot } from "@/server/agents/snapshot";
import { serializeBotProfile } from "@/server/bot/profile";
import { forgetOrgModules } from "@/server/modules";
import { borrarOrganizaciones, crearOrganizacion } from "./fixtures";

/**
 * 031 (PR A1) — Agentes contra Postgres REAL (como `vocero_app`, con RLS):
 * backfill, `ensureGeneralAgent` concurrente, unicidad del general, espejo en
 * `agent_profile` (y el contrato de `/api/bot/profile`), reconciliación,
 * atomicidad de publicar, versiones, tope de agentes, RLS y FKs compuestas,
 * y la vista previa: no escribe nada salvo la cuota, y su límite por minuto.
 */

const h = vi.hoisted(() => ({
  falloEspejo: false,
  respuesta: null as null | ((messages: { role: string; content: string }[]) => unknown),
  session: null as null | {
    userId: string;
    organizationId: string;
    role: string;
    access: { organizationId: string; userId: string; seesAll: boolean };
  },
}));

vi.mock("@/server/agents/mirror", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/agents/mirror")>();
  return {
    ...real,
    syncGeneralToProfile: async (...args: Parameters<typeof real.syncGeneralToProfile>) => {
      if (h.falloEspejo) throw new Error("espejo caído (prueba)");
      return real.syncGeneralToProfile(...args);
    },
  };
});

vi.mock("@/lib/ai", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...real,
    chatJson: async (_schema: unknown, messages: { role: string; content: string }[]) =>
      h.respuesta?.(messages) ?? {
        ok: true,
        data: { action: "reply", text: "hola de prueba" },
        raw: "",
        usage: { promptTokens: 10, completionTokens: 5 },
      },
  };
});

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...real,
    requireSession: async () => {
      if (!h.session) throw new real.UnauthorizedError();
      return h.session;
    },
    getSessionOrNull: async () => h.session,
  };
});

const sys = () => getSystemDb();
const as = <T>(org: string, fn: () => Promise<T>) => runWithOrganization(org, fn);

let A: Awaited<ReturnType<typeof crearOrganizacion>>;
let B: Awaited<ReturnType<typeof crearOrganizacion>>;
let ACTOR: string;

function cfg(extra: Partial<AgentConfig> = {}): AgentConfig {
  return { ...emptyConfig(), ...extra };
}

async function generales(org: string) {
  return sys()
    .select()
    .from(schema.agent)
    .where(and(eq(schema.agent.organizationId, org), eq(schema.agent.isGeneral, true), isNull(schema.agent.archivedAt)));
}

async function perfil(org: string) {
  const [p] = await sys().select().from(schema.agentProfile).where(eq(schema.agentProfile.organizationId, org));
  return p!;
}

async function logs(agentId: string) {
  return sys().select().from(schema.agentPublishLog).where(eq(schema.agentPublishLog.agentId, agentId));
}

beforeAll(async () => {
  process.env.OPENROUTER_API_TOKEN = "sk-test-agentes";
  process.env.OPENROUTER_MODEL = "mock/modelo";
  resetEnvCacheForTests();
  A = await crearOrganizacion("Agentes A");
  B = await crearOrganizacion("Agentes B");
  ACTOR = `usr_agentes_${Math.random().toString(36).slice(2, 8)}`;
  await sys().insert(schema.user).values({ id: ACTOR, name: "Dueña Agentes", email: `${ACTOR}@agentes.test` });
  await sys()
    .update(schema.agentProfile)
    .set({ name: "Martillito", tone: "Cercano", updatedAt: new Date("2026-01-01T00:00:00Z") })
    .where(eq(schema.agentProfile.organizationId, A.id));
});

afterAll(async () => {
  await borrarOrganizaciones([A.id, B.id]);
  await sys().delete(schema.user).where(eq(schema.user.id, ACTOR));
  delete process.env.OPENROUTER_API_TOKEN;
  delete process.env.OPENROUTER_MODEL;
  resetEnvCacheForTests();
});

beforeEach(() => {
  h.falloEspejo = false;
  h.respuesta = null;
  h.session = null;
});

describe("migración 0035: backfill del agente general", () => {
  it("una organización con agent_profile queda con un general publicado equivalente; re-ejecutar no duplica", async () => {
    const sql = readFileSync(path.resolve(import.meta.dirname, "../../drizzle/0035_agentes.sql"), "utf8");
    const backfill = sql.split("--> statement-breakpoint").find((s) => s.includes('INSERT INTO "agent"'))!;
    const raw = getSystemSql();
    await raw.unsafe(backfill);
    await raw.unsafe(backfill);
    const g = await generales(A.id);
    expect(g).toHaveLength(1);
    const p = await perfil(A.id);
    expect(g[0]!.published).toEqual({
      v: 1,
      displayName: "Martillito",
      tone: "Cercano",
      greeting: null,
      instructions: null,
      escalationRules: null,
      useSharedKb: true,
    });
    expect(g[0]!.draft).toEqual(g[0]!.published);
    expect(g[0]!.publishedAt?.getTime()).toBe(p.updatedAt.getTime());
    expect(g[0]!.internalName).toBe("Agente principal");
  });
});

describe("ensureGeneralAgent", () => {
  it("con solo agent_profile (fixtures, seeds viejos) crea UNO aunque se llame 10 veces a la vez", async () => {
    const D = await crearOrganizacion("Agentes D");
    try {
      expect(await generales(D.id)).toHaveLength(0);
      const r = await Promise.all(Array.from({ length: 10 }, () => as(D.id, () => ensureGeneralAgent(D.id))));
      expect(new Set(r.map((x) => x?.agent.id)).size).toBe(1);
      expect(await generales(D.id)).toHaveLength(1);
    } finally {
      await borrarOrganizaciones([D.id]);
    }
  });

  it("sin agent_profile no inventa nada", async () => {
    const C = await crearOrganizacion("Agentes C");
    try {
      await sys().delete(schema.agentProfile).where(eq(schema.agentProfile.organizationId, C.id));
      expect(await as(C.id, () => ensureGeneralAgent(C.id))).toBeNull();
      expect(await generales(C.id)).toHaveLength(0);
    } finally {
      await borrarOrganizaciones([C.id]);
    }
  });

  it("un 2.º general (no archivado) lo rechaza la BD", async () => {
    await expect(
      as(A.id, () =>
        withTenant(A.id, (tx) =>
          tx.insert(schema.agent).values({
            id: newId("agent"),
            organizationId: A.id,
            internalName: "Otro general",
            isGeneral: true,
            draft: cfg(),
            published: cfg(),
          })
        )
      )
    ).rejects.toThrow();
  });
});

describe("reconciliación con agent_profile", () => {
  it("si la imagen anterior guarda el perfil, el general se pone al día (legacy_put) y el borrador sin cambios lo sigue", async () => {
    const [g] = await generales(A.id);
    const antes = (await logs(g!.id)).length;
    // Lo que haría el contenedor viejo durante el despliegue.
    await sys()
      .update(schema.agentProfile)
      .set({ instructions: "Escrito por la imagen anterior", updatedAt: new Date() })
      .where(eq(schema.agentProfile.organizationId, A.id));
    const r = await as(A.id, () => ensureGeneralAgent(A.id));
    expect(r?.published?.instructions).toBe("Escrito por la imagen anterior");
    expect((await generales(A.id))[0]!.draft).toMatchObject({ instructions: "Escrito por la imagen anterior" });
    const l = await logs(g!.id);
    expect(l).toHaveLength(antes + 1);
    expect(l.some((x) => x.action === "legacy_put")).toBe(true);
    // Lectura barata: la siguiente vez ya no escribe.
    await as(A.id, () => ensureGeneralAgent(A.id));
    expect(await logs(g!.id)).toHaveLength(antes + 1);
  });

  it("solo el interruptor (updated_at nuevo, mismo comportamiento) no escribe nada", async () => {
    const [g] = await generales(A.id);
    const antes = (await logs(g!.id)).length;
    await as(A.id, () => putLegacyProfile(A.id, ACTOR, { enabled: true }));
    await as(A.id, () => ensureGeneralAgent(A.id));
    expect(await logs(g!.id)).toHaveLength(antes);
    expect((await perfil(A.id)).enabled).toBe(true);
  });
});

describe("borrador, publicar y espejo", () => {
  it("guardar el borrador del general NO cambia producción ni el espejo", async () => {
    const [g] = await generales(A.id);
    const before = await perfil(A.id);
    await as(A.id, () => saveDraft(A.id, g!.id, cfg({ displayName: "Nuevo", tone: "Formal" })));
    expect((await perfil(A.id)).name).toBe(before.name);
    const r = await as(A.id, () => ensureGeneralAgent(A.id));
    expect(r?.published?.displayName).toBe("Martillito");
    const d = await as(A.id, () => getAgent(A.id, g!.id));
    expect(d?.status).toBe("changes");
  });

  it("publicar el general: producción + espejo + versión, sin tocar `enabled`; contrato del bot intacto", async () => {
    const [g] = await generales(A.id);
    await sys().update(schema.agentProfile).set({ enabled: false }).where(eq(schema.agentProfile.organizationId, A.id));
    await as(A.id, () => publishAgent(A.id, g!.id, ACTOR));
    const p = await perfil(A.id);
    expect(p.enabled).toBe(false);
    expect(p.name).toBe("Nuevo");
    expect(p.tone).toBe("Formal");
    const [g2] = await generales(A.id);
    expect(p.updatedAt.getTime()).toBe(g2!.publishedAt!.getTime());
    expect(serializeBotProfile(p, []).profile).toEqual({
      name: "Nuevo",
      tone: "Formal",
      instructions: null,
      escalationRules: null,
      greeting: null,
    });
    expect((await logs(g!.id)).at(-1)?.action).toBeDefined();
  });

  it("general SIN nombre: el espejo escribe «Asistente» y la reconciliación no se lo devuelve", async () => {
    const [g] = await generales(A.id);
    await as(A.id, () => saveDraft(A.id, g!.id, cfg({ displayName: "" })));
    await as(A.id, () => publishAgent(A.id, g!.id, ACTOR));
    expect((await perfil(A.id)).name).toBe("Asistente");
    await as(A.id, () => putLegacyProfile(A.id, ACTOR, { enabled: true }));
    const r = await as(A.id, () => ensureGeneralAgent(A.id));
    expect(r?.published?.displayName).toBeNull();
  });

  it("si el espejo falla, NO queda nada a medias (publicar es una transacción)", async () => {
    const [g] = await generales(A.id);
    const antesLogs = (await logs(g!.id)).length;
    await as(A.id, () => saveDraft(A.id, g!.id, cfg({ displayName: "Nunca publicado" })));
    h.falloEspejo = true;
    await expect(as(A.id, () => publishAgent(A.id, g!.id, ACTOR))).rejects.toThrow("espejo caído");
    h.falloEspejo = false;
    const [g2] = await generales(A.id);
    expect((g2!.published as AgentConfig).displayName).toBeNull();
    expect(await logs(g!.id)).toHaveLength(antesLogs);
  });

  it("PUT histórico de /agent: actualiza el perfil y el general a la vez; `name: null` = sin nombre", async () => {
    await as(A.id, () => putLegacyProfile(A.id, ACTOR, { name: "Sofi", instructions: "Hola" }));
    let p = await as(A.id, () => getLegacyProfile(A.id));
    expect(p).toMatchObject({ name: "Sofi", displayName: "Sofi", instructions: "Hola", hasUnpublishedDraft: false });
    expect((await perfil(A.id)).name).toBe("Sofi");
    await as(A.id, () => putLegacyProfile(A.id, ACTOR, { name: null }));
    p = await as(A.id, () => getLegacyProfile(A.id));
    expect(p).toMatchObject({ name: "Asistente", displayName: null, instructions: "Hola" });
  });
});

describe("varios agentes", () => {
  it("crear (sin nombre), duplicar con su conocimiento, publicar, hacer general: nunca 0 ni 2 generales", async () => {
    const nuevo = await as(A.id, () => createAgent({ organizationId: A.id, actorUserId: ACTOR, internalName: "Ventas" }));
    expect(nuevo.draft.displayName).toBeNull();
    expect(nuevo.status).toBe("draft");
    await as(A.id, () => createKbEntry(A.id, { kind: "qa", question: "¿Precio?", answer: "$10", agentId: nuevo.id }));
    const copia = await as(A.id, () =>
      createAgent({ organizationId: A.id, actorUserId: ACTOR, internalName: "Ventas (copia)", duplicateOf: nuevo.id })
    );
    expect((await as(A.id, () => kbForAgent(A.id, copia.id, false))).map((e) => e.question)).toEqual(["¿Precio?"]);

    await expect(as(A.id, () => makeGeneral(A.id, nuevo.id, ACTOR))).rejects.toMatchObject({ code: "not_published" });
    await as(A.id, () => saveDraft(A.id, nuevo.id, cfg({ displayName: "Vale", instructions: "Vende" })));
    await as(A.id, () => publishAgent(A.id, nuevo.id, ACTOR));
    const [viejo] = await generales(A.id);
    await Promise.all([
      as(A.id, () => makeGeneral(A.id, nuevo.id, ACTOR)),
      as(A.id, () => makeGeneral(A.id, nuevo.id, ACTOR)),
    ]);
    const g = await generales(A.id);
    expect(g.map((x) => x.id)).toEqual([nuevo.id]);
    expect((await perfil(A.id)).name).toBe("Vale");
    // El anterior sigue existiendo como agente normal y ya se puede archivar.
    await as(A.id, () => archiveAgent(A.id, viejo!.id));
    await expect(as(A.id, () => archiveAgent(A.id, nuevo.id))).rejects.toMatchObject({ code: "agent_general" });
  });

  it("restaurar una versión la carga al BORRADOR, nunca a producción", async () => {
    const [g] = await generales(A.id);
    const versiones = (await as(A.id, () => listVersions(A.id, g!.id)))!;
    const vieja = versiones.find((v) => v.action === "publish")!;
    await as(A.id, () => saveDraft(A.id, g!.id, cfg({ displayName: "Otra cosa" })));
    await as(A.id, () => publishAgent(A.id, g!.id, ACTOR));
    await as(A.id, () => restoreVersion(A.id, g!.id, vieja.id, ACTOR));
    const d = (await as(A.id, () => getAgent(A.id, g!.id)))!;
    expect(d.draft.displayName).toBe(vieja.snapshot.displayName);
    expect(d.published?.displayName).toBe("Otra cosa");
    expect((await perfil(A.id)).name).toBe("Otra cosa");
  });

  it("guarda solo las últimas 30 versiones por agente", async () => {
    const [g] = await generales(A.id);
    for (let i = 0; i < 32; i++) await as(A.id, () => publishAgent(A.id, g!.id, ACTOR));
    expect((await logs(g!.id)).length).toBe(30);
  });

  it(`tope de ${MAX_ACTIVE_AGENTS} agentes activos, aun con altas a la vez`, async () => {
    const activos = async () =>
      (await sys().select().from(schema.agent).where(and(eq(schema.agent.organizationId, B.id), isNull(schema.agent.archivedAt)))).length;
    const faltan = MAX_ACTIVE_AGENTS - (await activos()) + 3;
    const r = await Promise.allSettled(
      Array.from({ length: faltan }, (_, i) =>
        as(B.id, () => createAgent({ organizationId: B.id, actorUserId: ACTOR, internalName: `A${i}` }))
      )
    );
    expect(await activos()).toBe(MAX_ACTIVE_AGENTS);
    const rechazos = r.filter((x) => x.status === "rejected") as PromiseRejectedResult[];
    expect(rechazos).toHaveLength(3);
    expect(rechazos[0]!.reason).toBeInstanceOf(AgentError);
    expect((rechazos[0]!.reason as AgentError).code).toBe("agent_limit");
  });
});

describe("aislamiento entre organizaciones", () => {
  it("B no ve los agentes ni las versiones de A (RLS)", async () => {
    const [gA] = await generales(A.id);
    const visto = await as(B.id, () => getAgent(B.id, gA!.id));
    expect(visto).toBeNull();
    const filas = await withTenant(B.id, (tx) => tx.select().from(schema.agentPublishLog).where(eq(schema.agentPublishLog.agentId, gA!.id)));
    expect(filas).toHaveLength(0);
  });

  it("B no puede colgar conocimiento ni corridas de un agente de A (FK compuesta)", async () => {
    const [gA] = await generales(A.id);
    await expect(
      sys().insert(schema.kbEntry).values({ id: newId("kbEntry"), organizationId: B.id, kind: "block", content: "x", agentId: gA!.id })
    ).rejects.toThrow();
    await expect(
      sys().insert(schema.agentTestRun).values({ id: newId("testRun"), organizationId: B.id, status: "done", agentId: gA!.id })
    ).rejects.toThrow();
    await expect(as(B.id, () => createKbEntry(B.id, { kind: "block", content: "x", agentId: gA!.id }))).rejects.toThrow();
  });
});

describe("evaluaciones: snapshot", () => {
  it("congela la config elegida (borrador o publicado) y el conocimiento del agente", async () => {
    const ag = await as(A.id, () => createAgent({ organizationId: A.id, actorUserId: ACTOR, internalName: "Snap" }));
    await as(A.id, () => saveDraft(A.id, ag.id, cfg({ instructions: "borrador", useSharedKb: false })));
    await as(A.id, () => createKbEntry(A.id, { kind: "block", content: "solo de Snap", agentId: ag.id }));
    await as(A.id, () => createKbEntry(A.id, { kind: "block", content: "compartido" }));
    await expect(as(A.id, () => buildRunSnapshot(A.id, { agentId: ag.id }))).rejects.toMatchObject({ code: "not_published" });
    const s = await as(A.id, () => buildRunSnapshot(A.id, { agentId: ag.id, source: "draft" }));
    expect(s.config.instructions).toBe("borrador");
    expect(s.kbText).toBe("solo de Snap");
    const general = await as(A.id, () => buildRunSnapshot(A.id, {}));
    expect(general.isGeneral).toBe(true);
    expect(general.kbText).toContain("compartido");
    expect(general.kbText).not.toContain("solo de Snap");
  });
});

describe("vista previa (POST /api/lab/preview)", () => {
  type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
  async function preview(body: unknown): Promise<Response> {
    const mod = (await import("@/app/api/lab/preview/route")) as unknown as Record<string, Handler>;
    return mod.POST!(
      new Request("http://localhost/api/lab/preview", { method: "POST", body: JSON.stringify(body) }),
      { params: Promise.resolve({}) }
    );
  }
  const owner = (org: string) => {
    h.session = { userId: ACTOR, organizationId: org, role: "owner", access: { organizationId: org, userId: ACTOR, seesAll: true } };
  };

  async function conteos(org: string) {
    const db = sys();
    const n = async (t: typeof schema.message | typeof schema.lead | typeof schema.booking | typeof schema.conversation | typeof schema.contactActivityEvent | typeof schema.agent | typeof schema.kbEntry) =>
      (await db.select({ id: t.id }).from(t).where(eq(t.organizationId, org))).length;
    return {
      message: await n(schema.message),
      lead: await n(schema.lead),
      booking: await n(schema.booking),
      conversation: await n(schema.conversation),
      activity: await n(schema.contactActivityEvent),
      agent: await n(schema.agent),
      kb: await n(schema.kbEntry),
    };
  }
  async function turnosLab(org: string) {
    const rows = await sys().select().from(schema.aiUsage).where(and(eq(schema.aiUsage.organizationId, org), eq(schema.aiUsage.kind, "lab")));
    return rows.reduce((n, r) => n + r.turns, 0);
  }

  beforeEach(() => resetRateLimit());

  it("responde con la config del formulario (sin guardar) y las acciones como chips; no escribe nada salvo la cuota", async () => {
    owner(A.id);
    const ag = await as(A.id, () => createAgent({ organizationId: A.id, actorUserId: ACTOR, internalName: "Preview" }));
    const antes = await conteos(A.id);
    const usoAntes = await turnosLab(A.id);
    let systemVisto = "";
    h.respuesta = (messages) => {
      systemVisto = messages[0]!.content;
      return { ok: true, data: { action: "move_stage", stage: "Etapa 1", reply: "Te aparto" }, raw: "", usage: { promptTokens: 3, completionTokens: 2 } };
    };
    const res = await preview({
      agentId: ag.id,
      config: { displayName: "", tone: "Sin guardar", useSharedKb: true },
      history: [{ role: "user", text: "hola" }, { role: "assistant", text: "¿qué buscas?" }],
      message: "lo compro",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: string; chips: { kind: string; label: string }[]; debug: { action: string } };
    expect(body.reply).toBe("Te aparto");
    expect(body.chips).toEqual([{ kind: "move_stage", label: "Movería a Etapa 1" }]);
    expect(body.debug.action).toBe("move_stage");
    expect(systemVisto).toContain("No tienes nombre propio");
    expect(systemVisto).toContain("Tono: Sin guardar");
    expect(await conteos(A.id)).toEqual(antes);
    expect(await turnosLab(A.id)).toBe(usoAntes + 1);
  });

  it("el patrón de respaldo escala sin llamar al modelo", async () => {
    owner(A.id);
    const [g] = await generales(A.id);
    const usoAntes = await turnosLab(A.id);
    const res = await preview({ agentId: g!.id, config: cfg(), history: [], message: "quiero hablar con un asesor" });
    const body = (await res.json()) as { escalated: boolean; chips: { kind: string }[] };
    expect(body.escalated).toBe(true);
    expect(body.chips[0]!.kind).toBe("handoff");
    expect(await turnosLab(A.id)).toBe(usoAntes);
  });

  it("agente de otra organización → 404; módulo Laboratorio apagado → 404", async () => {
    owner(B.id);
    const [gA] = await generales(A.id);
    expect((await preview({ agentId: gA!.id, config: cfg(), history: [], message: "hola" })).status).toBe(404);
    await sys()
      .insert(schema.organizationModule)
      .values({ organizationId: B.id, lab: false })
      .onConflictDoUpdate({ target: [schema.organizationModule.organizationId], set: { lab: false } });
    forgetOrgModules(B.id);
    try {
      const [gB] = await generales(B.id);
      expect((await preview({ agentId: gB!.id, config: cfg(), history: [], message: "hola" })).status).toBe(404);
    } finally {
      await sys().update(schema.organizationModule).set({ lab: true }).where(eq(schema.organizationModule.organizationId, B.id));
      forgetOrgModules(B.id);
    }
  });

  it("cuota agotada → 429 con mensaje claro", async () => {
    owner(A.id);
    const [g] = await generales(A.id);
    h.respuesta = () => ({ ok: false, error: "quota_exceeded", detail: "tope" });
    const res = await preview({ agentId: g!.id, config: cfg(), history: [], message: "hola" });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("quota_exceeded");
  });

  it("límite: la petición 31 del minuto → 429 preview_rate_limited", async () => {
    owner(A.id);
    const [g] = await generales(A.id);
    const body = { agentId: g!.id, config: cfg(), history: [], message: "hola" };
    for (let i = 0; i < 30; i++) expect((await preview(body)).status).toBe(200);
    const res = await preview(body);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("preview_rate_limited");
  });
});
