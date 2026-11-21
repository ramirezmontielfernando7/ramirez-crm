# Candidato B original corregido · 0.1.4 / 5

Fuente fijada: `3bb90d690eaeb51af540eed8115c6b47b718c4b4`.
Rama: `codex/dashfort-mobile-ux-keyboard-20261120`.
El incremento 0.1.3/4 → 0.1.4/5 identifica este candidato y permite actualizar sobre la APK probada. Package `com.demfort.dashfort.dev`, ARM64. No hay APK nueva todavía.

El borrador `mobile-apk014.yml.disabled` es un archivo local de documentación y NO es un workflow activo. Reutiliza el proceso exitoso de 0.1.3: runner estándar Ubuntu24.04, Node24.22.1, Temurin17.0.21+9, SDK37.0/target36/min24, Build Tools37.0.0/36.0.0, NDK27.1.12297006, CMake3.22.1 y lockfile móvil intacto. Actions fijadas por SHA; `contents:read`, checkout sin credenciales persistidas, R8 y shrink habilitados, solo ARM64, sin Releases, servicios ni despliegues. Artefacto sin firmar retenido1día.

No usar Gradle aquí: ~624MiB libres frente a un mínimo operativo de8GiB en el runner antes de compilar. No borrar respaldos ni reemplazar ninguna APK anterior. La autorización antigua de un run ya se consumió con 0.1.3 y NO autoriza éste.

## Operación exacta pendiente de autorización

1. Revalidar los disparadores remotos conocidos y detenerse ante un riesgo nuevo. Publicar el controlador como `.github/workflows/mobile-apk014.yml` únicamente en esta rama aislada; el push de ese archivo en esa rama inicia UNA ejecución. No tocar main ni el workflow TWA.
2. Usar solo runner estándar gratuito, sin facturación. Confirmar una única ejecución/intento. Si surge un coste o una segunda ejecución, detenerse.
3. Descargar exclusivamente el artefacto de ese run. Comprobar `provenance.json`, sourceSha fijado, workflowCommit/runId, SHA256, ZIP íntegro, ARM64, min24/target36, package, versión0.1.4 y code5. No transferir la firma a GitHub.
4. Con las herramientas locales existentes (`zipalign`, `apksigner`, `scripts/verify-apk.py`), alinear y firmar localmente en una ruta NUEVA usando la firma experimental protegida ya existente fuera de Git. La contraseña se lee únicamente en memoria del entorno local; no va en argumentos literales, código nuevo, logs ni paquetes. No copiar certificados privados a repositorios ni artefactos.
5. Verificar firma v2, alineación ZIP/ELF16KiB, bundle Hermes, permisos y ausencia de materiales privados/configuraciones productivas. Comparar certificado con las APK0.1.2 y0.1.3: SHA256 público `0f5d018522f61cf6098871916d2c3cba8e0c6659427a7349c41f0225a983db1b`. Ese hash es del certificado público, no de la clave privada.
6. Entregar APK nueva y SHA256 sin sobrescribir anteriores. La distribución por Drive requerirá el permiso correspondiente para un archivo privado nuevo. No instalar ni desinstalar remotamente en el teléfono.

## Comprobaciones en Motorola Edge50Pro · Android16

- Actualizar sobre0.1.3 conservando datos ficticios; package y firma deben coincidir, code5>4. Conservar ambas APK por si hiciera falta volver atrás. Android normalmente impide downgrade: no prometer reversión directa sin perder datos.
- Chat de clientes, Equipo y Mi número: escribir varias líneas, cambiar foco, abrir/cerrar teclado, cambiar tamaño del teclado y usar teclado flotante/hardware si están disponibles. Ver el texto en todo momento, sin doble espacio inferior ni desplazamiento excesivo.
- Formularios largos de Contactos, Tareas, Agenda, Agentes y Configuración; campos bajos de modales y búsquedas. Volver tras guardar/cancelar conserva el estado esperado.
- Selector: tres celdas idénticas en cada sección, indicador fluido, sin remontaje visible. Cambios rápidos y regreso desde chat mantienen filtros, consultas y scroll.
- Barra: aspecto original, ligero radio exterior, oculta con teclado, reaparece sin tapar último elemento/campo. Validar navegación por gestos y tres botones del sistema.
- Claro/oscuro, fuente grande/TalkBack y reducir movimiento: etiquetas accesibles, foco coherente y sin efectos artificiales. Comprobar transiciones nativas y rendimiento real con listas largas.
- Segundo plano, reapertura y notificaciones locales exclusivamente ficticias. No activar autenticación, backend, WhatsApp ni push remoto.

Las pruebas RN Web usan fixtures de router/sesión/storage. No certifican IME, gestos, transiciones del stack ni rendimiento nativo Android/iOS. Esos puntos permanecen pendientes hasta probar el nuevo binario. No se agregaron dependencias.
