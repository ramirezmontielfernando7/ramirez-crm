/**
 * Fase 3, PR 2 — Administradores de PLATAFORMA. Herramienta del OPERADOR: el
 * primer administrador nunca se crea desde la interfaz.
 *
 *   node scripts/platform-admin.mjs add    --email tu@correo [--apply]
 *   node scripts/platform-admin.mjs remove --email tu@correo [--apply]
 *   node scripts/platform-admin.mjs list
 *
 * Sin `--apply` NO escribe nada: muestra cada comprobación y lo que haría.
 * Con `--apply` repite las comprobaciones y escribe (con bitácora).
 *
 * Reglas: la persona tiene que existir y ser miembro de la organización de la
 * plataforma (PLATFORM_ORG_ID). En la imagen de Docker viaja como
 * `/app/ops/platform-admin.mjs`:
 *   docker exec -it <contenedor de la app> node ops/platform-admin.mjs add --email …
 * Usa DATABASE_URL_SYSTEM (o DATABASE_URL) y PLATFORM_ORG_ID del contenedor.
 */
import { randomBytes } from "node:crypto";
import postgres from "postgres";

const [, , cmd, ...rest] = process.argv;
const args = {};
for (let i = 0; i < rest.length; i++) {
  const k = rest[i]?.replace(/^--/, "");
  if (k === "apply") args.apply = true;
  else args[k] = rest[++i];
}

function uso(msg) {
  if (msg) console.error(`Error: ${msg}`);
  console.error("Uso: platform-admin.mjs add --email correo [--apply] | remove --email correo [--apply] | list");
  process.exit(2);
}

const url = process.env.DATABASE_URL_SYSTEM || process.env.DATABASE_URL;
if (!url) uso("falta DATABASE_URL_SYSTEM o DATABASE_URL");
if (!["add", "remove", "list"].includes(cmd)) uso();

const paso = (n, texto) => console.log(`  ${n}. ${texto}`);
const sql = postgres(url, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
let code = 0;

try {
  const [{ usuario, base }] = await sql`select current_user as usuario, current_database() as base`;
  console.log(`Base «${base}», conectado como «${usuario}».`);

  if (cmd === "list") {
    const filas = await sql`
      select p.user_id, u.email, u.name, p.created_at, p.locked_until
      from platform_admin p join "user" u on u.id = p.user_id order by p.created_at`;
    for (const f of filas) {
      console.log(`  ${f.email}  «${f.name}»  desde ${f.created_at.toISOString().slice(0, 10)}${f.locked_until && f.locked_until > new Date() ? "  (bloqueado)" : ""}`);
    }
    if (filas.length === 0) console.log("  (ningún administrador de plataforma)");
  } else {
    if (!args.email) uso("falta --email");
    const email = String(args.email).trim().toLowerCase();
    const plataforma = process.env.PLATFORM_ORG_ID?.trim();
    console.log(args.apply ? "Modo: APLICAR (escribe)." : "Modo: solo mostrar (no escribe nada; agrega --apply para aplicar).");

    paso(1, `PLATFORM_ORG_ID = ${plataforma || "(vacía)"}`);
    if (!plataforma) throw new Error("PLATFORM_ORG_ID no está definida: sin ella no hay organización de la plataforma");
    const [org] = await sql`select id, name, status from organization where id = ${plataforma}`;
    if (!org) throw new Error(`la organización ${plataforma} no existe`);
    paso(2, `Organización de la plataforma: «${org.name}» (${org.status})`);

    const [persona] = await sql`select id, name, email from "user" where lower(email) = ${email}`;
    if (!persona) throw new Error(`no hay ninguna cuenta con el correo ${email}`);
    paso(3, `Cuenta: «${persona.name}» <${persona.email}> (${persona.id})`);

    const [miembro] = await sql`select role from member where user_id = ${persona.id} and organization_id = ${plataforma}`;
    paso(4, miembro ? `Es miembro de la organización de la plataforma, con rol «${miembro.role}»` : "NO es miembro de la organización de la plataforma");

    const [admin] = await sql`select created_at from platform_admin where user_id = ${persona.id}`;
    paso(5, admin ? `Ya es administrador de plataforma (desde ${admin.created_at.toISOString().slice(0, 10)})` : "Todavía no es administrador de plataforma");

    if (cmd === "add") {
      if (!miembro) throw new Error("solo un miembro de la organización de la plataforma puede ser administrador de plataforma");
      if (admin) {
        paso(6, "Nada que hacer.");
      } else if (!args.apply) {
        paso(6, `Haría: darle el rol de administrador de plataforma a ${persona.email} y anotarlo en la bitácora. No se escribió nada.`);
      } else {
        await sql.begin(async (tx) => {
          await tx`insert into platform_admin (user_id, created_by) values (${persona.id}, null) on conflict do nothing`;
          await tx`
            insert into platform_audit_log (id, actor_user_id, actor_email, action, target_user_id, target_user_email, detail)
            values (${"pal_" + randomBytes(10).toString("hex")}, null, 'operador (script)', 'admin.added',
                    ${persona.id}, ${persona.email}, ${sql.json({ via: "scripts/platform-admin.mjs" })})`;
        });
        paso(6, `Hecho: ${persona.email} ya es administrador de plataforma. Entra a /platform.`);
      }
    } else {
      if (!admin) {
        paso(6, "Nada que hacer.");
      } else if (!args.apply) {
        paso(6, `Haría: quitarle el rol de administrador de plataforma a ${persona.email}. No se escribió nada.`);
      } else {
        await sql.begin(async (tx) => {
          await tx`delete from platform_admin where user_id = ${persona.id}`;
          await tx`
            insert into platform_audit_log (id, actor_user_id, actor_email, action, target_user_id, target_user_email, detail)
            values (${"pal_" + randomBytes(10).toString("hex")}, null, 'operador (script)', 'admin.removed',
                    ${persona.id}, ${persona.email}, ${sql.json({ via: "scripts/platform-admin.mjs" })})`;
        });
        paso(6, `Hecho: ${persona.email} ya no es administrador de plataforma.`);
      }
    }
  }
} catch (err) {
  console.error(`Error: ${err?.message ?? err}`);
  code = 1;
} finally {
  await sql.end();
}
process.exit(code);
