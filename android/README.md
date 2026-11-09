# App Android (TWA)

Envuelve https://dash.demfort.com (PWA) como app de Android con Bubblewrap.
Se construye a mano en GitHub: Actions → «Android (APK y AAB)» → Run workflow.
Secretos necesarios del repositorio: `ANDROID_KEYSTORE_B64` (llave de firma en base64)
y `ANDROID_KEY_PASSWORD`. La huella SHA-256 de esa llave está en
`public/.well-known/assetlinks.json` (así se quita la barra de URL).
Si Play Store re-firma la app, añade ahí también la huella de Google.
NUNCA subas el `.jks` al repositorio.
