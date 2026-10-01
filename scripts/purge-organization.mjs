/**
 * Fase 3, PR 2 — Borrado DEFINITIVO de una organización ya borrada (suave)
 * desde /platform y pasado su plazo de gracia (30 días). Herramienta del
 * OPERADOR; no tiene botón en la interfaz a propósito.
 *
 *   node scripts/purge-organization.mjs --org org_…                       (muestra, no borra)
 *   node scripts/purge-organization.mjs --org org_… --confirm "Nombre exacto"   (borra)
 *
 * Se niega si: es la organización de la plataforma, no está en estado
 * `deleted`, o todavía no llega su `purge_after`. Borra en cascada TODO lo
 * del negocio (contactos, conversaciones, mensajes, credenciales…), las
 * cuentas de sus personas (cada una pertenece a un solo negocio) y sus
 * archivos en MEDIA_DIR/<org>. La bitácora de plataforma se conserva.
 *
 * En la imagen de Docker viaja como `/app/ops/purge-organization.mjs`:
 *   docker exec -it <contenedor de la app> node ops/purge-organization.mjs --org …
 */
import { randomBytes } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const rest = process.argv.slice(2);
const args = {};
for (let i = 0; i < rest.length; i++) args[rest[i]?.replace(/^--/, "")] = rest[++i];

function uso(msg) {
  if (msg) console.error(`Error: ${msg}`);
  console.error('Uso: purge-organization.mjs --org org_… [--confirm "Nombre exacto de la organización"]');
  process.exit(2);
}

const url = process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL;
if (!url) uso("falta DATABASE_URL_SYSTEM o DATABASE_URL");
if (!args.org || !/^org_[A-Za-z0-9_-]+$/.test(args.org)) uso("falta --org (org_…)");

const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
let code = 0;
try {
  const [org] = await sql`select id, name, status, deleted_at, purge_after from organization where id = ${args.org}`;
  if (!org) throw new Error(`la organización ${args.org} no existe (¿ya se purgó?)`);
  console.log(`Organización «${org.name}» (${org.id})`);
  console.log(`  estado: ${org.status} · borrada: ${org.deleted_at?.toISOString() ?? "-"} · borrable desde: ${org.purge_after?.toISOString() ?? "-"}`);

  if (org.id === process.env.PLATFORM_ORG_ID?.trim()) throw new Error("es la organización de la plataforma: no se purga");
  if (org.status !== "deleted") throw new Error(`no está borrada (estado «${org.status}»): bórrala primero desde /platform`);
  if (!org.purge_after || org.purge_after > new Date()) {
    throw new Error(`todavía está en su plazo de gracia: se puede purgar desde ${org.purge_after?.toISOString() ?? "?"}`);
  }
  // Fase 3, PR 3: una organización "madre" (parent_id) no se borra con hijas
  // colgando (la FK es RESTRICT). Hoy nada escribe parent_id.
  const [hijas] = await sql`select count(*)::int as n from organization where parent_id = ${org.id}`;
  if ((hijas?.n ?? 0) > 0) throw new Error(`tiene ${hijas.n} organización(es) hija(s): no se purga mientras dependan de ella`);

  // Lo que se va (solo conteos: nunca contenido).
  const tablas = await sql`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'organization_id' order by table_name`;
  let total = 0;
  for (const { table_name } of tablas) {
    const [r] = await sql.unsafe(`select count(*)::int as n from "${table_name}" where organization_id = $1`, [org.id]);
    if (r.n > 0) console.log(`  ${table_name}: ${r.n} fila(s)`);
    total += r.n;
  }
  const personas = await sql`
    select u.id, u.email from member m join "user" u on u.id = m.user_id
    where m.organization_id = ${org.id}
      and not exists (select 1 from member o where o.user_id = m.user_id and o.organization_id <> ${org.id})`;
  console.log(`  cuentas de personas que se borran: ${personas.length}`);
  // Adjuntos y marca en MEDIA_DIR/<org>; chat de equipo en MEDIA_DIR/team-chat/<org>.
  const carpetas = process.env.MEDIA_DIR
    ? [path.resolve(process.env.MEDIA_DIR, org.id), path.resolve(process.env.MEDIA_DIR, "team-chat", org.id)]
    : [];
  const existentes = [];
  for (const c of carpetas) if (await stat(c).then(() => true, () => false)) existentes.push(c);
  console.log(`  archivos: ${carpetas.length === 0 ? "MEDIA_DIR no definida: los archivos no se tocan" : existentes.length ? existentes.join(", ") : "ninguna carpeta"}`);
  console.log(`  total: ${total} fila(s) de negocio`);

  if (args.confirm === undefined) {
    console.log('\nNo se borró nada. Para borrar de verdad: --confirm "' + org.name + '"');
  } else if (args.confirm !== org.name) {
    throw new Error("--confirm no coincide con el nombre exacto de la organización: no se borró nada");
  } else {
    await sql.begin(async (tx) => {
      // Todo lo de dominio cuelga de organization con ON DELETE CASCADE.
      await tx`delete from organization where id = ${org.id}`;
      if (personas.length > 0) await tx`delete from "user" where id in ${tx(personas.map((p) => p.id))}`;
      await tx`
        insert into platform_audit_log (id, actor_user_id, actor_email, action, target_org_id, target_org_name, detail)
        values (${"pal_" + randomBytes(10).toString("hex")}, null, 'operador (script)', 'organization.purged',
                ${org.id}, ${org.name}, ${sql.json({ filas: total, cuentas: personas.length })})`;
    });
    for (const c of existentes) await rm(c, { recursive: true, force: true });
    console.log(`\nPurgada: ${total} fila(s), ${personas.length} cuenta(s)${existentes.length ? " y sus archivos" : ""}. Queda en la bitácora de plataforma.`);
  }
} catch (err) {
  console.error(`Error: ${err?.message ?? err}`);
  code = 1;
} finally {
  await sql.end();
}
process.exit(code);
