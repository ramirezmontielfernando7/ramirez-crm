# APK experimental T-M4 · 0.1.1

Archivo final: `/workspace/work/apk-tm4/entrega/Dashfort-Mobile-TM4-0.1.1-Android16-ARM64.apk`.

- Tamaño: 33,593,429 bytes.
- SHA-256: `dda720189d6eb004f394dc147ebd4b29cdde85aa61382afc5162ce2e4ace68a1`.
- Identificador: `com.demfort.dashfort.dev`; versión `0.1.1` / versionCode `2`.
- Solo ARM64; mínimo API 24, objetivo API 36 (Android 16), compileSdk 37.
- Expo 58.0.24, React Native 0.88.1, React 19.3.0. JDK Temurin 17.0.21, Gradle 9.4.1, AGP 9.2.1, Build Tools 37/36, NDK 27.1.12297006, CMake 3.22.1.
- Fuente exacta: `bba69dff11d748ed68b23a666268e1842c1101af`, rama `codex/dashfort-mobile-tm4-20261111`. Los 358 archivos versionados de la copia coinciden con ese commit. La documentación posterior no cambia la fuente de ese binario.
- Certificado público SHA-256: `0f5d018522f61cf6098871916d2c3cba8e0c6659427a7349c41f0225a983db1b`, igual al de la APK T-M3 instalada. Clave privada fuera de Git.

## Verificación realizada

Ensamblado local completo: `:app:assembleRelease` y `lintVitalRelease` correctos. Una compilación incremental posterior incorporó el último ajuste de suscripción del chat; terminó correctamente, sin reemplazar la salida anterior ni la APK T-M3. No hubo EAS, Actions, servicios de pago, despliegue ni publicación.

`scripts/verify-apk.py` comprobó firma v2, certificado esperado, ID, versión, CRC y ausencia de entradas duplicadas, ABI AArch64, zipalign de 16 KB y segmentos ELF >=16 KB en 25 bibliotecas. Bundle Hermes de 4,287,940 bytes y 3 fuentes locales empaquetados. El manifiesto no es debuggable/testOnly. Sus permisos coinciden con los de T-M3.

El mapa del bundle confirma los ocho módulos T-M4 y las correcciones finales de concurrencia, caché y suscripción. Ver evidence/apk-verification.json y evidence/apk-source-audit.json. El tamaño de bundle no es una medición de memoria o fluidez.

## Instalación

1. Descargar la APK final nueva y abrirla desde Archivos/Descargas en el Motorola Edge 50 Pro.
2. Si Android lo pide, permitir instalación de apps desconocidas a la app desde la que se abrió el archivo.
3. Elegir **Actualizar** Dashfort Dev. Misma firma e ID, código 2 superior al 1 previo: se prepara como actualización de la demo instalada. La TWA tiene su instalación independiente.
4. Usar solo perfiles y datos ficticios. Debe funcionar sin Metro ni Expo Go; probar también en modo avión.

Enlace nuevo de Drive: pendiente de autorización y subida privada. No se reemplaza el archivo T-M3 ya entregado.

Para regresar al binario exacto T-M3 (código 1), Android puede exigir desinstalar Dashfort Dev por ser una versión inferior; eso borra sus datos ficticios locales. El código original y su APK se conservan. No se ejecuta ninguna desinstalación desde este entorno y no se toca la TWA.

## Prueba nativa pendiente

No hay emulador, /dev/kvm ni USB de teléfono disponibles. Se intentó enumerar con ADB, pero la herramienta no pudo crear su directorio de preferencias en /home/agent/.android, de solo lectura; no se modificó ese directorio. Por tanto no se declara instalación, instrumentación ni ejecución nativa de T-M4. La confirmación del propietario en Motorola corresponde a T-M3.

En el teléfono, comprobar teclado abierto al escribir notas/tareas/pérdida, Enter, cierre con Atrás, scroll de hojas largas y recuperación al volver a Bandeja/chat. Revisar modo oscuro, áreas seguras, gestos, reapertura de datos guardados, TalkBack y texto al 130%. Validar que notas no sean mensajes y que conexión siga siendo simulada. El checklist completo está en RESULTADOS.md. En iOS faltan compilación/instalación y QA nativo; un bundle Hermes no es una IPA.

Los avisos de APIs obsoletas de dependencias y de compatibilidad futura con Gradle 10 no impidieron la compilación; se conserva Gradle 9.4.1 probado, sin actualizar infraestructura o dependencias por iniciativa propia.
