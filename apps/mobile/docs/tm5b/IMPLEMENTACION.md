# T-M5B · Avisos locales Android

Rama aislada `codex/dashfort-mobile-tm5b-20261114`, derivada exactamente de T-M5A `3b85b3bcc0f0039108b7d625541b55c612d6b636`. Conserva T-M1…T-M4 y sus pantallas aprobadas. Únicamente `apps/mobile`. Sin push, backend, servicios de envío, credenciales Firebase/APNs, EAS, OTA ni T-M5C.

## Compatibilidad y alcance

Expo pasa de 58.0.24 a 58.0.25: parche dentro del SDK 58 recomendado por el comprobador oficial; React Native sigue en 0.88.1 y React en 19.3.0. Se conserva la matriz de módulos nativos del SDK. `expo install --check` pasa. No se atribuyen al parche correcciones específicas sin evidencia de changelog. La justificación es alinearse con el parche recomendado y verificar la regresión de esta app.

Se añade `expo-notifications ~58.1.9` y sus dependencias oficiales resueltas en package-lock. No se añaden TaskManager, BackgroundTask, servicios foreground, alarmas exactas ni procesos persistentes. La biblioteca incluye dependencias nativas Firebase; esto no configura un proyecto Firebase ni activa envíos remotos.

El plugin local desactiva auto-inicialización de Firebase Messaging/Analytics y retira los servicios de transporte Messaging del manifiesto fusionado. Sin google-services.json ni identificadores de proyecto. La API de registro automático de Expo se desactiva al consultar permisos; nunca se invocan las APIs de tokens ni suscripciones a temas. En iOS el plugin desactiva los entitlements APNs y los modos remotos. Las pruebas locales de esta etapa están habilitadas exclusivamente en Android; web/iOS informan `unsupported`.

## Separación de transportes

- T-M5A conserva sus controles, permiso y token **ficticios**. No conceden permiso Android ni envían al sistema.
- `local.ts` coordina exclusivamente muestras locales con `LocalPort`. El permiso Android es independiente del permiso simulado.
- `local-port.native.ts` adapta las APIs del sistema, canal, avisos, respuesta inicial y pulsaciones posteriores. `local-port.ts` bloquea emisiones y permisos en web.
- `LocalContext.tsx` conecta el adaptador al ciclo de sesión y primer plano. El laboratorio existente incorpora sus únicos controles visibles. En `/demo` se añade acceso al laboratorio, sin cambiar las pantallas T-M1…T-M4.
- Push remoto sigue sin implementar ni configurar. No basta activar una URL o cambiar un prefijo para integrarlo.

## Permisos y batería

Canal `dashfort-local-demo-v1`, importancia DEFAULT, sin sonido, vibración ni badge, privacidad PRIVATE. Se mantiene VIBRATE bloqueado. POST_NOTIFICATIONS se solicita solo pulsando «Solicitar permiso Android». Denegación/bloqueo nunca impide usar Bandeja/Chat. Se consulta el canal y el permiso al volver a primer plano. Un canal ya configurado por el usuario conserva las decisiones de Android.

Las muestras usan alarmas no repetitivas con demoras de 1 o 15 segundos; **son aproximadas**, no una garantía de puntualidad. SCHEDULE_EXACT_ALARM y USE_EXACT_ALARM están bloqueados. Android puede agrupar o retrasar la alarma con Doze/ahorro de batería. No hay polling ni ejecución JS permanente. El receptor de reinicio incluido por Expo permite manejar las alarmas locales; no es un servicio permanente.

## Seguridad, persistencia y navegación

Contenido fijo: «Dashfort» / «Tienes un aviso nuevo en Dashfort». Los datos del aviso solo contienen el tipo de transporte y eventId ficticio; no contienen texto de chat, nombres, URLs, usuario o ruta. La agrupación utiliza threadIdentifier por conversación y un identificador nativo determinista por organización/conversación. Una muestra nueva reemplaza la anterior de ese chat; esto no promete una UI idéntica del sistema en todos los fabricantes.

El registro AsyncStorage contiene hasta 128 muestras ficticias y su propietario, evento tipado y marca de programación. Se guarda antes de programar. La cola serializa emisiones/pulsaciones/limpieza; reintentar una programación de resultado incierto reutiliza el mismo ID nativo. La deduplicación por evento y el ledger persistido T-M5A evitan emisiones y aperturas repetidas.

Al reiniciar el proceso se reconstruye la fuente canónica de demostración desde el registro antes de asignar identidad o procesar la respuesta inicial. El payload nativo nunca define su propia autoridad: solo permite buscar una muestra previamente registrada. Se vuelven a verificar TTL, tipo elegible, usuario, organización, pertenencia y acceso de Bandeja, también después de esperas asíncronas. El destino pasa por `store.tap` y su comprobación de router listo, sincronización simulada y autorización. No se aceptan rutas arbitrarias.

Cerrar sesión, cambiar de cuenta/organización o perder pertenencia retira muestras no autorizadas y revoca sus destinos. La Bandeja sigue siendo de organización A: un aviso B se rechaza y nunca abre un chat A. En una app sin proceso activo no puede ejecutarse una revocación inmediata; el contenido genérico reduce exposición y se revalida antes de abrir. El registro se puede limpiar desde el laboratorio. Una muestra descartada no se reenvía automáticamente al recuperar permisos.

Un fallo del registro local deshabilita las pruebas locales y muestra un diagnóstico en el laboratorio; no bloquea la sesión ni la app existente. No se guardan credenciales, certificados ni tokens reales en el registro.

## Límites

No hay emulador, teléfono conectado ni Xcode. Las pruebas con un puerto falso validan lógica, no recepción del sistema. Las capturas son React Native Web. No se afirma prueba de segundo plano, cold start nativo, Doze, consumo, TalkBack, sonido o instalación. El usuario debe comprobarlos en Motorola. La fuerza de detención, reinicio, restricciones del fabricante, revocación y batería pueden impedir o retrasar avisos. No es un servicio de mensajería real.

## Receta local de APK

En una copia limpia del commit fuente, ejecutar `npm ci` y `npm run apk:local` con JDK 17 completo, SDK Platform 37/Build Tools 37, NDK 27.1.12297006, CMake 3.22.1 y las variables `MOBILE_SIGNING_KEY` (ruta local a la firma experimental conservada), `MOBILE_ANDROID_ABIS=arm64-v8a`, `MOBILE_ANDROID_LEAN=1` y `MOBILE_APK_OUTPUT` apuntando a un archivo nuevo. El script no sobrescribe salidas y genera el proyecto Android desde app.json/plugins/lockfile. Nunca versionar la clave ni sustituirla por una nueva si se desea actualizar 0.1.1.

En este entorno se reutiliza la toolchain ya instalada: Gradle 9.4.1/AGP 9.2.1, compileSdk 37, targetSdk 36 (Android 16), mínimo 24. SDK Platform 37 es necesaria para **compilar la configuración actual**, no significa que se exija Android 17 en el teléfono. Se mantuvieron las versiones de toolchain ya probadas. La red del entorno requiere el proxy Java y el truststore del sistema ya documentados en la receta anterior; no se configura ninguna red productiva.

El disco tenía menos de 500 MB libres. Los directorios generados `build` se trasladan mediante enlaces a almacenamiento temporal en memoria con permiso de escritura explícito para esta ejecución. Los directorios `.cxx` deben permanecer en rutas reales: Ninja/CMake entraban en regeneración continua al enlazar también `.cxx`. Esa corrección afecta solo artefactos ignorados, no bibliotecas ni código de la app. La APK se copia al directorio de entrega antes de terminar el proceso temporal. Una máquina con espacio suficiente no necesita esta adaptación.

Las pertenencias/asignaciones ficticias del backend de muestra siguen teniendo el ciclo de vida de T-M5A (memoria); no representan autorización de servidor durable. La limpieza nativa retira las muestras invalidadas durante la sesión. La integración futura deberá consultar autoridad real autenticada y revocaciones persistentes; esta etapa no la habilita.
