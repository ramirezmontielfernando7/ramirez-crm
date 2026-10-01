import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PR 3 multitenant — El pool de SISTEMA (`vocero_system`, en el PR 4 salta
 * RLS) es solo para lo que no es de una organización o sirve para
 * averiguarla. Cada archivo que lo usa está aquí, con su motivo y su número
 * exacto de usos: uno nuevo (o uno más en un archivo listado) pone esto en
 * rojo y obliga a justificarlo. Lo mismo para `getSql()` crudo, que se salta
 * el `app.org_id` por consulta.
 *
 * Si estás aquí porque esto se puso rojo: casi seguro lo que quieres es
 * `getDb()` dentro de `withAuth`, `runWithOrganization(org, …)` o
 * `withTenant(org, …)`.
 */
const PERMITIDOS: Record<string, { usos: number; motivo: string }> = {
  "src/lib/auth/index.ts": {
    usos: 1,
    motivo: "better-auth resuelve usuarios y sesiones antes de saber la organización, y escribe member/invitation",
  },
  "src/server/auth/on-signup.ts": {
    usos: 2,
    motivo: "crear la organización del primer registro y resolver la membresía que DECIDE la organización de la sesión",
  },
  "src/server/auth/registration.ts": {
    usos: 1,
    motivo: "cuenta organizaciones de toda la instancia para cerrar el registro público",
  },
  "src/server/bot/keys.ts": {
    usos: 2,
    motivo: "la llave decide la organización de /api/bot/*; y ligar BOT_API_KEY a PLATFORM_ORG_ID al arrancar",
  },
  "src/server/whatsapp/credentials.ts": {
    usos: 2,
    motivo: "enrutamiento del webhook: phone_number_id / WABA → organización",
  },
  "src/server/instagram/credentials.ts": {
    usos: 2,
    motivo: "enrutamiento del webhook: IG_ID / cuenta de Zernio → organización",
  },
  "src/server/messenger/credentials.ts": {
    usos: 2,
    motivo: "enrutamiento del webhook: página / cuenta de Zernio → organización",
  },
  "src/instrumentation-node.ts": {
    usos: 1,
    motivo: "arranque: corridas del Laboratorio huérfanas de TODAS las organizaciones",
  },
  "src/server/campaigns/runner.ts": {
    usos: 1,
    motivo: "arranque: campañas que quedaron enviando en TODAS las organizaciones (cada ejecutor sigue luego a nombre de la suya)",
  },
  "src/app/api/health/route.ts": {
    usos: 2,
    motivo: "salud: `select 1` en los dos pools, sin organización",
  },
  "src/app/api/dev/wa-mock/status/route.ts": {
    usos: 1,
    motivo: "mock de desarrollo (404 en producción): como Meta, aún no sabe de qué organización es el wamid",
  },
};

const PATRON = /\b(getSystemDb|getSystemSql|getSql)\(\)/g;
const RAIZ = path.resolve(import.meta.dirname, "../..");

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return archivos(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("pool de sistema y SQL crudo: solo donde está justificado", () => {
  const usos = new Map<string, number>();
  for (const abs of archivos(path.join(RAIZ, "src"))) {
    const rel = path.relative(RAIZ, abs).split(path.sep).join("/");
    if (rel === "src/lib/db/index.ts") continue;
    const n = sinComentarios(readFileSync(abs, "utf8")).match(PATRON)?.length ?? 0;
    if (n > 0) usos.set(rel, n);
  }

  it("ningún archivo fuera de la lista lo usa, y los listados no suman usos", () => {
    const mal: string[] = [];
    for (const [rel, n] of usos) {
      const p = PERMITIDOS[rel];
      if (!p) mal.push(`${rel}: ${n} uso(s) sin justificar`);
      else if (n !== p.usos) mal.push(`${rel}: ${n} uso(s), la lista dice ${p.usos}`);
    }
    expect(mal, mal.join("\n")).toEqual([]);
  });

  it("la lista no tiene archivos que ya no lo usan", () => {
    const sobran = Object.keys(PERMITIDOS).filter((rel) => !usos.has(rel));
    expect(sobran).toEqual([]);
  });

  it("cada excepción dice por qué", () => {
    for (const p of Object.values(PERMITIDOS)) expect(p.motivo.length).toBeGreaterThan(20);
  });
});
