# Primera APK probada en teléfono

Fuente exacta: rama `codex/dashfort-mobile-tm3-20261111`, commit `d849c0dcfbb1fe2a426d1f9a79af817922e0d068`. Los 338 archivos móviles coincidían con Git al compilar. T-M1 y T-M2 son ancestros. No hubo cambios de pantallas al generar la APK.

Archivo conservado sin reemplazar: `/workspace/work/apk-tm3/entrega/Dashfort-Mobile-TM3-Android16-ARM64.apk` (33.527.969 bytes).
SHA-256: `65f933d9721b7bcac2a5c957e175cb7e3da517875282f306e738bee42dc85c2f`.
Copia privada entregada: https://drive.google.com/file/d/13a4MkdTM8sO2lN6LrgO94IZ0UZyCJJtC/view . No se cambia este archivo ni sus permisos.

El propietario confirmó instalación y prueba satisfactoria en Motorola Edge 50 Pro, Android 16, ARM64. Es una validación inicial general reportada por el usuario, no un registro automatizado de todos los recorridos. Teclado, gestos, scroll, accesibilidad y rendimiento detallados siguen requiriendo QA. Los logs originales reflejan el estado anterior a esa confirmación.

Identidad `com.demfort.dashfort.dev`, Dashfort Dev, versión 0.1.0 / código 1, minSdk 24, targetSdk 36, compileSdk 37. Firma APK v2, ELF/ZIP alineados a 16 KB, 25 bibliotecas ARM64, Hermes y tres fuentes empaquetados. Lint vital, TypeScript y 37 pruebas de lógica aprobaron. Sin backend, WhatsApp real, OTA o datos productivos.

## Configuración que faltaba conservar en Git

El script anterior abortaba por buscar solo `platforms/android-37`, pero Google distribuye `platforms;android-37.0`. El entorno también tenía un runtime Java 21 sin javac. Se terminó usando un JDK 17 completo (Temurin 17.0.21), Gradle 9.4.1, AGP 9.2.1, Build Tools 37.0.0 y 36.0.0, NDK 27.1.12297006 y CMake 3.22.1. Node 24 y el lockfile móvil se conservaron.

La compilación fue local en una copia limpia de apps/mobile, con prebuild Android nuevo. Se usó `scripts/android-lean.gradle` (-O2 y -g0) y un worker para limitar espacio/memoria. Hubo recortes de herramientas/arquitecturas opcionales y deduplicación de cachés temporales; no forman parte del código ni son requisitos del producto. Para reproducir sin estos recortes, usar al menos 15 GB libres, SDK completo y JDK 17. Mantener TLS; en el entorno gestionado se usó el almacén CA del sistema.

Orden equivalente, desde el Android generado de una copia limpia:

```bash
./gradlew :app:assembleRelease --no-daemon --max-workers=1 -PreactNativeArchitectures=arm64-v8a --init-script ../scripts/android-lean.gradle
```

La firma experimental original se conserva únicamente en `/workspace/work/apk-tm3/signing/dashfort-experimental.keystore`, fuera de Git y fuera del respaldo publicable. Su certificado público SHA-256 es `0f5d018522f61cf6098871916d2c3cba8e0c6659427a7349c41f0225a983db1b`. Para actualizar la app instalada hay que reutilizar esa clave y aumentar versionCode. Si se pierde la clave, puede recompilarse la demo con otra firma, pero habría que desinstalar la anterior. Ningún certificado privado o contraseña productiva se añade a Git.

La referencia original recupera exactamente las fuentes probadas. Este checkpoint añade receta y comprobaciones, no redefine el commit del binario. Una recompilación equivalente no garantiza igualdad byte a byte: timestamps, rutas y firma influyen. El APK original y su hash son la referencia binaria exacta.

Respaldo de código T-M3: ya remoto. Receta/checkpoint: local hasta recibir autorización nueva de push. No se hizo push, tag, PR, merge, despliegue ni publicación para conservar esta fase.
