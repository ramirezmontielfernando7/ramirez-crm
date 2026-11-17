# I2-P2 · Expediente para revisión final breve

**Preparado para revisión; no enviado ni aprobado por Claude.** No autoriza HTTP, backend, PostgreSQL, migraciones, workers, teléfono ni gastos. Revisar el delta I2-P → I2-P2, sin repetir una auditoría general del CRM.

- Base móvil exacta: `8d0a1d30777a24f49e2d512296bb0663399c4bbe`.
- Rama local: `codex/dashfort-mobile-i2p2-20261117`.
- Commit de correcciones/pruebas: `f15ee228b38544452224c85d19bfb2724f95f96f`.
- Main backend de referencia: `3a91d507c535682136b31acefcf2ff63107a2dbd` (ref consultada, sin descargar/arrancar ese backend).
- Estado remoto: I1 respaldada; las refs I2-P e I2-P2 no aparecen en la consulta de esta entrega. Fuente y bundle locales preparados; no hubo push.

## Qué revisar en código

1. `src/integration/auth/controller.ts`: `begin` captura epoch antes de callbacks; `operation`, `logout`, `guarded`, `orphan` revalidan autoridad; respuestas exitosas que ignoran abort no se instalan. Cierre reentrante y nuevo login durante cleanup viejo no revocan/borran la sesión nueva.
2. `vault.ts`: cerco síncrono, cola única, barrera duradera, purga previa al login y registro de referencias sin cookies. Ningún fallo independiente debe impedir intentar borrar/revocar; saturación del límite tampoco.
3. `boundary.ts`: detach intenta todos los participantes; attach fallido revierte todos. Se usa con memoria, no con los stores reales de la demo.
4. `model.ts`: allowlist del scope y referencias; códigos de diagnóstico y cinco estados de revocación. `fixture.ts`: idempotencia de revocación ficticia, incluida referencia después de reiniciar.
5. `secure-store.native.ts`: namespace exclusivo fixture, valores canónicos. Adapter no montado, sin pruebas en hardware.
6. `transport.ts`: idéntico a I2-P; `DisabledAuthenticatedHttp.execute` siempre rechaza, sin sender, fetch ni sockets. `preflight.ts` solo valida declaraciones y aun pasando devuelve `readyToStart:false`.

## Evidencias focalizadas

- `tests/integration-i2p2-regressions.test.ts`: mismas cuatro reproducciones, **4 fallos en I2-P / 4 aprobadas ahora**; logs antes/después en evidence.
- `integration-i2p.test.ts`: 17 casos previos conservados, `failNext` ahora ejercitado realmente. Expectativas de logout actualizadas: ausencia de credencial activa en vez de almacén totalmente vacío, pues barrera/referencias deben persistir; `pending` sustituye `unconfirmed`; fallo local devuelve `cleanup` con detalle estructurado. No se debilitaron aserciones de autoridad/aislamiento.
- `integration-i2p2.test.ts`: 28 casos adversariales adicionales; incluye cada etapa de limpieza, capacidad saturada, persistencia fallida de una sesión ya creada, reentrada, logins fuera de orden, éxito tardío login/renew/switch, caída de respuestas, restart/recovery y cruce de organización.
- `integration-i2p2-preflight.test.ts`: 8 casos de validación del plan futuro; cada worker/binding y red/volumen/secretos se alteran para comprobar rechazo.
- Suite total **176/176**, browser **45/45**; TypeScript/formato/export web aprobados. Browser solo prueba la demo RN Web conservada, no Better Auth nativo ni infraestructura.
- `evidence/isolation.json`: 82 archivos existentes de runtime/config/dependencias conservados; APK 0.1.2 con hash original; historial T-M1–T-M5B/I1/I2-P como ancestros; todo cambio en apps/mobile.

## Límites que el revisor debe aceptar o exigir resolver antes de I2

- Es imposible persistir un logout cuando fallan todas las escrituras y borrados. La instancia actual bloquea autoridad y declara error; no se garantiza que un nuevo proceso recuerde un evento que nunca pudo guardar. Exigir procedimiento de cuarentena/borrado local y revocación autorizada antes de confiar de nuevo.
- La recuperación por referencia es un contrato/capacidad del simulador. Better Auth real no se presume compatible; una referencia sin autorización **no es** una credencial. Si no existe una vía autorizada, el resultado remoto sigue desconocido.
- Una sesión creada pero cuya respuesta jamás llegó al cliente requiere políticas de instalación/expiración/revocación del servidor. No basta abortar ni un registro cliente.
- El preflight declara configuración, no inspecciona una máquina/BD/firewall ni evita por sí mismo que otro script arranque workers. [CONTROLES-I2.md](CONTROLES-I2.md) exige un gate previo a toda mutación y migraciones separadas; todavía no implementado en servidor.
- Ninguna prueba realizada acredita cookies reales, CSRF, TLS, bootstrap de permisos, RLS, almacenamiento seguro nativo ni control efectivo de Coolify/Hetzner.

## Decisión solicitada al revisor y al propietario

Confirmar si el delta resuelve los cuatro defectos, si quedan carreras de autoridad/persistencia y si el plan auth-only tiene omisiones concretas. Si la revisión es satisfactoria, el propietario puede autorizar **una siguiente etapa acotada**: preparar un checkout backend separado desde el main revisado e implementar/testear gates sin arranque. No equivale a autorizar automáticamente DB, migraciones, backend o transporte real.

Posteriormente autorizar por bloques: máquina y controles operativos → PostgreSQL/roles/seeds → migraciones test → backend auth-only → bridge real/conexión del Motorola. No producción, T-M5C, I3 o proveedores por implicación. El respaldo remoto de I2-P/I2-P2 también requiere permiso explícito; no se ha solicitado ni ejecutado un push encubierto.

Reversión: conservar rama/bundle, volver en checkout separado a I2-P o I1; la demo y APK no cambiaron. Cuando existan recursos test, detener/revocar solo ese proyecto y no borrar volúmenes sin verificar IDs/permiso. Ver [controles y reversión](CONTROLES-I2.md).
