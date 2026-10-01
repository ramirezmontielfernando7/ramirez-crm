# Roles de base de datos y `withTenant` (multitenant, fase 1 · PR 3)

Una instancia de Vocero atiende a muchas organizaciones con la misma base.
Este PR prepara el terreno para RLS (PR 4) **sin cambiar el comportamiento**:
tres roles, dos pools y cada consulta marcada con su organización.

## Los tres roles

| Rol | Conexión | Para qué | Puede |
|---|---|---|---|
| dueño del esquema (`postgres`) | `DATABASE_URL_MIGRATE` | solo `migrate.mjs`, al arrancar el contenedor | todo |
| `vocero_app` | `DATABASE_URL` | la app atendiendo a una organización | `SELECT/INSERT/UPDATE/DELETE`; sin DDL, sin `TRUNCATE`, sin `BYPASSRLS` |
| `vocero_system` | `DATABASE_URL_SYSTEM` | lo que no es de una organización o sirve para averiguarla | lo mismo + `BYPASSRLS` (solo importa desde el PR 4) |

- La migración `0026_roles_de_bd.sql` crea los dos roles **sin contraseña y
  sin LOGIN**: ninguna contraseña vive en el repo.
- `scripts/migrate.mjs`, tras migrar, les da LOGIN con
  `VOCERO_APP_DB_PASSWORD` / `VOCERO_SYSTEM_DB_PASSWORD` si están definidas.
  Al servidor solo viaja el verificador SCRAM-SHA-256 calculado en Node: la
  contraseña en claro no queda en el log de Postgres.
- `migrate.mjs` también repite los `GRANT` en cada arranque, por si una tabla
  la creara otro dueño.
- Sin `DATABASE_URL_MIGRATE` ni `DATABASE_URL_SYSTEM` todo usa `DATABASE_URL`:
  una instalación que todavía no separó roles funciona igual que antes.
- Reversa (sin migración nueva): `scripts/sql/0026-reversa.sql`, después de
  volver a poner `postgres` en `DATABASE_URL`.

## Cómo llega la organización a cada consulta

`src/lib/db/index.ts`:

- **`getDb()` dentro de un contexto de organización** (`withAuth`,
  `runWithOrganization`): cada consulta corre en su propia transacción corta
  que primero hace `select set_config('app.org_id', <org>, true)`. Se confirma
  sola, igual que antes: nada queda sin confirmar mientras la request espera a
  Meta, y los eventos SSE siguen viendo lo que ya se escribió.
- **`withTenant(org, fn)`**: UNA transacción para varias consultas, con
  `app.org_id` fijado al inicio. `getDb()` dentro de `fn` devuelve esa misma
  transacción. Anidado con la misma organización la reutiliza; con otra, lanza.
- **`db.transaction()`** dentro de un contexto de organización también fija
  `app.org_id` al empezar.
- `set_config(..., true)` es **local a la transacción**: al confirmar o
  revertir, la conexión vuelve limpia al pool. Funciona con el pool de
  postgres-js tal cual, sin PgBouncer.
- **Sin organización en el contexto**, el pool de la app recibe **cero
  filas** (RLS, [rls.md](rls.md)) y deja un aviso en el log (una vez por
  consulta distinta). Con `DB_TENANT_STRICT=true` (E2E y CI) lanza, para que
  ningún camino quede sin migrar.
- **`getSystemDb()`**: el pool de `vocero_system`. Cada archivo que lo usa
  está en `tests/unit/system-db-guard.test.ts` con su motivo.

### El LLM nunca con una transacción abierta

Una llamada al modelo tarda segundos; con una transacción abierta, esa
conexión queda tomada todo ese tiempo y con decenas de organizaciones el pool
se agota. `chatJson` lo verifica: fuera de producción lanza
`LlmInTransactionError` (lo prueba `tests/db/with-tenant.test.ts`, y el E2E
corre en modo estricto); en producción lo registra y sigue.

## Cada proceso y su conexión

| Proceso | Pool | Organización |
|---|---|---|
| Rutas con `withAuth` | app | la de la sesión |
| SSE `/api/events` | app | la de la sesión; una consulta por evento, sin transacción abierta (el stream vive horas) |
| Páginas del servidor (layout, Resultados, Agenda, marca, favicon) | app | la de la sesión (`runWithOrganization`) |
| better-auth (usuarios, sesiones, `member`, `invitation`) | sistema | todavía no hay |
| Membresía de la sesión (`resolveMembership`) | sistema | es la que la decide |
| Primer registro (`onUserCreated`) y registro cerrado | sistema | crea la organización |
| Enrutamiento del webhook (WhatsApp, Instagram, Messenger, Zernio) | sistema | es el que la decide |
| Ingesta del webhook ya enrutada, ecos, estados de plantilla | app | la del número/página |
| `/api/bot/*`: resolver la llave | sistema | es la que la decide |
| `/api/bot/*`: el resto | app | la de la llave |
| Turno del agente | app | la hereda de quien lo agenda; el LLM, fuera de transacción |
| Laboratorio | app | la de la corrida |
| Campañas (ejecutor) | app | la de la campaña |
| Arranque: corridas huérfanas | sistema | todas |
| Arranque: campañas por reanudar | sistema para listarlas; app para cada ejecutor | cada una la suya |
| Arranque: `BOT_API_KEY` → `PLATFORM_ORG_ID` | sistema | la plataforma |
| `/api/health` | ambos (`select 1`) | ninguna |
| Migraciones | dueño (`DATABASE_URL_MIGRATE`) | — |
| Seed de demo (CLI), `bot-key.mjs`, E2E | sistema (`DATABASE_URL_SYSTEM`, o `DATABASE_URL`) | trabajo de plataforma |
| Seed de demo desde la app (`/api/seed/demo`) | app | la de la sesión |

## Conexiones: `max_connections`

Por contenedor: `DB_POOL_MAX` (15) + `DB_SYSTEM_POOL_MAX` (5) = **20**.
Durante un despliegue conviven el contenedor viejo y el nuevo: **40**, más 1
de `migrate.mjs` y las de administración. Postgres trae
`max_connections = 100` (3 reservadas a superusuario): cabe con holgura.

Verifícalo en la Terminal de Postgres:

```
psql -U postgres -Atc "show max_connections"
psql -U postgres -Atc "select usename, count(*) from pg_stat_activity group by 1 order by 2 desc"
```

La migración 0026 necesita que el usuario de las migraciones sea
superusuario (`BYPASSRLS` lo exige). Con el usuario de tu `DATABASE_URL`
(aquí `postgres`):

```
psql -U postgres -Atc "select rolname, rolsuper from pg_roles where rolname = current_user"
```

Debe decir `postgres|t`. Si dice `f`, crea `vocero_system` a mano como
superusuario antes de desplegar (`CREATE ROLE vocero_system NOLOGIN BYPASSRLS;`):
la migración lo reutiliza.

Si subes los pools, mantén `2 × (DB_POOL_MAX + DB_SYSTEM_POOL_MAX) + 5` por
debajo de `max_connections − 3`.

## Instalaciones con docker compose (Ruta B)

`docker-compose.yml` ya conecta con los tres roles. Antes de actualizar,
agrega al `.env`:

```
VOCERO_APP_DB_PASSWORD=<openssl rand -hex 24>
VOCERO_SYSTEM_DB_PASSWORD=<openssl rand -hex 24>
```

Sin ellas `docker compose up` se niega a arrancar y dice cuál falta. Al
arrancar, `migrate.mjs` (como `postgres`) crea los roles y les pone esas
contraseñas antes de que arranque la app.
