# Backend de pruebas · Plan verificable, todavía sin ejecutar

## Referencia y alcance

Usar un checkout independiente del **main vigente revisado**, no la raíz histórica de la rama Mobile. Referencia de esta entrega: `3a91d507c535682136b31acefcf2ff63107a2dbd`, comprobada por ref remota. El objeto de ese main no se descargó al repositorio móvil en esta ejecución. Si main cambia, revisar el delta y fijar un nuevo SHA antes de implementar/arrancar; no actualizar automáticamente una imagen por etiqueta mutable.

La revisión previa identificó arranque con migraciones y tareas de mantenimiento/campañas/workers. Este plan **no afirma que ya exista un modo auth-only**. No se modificaron instrumentation, Dockerfile, scripts de arranque, dependencias o infraestructura del backend. Las referencias previas a `834806ec` en informes I1/I2-P son históricas y no deben usarse como main actual.

## Validador ejecutable preparado

`src/integration/preflight.ts` es una función pura `validateAuthOnlyPlan(raw, reviewedMain)`; valida por allowlist el manifiesto [plan-auth-only.example.json](plan-auth-only.example.json). Las pruebas en `tests/integration-i2p2-preflight.test.ts` comprueban cada binding, worker y aislamiento declarado, propiedades inesperadas y entradas inválidas. Se puede ejecutar sin backend ni BD:

```bash
cd apps/mobile
node_modules/.bin/tsx --test tests/integration-i2p2-preflight.test.ts
node_modules/.bin/tsx -e 'import fs from "node:fs"; import {validateAuthOnlyPlan} from "./src/integration/preflight"; console.log(validateAuthOnlyPlan(JSON.parse(fs.readFileSync("docs/integration-i2p2/plan-auth-only.example.json","utf8")),"3a91d507c535682136b31acefcf2ff63107a2dbd"))'
```

El resultado válido incluye **`readyToStart: false`**, `operationalEvidence: pending`, `ownerAuthorization: required`. Una entrada no válida lanza `PreflightFault` con código sanitizado. No hay sender, spawn, Docker o conexión DB en el validador. Una declaración correcta no demuestra aislamiento real, no genera configuración operativa y no debe encadenarse con un comando de arranque.

Los nombres `.invalid`/`fixture-only-*` son referencias de ejemplo. No son hosts, DSN, secretos ni credenciales operativos. El plan solo permite red interna, egress IPv4/IPv6 denegado, sin ingreso público, sin publicación de PostgreSQL/socket Docker, volúmenes test concretos, sin herencia de entorno, tres roles/DSN separados sobre la misma BD test y 14 tareas explícitamente apagadas.

## Implementación futura propuesta, por orden

1. Tras revisión y autorización, crear checkout/worktree backend separado fijado al main revisado. Conservar los cambios exclusivamente de pruebas en rama propia. No reutilizar scripts productivos de inicio ni el compose genérico existente sin revisar su configuración efectiva. Revisar por separado el empaquetado raíz (TypeScript/ESLint/contexto Docker) para que no incorpore Mobile accidentalmente.
2. Implementar un único selector de perfil **antes de cualquier operación mutante en instrumentation/entrypoint**. En auth-only exigir configuración completa y abortar si falta o es contradictoria. Este perfil debe impedir también mantenimiento de credenciales, backfills, limpieza/reanudación de campañas e indexadores; no solo los workers con nombre evidente. En el perfil productivo conservar el comportamiento vigente, sin desplegarlo en esta fase. Tests con spies deben acreditar cero arranques de todos los participantes desde cada entrypoint utilizado.
3. Separar explícitamente el comando de migración del arranque auth-only. Construir imágenes no debe conectar BD. Ningún `prestart`, script npm, Docker CMD o import lateral puede ejecutar migraciones/seeds. El migrador test se ejecutaría solo con autorización, sobre la identidad de instancia test previamente acreditada; el servidor no recibe ese DSN/rol.
4. Seleccionar máquina local disponible, con recursos y disco suficientes, sin acceso/credenciales productivas. No hace falta contratar otro servidor. El entorno actual tiene disco libre escaso y no queda acreditado para PostgreSQL/build adicional. Hetzner compartido y Coolify quedan excluidos de la propuesta mínima; cualquier uso compartido exige nueva revisión, cuotas y autorización. No se ha instalado/arrancado infraestructura.
5. Preparar red interna test y volúmenes nuevos con proyecto exclusivo. Sin host networking, mounts de repositorio productivo/home/`.env`/`.aws`, sockets Docker o volúmenes existentes. PostgreSQL sin puerto publicado; el futuro backend de escritorio, inicialmente solo loopback, sin túneles ni ingress público. Antes del teléfono habrá una revisión específica de TLS, dirección LAN y alcance de firewall.
6. Generar secretos locales **nuevos** fuera de Git después de autorización; entorno por allowlist, sin herencia de shell ni fallback a valores productivos. Revisar las tres conexiones app/system/migrate en su configuración efectiva redactada: host resuelto, puerto, BD, usuario, instancia y rol. No basta nombre `_test`. Nunca usar dumps, cookies o sesiones productivos.
7. Egress denegado por defecto para IPv4 **e IPv6**, DNS y rutas alternativas. Solo BD y stubs internos permitidos. Cerrar acceso a gateway/host, rangos LAN/productivos y metadata/cloud APIs; nada de Meta, WhatsApp, SMTP, IA, calendarios, CDN o webhooks reales. Resolver paquetes antes de introducir secretos test. La red `internal` de Docker por sí sola no acredita todos los controles; comprobar reglas efectivas, aliases, rutas, mounts y conectividad a señuelos internos controlados. No sondear producción para comprobar un bloqueo.
8. Preparar tres roles PostgreSQL exclusivos: migrador/owner de esquema test, app sin superuser/createrole/createdb/BYPASSRLS y rol system acotado al ámbito test (si exige BYPASSRLS, documentarlo y demostrar que nunca alcanza otra instancia). App sin privilegios sobre otras BD/esquemas. Secretos de migración ausentes en runtime. Roles y grants se acreditan con consultas **solo tras autorizar la BD test**.
9. Tras aprobar controles estáticos y configuración operativa, autorizar por separado arranque PostgreSQL, migraciones/seeds ficticios y backend auth-only. Seed mínimo: dos organizaciones y tres roles sintéticos; sin campañas, jobs pendientes ni proveedores registrados. No activar webhooks ni procesos que reanuden trabajo histórico.
10. Probar Better Auth real primero localmente: versión exacta, cookie jar/Set-Cookie/rotación, sesión/CSRF/Origin/TLS, revocación y bootstrap efectivo de contexto. No usar OAuth MCP como sesión del CRM; no habilitar el plugin de organizaciones bloqueado sin analizar el modelo existente. La recuperación por referencia requiere contrato autorizado propio, no asumir endpoint disponible.
11. Solo con nueva autorización implementar el bridge/HTTP allowlisted, unir SessionBoundary a stores, y conectar Motorola con usuarios ficticios. Pruebas RLS negativas entre empresas, late responses/logout offline, pérdida de dispositivo y hardware seguro. iOS necesita capacidad propia autorizada. Nada de Bandeja/WhatsApp real ni push remoto por aprobar autenticación.

## Checklist de aceptación operativa pendiente

| Control | Evidencia exigida antes de continuar | Estado actual |
|---|---|---|
| Fuente backend | SHA completo main revisado, árbol limpio y manifiesto de imagen/lock | Ref fijada; checkout futuro pendiente |
| Arranque sin efectos | Tests entrypoint/imports con todos los workers/migraciones en cero; comando efectivo revisado | Solo propuesta y validador |
| Host y recursos | Identidad de máquina no productiva, disco/RAM/cupos suficientes | No acreditado |
| Configuración | Env efectivo redactado; ninguna herencia/fallback/mount productivo | No acreditado |
| Red | Reglas/rutas IPv4/IPv6/DNS, sin acceso host/externo, negativas contra señuelos | No acreditado |
| PostgreSQL | Identidad instancia/BD test; tres DSN/roles/grants; ninguna conexión productiva | No creada/conectada |
| Almacenamiento | IDs/labels/mounts de volúmenes nuevos; sin volúmenes o dumps reales | No creado |
| Servicios exteriores | Ningún token/proveedor/webhook real; todos los adaptadores deshabilitados o stub | No conectado |
| Aislamiento de datos | Seed sintético y pruebas RLS de app/system por org/usuario | Pendiente de BD autorizada |
| Protocolo nativo | Cookies, orígenes, TLS, revocación, SecureStore y permisos en hardware | Pendiente |
| Autorización | Decisión explícita del propietario para cada bloque operativo | No concedida por este plan |

## Reversión

Ahora: cambiar a I2-P `8d0a1d3` o I1 `00fb8ca` en checkout separado; conservar la rama y el bundle I2-P2. No usar reset destructivo ni sustituir APK. No hay servicios, BD o migraciones creados en esta entrega que revertir.

En la prueba futura: desactivar el bridge/factory test y volver a demo; bloquear egress y detener solo procesos del proyecto test; revocar sesiones y secretos exclusivamente ficticios por vías autorizadas; conservar logs redactados. Destruir volúmenes test requiere confirmar sus IDs y autorización de borrado. No revertir RLS, secretos ni esquema productivos. Un fallo operativo no se resuelve abriendo egress, desactivando TLS/RLS o apuntando a producción.
