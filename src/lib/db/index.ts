import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/log";
import {
  currentOrganizationId,
  currentTransaction,
  runInTransaction,
} from "@/lib/request-context";
import * as schema from "./schema";

/**
 * Opciones de conexión comunes a TODA conexión que abra este repo (app, seeds,
 * migraciones, arneses E2E).
 *
 * `TimeZone: "UTC"` no es cosmético, es el invariante de tiempo del proyecto.
 * Las columnas son `timestamp without time zone`, y Drizzle las trata siempre
 * como UTC en ambas direcciones: al leer hace `new Date(valor + "+0000")` y al
 * escribir hace `valor.toISOString()`. El único escritor que se sale de ese
 * marco es SQL: `now()` de los `defaultNow()` se castea a `timestamp` usando
 * la zona de la SESIÓN, así que en un Postgres que no corra en UTC escribe
 * hora LOCAL y ese mismo valor se vuelve a leer como si fuera UTC.
 *
 * Síntoma real (Postgres en UTC-6): un saliente mostraba 08:59 en la burbuja
 * del hilo (`message.created_at`, escrito por `now()`) y 14:59 en la lista
 * (`conversation.last_message_at`, escrito desde JS). Fijar la zona de sesión
 * en UTC alinea `now()` con Drizzle y con eso TODAS las columnas
 * `defaultNow()` del esquema de golpe, sin migración y sin depender de cómo
 * esté configurado el servidor de BD. En Docker los contenedores ya corren en
 * UTC — esto hace que el dev local y cualquier Postgres self-hosted se
 * comporten igual.
 */
export const PG_CONNECTION_OPTIONS = {
  onnotice: () => {},
  connection: { TimeZone: "UTC" },
} as const;

/**
 * Fase 1 multitenant, PR 3 — dos pools por proceso:
 *
 *   * **app** (`DATABASE_URL`, rol `vocero_app` en producción): todo lo que
 *     atiende a una organización. Cada consulta hecha dentro de un contexto
 *     de organización (`withAuth`, `runWithOrganization`) corre en su propia
 *     transacción corta que primero fija
 *     `set_config('app.org_id', <org>, true)`; `withTenant(org, fn)` abre UNA
 *     transacción para varias. En el PR 4, RLS filtra con ese valor.
 *   * **system** (`DATABASE_URL_SYSTEM`, rol `vocero_system`): lo que por
 *     definición no es de una organización o sirve para averiguarla —
 *     better-auth, la membresía de la sesión, el enrutamiento del webhook, la
 *     llave del cerebro externo, el arranque—. Sin la variable usa
 *     DATABASE_URL (instalaciones que aún no separaron roles).
 *
 * Tope de conexiones por proceso: DB_POOL_MAX + DB_SYSTEM_POOL_MAX. Debe
 * caber (×2 durante un despliegue) en `max_connections` de Postgres; ver
 * docs/roles-de-bd.md.
 *
 * En dev, Next recarga módulos: los pools se cachean en globalThis para no
 * agotar conexiones.
 */
export type Db = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __voceroSql?: ReturnType<typeof postgres>;
  __voceroSystemSql?: ReturnType<typeof postgres>;
  __voceroTenantMisses?: Set<string>;
};

export const DEFAULT_DB_POOL_MAX = 15;
export const DEFAULT_DB_SYSTEM_POOL_MAX = 5;

function poolMax(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function getSql() {
  if (!globalForDb.__voceroSql) {
    const env = getEnv();
    globalForDb.__voceroSql = postgres(env.DATABASE_URL, {
      max: poolMax(process.env.DB_POOL_MAX, DEFAULT_DB_POOL_MAX),
      ...PG_CONNECTION_OPTIONS,
    });
  }
  return globalForDb.__voceroSql;
}

export function getSystemSql() {
  if (!globalForDb.__voceroSystemSql) {
    const env = getEnv();
    globalForDb.__voceroSystemSql = postgres(
      process.env.DATABASE_URL_SYSTEM || env.DATABASE_URL,
      {
        max: poolMax(process.env.DB_SYSTEM_POOL_MAX, DEFAULT_DB_SYSTEM_POOL_MAX),
        ...PG_CONNECTION_OPTIONS,
      }
    );
  }
  return globalForDb.__voceroSystemSql;
}

/**
 * Consulta al pool de la app SIN organización en el contexto. En el PR 4 RLS
 * le devolverá cero filas; hoy funciona igual que antes y se registra (una
 * vez por consulta distinta). Con DB_TENANT_STRICT=true (E2E y CI) lanza,
 * para que ningún camino quede sin migrar.
 */
function missingOrganization(query: string): void {
  const firstLine = query.replace(/\s+/g, " ").slice(0, 120);
  if (process.env.DB_TENANT_STRICT === "true") {
    throw new Error(
      `consulta al pool de la app sin organización (usa withTenant, runWithOrganization o getSystemDb): ${firstLine}`
    );
  }
  const seen = (globalForDb.__voceroTenantMisses ??= new Set());
  if (seen.has(firstLine)) return;
  seen.add(firstLine);
  logger("db").warn("consulta sin organización en el pool de la app", { query: firstLine });
}

type Sql = ReturnType<typeof postgres>;
type TxSql = Parameters<Parameters<Sql["begin"]>[1]>[0];

async function setOrg(c: TxSql, organizationId: string) {
  await c`select set_config('app.org_id', ${organizationId}, true)`;
}

/**
 * Lo que drizzle usa del cliente de postgres-js (`options`, `unsafe`,
 * `begin`), con `app.org_id` fijado por consulta. `unsafe` devuelve un
 * thenable con `.values()`, igual que el `PendingQuery` original.
 */
function tenantClient(base: Sql) {
  function exec(query: string, params: unknown[] | undefined, values: boolean) {
    const org = currentOrganizationId();
    const run = (c: Sql | TxSql) => {
      const q = c.unsafe(query, params as never[]);
      return values ? q.values() : q;
    };
    if (!org) {
      missingOrganization(query);
      return Promise.resolve(run(base));
    }
    // El resultado va envuelto: si `begin` recibe un arreglo lo trata como
    // lista de consultas (Promise.all) y perdería `count`/`columns`.
    return base
      .begin(async (c) => {
        await setOrg(c, org);
        return { result: await run(c) };
      })
      .then((r) => (r as unknown as { result: unknown }).result);
  }
  return {
    options: base.options,
    unsafe(query: string, params?: unknown[]) {
      return {
        values: () => exec(query, params, true),
        then: <A, B>(
          onOk?: ((v: unknown) => A | PromiseLike<A>) | null,
          onErr?: ((e: unknown) => B | PromiseLike<B>) | null
        ) => exec(query, params, false).then(onOk, onErr),
      };
    },
    begin(fn: (c: TxSql) => unknown) {
      const org = currentOrganizationId();
      if (!org) missingOrganization("begin (transacción)");
      return base.begin(async (c) => {
        if (org) await setOrg(c, org);
        return runInTransaction(org, undefined, () => fn(c));
      });
    },
  };
}

let tenantDb: Db | null = null;
let rawAppDb: Db | null = null;
let systemDb: Db | null = null;

/**
 * La BD de la app. Dentro de `withTenant` devuelve SU transacción; en
 * cualquier otro lado, el pool de la app con `app.org_id` por consulta
 * (según el contexto de organización vigente al ejecutarla).
 */
export function getDb(): Db {
  const tx = currentTransaction();
  if (tx) return tx as Db;
  if (!tenantDb) {
    tenantDb = drizzle(tenantClient(getSql()) as unknown as Sql, { schema });
  }
  return tenantDb;
}

/**
 * La BD de sistema: SOLO para lo que no es de una organización o sirve para
 * averiguarla. Cada uso está en la lista de `tests/unit/system-db-guard.test.ts`
 * con su motivo.
 */
export function getSystemDb(): Db {
  if (!systemDb) systemDb = drizzle(getSystemSql(), { schema });
  return systemDb;
}

/**
 * Abre UNA transacción en el pool de la app, fija `app.org_id` (local a la
 * transacción: al confirmar o revertir, la conexión vuelve limpia al pool)
 * y corre `fn` con ella; `getDb()` dentro de `fn` devuelve esta misma
 * transacción. Anidado con la misma organización reutiliza la de afuera;
 * con otra, lanza.
 *
 * Nunca llames al LLM ni a otra API lenta dentro: la conexión queda tomada
 * todo ese tiempo (`chatJson` lo verifica).
 */
export async function withTenant<T>(
  organizationId: string,
  fn: (tx: Db) => Promise<T>
): Promise<T> {
  const outer = currentTransaction();
  if (outer) {
    if (currentOrganizationId() !== organizationId) {
      throw new Error("withTenant anidado con otra organización");
    }
    return fn(outer as Db);
  }
  if (!rawAppDb) rawAppDb = drizzle(getSql(), { schema });
  return rawAppDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${organizationId}, true)`);
    return runInTransaction(organizationId, tx, () => fn(tx as unknown as Db));
  });
}

export { schema };
