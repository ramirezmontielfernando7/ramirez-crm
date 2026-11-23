# C9 · Avisos Android

C9 agrega un conector opcional para avisos de mensajes entrantes. La ingesta
conserva su flujo aun cuando Firebase falle. Sin una cuenta válida en
`FCM_SERVICE_ACCOUNT_JSON`, el registro responde 503 y no se hacen llamadas a
Google. La baja sigue disponible. OAuth y FCM HTTP v1 usan `fetch` y firma
RS256 de Node. No hay dependencias nuevas de servidor.

| Método y ruta | Autenticación | Cuerpo y efecto |
| --- | --- | --- |
| POST `/api/mobile/push/register` | `withAuth`, Bearer móvil firmado, sesión y organización activas | `{token}`. Alta o renovación del dispositivo Android, máximo cinco activos por usuario y organización. |
| POST `/api/mobile/push/unregister` | Igual | `{token}`. Baja idempotente del dispositivo ligado a esa sesión. |
| POST `/api/mobile/session/revoke` | Ruta móvil existente | Better Auth revoca la sesión y la relación de la migración borra sus dispositivos. |

Registro y baja rechazan cookies y metadatos de navegador. No se cambia el
filtro CSRF ni la respuesta del login web. Su cuerpo solo admite `token` y
tiene límites de tamaño. El servidor obtiene el usuario, la organización y la
sesión de Better Auth. La base aplica RLS forzada y guarda SHA-256 para localizar
el registro y AES-256-GCM para recuperar el token al enviar, con la rotación de
`src/server/credentials/maintenance.ts`. Un token físico tiene un solo
vínculo activo. Ante un vínculo de otra cuenta u organización el registro
responde 409. La proyección de sistema de las sesiones comprueba su vigencia
sin leer credenciales; la purga usa el rol de sistema solo para enumerar los IDs
de las organizaciones y ejecuta el borrado con RLS.

## Destinatarios y contenido

Se reutiliza el evento `message.new` de la Bandeja web. Para cada destinatario se
vuelve a consultar la membresía, el rol, la sesión, la asignación del contacto
y el estado de la empresa antes de llamar a FCM. Reciben el asesor asignado y
quienes tienen `scope.all` (propietario y coordinador). Sin asignación quedan
solo estos últimos. Un chat atendido por IA sigue la regla web del mensaje
entrante. Se excluyen Laboratorio, Mi número, contactos de números privados,
mensajes salientes y empresas suspendidas o eliminadas.

Android recibe **Dashfort — Nuevo mensaje** con visibilidad privada, canal
`messages`, y datos `type` y `conversationId`. FCM necesita el token de destino.
El aviso no contiene texto del mensaje, nombre, teléfono ni credenciales del
CRM. Usa tag/colapso por chat, prioridad alta, y TTL de 60 segundos para no
entregar con retraso un aviso de un alcance antiguo.

La entrega es de mejor esfuerzo. La cola vive en memoria (cuatro trabajos en
paralelo y hasta 64 entre activos y en espera, máximo 100 dispositivos por evento). Puede
descartar avisos si el proceso se reinicia o se satura. No reintenta la entrega del
mensaje. Las llamadas de OAuth y FCM vencen a los 2,5 s cada una. Errores
tipados de token de FCM lo revocan. Al arrancar y cada 24 h se purgan registros
sin actividad de más de 60 días. Una revocación producida después de la
validación puede coincidir con un envío ya en curso. El aviso tiene contenido
genérico y el móvil vuelve a consultar la autorización al abrir el chat.

## Activación posterior a la auditoría

1. Claude debe revisar el backend, especialmente RLS, destinatarios, cambios
   de acceso y compatibilidad con el login existente.
2. El responsable aplica la migración 0081 en el entorno autorizado con
   respaldo y luego publica el servidor. Sin configurar FCM, comprobar salud
   del CRM y que el registro devuelve 503.
3. En Coolify, el responsable configura `FCM_SERVICE_ACCOUNT_JSON` solo en el
   backend y reinicia según el proceso normal. Usar una cuenta del mismo
   proyecto Firebase que la app, con permiso de enviar por FCM HTTP v1.
   No adjuntar el JSON a incidencias, registros ni archivos versionados.
4. Colocar la configuración pública Android en
   `apps/mobile/google-services.json` para `com.demfort.dashfort.dev`. Solo
   después compilar, firmar e instalar la 0.2.1 dentro de la validación aprobada.
5. En un chat de prueba propio verificar opt-in, recepción con pantalla
   bloqueada y proceso cerrado, toque y alcance de la sesión, baja y revocación.
   Confirmar que una cuenta no asignada y una empresa diferente quedan fuera.

Para apagar el conector, quitar la variable y reiniciar el servidor. Para
revertir el esquema, volver al servidor anterior y, después de un respaldo y
de revisar el historial de migraciones, aplicar
[`scripts/sql/0081-reversa.sql`](../scripts/sql/0081-reversa.sql) durante una
operación autorizada. El SQL de reversión borra los vínculos y exige un nuevo
registro. Si se planea reactivar después, reconciliar explícitamente el diario
de migraciones con el esquema revertido, sin borrar entradas en automático.

## Migración única

Archivo canónico [0081_mobile_push_devices.sql](../drizzle/0081_mobile_push_devices.sql).

```sql
-- C9: registros Android opcionales, ligados a la sesión concreta de Better Auth.
CREATE TABLE IF NOT EXISTS "mobile_push_devices" (
  "id" text PRIMARY KEY,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "session_id" text NOT NULL REFERENCES "session"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "token_cipher" text NOT NULL,
  "token_iv" text NOT NULL,
  "token_tag" text NOT NULL,
  "key_version" integer NOT NULL DEFAULT 1,
  "platform" text NOT NULL DEFAULT 'android',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "revoked_at" timestamp,
  CONSTRAINT "mobile_push_devices_platform_ck" CHECK ("platform" = 'android')
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mobile_push_devices_org_user_token_uq"
  ON "mobile_push_devices" ("organization_id", "user_id", "token_hash");--> statement-breakpoint
-- Un solo usuario/tenant activo por token físico. Ante duda falla cerrado.
CREATE UNIQUE INDEX IF NOT EXISTS "mobile_push_devices_active_token_uq"
  ON "mobile_push_devices" ("token_hash") WHERE "revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_push_devices_session_idx"
  ON "mobile_push_devices" ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mobile_push_devices_seen_idx"
  ON "mobile_push_devices" ("last_seen_at");--> statement-breakpoint
ALTER TABLE "mobile_push_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mobile_push_devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "aislamiento_por_organizacion" ON "mobile_push_devices";--> statement-breakpoint
CREATE POLICY "aislamiento_por_organizacion" ON "mobile_push_devices"
  USING ("organization_id" = current_setting('app.org_id', true))
  WITH CHECK ("organization_id" = current_setting('app.org_id', true));
```

## Validación

Se utilizaron PostgreSQL local y sus roles `vocero_app`/`vocero_system`, usuarios
ficticios, y un doble HTTP de FCM. No se utilizó Firebase real ni se aplicó la
migración a una base remota. La recepción real y el comportamiento nativo
permanecen pendientes.

Pasaron `pnpm typecheck`, `pnpm lint` y las 2570 pruebas unitarias ejecutadas
en Node 22, con una omitida por la suite. Las pruebas dirigidas de C9 y RLS
sumaron 14 aprobadas. Se ejecutó el migrador dos veces y se repitió
directamente el SQL de 0081 otras dos veces para comprobar su idempotencia.

La corrida inicial en Node 24 reprodujo en `main` un error de Undici de
`upload-limits.test.ts`; la suite unitaria pasó con el Node 22 que usa CI.
El primer gate de base de datos usó un prefijo extra en
`META_GRAPH_BASE_URL`. Los tres fallos de plantillas se reprodujeron en
`main` con ese ajuste y las cinco pruebas de ese archivo pasaron al usar la
raíz del doble local. No hubo cambios al código de esos módulos.

El gate completo `pnpm test:db` pasó con PostgreSQL 17 local, los roles de
producción y el doble local corregido. Pasaron las 859 pruebas de 102 archivos.
