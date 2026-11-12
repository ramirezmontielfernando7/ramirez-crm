# APK Android local · estado vigente

La primera APK T-M3 ya fue compilada, entregada y probada por el propietario en Motorola Edge 50 Pro / Android 16. Consultar `apk-probada/VERSION.md` para hash, commit y validación. Las notas antiguas de falta de SDK que siguen abajo son históricas.

Para nuevas compilaciones: JDK 17 completo (java, javac y jlink), SDK `platforms;android-37.0`, Build Tools 37.0.0 y 36.0.0, NDK 27.1.12297006, CMake 3.22.1 y al menos 15 GB libres. Usar copia limpia sin android generado; el script conserva proyectos existentes y exige una huella de configuración coincidente.

`MOBILE_APK_OUTPUT` debe apuntar a una ruta nueva; nunca se reemplaza una APK existente. `MOBILE_SIGNING_KEY` puede señalar la clave experimental anterior, que se mantiene fuera de Git. Para los flags de la primera APK usar `MOBILE_ANDROID_LEAN=1`. No introducir claves de producción. El script no realiza instalaciones en teléfono, envíos o publicaciones. Reproducir la primera APK exige checkout d849c0d y la receta preservada; nuevas versiones usan las fuentes de su propia rama y un versionCode superior.

---

# APK experimental local

Estado de esta ejecución: **APK no generada**. `npm run apk:local` salió con código 2 porque no existe Android SDK Platform 37. Hay Java 21, pero no SDK, adb ni emulador. El prebuild Android sí se generó correctamente en `apps/mobile/android` (ignorado por Git). No se usó EAS ni otra compilación remota.

Identidad: `com.demfort.dashfort.dev`, nombre `Dashfort Dev`, esquema `dashfort-dev`. La TWA usa `com.demfort.dashfort`: las dos aplicaciones pueden convivir. OTA desactivada; sin permisos de cámara, micrófono, contactos o notificaciones en esta fase.

En un entorno de desarrollo con SDK y recursos suficientes:

1. Node 24, npm y JDK 17. Instalar desde Android Studio o Android Command-line Tools: `platform-tools`, `platforms;android-37`, `build-tools;37.0.0`, `ndk;27.1.12297006` y `cmake;3.22.1`. Aceptar las licencias del SDK y definir `ANDROID_HOME` con su ruta local. Versiones de SDK derivadas de React Native 0.88.1; conservar `package-lock.json`.
2. Entrar a `apps/mobile` (o a la raíz del ZIP móvil) y ejecutar:

   ```bash
   npm ci
   npm run typecheck
   npm test
   npm run apk:local
   ```

3. El script genera el proyecto nativo si falta, crea una clave **experimental nueva** en `artifacts`, compila `assembleRelease` con esa firma local y copia la APK a `artifacts/dashfort-mobile-experimental.apk`. Aunque Gradle llama a la variante «release», el nombre, ID y certificado son de desarrollo; no publica una Release ni una app en ninguna tienda. El JavaScript y las fuentes se empaquetan para funcionar sin Metro.
4. Verificar el archivo y su identidad antes de instalar:

   ```bash
   sha256sum artifacts/dashfort-mobile-experimental.apk
   "$ANDROID_HOME/build-tools/37.0.0/aapt" dump badging artifacts/dashfort-mobile-experimental.apk
   "$ANDROID_HOME/build-tools/37.0.0/apksigner" verify --print-certs artifacts/dashfort-mobile-experimental.apk
   ```

5. Instalar únicamente en un teléfono/emulador de prueba mediante el instalador Android o `adb install -r artifacts/dashfort-mobile-experimental.apk`. La instalación **no se ejecutó** en esta sesión.

El primer build descarga dependencias públicas de Gradle/Maven y puede tardar varios minutos. No consume cuotas EAS. Si falla, conservar el log y corregir el entorno antes de considerar un servicio remoto. No usar el workflow Android existente: publica la TWA y una Release con firma productiva.

El script conserva proyectos nativos existentes y aborta si cambia la configuración de firma esperada. Después de cambiar plugins de Expo, regenerar el prebuild en una copia limpia; no usar `--clean` sobre trabajo nativo propio. Las claves experimentales y los directorios nativos generados no se incluyen en Git ni en el ZIP.

iOS: el bundle JavaScript puede validarse en Linux. La compilación IPA, simulador, firma, llavero y prueba física requieren macOS/Xcode; no se realizaron. No se habilitaron APNs/FCM ni se registraron dispositivos.

## Actualización T-M3
El intento local sigue saliendo con código 2 por ausencia de Platform 37. Los exports Hermes de T-M3 no generan un ejecutable instalable. La revisión de dependencias actualizó los parches compatibles de Expo 58 y añadió el plugin local `expo-status-bar`. Para obtener una APK de esta etapa, usar un checkout limpio de la rama T-M3 o el ZIP de fuentes, sin copiar `android`/`ios` generados de T-M1/T-M2. Así `apk:local` genera el proyecto con la configuración vigente y conserva proyectos nativos propios en otras copias. El nombre de salida ya es genérico (`dashfort-mobile-experimental.apk`). Falta ejecutar e instalar esta compilación, probar teclado/gestos/Back/accesibilidad/scroll en Android, y hacer QA iOS en macOS/Xcode. No se utilizó compilación remota ni cuota compartida.

## Verificar un artefacto sin modificarlo

`scripts/verify-apk.py` revisa el ID de desarrollo, target Android 16, ABI ARM64, firma v2, certificado público esperado, CRC, zipalign de 16 KB, segmentos ELF AArch64, bundle Hermes y fuentes. Requiere Python 3.11+ y Build Tools 37.0.0; no instala ni vuelve a firmar el APK.

```bash
python scripts/verify-apk.py /ruta/nueva.apk \
  --sdk "$ANDROID_HOME" \
  --certificate 0f5d018522f61cf6098871916d2c3cba8e0c6659427a7349c41f0225a983db1b
```

La huella anterior es pública y corresponde a la firma experimental usada en la APK T-M3 instalada. La clave privada queda fuera de Git. T-M4 utiliza versión 0.1.1 / versionCode 2 y el mismo ID, para actualizar Dashfort Dev sin sustituir la TWA. Ver tm4/APK-TM4.md para el artefacto y las limitaciones de validación. No confundir la validación estática con instalación/ejecución en un dispositivo.
