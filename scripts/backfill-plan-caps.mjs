/**
 * Relleno único de los topes de PERSONAS y ALMACENAMIENTO de las empresas que
 * ya existían antes de que el alta los aplicara (applyPlanCaps).
 * Herramienta del OPERADOR de la plataforma.
 *
 *   node --env-file=.env scripts/backfill-plan-caps.mjs            # solo muestra
 *   node --env-file=.env scripts/backfill-plan-caps.mjs --apply    # escribe
 *
 * Regla: solo toca empresas con plan guardado inicio/esencial/pro/ultra y SOLO
 * los topes que están vacíos (nunca pisa uno puesto a mano). «custom» y las
 * empresas sin fila de plan se listan y no se tocan. Los valores salen del
 * catálogo vigente (platform_plan_catalog sobre los de fábrica). Es
 * re-ejecutable: una segunda corrida ya no encuentra nada. Usa el rol de
 * sistema (DATABASE_URL_SYSTEM) si existe. En la imagen: /app/ops/.
 */
import postgres from "postgres";
import { pathToFileURL } from "node:url";

/** Valores de fábrica de src/lib/plan-catalog.ts (tests/unit/plan-catalog.test.ts los compara). */
export const DEFAULTS = {
  inicio: { members: 2, storageGb: 5 },
  esencial: { members: 3, storageGb: 15 },
  pro: { members: 5, storageGb: 30 },
  ultra: { members: 10, storageGb: 100 },
};

/** Qué rellenar para una fila de plan (puro). `null` = nada que hacer. */
export function planFill(row, caps) {
  const c = caps[row.plan_key];
  if (!c) return null;
  const members = row.max_members === null ? c.members : null;
  const storage = row.storage_limit_bytes === null ? Math.round(c.storageGb * 1024 ** 3) : null;
  if (members === null && storage === null) return null;
  return { members, storage };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const url = process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL;
  if (!url) {
    console.error("Error: falta DATABASE_URL");
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
  let code = 0;
  try {
    const caps = structuredClone(DEFAULTS);
    for (const r of await sql`select scope, people_limit, storage_gb from platform_plan_catalog`) {
      if (!caps[r.scope]) continue;
      if (r.people_limit !== null) caps[r.scope].members = r.people_limit;
      if (r.storage_gb !== null) caps[r.scope].storageGb = r.storage_gb;
    }
    const orgs = await sql`
      select o.id, o.name, p.plan_key, p.max_members, p.storage_limit_bytes
      from organization o left join organization_plan p on p.organization_id = o.id
      order by o.name`;
    let cambios = 0;
    for (const r of orgs) {
      if (!r.plan_key) {
        console.log(`- ${r.id} «${r.name}»: sin fila de plan (no se toca)`);
        continue;
      }
      const fill = planFill(r, caps);
      if (!fill) {
        console.log(`= ${r.id} «${r.name}» [${r.plan_key}]: sin cambios`);
        continue;
      }
      cambios++;
      const partes = [];
      if (fill.members !== null) partes.push(`personas → ${fill.members}`);
      if (fill.storage !== null) partes.push(`almacenamiento → ${Math.round(fill.storage / 1024 ** 3)} GB`);
      console.log(`${apply ? "✓" : "·"} ${r.id} «${r.name}» [${r.plan_key}]: ${partes.join(", ")}`);
      if (apply) {
        await sql`
          update organization_plan
          set max_members = coalesce(max_members, ${fill.members}),
              storage_limit_bytes = coalesce(storage_limit_bytes, ${fill.storage}),
              updated_at = now()
          where organization_id = ${r.id}`;
      }
    }
    console.log(apply ? `Listo: ${cambios} empresa(s) actualizadas.` : `Vista previa: ${cambios} empresa(s) cambiarían. Usa --apply para escribir.`);
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : e);
    code = 1;
  } finally {
    await sql.end();
  }
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
