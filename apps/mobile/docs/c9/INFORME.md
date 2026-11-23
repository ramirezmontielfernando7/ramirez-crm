# C9 · Avisos Android

Dashfort Mobile **0.2.1**, versionCode **12**, identificador
`com.demfort.dashfort.dev`. Continúa desde C7+C8 (`66a7102`). Mantiene el diseño B
y los controles existentes. La firma queda para la compilación autorizada.

## Comportamiento

El interruptor de SET-14 explica qué mostrará el aviso. Solo se pide el permiso
de Android al activarlo. Una denegación mantiene la aplicación operativa y
permite abrir los ajustes del sistema. El registro vincula el teléfono a la
sesión autenticada. Se renueva al volver a primer plano si corresponde o al
rotar el token de FCM. Al cerrar sesión se intenta la baja antes de revocar la
sesión y se descartan los avisos visibles. Si la baja explícita falla sin red
con la sesión activa, se reintenta al volver a la app. Si tanto la baja como el
cierre remoto fallan por desconexión, el servidor solo puede invalidar el
vínculo al revocar/caducar la sesión o por purga. Por eso el aviso es genérico
y la apertura siempre requiere una sesión con acceso vigente.

| Método | Ruta | Control |
| --- | --- | --- |
| POST | `/api/mobile/push/register` | Bearer en staging o producción, independiente de `EXPO_PUBLIC_ALLOW_SEND`. |
| POST | `/api/mobile/push/unregister` | Igual. |

El modo demo sigue separado y no registra tokens FCM. Se usa el token **nativo**
de Android, no el de Expo Push Service. La app conserva el Bearer en SecureStore
y guarda únicamente la preferencia de avisos como estado local. Sonidos y
preferencias por tipo siguen marcados «Demo». iOS y web quedan sin el conector
nativo. Tocar un aviso guarda el destino mientras se inicia sesión, deduplica
el toque y consulta la Bandeja con esa sesión antes de abrir el chat.

## Configuración Android

Se fijó `expo-notifications` en **58.1.9**, versión incluida por Expo
**58.0.25** para React Native **0.88.1**. El ejemplo público
[`google-services.example.json`](../../google-services.example.json) indica el
formato. Producción falla con un mensaje claro si falta el archivo público
real, si pertenece a otro paquete o si es un JSON de cuenta de servicio.
Staging permite una compilación sin avisos cuando no hay archivo. El plugin
conserva el receptor FCM únicamente cuando hay configuración. El canal Android
«Mensajes» tiene visibilidad privada.

## Validación y orden de entrega

Las pruebas automatizadas cubren la lista blanca, denegación, serialización,
renovación, baja y la validación de IDs. En Chromium offline con los componentes
RN Web reales y un doble de Android se comprobó el registro en solo lectura,
rechazo de un chat fuera del alcance, apertura autorizada, toque duplicado,
baja seguida de revocación y toque recibido antes del login. No hubo solicitudes
externas. Pasaron TypeScript, formato y las 696 pruebas automatizadas. El
inventario comprobó 158 IDs registrados. La inspección de Expo offline confirmó
el permiso Android, el identificador y el versionCode con una configuración
pública ficticia. También confirmó que la configuración de producción falla
con el mensaje previsto cuando falta ese archivo.

No se compiló APK ni se comprobó entrega real de FCM. Para la prueba posterior
en el Motorola Edge 50 Pro con Android 16, revisar y preparar el servidor
primero. Luego instalar la APK 0.2.1 firmada con el mismo certificado. Validar
permiso denegado, permiso concedido, primer plano, segundo plano, proceso
cerrado, pantalla bloqueada, chat reasignado, sesión revocada y cierre sin red.
La entrega tras «Forzar detención» queda sujeta a Android. Revisar que no
aparezcan datos de clientes y que los avisos de un chat se agrupen.

Si hay un problema, desactivar el interruptor en el teléfono o retirar
`FCM_SERVICE_ACCOUNT_JSON` del servidor. La rama anterior de la app conserva
C7+C8; Android puede exigir desinstalar para bajar de versionCode, lo que
borraría datos locales. No hacerlo en el teléfono del usuario sin autorización.
