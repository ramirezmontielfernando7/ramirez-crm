# Revisión de aislamiento T-M3

- Base exacta: `6b4cccf6e80fd3d7810194985e0d81b25fdd5b48`, ancestro de HEAD. Conserva a su vez T-M1 `5b4c7e54d3949efaf8baf3b0292b216cb50712b9`.
- Rama de trabajo: `codex/dashfort-mobile-tm3-20261111`. `main` local sigue en `95b7ea0b236b35ee29a1a288a55c315a050e3b6e`.
- Los cambios de código, dependencias, scripts, pruebas y evidencia están dentro de `apps/mobile`. No se cambia ningún lockfile compartido, workflow ni configuración de producción.
- Se revisaron los archivos nuevos/modificados y patrones de claves privadas, tokens GitHub, AWS y servicios. No se detectaron secretos ni credenciales reales; no se incorporaron .env, firmas, keystores o certificados. Las cuentas, contraseñas, números, mensajes y adjuntos son muestras ficticias. Esta revisión de patrones no equivale a una garantía de detección universal.
- Los límites de texto y adjuntos son copias puras locales; no importan código del backend/CRM. Chat no crea clientes HTTP/WebSocket, no llama a WhatsApp/IA ni accede a cámara, GPS, contactos o archivos reales.
- En las cuatro matrices visuales finales no aparecieron errores JavaScript ni solicitudes HTTP externas; no se conectó a producción. Las descargas del toolchain se limitaron a paquetes públicos de desarrollo.
- No se hizo push, PR, merge, tag, release, deploy, OTA, workflow manual, build remoto, ni cambio en Coolify/Hetzner. La autorización de respaldo T-M2 no se reutilizó. No se inició T-M4.

Los ZIP/bundle se generan desde los archivos versionados del commit final. Su manifiesto externo guarda SHA-256, commit completo, verificación de ZIP y bundle. Ver CONSERVACION.md. El árbol debe quedar limpio después del commit de cierre; comprobar con `git status --porcelain` antes de continuar.
