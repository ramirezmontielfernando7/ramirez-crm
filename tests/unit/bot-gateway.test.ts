import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_API_BUDGET, BOT_AUTH_FAILURES, requireBotKey } from "@/server/bot/auth";
import { mergeFicha, normalizeFicha } from "@/server/bot/ficha";
import { toHandoffReason } from "@/server/bot/handoff";
import { resetRateLimit } from "@/lib/rate-limit";

/**
 * La puerta de toda la superficie `/api/bot/*`. Fase 1 multitenant (H2): la
 * llave vive en `bot_api_key` (hash) y dice la organización; aquí la BD de
 * llaves es un mapa en memoria. La búsqueda real por hash contra Postgres se
 * prueba en tests/db/bot-keys.test.ts.
 */

const KEY = "clave-de-servicio-larga-0123456789abcdef";
const KEY_B = "clave-de-otra-organizacion-0123456789abc";

const llaves = vi.hoisted(() => new Map<string, string>());
vi.mock("@/server/bot/keys", () => ({
  resolveBotKey: async (k: string | null) => {
    const org = k ? llaves.get(k) : undefined;
    return org ? { keyId: `bak_${org}`, organizationId: org } : null;
  },
  touchBotKey: async () => {},
}));

function reqWith(key?: string): Request {
  return new Request("http://localhost/api/bot/context", {
    headers: key ? { "x-api-key": key } : {},
  });
}

async function status(req: Request): Promise<number> {
  const r = await requireBotKey(req);
  return r.ok ? 200 : r.response.status;
}

describe("requireBotKey", () => {
  beforeEach(() => {
    llaves.clear();
    llaves.set(KEY, "org_a");
    llaves.set(KEY_B, "org_b");
    resetRateLimit();
  });

  it("key correcta → pasa con la organización DE ESA llave", async () => {
    expect(await requireBotKey(reqWith(KEY))).toEqual({ ok: true, organizationId: "org_a" });
    expect(await requireBotKey(reqWith(KEY_B))).toEqual({ ok: true, organizationId: "org_b" });
  });

  it("key incorrecta → 401", async () => {
    expect(await status(reqWith("otra-clave-igual-de-larga-pero-mala!!"))).toBe(401);
  });

  it("sin header → 401", async () => {
    expect(await status(reqWith())).toBe(401);
  });

  it("organización sin llave (apagado por defecto) → 401 siempre", async () => {
    llaves.clear();
    expect(await status(reqWith(KEY))).toBe(401);
  });

  it("la BOT_API_KEY de la variable ya no abre nada por sí sola", async () => {
    llaves.clear();
    vi.stubEnv("BOT_API_KEY", KEY);
    expect(await status(reqWith(KEY))).toBe(401);
    vi.unstubAllEnvs();
  });
});

/**
 * R11 — El límite ya no es un DoS de regalo. Antes: un cubo global contado
 * ANTES de autenticar, así que 600 requests anónimos por minuto dejaban al
 * cerebro en 429 y a los clientes sin respuesta.
 */
describe("requireBotKey: límites (autentica primero, cuenta después)", () => {
  const MALA = "clave-equivocada-del-mismo-largo-0000000";

  function desde(ip: string, key?: string): Request {
    return new Request("http://localhost/api/bot/context", {
      headers: {
        // Primer salto = el cliente; el resto lo agregan los proxies.
        "x-forwarded-for": `${ip}, 10.0.0.2`,
        ...(key ? { "x-api-key": key } : {}),
      },
    });
  }

  beforeEach(() => {
    llaves.clear();
    llaves.set(KEY, "org_a");
    llaves.set(KEY_B, "org_b");
    resetRateLimit();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("700 requests sin key desde una IP → el cerebro sigue en 200", async () => {
    const vistos = { 401: 0, 429: 0 };
    for (let i = 0; i < 700; i++) {
      const s = await status(desde("203.0.113.9", i % 2 ? MALA : undefined));
      if (s === 401 || s === 429) vistos[s]++;
    }
    expect(vistos).toEqual({ 401: BOT_AUTH_FAILURES.max, 429: 700 - BOT_AUTH_FAILURES.max });
    expect(await status(desde("198.51.100.7", KEY))).toBe(200);
    // Ni aunque comparta IP con quien inunda (mismo proxy, o "local").
    expect(await status(desde("203.0.113.9", KEY))).toBe(200);
  });

  it("las fallidas se frenan POR IP: 30 → 401, la 31 → 429; otra IP sigue en 401", async () => {
    for (let i = 0; i < BOT_AUTH_FAILURES.max; i++) {
      expect(await status(desde("203.0.113.9", MALA))).toBe(401);
    }
    expect(await status(desde("203.0.113.9", MALA))).toBe(429);
    expect(await status(desde("192.0.2.1", MALA))).toBe(401);
  });

  it("el presupuesto es POR organización: agotar el de A no frena a B", async () => {
    for (let i = 0; i < BOT_API_BUDGET.max; i++) {
      expect(await status(desde("198.51.100.7", KEY))).toBe(200);
    }
    expect(await status(desde("198.51.100.7", KEY))).toBe(429);
    expect(await status(desde("198.51.100.7", KEY_B))).toBe(200);
    // Y los fallidos no se cuentan contra él: su respuesta sigue siendo 401.
    expect(await status(desde("192.0.2.1"))).toBe(401);
  });
});

describe("normalizeFicha (tolerante al drift del LLM)", () => {
  it("las claves las pone el negocio, no el CRM", () => {
    expect(
      normalizeFicha({ tratamiento: "ortodoncia", metros: 120, urgente: true })
    ).toEqual({ tratamiento: "ortodoncia", metros: 120, urgente: true });
  });

  it("recorta espacios y trunca a 500 caracteres", () => {
    const out = normalizeFicha({ notas: "  hola  ", largo: "x".repeat(900) });
    expect(out.notas).toBe("hola");
    expect((out.largo as string).length).toBe(500);
  });

  it("la cadena vacía se descarta; null explícito sobrevive para borrar", () => {
    const out = normalizeFicha({ rubro: "", geo: null });
    expect("rubro" in out).toBe(false);
    expect(out.geo).toBeNull();
  });

  it("objetos y arreglos se ignoran sin reventar", () => {
    expect(normalizeFicha({ nested: { a: 1 }, lista: [1, 2], ok: "sí" })).toEqual({
      ok: "sí",
    });
  });

  it("números no finitos fuera; el cero sí es un dato", () => {
    expect(normalizeFicha({ a: Number.NaN, b: Infinity, empleados: 0 })).toEqual({
      empleados: 0,
    });
  });

  it("claves vacías o larguísimas se descartan", () => {
    const out = normalizeFicha({ "  ": "x", ["k".repeat(80)]: "y", bien: "z" });
    expect(out).toEqual({ bien: "z" });
  });

  it("un bot en bucle no puede inflar la ficha sin límite", () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < 200; i++) raw[`campo${i}`] = "v";
    expect(Object.keys(normalizeFicha(raw)).length).toBe(40);
  });
});

describe("toHandoffReason (el handoff nunca se pierde por el motivo)", () => {
  it("los motivos del catálogo pasan tal cual", () => {
    for (const r of ["cliente", "modelo", "error", "ventana", "hostilidad"]) {
      expect(toHandoffReason(r)).toBe(r);
    }
  });

  it("un motivo inventado por el LLM cae a 'modelo' en vez de tirar el handoff", () => {
    expect(toHandoffReason("porque el señor se enojó")).toBe("modelo");
  });

  it("ausente o vacío también cae a 'modelo'", () => {
    expect(toHandoffReason(undefined)).toBe("modelo");
    expect(toHandoffReason("   ")).toBe("modelo");
  });

  it("tolera mayúsculas y espacios de sobra", () => {
    expect(toHandoffReason("  Hostilidad ")).toBe("hostilidad");
  });
});

describe("mergeFicha", () => {
  it("lo ausente se conserva y lo nuevo se agrega", () => {
    expect(mergeFicha({ rubro: "dentista" }, { geo: "Querétaro" })).toEqual({
      rubro: "dentista",
      geo: "Querétaro",
    });
  });

  it("un valor nuevo pisa al viejo", () => {
    expect(mergeFicha({ geo: "CDMX" }, { geo: "Querétaro" })).toEqual({
      geo: "Querétaro",
    });
  });

  it("null borra la clave en vez de guardarla en null", () => {
    const out = mergeFicha({ rubro: "dentista", geo: "CDMX" }, { geo: null });
    expect(out).toEqual({ rubro: "dentista" });
  });

  it("sin ficha previa parte de cero", () => {
    expect(mergeFicha(null, { a: 1 })).toEqual({ a: 1 });
  });
});
