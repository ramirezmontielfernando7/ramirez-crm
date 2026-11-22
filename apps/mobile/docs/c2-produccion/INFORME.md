# C2 · Dashfort Mobile 0.1.6

Rama `codex/dashfort-mobile-c2-produccion-20261121` desde `b67d14cd7c4963fcc6d0f20cb1b458cec383da4b`. Versión 0.1.6, versionCode 7 y paquete `com.demfort.dashfort.dev`. Los cambios están en `apps/mobile`. La app sigue preparada para la misma firma experimental.

## Qué cambió

- `EXPO_PUBLIC_MODE=production` exige el valor literal `EXPO_PUBLIC_API_URL=https://dash.demfort.com`. La configuración inválida muestra un error antes de cargar la sesión o el formulario. En staging sigue bloqueado el host de producción y sus subdominios. Sin modo definido se abre demo.
- El transporte remoto comprueba el método y la ruta antes de llamar a la red. Admite GET para Bandeja e historial y POST para login y revocación. Bandeja solo admite los parámetros `limit` y `cursor` del lector. Las solicitudes usan Bearer después del login, omiten cookies y rechazan redirecciones. Envío, adjuntos, IA, CRM, agenda y campañas permanecen en el alcance demo.
- Más muestra la versión y «Conectado a Dashfort» o «Entorno de pruebas». Los modos remotos comparten las pantallas de la 0.1.5 y los componentes B. El selector, el teclado y la barra inferior conservan su comportamiento.
- Producción y staging tienen claves y servicios de SecureStore separados. Se mantienen las exclusiones de respaldo y transferencia en Android. El cierre borra la sesión local y solicita su revocación. Una caducidad local, un 401 en una lectura o un 403 de empresa suspendida borran la sesión y abren el login con el aviso correspondiente. Un 429 o una falta de red permiten reintentar. Los errores del servidor se traducen a mensajes controlados sin incluir el contenido de su respuesta.

## Verificación

- El gate de `apps/mobile` pasó completo. TypeScript, formato, 621 pruebas y trazabilidad de los 158 IDs.
- Las pruebas incluyen origen literal, staging, modo demo por defecto, combinaciones de métodos y rutas, cursor, aislamiento de credenciales, revocación, caducidad y respuestas 401, 403 y 429. El transporte se probó con fixtures locales.
- Una comprobación de RN Web en Chromium con SecureStore y transporte simulados confirmó que se bloquea la configuración inválida, que 401 y suspensión devuelven al login, y que se muestran los avisos de 429 y sin red. Confirmó también las dos etiquetas de Más y el cierre de sesión. Chromium bloqueó toda solicitud externa y registró cero.
- La regresión demo del diseño B pasó en Chromium con 70 capturas locales, ambos temas, cero errores y cero solicitudes externas.
- Expo introspect verificó versión, paquete y referencias de manifiesto a las dos reglas de respaldo de SecureStore. El código de firma y las dependencias del proyecto se mantienen.

## Límites y reversión

La restricción de solo lectura se aplica en este cliente. El servidor sigue siendo responsable de autorizar cada solicitud según la sesión y los permisos existentes. Una suspensión detectada por el servidor se refleja en la próxima lectura. Si el teléfono está sin red al cerrar sesión, se elimina la credencial local y la app avisa que la revocación remota quedó sin confirmar.

Faltan la instalación nativa y la comprobación de conectividad con el despliegue de producción. El trabajo se probó solo con datos ficticios. La preparación del binario corresponde a Claude después de auditar esta rama y comprobar la fusión del PR #293. No se compiló una APK.

Para revertir el acceso, preparar la siguiente versión con el modo demo o staging y su configuración correspondiente. Para revertir el código, usar la base `b67d14c` o revertir el commit C2. Si ya se instaló una versión con code 7, la APK de reemplazo debe conservar paquete y firma y usar un versionCode mayor para actualizar sin desinstalar.
