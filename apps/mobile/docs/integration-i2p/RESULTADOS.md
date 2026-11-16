# I2-P · Resultado y límites de la entrega

Rama `codex/dashfort-mobile-i2p-20261116`, desde I1 `00fb8caad3e61beef0d7a802ee87e17cfb53df8c`. Commit de código **cdd65e7a63edea0510ae3b289520e38bf55436fe**; documentación/evidencias en commit posterior. Main leído como referencia: **834806ec8616375fd8acb7961ac0d830ac9d0066**. No se modificó main local ni remoto, raíz, CRM, backend, TWA, Coolify o Hetzner.

## Entregado

Contratos futuros Better Auth y almacenamiento opaco; coordinador aislado de autenticación; tres roles backend con usuarios ficticios; restauración validada por autoridad; expiración/renovación/revocación simuladas; vault serializado y adaptador SecureStore opt-in; generaciones y cancelación para respuestas tardías; limpieza de ámbito; HTTP siempre bloqueado y validadores de destino/3xx/401/403. Los nuevos módulos no están importados por pantallas ni por el SessionProvider aprobado. No se reinventó una autenticación real, cookie parser, JWT ni password hashing.

Documentos: [implementación](IMPLEMENTACION.md), [entorno y activación I2](ENTORNO-Y-ACTIVACION.md), [compatibilidad web](COMPATIBILIDAD.md) y [expediente Claude](REVISION-CLAUDE.md). Las correcciones de backend/configuración raíz son propuestas, no cambios realizados.

## Pruebas

| Comprobación | Resultado y alcance |
|---|---|
| TypeScript estricto | Pasa, incluye adapter nativo por tipos |
| Suite lógica completa | **136/136**, 0 fallos/omitidos: 119 previas + 17 I2-P |
| Pruebas específicas I2-P | Login por tres roles/incorrecto, restore canónico vs rol local falsificado, envelope corrupto/expirado, offline, refresh compartido y logout en carrera, cambio org/no autorizado, respuestas antiguas, escritura de vault pendiente, 401/403/revocación, expiry mientras llega resultado, borrado fallido, namespace/secretos ficticios, URL/redirect y transporte bloqueado |
| Formato | Pasa |
| Dependencias | Sin nuevas instalaciones ni cambios de package/lock. `expo install --check` en modo offline informa compatibles, con advertencia propia de fiabilidad limitada sin consulta remota; no acredita últimos parches disponibles |
| Export web | Pasa, con telemetría/red de Expo deshabilitadas |
| Regresión Chromium | **45/45**, 0 fallos/omitidos; pantallas demo y recorridos T-M1…T-M5B conservados |
| Preservación I1/runtime | 77 archivos existentes de app/src/assets/plugins/config/dependencias idénticos al checkpoint; sin import nuevo hacia auth desde runtime anterior |
| APK 0.1.2 | Hash idéntico: 36f3a4781220eff96ef9938e1d07adbf9ceac7797254ad3cc94f2b7d75b18f7a. No se construyó ni reemplazó APK |
| Backend/BD/protocolo HTTP real/Android/iOS | No ejecutados; pendientes tras puerta de seguridad |

La primera ejecución detectó una restricción de tipos y dos casos rojos: sincronización insuficiente del test que pretendía retrasar el primer login, y clasificación de un vencimiento propio como stale tras invalidar la generación. Se corrigieron el test y el controlador, se añadieron condiciones claras y se repitió: 17/17 específicos y 136/136 en la suite final. Se preserva el diagnóstico inicial, no se presenta como una integración real aprobada.

El navegador solo usa el servidor estático local de QA, no un backend Dashfort ni staging. No hubo HTTP a producción/servicios de pruebas, Postgres, migraciones, workers, campañas, webhooks, WhatsApp, push remoto, infraestructura nueva, servicios de pago o cuotas externas. La consulta GitHub fue solo lectura de refs/código para la referencia requerida.

## Archivos modificados

Nuevos: ocho archivos en `src/integration/auth/` (`better-auth-contract.ts`, `controller.ts`, `fixture.ts`, `model.ts`, `secure-store.native.ts`, `secure-store.ts`, `transport.ts`, `vault.ts`), `tests/integration-i2p.test.ts`, esta carpeta de documentación/evidencia. Cambios de continuidad: AGENTS.md y README.md. No hay modificaciones en rutas/pantallas, temas, iconos, tamaños, fuentes, navegación, datos o adaptadores de demo existentes. T-M1–T-M5B e I1 permanecen en el historial.

## Listo para evolucionar / pendiente

**Implementado y probado aisladamente:** orquestación, protección de ámbito, serialización de almacenamiento, fixture de errores/capacidades, interfaces y políticas de rechazo. Sin procesos permanentes y sin tráfico externo habilitable por configuración.

**Preparado pero no validado en hardware:** SecureStore, políticas de backup, reinstalación, keychain/keystore y binding de instalación. El puerto seguro real es un contrato; el adapter ejecutable solo admite envelopes ficticios. No guarda credenciales reales en ningún formato.

**Pendiente de conocer/probar con backend aislado:** bridge Better Auth real, nombres/opciones y múltiples cookies Set-Cookie, renovación efectiva, Origin/CSRF/TLS, contexto verificado de permisos/módulos, selección org si se autoriza y logout/revocación real. No se presume que OAuth MCP o el plugin org bloqueado sirven. Hace falta revisar y acreditar el entorno antes de implementar/activar esas conexiones.

**Límites operacionales:** abortar una espera no deshace un login ya procesado en servidor; evaluar limpieza de sesiones huérfanas al conectar. Un fallo de almacenamiento o un teléfono offline impide garantizar borrado/revocación remotos. SessionBoundary aún no está conectado a repositorios reales. Ante estas limitaciones no se reporta autenticación productiva lista ni se simula su prueba.

## Conservación y siguiente paso

Commits locales organizados y árbol limpio al cierre. Bundle incremental local preparado desde 00fb8ca en `artifacts/integration-i2p/dashfort-mobile-i2p.bundle`, con manifest de hashes/head en ese directorio. No incluye APK, claves o cachés ignoradas. No se hizo push, PR, merge, tag, release o despliegue.

**Siguiente paso: revisión independiente de Claude del expediente y del código.** No se envió el expediente ni se afirma aprobación. Solo después el propietario decidirá autorizaciones concretas para crear/arrancar el entorno, tocar servidor/configuración raíz, conectar BD/migraciones o teléfono. No se inició I2 real ni T-M5C. Ninguna tarea de desarrollo aislado de esta entrega quedó esperando un permiso individual.
