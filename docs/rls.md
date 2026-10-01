# RLS por organización (multitenant, fase 1 · PR 4)

Desde la migración `0027_rls_por_organizacion.sql`, Postgres mismo impide que
una organización vea, cambie o escriba filas de otra, aunque una consulta de
la app olvide su `where organization_id = …`.

## Qué hace

- Las **45 tablas de dominio** (todas las que tienen `organization_id`):
  `ENABLE` + `FORCE ROW LEVEL SECURITY` y una sola política,
  `aislamiento_por_organizacion`:

  ```sql
  USING      (organization_id = current_setting('app.org_id', true))
  WITH CHECK (organization_id = current_setting('app.org_id', true))
  ```

  `USING` filtra lo que se lee, cambia o borra; `WITH CHECK` rechaza escribir
  una fila a nombre de otra organización (error `42501`).
- **`organization`**: la misma política sobre su `id`. Cada organización solo
  se ve a sí misma (su marca). Crearla o borrarla es de plataforma.
- **Sin `app.org_id`** (vacío o `NULL`) la comparación nunca es verdadera:
  **cero filas** y ninguna escritura.

## A quién aplica

| Rol | RLS |
|---|---|
| `vocero_app` (`DATABASE_URL`) | **Sí.** El PR 3 fija `app.org_id` en cada consulta hecha a nombre de una organización. |
| `vocero_system` (`DATABASE_URL_SYSTEM`) | No: `BYPASSRLS`. Enrutamiento del webhook, sesión, arranque, better-auth. |
| `postgres` (migraciones) | No: superusuario. `FORCE` cubre al dueño si algún día no lo fuera. |

## Excepciones (sin RLS), con motivo

Verificadas por `tests/db/rls.test.ts`: cualquier otra tabla sin la política
pone CI en rojo, y una excepción con `organization_id` también.

| Tabla | Motivo |
|---|---|
| `user` | better-auth; sin `organization_id`: una persona es de sus membresías (`member`, que sí tiene RLS) |
| `session` | better-auth; sin `organization_id`; solo el pool de sistema |
| `account` | better-auth (credenciales de login); solo el pool de sistema |
| `verification` | better-auth (tokens); solo el pool de sistema |
| `webhook_unrouted` | Fase 3: eventos de Meta que no se pudieron enrutar (justo no se sabe su organización). Cifrada, 7 días; `vocero_app` no tiene permisos sobre ella ([credenciales.md](credenciales.md)) |

## Reversa (sin migración nueva)

De la más rápida a la más completa:

1. **Al instante, sin tocar la base**: en Coolify, pon en `DATABASE_URL` la
   misma URL que `DATABASE_URL_SYSTEM` (usuario `vocero_system`, que salta
   RLS) y redespliega. La app queda como con el PR 3. Para volver: el valor
   anterior de `DATABASE_URL`.
2. **Quitar RLS de la base**: en la Terminal de Postgres,
   `psql -U postgres -d <base> -f scripts/sql/0027-reversa.sql` (o pega su
   bloque `DO`). Idempotente; quita la política y apaga RLS en toda tabla de
   `public` que la tenga. La app sigue funcionando: fija `app.org_id` aunque
   nadie lo exija.
3. **Volver a desplegar el commit anterior NO quita RLS**: la migración ya se
   aplicó. Usa 1 o 2.
4. Último recurso: restaurar el backup tomado antes de fusionar.

## Verlo en producción

```
# Tablas con RLS forzado (esperado: 46; 49 desde la 0028)
psql -U postgres -d <base> -Atc "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity"

# Como la app, SIN organización: cero filas
psql -U postgres -d <base> -c "begin; set local role vocero_app; select count(*) from contact; rollback;"

# Como la app, CON tu organización: tus filas
psql -U postgres -d <base> -c "begin; set local role vocero_app; select set_config('app.org_id', '<tu org_…>', true); select count(*) from contact; rollback;"
```

## Al agregar una tabla

Toda tabla nueva con `organization_id` necesita la política en su migración
(copia el bloque de la 0027 para esa tabla). Si no, `tests/db/rls.test.ts`
falla en CI. Y la app solo la verá dentro de un contexto de organización
(`withAuth`, `runWithOrganization`, `withTenant`).
