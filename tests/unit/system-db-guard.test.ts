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
  "src/server/credentials/resolve.ts": {
    usos: 1,
    motivo: "enrutamiento de webhooks: número / WABA / perfil / página / cuenta de Zernio → organización (sin descifrar tokens)",
  },
  "src/server/credentials/maintenance.ts": {
    usos: 1,
    motivo: "arranque: rotación de la llave de cifrado y secretos en claro → cifrados, en TODAS las organizaciones",
  },
  "src/server/platform-admin/org-status.ts": {
    usos: 1,
    motivo: "Fase 3: ¿la organización opera? (activa / suspendida / borrada) lo decide la plataforma, también antes de saber la organización de una sesión",
  },
  "src/server/modules/store.ts": {
    usos: 1,
    motivo: "Fase 3, PR 3: los módulos de una organización los decide la plataforma; se consultan también antes de abrir el contexto (webhook recién enrutado, arranque) y los escribe el administrador de plataforma",
  },
  "src/server/platform-admin/admins.ts": {
    usos: 1,
    motivo: "Fase 3: quién es administrador de plataforma y su reautenticación (tabla de plataforma)",
  },
  "src/server/platform-admin/audit.ts": {
    usos: 1,
    motivo: "Fase 3: bitácora de plataforma (tabla de plataforma, sin organización)",
  },
  "src/server/platform-admin/links.ts": {
    usos: 1,
    motivo: "Fase 3: enlaces de un solo uso para poner contraseña (antes de tener sesión)",
  },
  "src/server/platform-admin/organizations.ts": {
    usos: 1,
    motivo: "Fase 3: el administrador de plataforma da de alta, suspende y borra organizaciones (por encima de ellas)",
  },
  "src/server/webhooks/unrouted.ts": {
    usos: 1,
    motivo: "eventos de webhook sin organización (tabla de plataforma webhook_unrouted) y su limpieza de 7 días",
  },
  "src/instrumentation-node.ts": {
    usos: 1,
    motivo: "arranque: corridas del Laboratorio huérfanas de TODAS las organizaciones",
  },
  "src/server/campaigns/dispatcher.ts": {
    usos: 1,
    motivo: "Campañas v2: el programador de campañas (al arrancar y cada 15 s) lista las organizaciones con campañas por despachar en TODAS las organizaciones; cada despachador corre luego a nombre de la suya",
  },
  "src/server/meta-sync/daily.ts": {
    usos: 2,
    motivo: "Campañas v2: la sincronización diaria con Meta (salud + plantillas; y, PR 3, analíticas) lista las organizaciones activas con número conectado (cruza organizaciones); el trabajo de cada una corre luego a nombre de la suya",
  },
  "src/server/kb-docs/store.ts": {
    usos: 1,
    motivo: "035: al arrancar, los documentos del agente por (re)indexar de TODAS las organizaciones (solo ids); el indexado de cada uno corre luego a nombre de la suya",
  },
  "src/server/platform-admin/usage.ts": {
    usos: 1,
    motivo: "036 PR 4: la lista de /platform lee el consumo de IA del mes (ai_usage total) y los topes (ai_quota) de TODAS las organizaciones en dos lecturas agrupadas, más si una organización existe; solo números, nunca contenido. El detalle de una sola va con el pool de la app (runWithOrganization)",
  },
  "src/server/costs/pricing.ts": {
    usos: 1,
    motivo: "036 PR 3b: precios de IA de la plataforma (platform_ai_pricing, tabla de PLATAFORMA sin organización) con su historial; solo el administrador de plataforma",
  },
  "src/server/costs/report.ts": {
    usos: 1,
    motivo: "036 PR 3b: el panel de costos lee tokens y costo del mes (ai_usage) de TODAS las organizaciones en una lectura agrupada, más el nombre de las que tuvieron consumo; solo números, nunca contenido",
  },
  "src/server/limits/daily.ts": {
    usos: 1,
    motivo: "036 PR 3a: la revisión periódica de avisos de consumo lista las organizaciones ACTIVAS con algún tope de almacenamiento, personas o módulos (cruza organizaciones); la revisión de cada una corre luego a nombre de la suya",
  },
  "src/server/usage/storage.ts": {
    usos: 1,
    motivo: "036 PR 2: el administrador de plataforma ve cuánto almacenamiento (aprox.) ocupa CADA organización: sumas agrupadas por organización, nunca contenido; la de una sola organización va con el pool de la app",
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
