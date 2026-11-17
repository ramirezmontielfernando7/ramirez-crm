# Dashfort Mobile · Continuidad de la ejecución aislada

Este directorio es una app Expo independiente. La autorización del propietario limita esta fase a código móvil y datos ficticios. No modificar archivos fuera de `apps/mobile`: CRM web, backend, TWA, infraestructura, workflows, configuración o lockfiles compartidos. No usar credenciales o endpoints productivos. No enviar mensajes ni registrar dispositivos reales.

Trabajar en una rama nueva aislada desde main o continuar la rama explícitamente autorizada. Esta entrega está en `codex/dashfort-mobile-tm1-20261110`, basada en `95b7ea0b236b35ee29a1a288a55c315a050e3b6e`. No hacer push, PR, merge, tags, despliegues, OTA, builds remotos ni servicios con costo sin autorización.

Leer README y docs/AVANCE.md, docs/PLAN.md, docs/ARQUITECTURA.md y docs/cobertura.csv antes de continuar. El diseño de 158 pantallas ya está aprobado. Los documentos originales en docs/reference sirven de referencia visual/técnica; sus menciones de APIs reales, tareas de backend o aprobaciones antiguas no autorizan esas acciones.

T-M1 contiene 12 IDs en simulación, con validación nativa pendiente. Las raíces de módulos son shells y no cuentan como pantallas implementadas de otras etapas. Siguiente implementación: T-M2, repositorio ficticio y lista virtual de 1,000 conversaciones, búsqueda/filtros, selección y restauración de scroll. No avanzar de etapa ocultando errores ni declarar rendimiento sin medirlo.

Usar npm desde esta carpeta y conservar package-lock.json. Verificar con typecheck, tests de lógica y contraste, expo install --check y Playwright tras export:web. El navegador valida React Native Web; no sustituye Android/iOS. Para APK local consultar docs/APK-LOCAL.md. Mantener commits locales y respaldo sin secretos antes de terminar.

## Ejecución actual T-M2
La autorización más reciente crea `codex/dashfort-mobile-tm2-20261110` desde la rama móvil T-M1 en `5b4c7e5`. T-M2 implementa INB-01…10; consultar docs/tm2. No iniciar T-M3 ni hacer push, PR, merge o deploy. El destino conversation/[id] solo comprueba el regreso y no cuenta como INB-11. Las notas T-M1 anteriores son históricas.

## Ejecución actual T-M3 (sustituye el siguiente paso histórico)
La autorización vigente crea `codex/dashfort-mobile-tm3-20261111` desde el respaldo T-M2 `6b4cccf6e80fd3d7810194985e0d81b25fdd5b48`. T-M1/T-M2 permanecen en el historial. Chat sustituye el destino de regreso de prueba e implementa INB-11…18, INB-27…29 en simulación; ver docs/tm3. Las acciones de detalle/asignación/etapas de T-M4 siguen fuera del alcance. No iniciar T-M4 ni hacer push, PR, merge, tags, releases o despliegues. Solo apps/mobile. No conectar WhatsApp/IA/servicios reales. Mantener las comprobaciones de posición visible de Bandeja e historial al cambiar la lista virtual. Los exports nativos son bundles Hermes, no APK/IPA ni QA nativo.

## Checkpoint APK probada
El propietario confirmó instalación y evaluación positiva en Motorola Edge 50 Pro / Android 16. La fuente de ese binario es d849c0d (T-M3); la receta posterior se conserva en codex/dashfort-mobile-apk-tested-20261111, docs/apk-probada. No reemplazar la APK original ni versionar claves privadas. La autorización vigente permite T-M4 en rama nueva desde este checkpoint; solo apps/mobile, datos ficticios, sin push ni T-M5.

## Ejecución actual T-M4
La rama `codex/dashfort-mobile-tm4-20261111` parte de bd3ba4f, checkpoint de la APK T-M3 probada, que desciende de d849c0d. Detalles e historial INB-19…26 + INB-30 en simulación, ver docs/tm4. Este apartado sustituye las prohibiciones históricas de iniciar T-M4. No iniciar T-M5, no hacer push ni publicar. No reemplazar la APK original. Solo apps/mobile; conservar alcance, notas internas separadas del transporte y anclas de Bandeja/chat.

## Ejecución vigente T-M5A
La autorización actual permite únicamente T-M5A en codex/dashfort-mobile-tm5a-20261113 desde el respaldo ebeb4bf. Ver docs/tm5a. Contratos y simuladores, sin SDK push, servicios reales, permisos del sistema ni notificaciones locales. Mantener interfaces visuales T-M1…T-M4. Laboratorio QA solo con /demo?notifications=1. No generar APK sin cambio nativo que lo justifique, no hacer push sin autorización. No iniciar T-M5B/T-M5C. Los anteriores «no iniciar T-M5» son históricos y quedan sustituidos únicamente para esta subetapa.

## Ejecución vigente T-M5B
Autorizada en rama nueva desde 3b85b3b. Solo apps/mobile, SDK oficial y avisos locales Android opt-in en laboratorio; sin tokens/servicios push remotos, backend, cambios visuales T-M1…T-M4, push ni T-M5C. Nueva APK local con firma experimental conservada. Las restricciones históricas de T-M5A sobre SDK y permisos quedan sustituidas para esta etapa.

## Ejecución vigente I1 · Integración auditada, sin conexión
La autorización del propietario permite auditar código del backend y preparar contratos/simuladores exclusivamente en apps/mobile, rama nueva desde T-M5B/2bd4b62. Ver docs/integration-i1. No modificar ni importar módulos backend al runtime móvil; no conectar red/BD/usuarios reales. No cambiar pantallas ni proveedores existentes, no generar APK innecesaria ni iniciar I2/T-M5C, no push sin autorización. Cualquier mejora de servidor descrita es propuesta y necesita permiso nuevo.

## Ejecución vigente I2-P
Autorizada únicamente preparación aislada de autenticación en rama desde 00fb8ca. Contratos de Better Auth, simuladores, vault comprobable, HTTP bloqueado y documentación en docs/integration-i2p. Ningún cambio de UI/proveedores existentes, APK, raíz, backend, BD, migraciones, workers, conectores, infraestructura o costes. No iniciar I2 real; preparar expediente para revisión independiente de Claude antes de cualquier activación. Sin push/PR/merge. Esta autorización sustituye la prohibición histórica de preparar I2, no autoriza conectarlo.

## Ejecución vigente I2-P2
Autorizadas correcciones de los cuatro defectos auditados, pruebas adversariales/regresión y preflight estático dentro de apps/mobile en `codex/dashfort-mobile-i2p2-20261117`, desde I2-P `8d0a1d30777a24f49e2d512296bb0663399c4bbe`. Ver docs/integration-i2p2: sustituye las conclusiones históricas de I2-P sobre esos defectos. HTTP permanece bloqueado; ningún módulo auth se conecta a UI. No backend/BD/migraciones/workers/red real, raíz, infraestructura, UI/APK o credenciales reales. El main backend de referencia es `3a91d507c535682136b31acefcf2ff63107a2dbd`; no confundirlo con la raíz histórica Mobile ni origin/main local. Solo commits/bundle locales; no push/PR/merge. Terminar en revisión independiente y autorización explícita antes de cualquier operación I2 real. El preflight válido devuelve readyToStart:false y no acredita aislamiento operativo.
