# APK T-M5B · 0.1.2 verificada estáticamente

Archivo existente, conservado sin recompilar ni reemplazar:
`/workspace/work/ramirez-crm/apps/mobile/artifacts/tm5b/Dashfort-Mobile-TM5B-0.1.2-ARM64.apk`

- Fuente: `d3bd5825b529e4da14189210b25919ac1f42207f`, rama `codex/dashfort-mobile-tm5b-20261114`.
- Tamaño: 34.293.119 bytes.
- SHA-256: `36f3a4781220eff96ef9938e1d07adbf9ceac7797254ad3cc94f2b7d75b18f7a`.
- Identificador: `com.demfort.dashfort.dev`.
- Versión: `0.1.2`, versionCode `3`.
- Arquitectura exclusiva: `arm64-v8a`; mínimo API 24, objetivo API 36 (Android 16).
- Certificado público SHA-256: `0f5d018522f61cf6098871916d2c3cba8e0c6659427a7349c41f0225a983db1b`. Coincide con la firma experimental anterior.

## Qué ocurrió con R8

La espera/interacción anterior se interrumpió mientras aparecía `:app:minifyReleaseWithR8`. El proceso Gradle continuó y terminó con **BUILD SUCCESSFUL in 11m 23s**, 604 tareas (570 ejecutadas, 34 reutilizadas). El registro posterior incluye R8, lintVitalRelease, validación de firma, empaquetado y assembleRelease correctos. No hay error de R8, OutOfMemoryError, fallo de build ni desaparición del daemon en este registro final.

Por tanto, el problema fue la interrupción de la espera/confirmación de la herramienta; no un fallo final de compilación. No hubo necesidad de volver a compilar, desactivar R8, ajustar memoria, alterar código o usar recursos remotos en esta continuación. Los intentos anteriores con rutas temporales/CMake fueron problemas distintos, ya descritos en IMPLEMENTACION.md.

## Comprobaciones del archivo real

`scripts/verify-apk.py` pasó: estructura ZIP/CRC sin duplicados, ID, versión, firma v2 válida, certificado esperado, no debuggable/testOnly, ARM64 exclusivo, zipalign de 16 KB y alineación ELF >=16 KB en 26 bibliotecas. Incluye Hermes (4.439.800 bytes) y las tres fuentes empaquetadas.

La inspección de Hermes encuentra los identificadores del transporte local, canal y registro T-M5B, y los controles para solicitar permiso y programar muestras. DEX contiene los módulos nativos de planificación, permisos, canales y respuestas de Expo Notifications. Esto demuestra inclusión del código, no su funcionamiento en el teléfono.

El manifiesto contiene POST_NOTIFICATIONS, mantiene desactivadas la autoinicialización de Firebase Messaging y Analytics y excluye los dos servicios de transporte Messaging retirados por el plugin. No contiene permisos de alarmas exactas, micrófono o vibración. Los recursos no incluyen google_app_id, google_api_key ni gcm_defaultSenderId. Las dependencias de Expo conservan componentes transitivos Firebase y su receptor protegido; su presencia no configura un proyecto ni registra tokens. No se activó FCM, Expo Push Service ni backend.

Evidencias: `evidence/apk-verification.json`, `apk-tm5b-content.json`, `apk-manifest.txt`, `build-final-summary.txt`. El registro completo original permanece en `/tmp/dashfort-tm5b-build.log`. La fuente y auditoría anteriores se conservan; no se repitió la implementación ni la suite de pruebas ya aprobada.

## Instalación y límites

La APK es estructuralmente válida, está firmada y es compatible por ABI/SDK con el Motorola Edge 50 Pro / Android 16. La instalación y ejecución real siguen **pendientes**: no hay emulador disponible; ADB no pudo enumerar dispositivos por su ruta de preferencias de solo lectura. No se afirma que los avisos nativos funcionen todavía.

Instalar como **Actualizar** Dashfort Dev, sin desinstalarla ni tocar la TWA. Abrir Más → Controles de la demo → Laboratorio de notificaciones. Solicitar permiso Android mediante el botón y probar el aviso inmediato, el aviso diferido con Inicio, pulsación para abrir chat y repetición sin duplicación. Ver [PRUEBA-MOTOROLA.md](PRUEBA-MOTOROLA.md) para denegación, bloqueo de pantalla, proceso retirado de recientes, revocación, cambio de organización, Doze, teclado y scroll. No se garantiza entrega tras fuerza de detención ni puntualidad de alarmas aproximadas.

No se modificó ni reemplazó la APK 0.1.1 ni se publicaron archivos. Producción, diseño, CRM, backend, TWA, Coolify y Hetzner permanecen intactos. Sin push, PR, merge, despliegue o T-M5C.
