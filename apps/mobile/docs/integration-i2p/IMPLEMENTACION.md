# I2-P · Preparación de autenticación sin conexión

Base remota verificada: `codex/dashfort-mobile-i1-20261115`, `00fb8caad3e61beef0d7a802ee87e17cfb53df8c`. Rama nueva: `codex/dashfort-mobile-i2p-20261116`. Se conservan T-M1–T-M5B, I1 y la APK 0.1.2; no se reemplazó ni generó otro binario. Ninguna pantalla ni proveedor actual importa estos módulos.

## Referencia de servidor

Main remoto consultado por `ls-remote` y código leído de origin/main: **834806ec8616375fd8acb7961ac0d830ac9d0066**, igual al auditado en I1. No se repitió el inventario de 262 rutas. Lecturas críticas: `src/lib/auth/index.ts`, `session.ts`, `permissions.ts`, `src/server/auth/on-signup.ts` y configuración de build. Sesión Better Auth 1.7.19, 30 días y actualización tras un día; rol desde membresía/delegaciones, suspensión revisada; organización activa validada y fallback de membresía; plugin organization y reset por correo bloqueados. OAuth MCP no autentica las APIs normales del CRM. No se consultó producción ni se presume qué commit está desplegado.

## Archivos nuevos

| Archivo bajo src/integration/auth | Responsabilidad y límite |
|---|---|
| better-auth-contract.ts | Contrato futuro para bridge Better Auth y almacenamiento opaco nativo; son interfaces, no un endpoint/bootstrap implementado |
| model.ts | Contexto público sin credenciales, errores acotados, autoridad abstracta, envelope **solo ficticio** validado e inmutable |
| controller.ts | Coordinación login/restore/renovación/salida, generación de sesión, AbortSignal y descarte de respuestas antiguas; no React ni HTTP |
| fixture.ts | Autoridad de prueba en memoria: owner/coordinador/asesor con cuentas example.invalid, expiración, revocación, fallos/red ficticia y barreras asíncronas |
| vault.ts | Lectura validada y escrituras/borrado serializados de un envelope por instalación; no acepta material real ni contraseñas |
| secure-store.ts | Implementación web/test bloqueada: sin fallback a localStorage/sessionStorage/AsyncStorage |
| secure-store.native.ts | Adaptador opcional al SecureStore ya instalado, namespace de fixtures y WHEN_UNLOCKED_THIS_DEVICE_ONLY; no instanciado en runtime |
| transport.ts | Planes de peticiones futuras, validación pura de origen/destino y estados; execute SIEMPRE falla blocked; no fetch, socket ni sender inyectado |

Los contratos de Better Auth separan referencia de binding y contexto validado del material de cookie; no definen un JWT propio, no almacenan hashes de contraseña ni implementan otro login real. El simulador es un test double, no un reemplazo de Better Auth. Sus credenciales tienen prefijo fixture-cookie, duración una hora de prueba y permisos representativos de los roles (subconjunto, sin delegaciones dinámicas); eso no redefine el TTL ni la matriz completa del servidor.

## Políticas implementadas

Una sesión restaurada no obtiene acceso solo porque exista un registro local. Se decodifica, se consulta la autoridad simulada y se compara usuario/org antes de instalar contexto. Rol y permisos locales alterados no mandan: se usa la respuesta canónica. Vencimiento/corrupción/falsificación fallan cerrados. Con falta de red simulada el envelope seguro puede conservarse para revalidación, pero el contexto público queda nulo y las operaciones protegidas se rechazan.

Cada transición cambia generación, aborta las solicitudes antiguas y desconecta de forma síncrona el ámbito de datos mediante SessionBoundary. Antes/después de persistir o aceptar un resultado se verifica la generación. Las escrituras del vault se serializan; si una escritura queda atrasada, se elimina antes de admitir otra. logout durante una renovación conserva el candidato necesario para intentar revocarlo; no permite reinstalar la respuesta tardía. Renovaciones concurrentes comparten una promesa. No hay timers, polling, workers o procesos de segundo plano nuevos.

El puerto SessionBoundary obliga a desacoplar caché/borradores/medios/avisos antes de instalar otra identidad. Se ha probado con cachés en memoria, NO se conectó a los almacenes existentes. Una futura integración deberá implementar ese puerto contra todos los repositorios móviles y validar que su detach no falle. Un 401/403 del guard invalida conservadoramente la sesión/ámbito; una política más precisa por recurso puede añadirse solo con contexto confirmado del servidor, sin ocultar pérdida de acceso.

El cierre offline borra autoridad local e informa remoteRevocation=unconfirmed. No se afirma revocación remota ni se conserva un secreto real para reintentar en background. Si falla el borrado, queda estado blocked/storage y no se reporta limpieza segura exitosa. La persistencia fallida o un teléfono sin conexión no permiten garantizar borrado remoto; recuperación operativa debe revisarse antes de usar datos reales.

La selección de organización está deshabilitada por defecto, como capacidad no acreditada del backend. Solo un modo explícito del simulador permite probarla; asesor no puede ir a otra organización. La renovación también respeta capacidad explícita: si no aplica, devuelve unsupported y no inventa un endpoint de refresh OAuth.

Planes de HTTP: rutas Better Auth candidatas sign-in/email, get-session y sign-out; sin URL, cabecera Cookie o contraseña serializada. Validación de destino exige HTTPS, origen exacto, ruta permitida, forma canónica y ausencia de credenciales URL/query/fragmentos. Todos los 3xx se rechazan, igual que destinos absolutos no autorizados. La validación pura no habilita red; incluso un plan válido de staging falla en DisabledAuthenticatedHttp. No existe flag para habilitar producción en este código.

## Qué falta para autenticación real

No se implementaron parser/gestión real de múltiples Set-Cookie ni bridge Better Auth, bootstrap de permisos, selección org del servidor, fixture HTTP de Better Auth ni transporte de staging. Requieren acreditar comportamiento del servidor y un entorno aislado. **No será suficiente cambiar un prefijo o un flag para conectar producción.** El contrato futuro y el coordinador reducen trabajo, pero no sustituyen esos gates.

SecureStore se comprobó por tipos y por el contrato inyectable; no por hardware. Android/iOS deberán validar tamaño, backup, restauración, reinstalación, bloqueo de dispositivo y accesibilidad del keychain. La opción iOS THIS_DEVICE_ONLY no es una prueba de reglas Android de backup; comprobar manifiesto y configuración real de la compilación autorizada. Datos reales no se almacenarán mediante el adapter de fixtures.
