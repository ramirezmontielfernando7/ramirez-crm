# Expediente para revisión independiente de Claude

**Estado: operaciones bloqueadas NO ejecutadas.** Este documento prepara la revisión; no se envió a Claude ni se afirma que la haya aprobado. El propietario decidirá tras esa revisión.

Código a revisar: commit `cdd65e7a63edea0510ae3b289520e38bf55436fe`, rama `codex/dashfort-mobile-i2p-20261116`, base `00fb8ca`. Ver src/integration/auth y tests/integration-i2p.test.ts.

## 1. Operación que se propone ejecutar después

Crear un entorno local aislado de bajo coste, con checkout backend separado, PostgreSQL de pruebas y fixtures. Revisar/ejecutar migraciones test y arrancar backend sin workers; posteriormente probar Better Auth con HTTP de staging, SecureStore y un dispositivo. El orden y las precondiciones están en ENTORNO-Y-ACTIVACION.md. No se propone ejecutar producción ni abrir puertos públicos.

## 2. Componentes afectados

I2-P cambia solo apps/mobile/src/integration/auth, tests y documentación. No está conectado a SessionProvider ni a pantallas. La futura I2 afectaría un checkout backend de pruebas, su configuración de Better Auth/orígenes/bootstrap, roles y BD **nuevos**, reglas egress y posiblemente el bridge nativo. Cambios en tsconfig/ESLint/Docker de la raíz se proponen en COMPATIBILIDAD.md, sin implementarlos. La revisión debe separar esos diffs de cualquier cambio de dominio.

## 3. Riesgos

DSN/volumen equivocado; acceso a secretos del host; auto-start de workers con efecto exterior; cookies/CSRF/orígenes mal configurados; cliente Expo no compatible con servidor; bootstrap no disponible; cambio org bloqueado; respuesta/credencial antigua sobrescribe sesión nueva; logout offline no revocado en servidor; backup de credenciales en Android/iOS; root build incorpora Mobile. Un mock que pase no demuestra RLS, HTTP o seguridad real de Better Auth.

## 4. Evidencia que respalda la preparación

Resultados y rutas de pruebas en RESULTADOS.md/evidence. Tests específicos: envelope solo fixture; restauración por autoridad; rol caché alterado; refresh single-flight; logout/renovación simultánea; cambio org y response tardía; escritura de vault pendiente al salir; 401/403/expiración; credenciales corruptas; offline/deletion error; URL/redirect bloqueado. Transporte DisabledAuthenticatedHttp sin fetch/sockets/sender. Runtime aprobado, dependencias y APK permanecen idénticos al checkpoint. No se ejecutó backend, BD, migración o conexión real.

## 5. Cómo se impedirán impactos productivos

No compartir .env/credenciales/volúmenes/redes, verificar los tres DSN, reglas egress denegadas y stubs locales, cuentas y organizaciones ficticias, worker gate revisado antes del primer arranque, TLS/origen exacto y ninguna URL productiva en build. Los gates de fixture del código actual no deben quitarse para activar I2; hace falta un bridge real revisado y una factory de staging explícita. El usuario mantiene APK 0.1.2 y rama I1 como fallback.

## 6. Reversión

Retirar la factory/adaptadores test y volver al checkpoint de demo; revocar únicamente credenciales test; detener recursos locales test. No hay migraciones/servicios creados que revertir por I2-P. Un rollback futuro de esquema debe ser aditivo/ensayado en la BD test, no una operación sobre el CRM productivo. No hacer merge ni deploy para «guardar» el trabajo.

## 7. Autorizaciones concretas pendientes

1. Acreditar máquina, límites de recursos y configuración exacta del entorno test, sin costes o con presupuesto aprobado.
2. Autorizar crear/arrancar Postgres y backend de prueba, sus roles/seeds y migraciones, después de revisar egress y worker gates.
3. Autorizar por separado cambios mínimos de servidor: bootstrap y, si aplica, plugin/orígenes de Better Auth y selección de organización. No activar el plugin organization genérico bloqueado sin analizar reglas.
4. Autorizar el transporte de staging y la conexión del Motorola, una compilación nueva si corresponde y pruebas con usuarios ficticios. iOS requiere autorización/capacidad propia.
5. Autorizar cualquier instalación nativa, servicio externo, gasto, push/PR/merge/despliegue por separado. Ninguna aprobación técnica de Claude reemplaza la decisión del propietario.

## Preguntas para el revisor

- ¿La autoridad real y su versión 1.7.19 pueden reutilizarse con cookies nativas sin debilitar CSRF/orígenes? ¿Qué hace falta para Set-Cookie/renovación y bootstrap efectivo?
- ¿Hay alguna ruta de auto-start o salida que el plan no bloquee? Revisar configuración efectiva/entrypoint/instrumentation del checkout que vaya a ejecutarse, no solo I1.
- ¿El contrato de SessionBoundary cubre todos los stores/borradores/medios/avisos y falla cerrado si su detach/attach no puede completarse? Aún se ejercita con memoria, no con stores reales.
- ¿Falta protección ante renovación/llegada tardía que dejó una sesión huérfana en servidor? El cliente puede descartar una respuesta, no deshacer una autenticación ya procesada. Definir limpieza y política de revocación antes de conectar.
- ¿Son suficientes las políticas de backup, tamaño y reinstalación de SecureStore en ambas plataformas? No se acreditaron en hardware.
