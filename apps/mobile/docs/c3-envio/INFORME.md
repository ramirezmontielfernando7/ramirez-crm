# C3 · Envío de texto y lectura en Dashfort Mobile 0.1.7

Rama `codex/dashfort-mobile-c3-envio-20261122` desde `06bd80554db3c6e7858eb397848c48e3d21184cb`. Versión 0.1.7, versionCode 8 y paquete `com.demfort.dashfort.dev`. La compilación futura conserva la firma experimental.

## Contrato y cambios

El backend de referencia fue `main` en `62ed3dfaa833845dee3c3c57af873fd7d4f0c6a2`. Sus dos rutas web ya aceptan el Bearer nativo a través de `withAuth`. CSRF permite la petición nativa sin cookie, Origin ni Sec-Fetch-Site. Una escritura web cruzada con cookie sigue bloqueada. Por ello el push de C3 contiene solo cambios de app. No se necesitó rama de backend.

| Operación habilitada | Solicitud al CRM existente |
| --- | --- |
| Enviar un texto | `POST /api/conversations/{id}/messages` con `{ text }` |
| Marcar leído | `PATCH /api/conversations/{id}` con `{ markRead: true }` |

La app exige el valor literal `EXPO_PUBLIC_ALLOW_SEND=true` para ambas escrituras en producción o staging. Sin el flag, ambas quedan bloqueadas en el transporte y el chat conserva el modo de solo lectura. Se mantiene demo por defecto. El transporte conserva las restricciones C2 de origen, cookies, redirecciones y almacenamiento del token. El cuerpo de cada escritura lo arma la app. Adjuntos, plantillas, IA, notas, etiquetas, asignaciones, CRM, agenda y campañas no se conectan en C3.

Al abrir el chat se carga el historial y, con la escritura habilitada, se solicita marcar leído. La Bandeja baja el contador tras la confirmación. El compositor usa los controles B y la gestión de teclado existente. Muestra enviando, enviado o en cola según la respuesta. El historial se actualiza después del envío o al deslizar para refrescar. El servidor aplica la política de canal, organización y visibilidad del asesor. El cliente no modifica el estado de IA ni el handoff. El rechazo de WhatsApp por ventana de 24 horas muestra el texto de la respuesta web verificada.

## Pruebas ejecutadas

- Gate de app completo. TypeScript, formato, 625 pruebas aprobadas e inventario de 158 IDs. Los casos nuevos cubren lista blanca, flag en los dos modos, cuerpos exactos, doble toque, servidor 500, 401, suspensión 403, 429, red y ventana 409. También verifican que se borra la sesión ante 401 o suspensión.
- Comprobación RN Web en Chromium con tráfico externo bloqueado y transporte local simulado. Se comprobó el compositor, el PATCH al abrir, el refresh tras éxito, la consulta de historial al reintentar un resultado incierto y el modo de solo lectura sin flag. Cero solicitudes externas.
- Probeta local contra los handlers de main con PostgreSQL 17.12, roles de aplicación y sistema, RLS forzado y `wa-mock` del repo. Pasaron 19 pruebas de sesión, escritura y RLS. El asesor pudo escribir y marcar leído en su chat. Las rutas devolvieron 404 para otro asesor y otra organización, 409 con el mismo cuerpo que el web al cerrar la ventana y 401 con sesión abierta tras suspender la organización. También se comprobó el 403 de suspensión a mitad de una operación del envoltorio común. La bandeja de salida de `wa-mock` recibió exactamente un texto de la prueba. Se usaron las migraciones existentes para preparar la base desechable.
- La primera pasada de la probeta de envío devolvió 422 porque el contacto ficticio carecía de teléfono utilizable. Al corregir ese dato del fixture pasaron las 19 pruebas. No se cambió el servidor.

## Riesgos y reversión

El backend actual no deduplica envíos mediante una clave de idempotencia. El cliente bloquea el doble toque mientras la solicitud está en curso y limita cada texto a 4.096 caracteres para evitar el envío por partes de Meta. Ante una respuesta perdida, un 5xx o la falta de red, Reintentar consulta el historial. Un segundo envío requiere pulsar Enviar de nuevo después de revisar el historial. El resultado puede seguir siendo incierto hasta que el servidor y el canal lo confirmen. «Mensaje enviado» refleja la aceptación del CRM. Los envíos en cola se indican por separado.

Quedan pendientes la instalación, el teclado en dispositivo y la entrega real en un chat autorizado. El trabajo no abrió una conexión con producción ni WhatsApp real. Para revertir escrituras basta compilar sin `EXPO_PUBLIC_ALLOW_SEND`. Una actualización posterior sobre code 8 debe incrementar versionCode y conservar paquete y firma. Si se necesita revertir código, volver a la base C2 o revertir el commit C3.

## Prueba física después de la revisión de Claude

1. Instalar la build aprobada con `EXPO_PUBLIC_MODE=production`, URL exacta `https://dash.demfort.com` y `EXPO_PUBLIC_ALLOW_SEND=true`.
2. Usar exclusivamente un chat de prueba propio. Para probar la ventana de WhatsApp, elegir un chat por Meta y enviar primero un entrante desde ese número de prueba.
3. Abrirlo con un mensaje sin leer, regresar a Bandeja y comprobar el contador. Escribir un texto identificable y tocar Enviar dos veces rápidamente. Confirmar un solo mensaje en el teléfono receptor y en el historial.
4. Comprobar teclado, actualización al deslizar y regreso a Bandeja. Si se pierde la red, usar Reintentar para actualizar historial antes de repetir un envío explícito. Verificar el mensaje de ventana cerrada en un chat de prueba que cumpla esa condición.
5. En la build sin el flag, confirmar que el chat solo permite leer el historial. Cerrar sesión al terminar la prueba.
