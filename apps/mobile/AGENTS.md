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
