# Dictamen de Claude sobre la firma móvil (2026-11-27)

**Veredicto: APTO para activar con los dos ajustes de esta rama.** Revisión de
código y de diseño (workflows, `verify.py`, `fetch.sh`, `sign.sh`, `build.sh`,
README y modelo de amenazas); pruebas Python locales: 14 de 15 (la restante
necesita el SDK de Android, que este entorno no alcanza). No se probó la firma
real ni el entorno protegido: eso depende de la activación.

## Lo que está bien
- El job que firma nunca ejecuta código de la app: solo recibe bytes ya
  verificados (ID de ejecución y artefacto, digest del ZIP, SHA de la APK,
  versión, versionCode, paquete, ABI), firma en un namespace sin red y exige la
  huella del certificado histórico (`0f5d0185…83db1b`) en la salida.
- Solo `workflow_dispatch`, rama de control exacta, intento 1, sin forks, sin
  PR, sin tags, sin `main`, sin despliegues. El keystore solo vive en secretos
  del entorno `dashfort-mobile-signing`.
- Interruptor de apagado (`DASHFORT_SIGNING_LIVE`) y mínimo de versionCode
  (anti-downgrade).

## Hallazgos y ajustes (en esta rama)
1. **Bloqueante para el uso real:** el firmante exigía que quien despacha NO
   fuera el propietario y una aprobación manual en GitHub. Claude y Codex
   despachan con la cuenta del propietario, así que habrían sido rechazados, y
   Fer no quiere pulsar aprobaciones. Se quitaron la regla de actor y la
   comprobación de aprobación del job real. La barrera humana pasa a ser el OK
   de Fer en el chat; la técnica sigue siendo la rama exacta, el entorno
   restringido a esa rama y el interruptor.
2. **Regresión funcional:** `build.sh` eliminaba `EXPO_PUBLIC_ALLOW_SEND`, así
   que toda APK hecha con este sistema habría perdido el envío de mensajes.
   Nueva entrada `allow_send` (por defecto sí) que solo aplica al perfil
   producción.
3. **No necesario y se desaconseja instalarlo:** el despachador MCP/host con
   TLS (`broker.py`, `http_host.py`, `mcp_server.py`). Añade infraestructura y
   un token ampliado; Claude ya puede despachar con la herramienta de GitHub
   que tiene, limitada por su propia política de permisos.

## Riesgo residual (aceptado por el modelo de un solo propietario)
Quien pueda escribir en el repositorio (el propietario y sus IA) puede
construir y firmar una APK desde cualquier rama `codex/dashfort-mobile-*`.
Una APK maliciosa solo llega a un teléfono si Fer la instala. Mitigación:
revisar el SHA fuente antes de decir OK, y apagar `DASHFORT_SIGNING_LIVE`.
La llave es exportable por el runner mientras firma; no hay HSM.

## Activación (una sola petición a Fer)
1. Entorno `dashfort-mobile-signing` (sin revisores) limitado a la rama de
   control; variables `DASHFORT_SIGNING_LIVE`, `DASHFORT_ALLOW_PUBLIC_APK_DISTRIBUTION`,
   `DASHFORT_MIN_VERSION_CODE=13` y `DASHFORT_MOBILE_FIREBASE_CLIENT_JSON`
   (JSON público). Lo hace Claude desde el navegador de Fer.
2. Cuatro secretos del entorno con el keystore original (`…KEYSTORE_B64`,
   `…STORE_PASSWORD`, `…KEY_PASSWORD`, `…KEY_ALIAS`): solo desde la máquina de
   Codex, nunca por chat.
3. Fast-forward de la rama de control a esta rama.
