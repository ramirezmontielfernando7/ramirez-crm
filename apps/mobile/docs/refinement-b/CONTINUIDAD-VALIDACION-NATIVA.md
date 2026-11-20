# Continuidad después del cierre 158/158

## Reanudar sin reconstruir

1. Leer CHECKPOINT-158.md, cobertura.csv, INVENTARIO-158.json y el manifiesto local artifacts/continuation-b/conservation-158.json. Verificar rama, SHA completo y árbol limpio. No confundir el commit de código con el de documentación final.
2. Conservar B original. No abrir otra etapa de funciones ni conectar servicios por haber cerrado el inventario simulado.
3. La implementación permanece exclusivamente en apps/mobile. El backend reservado sigue en 562a8b386b7f0d0df9292406167357aa988fd4d0, limpio. No arrancarlo.

## Recuperación Git, sin red

Conservar juntos el bundle completo 9e50c40 y el incremental indicado en el manifiesto; comprobar sus SHA-256 antes de usarlos. En un destino local **nuevo**, con espacio suficiente:

```sh
git clone --mirror /ruta/dashfort-completo-9e50c40.bundle /ruta/nueva-recuperacion.git
git -C /ruta/nueva-recuperacion.git bundle verify /ruta/incremental-cierre-158.bundle
git -C /ruta/nueva-recuperacion.git fetch /ruta/incremental-cierre-158.bundle refs/heads/codex/dashfort-mobile-b-continuation-20261119:refs/heads/codex/dashfort-mobile-b-continuation-20261119
git -C /ruta/nueva-recuperacion.git fsck --full
git -C /ruta/nueva-recuperacion.git rev-parse refs/heads/codex/dashfort-mobile-b-continuation-20261119
```

Los nombres del incremental de ejemplo deben sustituirse por los del manifiesto real. Comparar el SHA obtenido con ese manifiesto, no solo con un prefijo. Git no conserva APK, claves de firma ignoradas, SDK ni dependencias: recuperar esos artefactos desde sus ubicaciones privadas existentes, sin incorporarlos al repositorio ni compartirlos. No borrar la cadena anterior después de recuperar.

## APK experimental 0.1.3

**No compilar en el entorno actual**, que sigue por debajo de 1 GiB libre. El espacio disponible no permite garantizar que Gradle/R8 termine sin llenar el volumen. No se intenta ni se desactiva R8.

Preparar un entorno local aislado con al menos 10 GiB libres para SDK/cachés/salidas además del proyecto; se recomiendan 15 GiB libres y 8 GiB RAM. Es una reserva conservadora, no una medición de la futura compilación. Puede usarse desde Codex si el workspace ofrece ese volumen; en otro caso requiere un ordenador/entorno distinto. No se ha contratado ni solicitado un servicio remoto.

- Restaurar el SHA final de esta rama, apps/mobile/package-lock.json y assets locales. Mantener Expo 58.0.25 / RN 0.88.1 y dependencias compatibles actuales; no actualizar para compilar sin una causa comprobada.
- Revisar docs/APK-LOCAL.md y scripts/build-apk-local.sh. Receta actual: JDK 17 completo, Android SDK Platform 37/37.0, Build Tools 37.0.0, NDK/CMake que establezca la configuración Expo/RN generada y herramientas de verificación. SDK de compilación no equivale a versión mínima de instalación; comprobar el minSdk y el manifest del APK generado.
- Conservar identificador **com.demfort.dashfort.dev**, ARM64 arm64-v8a, nombre **0.1.3**, versionCode **4**, OTA deshabilitado, servicios remotos de notificaciones deshabilitados.
- Indicar **MOBILE_SIGNING_KEY con la ruta privada existente verificada** y una **MOBILE_APK_OUTPUT nueva**. No dejar que el script genere una clave sustituta ni sobrescribir APK anteriores. Comparar después el certificado con la APK 0.1.2 usando apksigner. No copiar claves a documentación, bundles o ZIP.
- El script rechaza un Android generado con entradas distintas. Usar una copia nativa nueva y aislada; no forzar una configuración antigua ni parchear producción. No ejecutar EAS, Actions, OTA, tienda, publicación o despliegue.
- Ejecutar TypeScript, formato y npm test; revisar manifest/APK real con aapt/apksigner/zipalign, arquitectura, versión, firma y hash. Verificar que las familias locales quedaron empaquetadas. Conservar logs y salidas en directorio nuevo.

## Validación física requerida

Motorola Edge 50 Pro, Android 16, ARM64: instalar como actualización de la firma experimental sin desinstalar 0.1.2. La TWA debe continuar coexistiendo. Confirmar primero persistencia de datos, sesión ficticia y tema legado.

Probar recorrido de las ocho vistas finales y regresión de Bandeja/Chat/Equipo/Contactos/CRM/Marketing/Configuración: teclado y compositor, borradores, scroll/anclas al regresar, historial largo, retroceso físico, modales y enlaces, rotación bloqueada, áreas seguras, TalkBack, fuentes y escalado de texto, tema/branding por usuario y menú por rol. Probar desconexión, errores, pérdida de acceso, cierre de proceso y recuperación. Medir inicio frío/caliente, memoria y listas largas; no afirmar rendimiento nativo con las mediciones web.

Las notificaciones locales T-M5B solo se prueban mediante opt-in del laboratorio; registrar permiso concedido/denegado, primer plano, segundo plano real y arranque desde un aviso. No solicitar tokens remotos. Android en segundo plano no garantiza entrega en todos los estados. iOS requiere después macOS/Xcode y dispositivo/simulador; no se acredita aquí.

## Puerta para integración real

Better Auth, backend de pruebas/PostgreSQL, roles/organizaciones reales, datos, canales/WhatsApp/Meta/CAPI, invitaciones, IA, campañas, pagos, archivos y push remoto siguen pendientes. Requieren revisión independiente del entorno y del main backend vigente, controles operativos de aislamiento y autorización antes de arrancar servicios, abrir red, migrar o conectar dispositivos a ese backend. El demo no es una autorización ni un modelo de permisos productivo.

No hacer push ni distribuir el nuevo APK sin autorización. Producción, main, Coolify, Hetzner y el worktree de auditoría quedan fuera de este cierre.
