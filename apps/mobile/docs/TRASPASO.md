# Traspaso de Dashfort Mobile

## Punto de partida

Dashfort Mobile vive en `apps/mobile`. Usa Expo 58 y React Native 0.88.1. El
paquete Android es `com.demfort.dashfort.dev` y la distribución experimental usa
`arm64-v8a`. La TWA tiene su propio flujo y certificado.

La última APK firmada confirmada en este traspaso es **0.2.2 (código 13)**. C12
preparó **0.2.3 (código 14)** con citas y reacciones en Clientes y respuesta de
texto en Mi número. Su build de referencia fija el código fuente en
`a6678c222ac5b1eb8c07ea31ae02cad8c5dae3da`. El informe de C12 registra 713
pruebas aprobadas, TypeScript, formato e inventario 158/158. Las capturas son
de QA web con datos ficticios. [Informe de C12](c12/INFORME.md) ·
[Código fuente fijado](https://github.com/ramirezmontielfernando7/ramirez-crm/tree/a6678c222ac5b1eb8c07ea31ae02cad8c5dae3da/apps/mobile)

## Compilar Android

**Por GitHub Actions.** Abre la ejecución de Expo, comprueba que terminó con
éxito y descarga el artefacto `dashfort-expo-023-unsigned-46096689563` desde
**Artifacts** mientras siga disponible. Coteja `provenance.json` con el SHA de
fuente, el run, el paquete, la versión, el código y la arquitectura. Comprueba
el SHA-256 de la APK contra el archivo del artefacto antes de firmar.
La receta de 0.2.3 usa el perfil producción con envío habilitado. El run
enlazado **falló antes de generar el artefacto**. Gradle 9 no resolvió
`org.gradle.toolchains.foojay-resolver-convention:1.0.0` en los settings del
plugin de React Native. La bitácora confirma el fallo de resolución, pero la
causa de fondo sigue pendiente. Compilar ese perfil puede hacerse en un
runner aislado. Su prueba funcional requiere autorización y datos de prueba. [Ejecución 0.2.3](https://github.com/ramirezmontielfernando7/ramirez-crm/actions/runs/46096689563) ·
[Workflow de referencia](https://github.com/ramirezmontielfernando7/ramirez-crm/blob/1e389430f0a13f7d1f4e3897898172c33067a85a/.github/workflows/mobile-apk023.yml)

**En una máquina de compilación.** Usa Linux con Node.js 24.22.1, JDK 17, Android
SDK Command-line Tools, Python 3 y 8 GiB libres como mínimo al iniciar. El
script instala Android Platform 37.0, Build Tools 37.0.0 y 36.0.0, NDK
27.1.12297006 y CMake 3.22.1. La siguiente receta genera la variante **demo**,
con datos ficticios. Introduce un `ANDROID_HOME` válido antes de ejecutarla.

```bash
set -euo pipefail
: "${ANDROID_HOME:?Configura la ubicación del Android SDK}"
export ANDROID_HOME
BUILD_ROOT=$(mktemp -d "$HOME/dashfort-build.XXXXXX")
REPO_URL=https://github.com/ramirezmontielfernando7/ramirez-crm.git
export SOURCE_SHA=a6678c222ac5b1eb8c07ea31ae02cad8c5dae3da
CONTROL_SHA=688ea066b797450a319e43f755fee28db81c5884
git clone --filter=blob:none --no-checkout "$REPO_URL" "$BUILD_ROOT/source"
git -C "$BUILD_ROOT/source" fetch --no-tags origin "$SOURCE_SHA" "$CONTROL_SHA"
git -C "$BUILD_ROOT/source" checkout --detach "$SOURCE_SHA"
git -C "$BUILD_ROOT/source" worktree add --detach "$BUILD_ROOT/control" "$CONTROL_SHA"
export GITHUB_WORKSPACE="$BUILD_ROOT"
export RUNNER_TEMP="$BUILD_ROOT/run"
export GITHUB_STEP_SUMMARY="$RUNNER_TEMP/resumen.md"
export VERSION_NAME=0.2.3 VERSION_CODE=14 EXPO_PUBLIC_MODE=demo
export CI=1 EXPO_NO_TELEMETRY=1
mkdir -p "$RUNNER_TEMP"
bash "$BUILD_ROOT/control/scripts/mobile-signing/build.sh"
sha256sum "$RUNNER_TEMP/dashfort-build/unsigned.apk"
```

El script comprueba el lockfile, ejecuta las pruebas y genera un Android limpio
con Expo prebuild. Gradle usa R8 y produce solo
`$RUNNER_TEMP/dashfort-build/unsigned.apk`. Para repetir la variante de
producción autorizada, seguir el workflow fijado o usar
`EXPO_PUBLIC_MODE=production`, `ALLOW_SEND=true` y el JSON público de cliente
Android de Firebase en `PUBLIC_FIREBASE_CLIENT`. La configuración de cliente
de Firebase puede estar dentro del binario. Las claves de cuenta de servicio
deben permanecer fuera de la compilación. [Script de compilación](https://github.com/ramirezmontielfernando7/ramirez-crm/blob/688ea066b797450a319e43f755fee28db81c5884/scripts/mobile-signing/build.sh)

## Firmar con el respaldo cifrado

El respaldo `bundle.tgz.age` se creó para la clave pública age del propietario.
Se entregó cifrado en la conversación del 27 de noviembre y existe una copia
cifrada en Codex Cloud. Para recuperarlo se necesita la **identidad privada
age correspondiente**, bajo control del propietario. El archivo contiene
`dashfort-mobile.jks` y `claves.txt`. Guarda el cifrado y la identidad age
por separado. La restauración en otra máquina con esa identidad aún no está
confirmada.

| Comprobación | SHA-256 esperado |
| --- | --- |
| Archivo `bundle.tgz.age`, con su salto de línea final | `4471c25fd688d1107ab25f92119ba70f5ef412043154adcbea553e1a8dd63968` |
| Certificado Android de la APK 0.2.2 y del keystore recuperado | `0f5d018522f61cf6098871916d2c3cba8e0c6659427a7349c41f0225a983db1b` |

En una máquina de confianza con disco cifrado, instala age y usa el checkout
de control y Android Build Tools 37.0.0. Define las rutas `BACKUP`,
`AGE_IDENTITY_FILE`, `UNSIGNED_APK` y `CONTROL_CHECKOUT`. Define
`UNSIGNED_SHA256` a partir del artefacto de build comprobado y
`SIGNED_OUTPUT` como una carpeta privada nueva. Para otro número de
versión, actualiza los dos argumentos de versión y coteja el manifiesto.

```bash
(
  set +x
  set -euo pipefail
  umask 077
  CERT_SHA256=0f5d018522f61cf6098871916d2c3cba8e0c6659427a7349c41f0225a983db1b
  BACKUP_SHA256=4471c25fd688d1107ab25f92119ba70f5ef412043154adcbea553e1a8dd63968
  scratch=$(mktemp -d)
  trap 'rm -rf -- "$scratch"' EXIT
  printf '%s  %s\n' "$BACKUP_SHA256" "$BACKUP" | sha256sum --check
  printf '%s  %s\n' "$UNSIGNED_SHA256" "$UNSIGNED_APK" | sha256sum --check

  age -d -i "$AGE_IDENTITY_FILE" "$BACKUP" |
    tar -xzf - -C "$scratch" --no-same-owner --no-same-permissions -- dashfort-mobile.jks claves.txt

  unset MOBILE_STORE_PASSWORD MOBILE_KEY_PASSWORD MOBILE_KEY_ALIAS
  while IFS='=' read -r nombre valor; do
    case "$nombre" in
      DASHFORT_MOBILE_STORE_PASSWORD) export MOBILE_STORE_PASSWORD="$valor" ;;
      DASHFORT_MOBILE_KEY_PASSWORD) export MOBILE_KEY_PASSWORD="$valor" ;;
      DASHFORT_MOBILE_KEY_ALIAS) export MOBILE_KEY_ALIAS="$valor" ;;
      *) exit 1 ;;
    esac
  done < "$scratch/claves.txt"
  unset nombre valor
  : "${MOBILE_STORE_PASSWORD:?}" "${MOBILE_KEY_PASSWORD:?}" "${MOBILE_KEY_ALIAS:?}"

  recovered=$(keytool -exportcert -alias "$MOBILE_KEY_ALIAS" \
    -keystore "$scratch/dashfort-mobile.jks" -storepass:env MOBILE_STORE_PASSWORD |
    sha256sum | cut -d ' ' -f 1)
  test "$recovered" = "$CERT_SHA256"

  MOBILE_KEYSTORE_B64=$(base64 -w0 "$scratch/dashfort-mobile.jks")
  export MOBILE_KEYSTORE_B64
  bash "$CONTROL_CHECKOUT/scripts/mobile-signing/sign.sh" \
    "$UNSIGNED_APK" "$UNSIGNED_SHA256" 0.2.3 14 "$CERT_SHA256" \
    "$SIGNED_OUTPUT" "$ANDROID_HOME/build-tools/37.0.0"
  cd "$SIGNED_OUTPUT"
  sha256sum --check Dashfort-Mobile-0.2.3-ARM64-signed.apk.sha256
)
```

El firmante alinea para páginas de 16 KiB, firma con v2/v3 y valida el
certificado, el manifiesto, ARM64 y el contenido de la APK. Conserva la APK
firmada y su checksum. La identidad age, el keystore y las contraseñas quedan
fuera del repositorio y de los artefactos públicos. [Script de firma](https://github.com/ramirezmontielfernando7/ramirez-crm/blob/688ea066b797450a319e43f755fee28db81c5884/scripts/mobile-signing/sign.sh)

## Pendientes y entrega

- **APK 0.2.3.** Resolver el fallo de Gradle y obtener un run exitoso.
  Comprobar la disponibilidad del plugin Foojay desde el runner y sus
  repositorios de resolución antes de cambiar el toolchain. Firmar solo el
  artefacto verificado y probar la actualización sobre la 0.2.2 en el Motorola
  Edge 50 Pro.
  La compatibilidad requiere conservar paquete y certificado, y aumentar
  `versionCode`. Instalar sobre la versión anterior y comprobar que conserva
  los datos. La prueba física de C12 y WhatsApp de prueba sigue pendiente.
- **Firma centralizada.** Se validó en GitHub el build, la firma con clave
  desechable, la descarga y el rechazo de un hash inválido. El entorno solo
  admite la rama protegida `codex/dashfort-mobile-signing-20261125`. La
  integración de Codex recibió HTTP 403 al consultar los secretos del entorno.
  No se ha confirmado la carga definitiva ni una firma con el certificado
  histórico desde Actions. Para esa ruta, compilar mediante el workflow
  centralizado y con el mismo commit de control que verificará el firmante.
  El artefacto histórico del workflow 0.2.3 puede firmarse con el procedimiento
  local anterior. [Evidencia y activación](https://github.com/ramirezmontielfernando7/ramirez-crm/tree/688ea066b797450a319e43f755fee28db81c5884/docs/mobile-signing)
- **Respaldo.** Conserva una copia privada fuera de Codex Cloud y valida la
  recuperación con la identidad age del propietario. Mantén la copia
  cifrada existente hasta completar la prueba.
- **Servidor y distribución.** C12 consume el contrato C11 de citas y
  reacciones. El código de C11 figura en `main`. Este traspaso no acredita
  el despliegue ni la aplicación de la migración 0082 en producción. Antes
  de una prueba real, confirmar el estado del servidor y usar un chat propio
  de prueba. La app, el backend y la TWA requieren sus autorizaciones
  respectivas para cualquier cambio operativo.
