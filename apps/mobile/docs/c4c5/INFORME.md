# Dashfort Mobile · C4+C5

Rama `codex/dashfort-mobile-c4c5-20261122`, desde `e6a6d7632f17b520421b970d3b63e2222a3283e4`. Contrato del servidor verificado en `main` `62ed3dfaa833845dee3c3c57af873fd7d4f0c6a2`. Expo 0.1.8, versionCode 9, paquete `com.demfort.dashfort.dev`. El siguiente binario debe usar la misma firma experimental.

## Qué cambió

- **Bandeja → Chat → Ficha del contacto.** Muestra nombre, teléfono opcional, persona asignada, etiquetas, nota inicial e historial de notas. Permite añadir notas y poner o quitar etiquetas del catálogo del negocio. La escritura de etiquetas lee primero la ficha y conserva las etiquetas automáticas.
- **Asignación.** El botón aparece con el flag de escrituras y solo si el servidor concede la lectura del equipo. En `main`, `users.read` y `assignment.manage` coinciden para Propietario y Coordinador. El POST vuelve a aplicar el permiso y valida que el destino pertenezca al equipo. Un asesor conserva la vista del responsable a partir de la Bandeja.
- **Más → Tareas.** Lista el trabajo que el servidor autoriza, crea tareas propias con título y descripción opcional y permite completar o reabrir según `canEdit`.
- **Más → Agenda.** Consulta día o semana en la zona horaria del negocio. Se puede mover una cita futura agendada o crear una cita desde la ficha, con horarios de la disponibilidad web y confirmación explícita. El alta envía únicamente el contacto visible, el tipo sesión y el horario. No envía un ID de conversación. La app omite las citas de laboratorio en la vista conectada.
- El modo demo sigue siendo el predeterminado. Los módulos y operaciones que permanecen en Demo mantienen su separación de los datos reales. Los formularios conectados reutilizan `PageScroll` con protección de teclado, los componentes B y el almacenamiento de sesión de C3.

## Rutas y métodos

| Método y ruta | Uso | Cuerpo o restricción |
| --- | --- | --- |
| GET `/api/contacts/{id}` | Ficha y etiquetas actuales | ID de segmento |
| GET `/api/contacts/{id}/timeline` | Notas | Solo se muestran `note` y `initial_note` |
| GET `/api/contact-tags` | Catálogo editable | Sin parámetros |
| GET `/api/settings/team` | Permiso de asignación y nombres | Sin parámetros. El cliente descarta correos |
| GET `/api/work/tasks?filter=all` | Tareas visibles | Filtro fijo. El alcance lo aplica el servidor |
| GET `/api/bookings?from=AAAA-MM-DD&to=AAAA-MM-DD` | Agenda | Fechas válidas, límite inclusivo de siete días |
| GET `/api/calendar/availability` | Elección de horario | Solo al editar con el flag activo |
| POST `/api/contacts/{id}/notes` | Nueva nota | `{text}`, hasta 4 000 caracteres |
| PUT `/api/contacts/{id}/tags` | Poner o quitar etiqueta | `{tagIds}`, hasta 50 IDs; reemplazo según el contrato web |
| POST `/api/assignments` | Asignar, reasignar o quitar asignación | `{contactIds:[id],userId}`, con `null` para quitar |
| POST `/api/work/tasks` | Nueva tarea | `{title,description?}` |
| PATCH `/api/work/tasks/{id}` | Completar o reabrir | `{done:boolean}` |
| POST `/api/bookings` | Crear cita | `{kind:"session",contactId,startUtc}` |
| PATCH `/api/bookings/{id}` | Mover cita | `{action:"reschedule",startUtc}` |

Cada escritura C3/C4/C5 exige `EXPO_PUBLIC_ALLOW_SEND=true`. Login y revocación conservan su tratamiento. Las rutas nuevas solo aceptan los métodos, segmentos y consultas de la tabla. La app construye los cuerpos y el servidor sigue validando Bearer, membresía, alcance y permisos. El token permanece en SecureStore, con exclusión de respaldos Android. No se cambiaron el servidor, las migraciones ni la configuración de autenticación.

## Pruebas

- `npm run typecheck`, `npm run format:check`, `npm test` y `python3 scripts/verify-inventory.py` aprobados. 649 pruebas totales, 24 nuevas, e inventario 158/158.
- Las fixtures cubren cada operación con éxito, 401, 403 por falta de permiso, 403 por suspensión, 404, 429 y fallo de red. También verifican rutas bloqueadas, modo de solo lectura, cuerpos exactos, etiqueta automática conservada, doble toque y fin de sesión durante una mutación.
- Probeta local de los handlers de `main` más las suites `mobile-session` y `rls`. 23 pruebas aprobadas con PostgreSQL 17, usuario `vocero_app` sin BYPASSRLS, dos organizaciones ficticias, sesiones Better Auth firmadas y middleware CSRF. Agenda usó el conector local predeterminado, con wa-mock configurado y fetch bloqueado. La probeta no registró intentos de salida. Otras 39 pruebas de Trabajo, visibilidad de asesores y roles pasaron en el mismo PostgreSQL. Verificó contactos y chats ajenos por ID, permisos de asignación, tareas y citas fuera de alcance, y 401 por suspensión.
- Dos recorridos en Chromium con los componentes RN Web, transporte y almacenamiento ficticios, y cero solicitudes externas. C4+C5 recorrió contacto sin teléfono, nota incierta y actualización antes de repetir, etiquetas, asignación y 403, tareas, Agenda día/semana, creación y movimiento, expiración, vista de asesor y solo lectura. El recorrido C3 volvió a pasar envío, leído, conciliación y solo lectura.
- Configuración pública de Expo verificada sin compilar. Versión 0.1.8, versionCode 9, paquete intacto, Android `resize` y exclusión de backup de SecureStore.

### Reproducir la probeta

Preparar un checkout descartable del SHA de `main` indicado, con PostgreSQL local, una base nueva con sufijo `_test`, RLS habilitado, roles de aplicación y sistema, secretos efímeros y las migraciones que ya trae ese SHA. Copiar [PROBETA-MAIN.txt](./PROBETA-MAIN.txt) a `tests/db/c45-mobile-probe.test.ts` en ese checkout. Usar `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` en loopback y ejecutar:

```sh
pnpm exec vitest run --pool=threads --maxWorkers=1 -c vitest.db.config.ts \
  tests/db/c45-mobile-probe.test.ts tests/db/rls.test.ts tests/db/mobile-session.test.ts
```

## Límites y reversión

- Pendientes la instalación física, el teclado y el almacenamiento nativo, la conectividad real y la integración de los proveedores de Agenda. La organización debe tener habilitados Trabajo y Agenda. Ante un 404 se muestra estado de indisponibilidad.
- El reemplazo de etiquetas conserva las que devuelve la lectura previa. El servidor web no ofrece versionado para impedir que dos dispositivos editen el conjunto entre la lectura y el PUT. Ante un resultado incierto, la app bloquea la escritura hasta actualizar y pide revisar si se guardó antes de repetir. El bloqueo local no sustituye la idempotencia del servidor.
- La ruta web de asignación actualiza la responsabilidad del contacto y sus relaciones, como en el CRM. La consulta web de ficha puede solicitar reparación de la imagen de un anuncio en segundo plano. Crear o mover una cita puede actualizar el conector de calendario que ya esté configurado en el negocio. Esos efectos son del servidor existente y se dejaron fuera de las pruebas con proveedores reales.
- Para impedir escrituras, compilar la misma rama sin `EXPO_PUBLIC_ALLOW_SEND`. Para revertir código, revertir el cambio C4+C5 o usar el código C3. Una actualización sobre versionCode 9 debe conservar identificador y firma y aumentar versionCode.

## Prueba física para Fer después de la auditoría

1. Actualizar la 0.1.7 en el teléfono, comprobar versión 0.1.8 en Más y entrar con una cuenta autorizada. Usar un chat y registros de prueba propios. Verificar Bandeja, historial y regreso a la misma posición.
2. Abrir la ficha con y sin teléfono. Crear una nota con el teclado visible y agregar/quitar una etiqueta. Confirmar los resultados en el CRM. Tocar Guardar dos veces y verificar una sola nota.
3. Confirmar como asesor que el botón de asignación no aparece. Con una cuenta autorizada, reasignar únicamente el chat de prueba y comprobar el responsable en el CRM.
4. En Más, crear, completar y reabrir una tarea. Consultar Agenda en Día y Semana y comprobar zona horaria. Si el conector del negocio puede crear reuniones reales, elegir una cita de prueba autorizada y comprobar el resultado en el calendario antes de moverla.
5. Probar modo avión, volver a conectarse y pulsar Actualizar. Revisar registros antes de repetir una escritura incierta. Probar cierre de sesión y un binario de solo lectura. Confirmar que las funciones fuera de alcance siguen en Demo.
