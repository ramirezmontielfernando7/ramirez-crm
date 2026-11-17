# I2-P2 · Correcciones aisladas de autenticación

Base exacta: `8d0a1d30777a24f49e2d512296bb0663399c4bbe` (I2-P). Rama: `codex/dashfort-mobile-i2p2-20261117`. Todo queda dentro de `apps/mobile`. Este documento sustituye las conclusiones de seguridad de I2-P en los puntos corregidos; los informes anteriores se conservan como históricos.

## Cuatro defectos y evidencia

| Defecto reproducible en I2-P | Corrección | Evidencia |
|---|---|---|
| Un observador hace logout al recibir `authenticating` y el login antiguo recupera autoridad | La generación se captura antes de abortos, límites de sesión y observadores. Se verifica después de cada callback/await; nunca se toma prestada la generación actual | `integration-i2p2-regressions.test.ts`, caso 1; login reentrante, resultados fuera de orden y éxito tardío ignorando AbortSignal |
| Un fallo de detach interrumpe el cierre antes de borrar/revocar | El cierre retira autoridad y cerca el vault inmediatamente; descubre bindings, registra intención, borra credencial y revoca como pasos independientes. Errores estructurados, interfaz bloqueada | Caso 2; fallo independiente de cada participante y de lectura/escritura/borrado; observadores que lanzan |
| Restore frío offline seguido de logout afirma que no hay sesión remota | Se conserva el binding conocido para revocar, aunque falle restore. Registro persistente de referencias sin credenciales; recuperación explícita tras reiniciar | Caso 3; reinicio, vuelta online, resultado perdido y capacidad de revocación ausente |
| Scope retiene propiedades arbitrarias por spread | Construcción canónica de `userId`, `organizationId`, `sessionId`, `expiresAt`; tipos estrictos y objetos inmutables | Caso 4; campos extra/anidados, prototipo, arrays y tipos inválidos |

Las mismas cuatro pruebas fallaron contra la fuente archivada de I2-P y pasan con I2-P2: [antes](evidence/before.txt), [después](evidence/after.txt). No se reescribió el commit original. El test genérico anterior ahora activa realmente `failNext` y comprueba `server`.

## Cierre local y resultado remoto son independientes

`State.cleanupFailures` contiene únicamente códigos: `boundary`, `cache`, `drafts`, `media`, `notifications`, `credential-delete`, `restore-barrier`, `revocation-read`, `revocation-write`. Ningún texto de excepción, cookie, contraseña o payload del servidor pasa a ese diagnóstico. Los observadores defectuosos se aíslan y cuentan hasta 1,000 sin impedir otros pasos. Si queda una limpieza fallida, logout rechaza con `cleanup`, no comunica éxito local y el contexto queda nulo/bloqueado.

`CompositeSessionBoundary` intenta todos los participantes aunque falle uno y revierte todos tras un attach fallido. Es un adaptador probado con memoria, **todavía no está conectado a los stores de la app**. La futura conexión debe verificar que retiró realmente caches, borradores, medios y destinos/avisos de la cuenta anterior; limpiar una referencia en el controlador no basta.

| `remoteRevocation` | Significado |
|---|---|
| `none` | No se conoce un binding remoto pendiente; no afirma que no existan sesiones en el servidor |
| `confirmed` | La autoridad confirmó las revocaciones conocidas y se actualizó el registro; no certifica todas las sesiones de un usuario |
| `pending` | Hay referencia conocida, sin conectividad/confirmación; requiere recuperación |
| `failed` | La autoridad rechazó expresamente la revocación, por ejemplo 401/403; no se convierte en éxito |
| `unknown` | Resultado ambiguo, fallo del registro o capacidad no disponible; no puede afirmarse revocación |

El estado agregado prioriza unknown, luego failed, luego pending. Se mantiene separado de la limpieza local: borrar el dispositivo no revoca por sí mismo una sesión remota; confirmar el servidor no garantiza que se borró el dispositivo. El estado inicial antes de leer almacenamiento no es un inventario del servidor.

## Vault, barrera y recuperación

Una cola serializa escritura de credencial, barrera duradera y registro de revocación. Logout activa además un cerco síncrono en memoria. Si falla eliminar la credencial pero la barrera se escribe, la restauración también queda bloqueada al construir un vault nuevo. Un login explícito solo levanta la barrera después de purgar correctamente la credencial anterior. La barrera se mantiene tras logout y no es una sesión activa.

El registro contiene solo versión, referencias ficticias `{userId, organizationId, sessionId}` y resultado pendiente/fallido/desconocido. **Nunca conserva una cookie descartada**. Está limitado a 32 entradas; las candidatas en memoria también están limitadas. Al saturarse se rechazan nuevas operaciones de autenticación; el límite no puede impedir el borrado o los intentos de revocación durante logout. Si el registro lleno no puede guardar otra referencia, se informa de limpieza fallida, aunque la revocación online resulte confirmada. Se requiere drenarlo explícitamente antes de continuar.

`recoverRevocations()` comparte un único intento concurrente. No hay cron, servicio permanente, bucle de reintentos ni tareas de segundo plano. Debe invocarse en un punto autorizado tras recuperar conectividad. `revokeReference` es una capacidad **del simulador** para demostrar recuperación sin guardar credenciales. No se añadió un endpoint real ni se afirma que Better Auth lo ofrezca. En un servidor futuro una referencia no autoriza ninguna acción: exige autenticación, vínculo de instalación, autorización de usuario/organización e idempotencia. Sin esa capacidad, después de reiniciar el resultado permanece `unknown`; no se inventa éxito.

Una respuesta exitosa tardía de login/renovación/cambio de organización nunca se instala ni persiste como credencial activa. Se intenta revocar en memoria; si falla, queda solo una referencia. También se intenta limpiar una sesión recién emitida cuyo almacenamiento/attach falla. Si el cliente muere antes de recibir la respuesta, no conoce el identificador: se necesitará una política servidor de expiración/gestión de sesiones e identificación de instalación. AbortSignal cancela la espera, no deshace una autenticación ya procesada.

## Límites que siguen abiertos

Si simultáneamente fallan **todos** los writes y deletes y no hay red, ningún código puede garantizar la persistencia del logout. La instancia actual permanece cercada/bloqueada y devuelve error; si el proceso muere sin guardar barrera ni borrar credencial, una instancia nueva no puede deducir el cierre fallido. Procedimiento: mantener la instalación en cuarentena, reparar/vaciar el almacenamiento de pruebas y confirmar revocación desde una autoridad autorizada antes de volver a confiar en ella. No prometer garantía entre reinicios en ese caso. Un cierre del proceso en mitad de operaciones también requiere pruebas nativas y recuperación por servidor.

No hay bridge de cookies Better Auth real, transporte, bootstrap real de permisos ni SessionBoundary conectado. SecureStore solo admite fixtures y no está montado en la demo; su política de backup/keystore/keychain continúa pendiente de hardware. Ni los mocks ni los recorridos web prueban HTTP real, RLS, Android o iOS.
