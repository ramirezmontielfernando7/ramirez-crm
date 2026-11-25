# Firma centralizada de Dashfort Mobile

## Estado de entrega

Base de infraestructura `924abb112792a0324ac7a2ddbb3ab671000630ed`. Rama de
control propuesta `codex/dashfort-mobile-signing-20261125`. La app se toma
por SHA inmutable de una rama independiente. El build anterior de referencia
es Expo 0.2.2 en `877646e55d9809a5963127426a2834534183983c`. Esta entrega
contiene el código y el laboratorio local. Los workflows y el entorno
protegido requieren revisión y validación remota antes de cargar la clave
original. No se crea una Release ni un despliegue.

Paquete experimental `com.demfort.dashfort.dev`, solo `arm64-v8a`. El
certificado histórico se exige en la salida con esta huella SHA-256 pública.

```text
0f5d018522f61cf6098871916d2c3cba8e0c6659427a7349c41f0225a983db1b
```

## Límites y flujo auditable

1. **Build.** El job sin secretos comprueba que la rama autorizada
   `codex/dashfort-mobile-*` apunta al SHA solicitado y obtiene ese SHA,
   separado del checkout de control. Comprueba configuración Expo, ejecuta
   las pruebas, prepara Android y compila ARM64 con la firma de release
   retirada y R8 habilitado. Sube solo `unsigned.apk`. GitHub registra la
   ejecución, commit de control e ID y digest del ZIP. El resumen incluye
   el SHA-256 de la APK. El nombre de ejecución vincula el SHA de origen,
   la rama, versión, versionCode y perfil que se suministraron al workflow.
2. **Validación previa.** Una ejecución independiente exige el mismo commit
   de control, repositorio, rama y ruta de workflow, éxito, intento 1 y
   evento manual. Verifica el ID exacto de ejecución y artefacto, el digest
   del ZIP publicado en la API, su único miembro y el hash de la APK. El
   manifiesto de la APK debe coincidir en paquete, versión, versionCode y
   arquitectura. Rechaza entradas ya firmadas o con nombres de archivos
   sensibles conocidos. Muestra estos datos antes de pedir aprobación.
3. **Firma.** El runner efímero del job protegido descarga y verifica de
   nuevo el archivo aprobado. Solo obtiene el checkout de control. Ejecuta
   el paso de firma dentro de un namespace de red aislado y detiene el job
   si dicho aislamiento falla. El keystore se decodifica en un directorio
   temporal privado. Los parsers se ejecutan con entorno limpio y las
   contraseñas se pasan únicamente al proceso de firma. Se alinea antes
   de firmar, se exigen v2 y v3 válidas con un solo firmante y se coteja la
   huella histórica. La salida publicada es la APK y su checksum, con
   retención de siete días.
4. **Aprobación.** Fer revisa el resumen, abre la ejecución de compilación,
   revisa el código y verifica el SHA del binario antes de presionar
   **Review deployments → Approve and deploy**. La etiqueta de GitHub dice
   “deploy”, pero el job usa `environment.deployment: false`. GitHub
   documenta que conserva los revisores y omite el objeto de despliegue.
   Un reintento del mismo run queda bloqueado. Un nuevo run requiere una
   nueva aprobación, aunque vuelva a solicitar el mismo artefacto.

La procedencia prueba qué ejecución produjo el artefacto y con qué commit
de entrada. El build ejecuta el código de la app y sus dependencias, por
lo que un cambio malicioso puede producir un APK malicioso y correcto en
metadatos. La revisión del SHA fuente sigue siendo esencial. Esta validación
tampoco garantiza que el binario esté libre de todo secreto. Las comprobaciones
de ZIP se limitan a estructura y nombres conocidos. En un GitHub público,
tanto la APK sin firmar como la firmada se entregan como artefactos
descargables para usuarios autenticados. Este flujo es para APK
experimentales que el propietario acepte distribuir de esa forma.

## Activación posterior a la auditoría

1. Crear un ruleset de la rama de control **antes** de alojar secretos.
   Restringir creación, actualización y borrado de esa rama, exigir revisión
   humana de cambios de workflow y scripts, bloquear force-push y controlar
   todos los permisos de bypass. Solo el propietario o identidades
   mantenedoras confiables pueden administrar la regla y cambiar la rama.
   Confirmar que el repo sigue público y que los cinco workflows existentes
   y las integraciones externas mantienen su alcance. Inspeccionar los
   webhooks o solicitar confirmación al administrador si la API no los muestra.
2. Publicar solo la rama de control con autorización. El primer push que
   incluye los workflows tiene dos jobs de registro inocuos. Verificar
   que no comienzan builds, jobs de firma ni despliegues. Probar después
   `workflow_dispatch` en esa misma rama con el sistema real apagado.
   GitHub documenta que la interfaz manual requiere el archivo en la rama
   predeterminada y que la API/CLI admite ramas una vez registrado el
   workflow. El registro previo por push es un candidato que requiere
   confirmación real. Si la API/CLI rechaza el dispatch, detenerse y
   pedir autorización para resolver el registro. Esta etapa no toca main,
   ni cambia la rama predeterminada, ni presupone esa autorización.
3. Crear el entorno GitHub **dashfort-mobile-signing** con revisores
   obligatorios, Fer como revisor, prevención de autoaprobación, bypass
   administrativo apagado y lista exacta de ramas que mencione solo
   `codex/dashfort-mobile-signing-20261125`. Usar identidades
   separadas y mantener a las herramientas fuera de la lista de revisores,
   reglas de bypass y administradores. **No entregar un token Actions: write
   a una IA.** GitHub concede ese permiso para el repositorio entero y la
   TWA todavía tiene un workflow manual. Para delegación sin ese alcance,
   usar un ejecutor confiable que guarde la credencial fuera del alcance
   de las IA y solo permita solicitar estos dos workflows en la rama
   exacta, con parámetros validados. Puede ser una herramienta del sistema
   de agentes con una política real de llamadas. Si no existe ese control,
   el propietario o un operador confiable despacha las solicitudes
   preparadas por las IA. La aprobación del binario sigue en GitHub. Verificar en Settings
   y por API que una rama distinta no puede acceder al entorno. Cualquier
   workflow que pueda escribirse en la rama permitida debe tratarse como
   si tuviera acceso a la clave después de aprobación.
4. Hacer una prueba remota controlada con build inocuo y sin clave original:
   comprobar SDK, origen y hash de artefacto, espera real de aprobación,
   ausencia de eventos de despliegue, ejecución de `unshare --net` en
   Ubuntu hospedado y salidas públicas sin secretos. Para probar la etapa
   firmante completa en remoto, preparar una variante temporal revisada
   con su propio entorno y huella desechable. Quitar ese entorno después
   del ensayo. Verificar que el endpoint de historial incluye la aprobación
   aun con `deployment: false`. No eliminar el bloqueo de huella histórica de la rama real.
5. Generar y verificar el respaldo cifrado original con la identidad de
   cifrado del propietario, previa autorización. Solo después, y con
   autorización independiente, cargar por canal seguro los secretos del
   entorno `DASHFORT_MOBILE_KEYSTORE_B64`, `DASHFORT_MOBILE_STORE_PASSWORD`,
   `DASHFORT_MOBILE_KEY_PASSWORD` y `DASHFORT_MOBILE_KEY_ALIAS`. Mantener
   todos estos valores fuera de secretos de repositorio y de organización.
   No pegar valores en comandos, logs, variables públicas ni chat.
6. En el entorno, fijar `DASHFORT_MIN_VERSION_CODE` al mayor código
   distribuido, inicialmente `13` solo si sigue siendo el mayor. Se exige
   que la nueva APK lo supere. Registrar y actualizar el mínimo luego de
   una distribución. En el repositorio, definir `DASHFORT_SIGNING_LIVE`
   como `enabled` solo en el momento autorizado. El perfil por defecto es
   demo. El perfil producción usa el origen ya aprobado en la app y
   requiere el JSON **público** de cliente Android Firebase en la variable
   `DASHFORT_MOBILE_FIREBASE_CLIENT_JSON`. Nunca usar un JSON de cuenta de
   servicio. El flujo actual deja desactivado el permiso de envío móvil.
   Compilar una variante con otro perfil funcional requiere revisión.

Permitir a las IA solicitar workflows no les otorga acceso al keystore.
El límite es que el runner puede leer la clave mientras firma. La clave
es exportable y el entorno protegido no sustituye un HSM ni revoca binarios
ya firmados. El aislamiento de red y el checkout restringido reducen
exposición. Se deben mantener revisados los scripts, acciones fijadas y
la imagen hospedada. Si se suspende la firma, apagar el interruptor,
cancelar jobs en espera o activos, retirar los secretos y revocar las
credenciales de las identidades delegadas. Conservar el respaldo cifrado.

## Solicitar desde Claude o Codex

Una vez habilitado y validado el lanzamiento desde esta rama, las IA
entregan los campos al ejecutor autorizado. Solo ese ejecutor, o el
operador autorizado, utiliza la credencial. El ejemplo usa valores
de una próxima versión de demostración. Sustituir rama, SHA y versión
por el commit revisado que declara esos metadatos en Expo.

```bash
repo=ramirezmontielfernando7/ramirez-crm
control=codex/dashfort-mobile-signing-20261125
gh workflow run mobile-expo-build.yml -R "$repo" --ref "$control" \
  -f source_branch="$source_branch" -f source_sha="$source_sha" \
  -f version=0.2.3 -f version_code=14 -f profile=demo

# Tomar los identificadores y el SHA-256 del resumen de la compilación.
gh workflow run mobile-expo-sign.yml -R "$repo" --ref "$control" \
  -f build_run_id="$build_run_id" -f artifact_id="$artifact_id" \
  -f apk_sha256="$unsigned_sha256" -f source_sha="$source_sha" \
  -f version=0.2.3 -f version_code=14 -f profile=demo
```

Fer puede aprobar desde GitHub sin descargar o firmar localmente. Tras
aprobación, descargar el artefacto firmado de la ejecución de firma.
Inspeccionar su checksum y firmante. Rechazar el pedido ante discrepancias
y repetir desde una ejecución de compilación confiable. Cambiar los
workflows de control invalida el uso de los artefactos anteriores por
diseño. Se debe recompilar desde el nuevo commit de control.

## Respaldo cifrado y recuperación

La herramienta `scripts/mobile-signing/backup.sh` cifra el archivo
original con una clave pública OpenPGP del propietario ya importada en un
llavero seleccionado. Antes de invocarla, comprobar la huella OpenPGP por
un canal independiente y cotejar el certificado del alias Android con
la huella histórica. El script transmite el tar directo al cifrador, crea
solo el archivo cifrado y rechaza sobrescribir un respaldo. Se ensayó con
un destinatario y keystore desechables. El respaldo original sigue
pendiente de una identidad OpenPGP del propietario y de autorización
explícita para producirlo y llevarlo al almacenamiento acordado.

Conservar el cifrado y su checksum en una cuenta privada del propietario
y en un medio offline. Guardar credenciales del almacén, alias y método de
recuperación OpenPGP en el gestor del propietario, separado de ambas
copias. Para recuperar, verificar checksum, listar el único miembro del
tar, descifrar en un directorio privado y comparar certificado con la
APK 0.2.2 mediante `keytool` y `apksigner verify --print-certs`. Verificar
acceso a la entrada privada. Solo después de esta prueba se puede
recrear un entorno de firma. Conservar el original y la APK de control.

## Evidencia y límites de esta rama

```bash
for script in scripts/mobile-signing/*.sh; do bash -n "$script"; done
actionlint .github/workflows/mobile-expo-build.yml .github/workflows/mobile-expo-sign.yml
LAB_ANDROID_TOOLS=/ruta/sdk/build-tools/37.0.0 \
LAB_ANDROID_JAR=/ruta/sdk/platforms/android-37.0/android.jar \
PYTHONDONTWRITEBYTECODE=1 python3 scripts/mobile-signing/test.py
```

El laboratorio usa una APK Android mínima ARM64 generada por AAPT2. Prueba
con herramientas Android reales la firma, alineación, esquemas v2/v3,
APK y checksum de salida. Prueba tráfico de datos simulado de GitHub y
rechazos de origen, intento, ID, hash, ZIP, paquete, versión, firma
preexistente y certificado incorrecto. Un respaldo cifrado efímero se
descifra y se compara byte por byte con su entrada. No se corrió un
build completo de Expo, ni se ejercitó el aprobador o el namespace de
GitHub hospedado. Los datos reales de GitHub se consultaron solo en
lectura para confirmar la estructura de metadatos del run 0.2.2.

Referencias oficiales de GitHub sobre [registro manual](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch),
[entornos sin objetos de despliegue](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
y [digest del ZIP de artefactos](https://docs.github.com/en/rest/actions/artifacts).
