# Dashfort Mobile · C6

Rama `codex/dashfort-mobile-c6-20261122`, desde `56d3796a019c0cc7e25919fe7945366944d1eb90`. Rutas existentes verificadas en `main` `62ed3dfaa833845dee3c3c57af873fd7d4f0c6a2`. Versión 0.1.9, versionCode 10, paquete `com.demfort.dashfort.dev`. El futuro binario debe conservar la firma experimental.

## Comportamiento

- Chat ofrece plantillas aprobadas y habilitadas por el CRM. Admite variables numeradas y con nombre según el orden web, muestra la vista previa y pide confirmación explícita. Si el servidor devuelve `409 window_closed` para texto, se ofrece «Enviar plantilla» en los chats de WhatsApp de Meta identificados por el CRM.
- La ruta web de plantilla usa la línea principal del negocio aunque el chat tenga otra línea. La app verifica el número del chat contra `isPrimary` en la ruta web de números, al mostrar el formulario y otra vez antes del POST. Los chats de una línea secundaria, grupos y chats que no identifican una línea Meta quedan sin envío de plantilla. Así se evita enviar con un remitente distinto del mostrado.
- Las respuestas rápidas se leen del negocio e insertan un borrador editable. `{nombre}` usa el primer nombre cuando existe. Insertar no envía nada.
- Plantillas y texto comparten un bloqueo de envío. Un fallo incierto, incluido `403 meta_unavailable` de esta ruta web, bloquea repetir la plantilla en ese chat hasta actualizar y revisar el historial. El token sigue en SecureStore. Los mensajes y los valores de variables se mantienen en memoria y no se registran en logs.
- Los controles usan las hojas, campos y desplazamiento con teclado ya existentes. Adjuntos, IA, campañas, pipeline y push siguen en Demo. No se modificaron dependencias, servidor ni migraciones.

## Rutas añadidas

| Método y ruta | Uso |
| --- | --- |
| GET `/api/templates` | Lista del CRM. Se exponen en la UI solo las aprobadas y enviables |
| GET `/api/quick-replies` | Lectura e inserción local en el borrador |
| GET `/api/whatsapp-numbers` | Comprobar cuál es la línea Meta principal. Se conservan en memoria solo el resultado de la comprobación y el ID del chat |
| GET `/api/conversations?ids={id}` | Reconciliar datos de un único chat abierto con el estado canónico |
| GET `/api/events` | SSE con Bearer, sin parámetros en la URL |
| POST `/api/conversations/{id}/messages/template` | Cuerpo `{templateId, variables}` generado por la app. Requiere `EXPO_PUBLIC_ALLOW_SEND=true` |

Los IDs en rutas y consulta son segmentos ASCII de hasta 200 caracteres. Las lecturas de catálogos y el flujo de eventos funcionan en solo lectura. Se mantienen las demás rutas y condiciones de versiones previas.

## SSE y reconciliación

`/api/events` usa `requireSession` y revalida con `sessionFromHeaders`. La probeta verificó Bearer y aislamiento. Se usa el stream de `expo/fetch` que ya estaba instalado. La app tiene un stream en la Bandeja o en el Chat visible, cancela al salir o pasar a segundo plano y reconcilia al regresar. Agrupa eventos en ventanas de 750 ms y usa solo sus identificadores para decidir cuándo actualizar. Los textos de eventos no alimentan la interfaz. Las reconexiones esperan de 5 a 60 segundos y las respuestas de sesión inválida vuelven al login. Si el cliente o la ruta no ofrecen un stream utilizable, recurre a consultas cada 25 segundos en primer plano.

El historial se vuelve a leer y se deduplica por ID. `since` de la ruta de historial filtra por fecha de creación y habría omitido estados cambiados en mensajes antiguos. La Bandeja revalida en una página hasta 500 conversaciones cargadas. Para listas mayores se puede volver a paginar. El historial completo implica mayor costo en chats muy largos y debe medirse en Android antes de ampliar el tráfico. SSE no ofrece replay garantizado.

## Pruebas

- Gate móvil `npm run typecheck && npm run format:check && npm test && python3 scripts/verify-inventory.py`. 665 pruebas aprobadas. Inventario 158/158.
- PostgreSQL 17 y RLS con el rol de aplicación sin BYPASSRLS. 29 pruebas entre la probeta C6 y las suites de sesión móvil, RLS, respuestas rápidas y variables de plantillas. Con los handlers de `main`, la probeta comprobó el alcance de asesor y propietario, 404 fuera de alcance, autorización SSE y exactamente una plantilla en wa-mock tras rechazar las solicitudes inválidas. Los primeros fallos del montaje local se corrigieron al usar un teléfono de fixture normalizado y el prefijo de Graph esperado por cada suite.
- Chromium offline con RN Web y transporte ficticio. Se comprobó inserción sin envío, 409 con acceso a plantilla, bloqueo de variables faltantes, confirmación, un POST, evento entrante, estados, asignación, desconexión al ir a fondo, deduplicación al volver y regreso al login al invalidar sesión. Regresiones C3 y C4+C5 con el fallback del stream. Cero solicitudes externas.
- [Probeta reproducible](./PROBETA-MAIN.txt). Copiar a `tests/db/c6-mobile-probe.test.ts` de un checkout descartable del SHA indicado. Usar PostgreSQL local con base nueva terminada en `_test`, RLS, las migraciones del checkout, credenciales de prueba y `WA_MOCK_ENABLED=true`. Para la probeta, `APP_BASE_URL=http://localhost:3000` y `META_GRAPH_BASE_URL=http://localhost:3000/api/dev/wa-mock/graph`. Para `plantillas-variables-nombre.test.ts`, usar `META_GRAPH_BASE_URL=http://localhost:3000` porque la suite adapta el path a su mock sin prefijo. Se ejecutaron con `pnpm exec vitest run --pool=threads --maxWorkers=1 -c vitest.db.config.ts`.

## Límites, reversión y prueba física

- Pendientes el streaming nativo Android, el comportamiento a través del proxy real y la entrega por Meta. La vista previa muestra el texto final y los rótulos de componentes. Si la plantilla lleva imagen, avisa que se incluirá el encabezado aprobado. El envío reutiliza los componentes guardados por el CRM.
- La verificación previa de catálogo y número no es atómica con el POST. Puede haber cambios de configuración entre peticiones. La ruta valida de nuevo la plantilla y mantiene la semántica de la línea principal. El bloqueo local evita pulsaciones repetidas pero no ofrece idempotencia entre dispositivos ni tras el reinicio.
- Para desactivar escrituras, compilar sin `EXPO_PUBLIC_ALLOW_SEND`. Para retirar C6, revertir su cambio o volver al código 0.1.8. Una APK que reemplace la 0.1.9 debe conservar la firma y el paquete e incrementar versionCode.
- En el Motorola, probar un chat propio de la línea Meta principal con ventana cerrada y una plantilla aprobada de prueba. Insertar primero una respuesta rápida y verificar que queda en el borrador. Llenar variables, comprobar vista previa, confirmar un solo envío y verificar la entrega en WhatsApp y en el CRM.
- Recibir un mensaje con la Bandeja abierta y luego con el Chat abierto. Verificar actualización sin deslizar, estados de entrega y reasignación permitida. Pasar a segundo plano, activar modo avión, volver y verificar reconciliación sin duplicados. Confirmar ausencia de escritura con un binario de solo lectura y el bloqueo de plantilla en una línea secundaria de prueba.
