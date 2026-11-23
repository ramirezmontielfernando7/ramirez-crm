# Dashfort Mobile · C10

Versión 0.2.2, versionCode 13, paquete `com.demfort.dashfort.dev`. Base móvil
`b5373f752c62830a8c6f9ec5d2da9646dfe8e607`. Contratos revisados en
`main` `cfbef1d2c149c53cc2afd8920c9be15079a49ffb`. El cambio se limita a
`apps/mobile`. La firma experimental corresponde a una compilación posterior.

## Chat

- El historial virtualizado abre en el último mensaje. Al subir, muestra
  bloques de 45 mensajes ya recibidos. Cuando se lee más arriba conserva la
  fila de referencia y «Ir al último» cuenta los mensajes nuevos. El
  historial de Clientes todavía llega en una sola respuesta HTTP. Equipo y
  Mi número usan el cursor `before` que ya ofrece el servidor.
- El estilo predeterminado usa burbujas de Dashfort con cola, agrupación por
  remitente, separadores de fecha, hora y palomitas accesibles. Ajustes guarda
  «Dashfort» o «Estilo WhatsApp» en el dispositivo. El resto del Diseño B y
  las acciones existentes del chat conservan su flujo.
- Las imágenes reservan espacio antes de descargar, conservan su proporción,
  admiten reintento y abren un visor a pantalla completa con controles de
  zoom. Se mantiene la descarga autenticada y la limpieza de caché. Los
  stickers se dibujan sobre fondo transparente. Documentos, audio y video
  conservan el visor o reproductor existente.
- El render puede mostrar pastillas de reacción y citas con salto dentro del
  historial recibido. El DTO de Clientes y Mi número hoy no incluye esa
  información. El envío web de Clientes tampoco acepta cita y no hay una
  ruta web de reacción para Clientes. No se añadieron escrituras ni cambios
  de servidor para estas funciones. Equipo sí devuelve reacciones y se
  muestran en consulta. Las citas del chat de Clientes se ejercitaron con
  fixtures.
- En la base revisada no existe un botón del chat móvil que abra WhatsApp
  externo. Se buscaron llamadas de Linking y esquemas o enlaces de WhatsApp.
  Conservé los controles de ficha, plantillas y adjuntos.

## Rutas agregadas a la lista blanca

| Método | Ruta | Uso y alcance |
| --- | --- | --- |
| GET | `/api/team-chat/threads` | Hilos visibles, incluyendo supervisión cuando el servidor la autoriza. Un 403 o 404 oculta la pestaña. |
| GET | `/api/team-chat/threads/{id}/messages[?before={id}]` | Historial del hilo, con el permiso de escritura de la respuesta web. |
| POST | `/api/team-chat/threads/{id}/messages` | Solo texto `{body}` y solo con `EXPO_PUBLIC_ALLOW_SEND=true`. La supervisión queda en lectura. |
| GET | `/api/settings/my-number` | Número de la sesión. La pestaña requiere estado conectado. |
| GET | `/api/my-number/chats` | Lista del número propio. La app verifica que la respuesta corresponda al mismo número. |
| GET | `/api/my-number/chats/{id}/messages[?before={id}]` | Historial del número propio. El GET web existente marca leído al abrir. |

Los IDs admiten únicamente letras, dígitos, guion o subrayado, hasta 64
caracteres. Cada ruta existente usa `withAuth`. El servidor resuelve la
organización y el usuario desde Bearer y verifica membresía del hilo o la
propiedad del número. Mi número usa solo las rutas propias. Los chats de
otro asesor, incluso en supervisión, no se consultan desde esa pestaña. La
Bandeja general y el filtro de push permanecen separados. El servidor de
Equipo permite lectura a los miembros de la organización cuando el módulo
está habilitado y limita cada hilo según participación o supervisión. No
se introduce una matriz de roles paralela en el móvil.

Mi número queda en lectura en esta etapa. Equipo admite envío de texto y
deja los adjuntos del chat interno en la web. El listado de Mi número usa el
límite inicial del servidor. Se puede refrescar al entrar en cada sección
o al regresar a primer plano. El SSE y push existentes de Clientes se
mantienen.

## Verificación

- TypeScript, formato, 705 pruebas automatizadas aprobadas e inventario de 158 IDs.
- Chromium sin red con 552 mensajes ficticios. Abrió en el último.
  Con una imagen cargando, la reserva midió 164 px antes y después.
  Al recibir un nuevo mensaje durante la lectura, la fila observada quedó en
  547 px y el desplazamiento en 250 px. Al sumar una página antigua, la
  posición visual del texto observado cambió menos de 1 px. El visor amplió
  la foto de 390 a 585 px. Se verificaron la cita de fixture, el sticker, el
  archivo, el marcador leído y la navegación entre pestañas.
- Fixtures offline para envío de Equipo, cambio de acceso, número conectado
  y número ausente. La lista blanca, el Bearer sin cookies y los estados
  401, 403, 404, 429 y sin red se ejercitaron en el cliente. La prueba de
  alcance rechaza identificadores que no corresponden al número o hilo
  solicitado. La revisión de aislamiento del servidor se basó en los
  handlers de `main`. No se repitió el gate PostgreSQL.
- Regresiones offline de push C9, notas y funciones de espacio de trabajo
  cubiertas por el gate, visor PDF y audio, pausa de IA y cancelación de
  adjuntos.

## Pendientes y reversión

No hubo compilación de APK ni prueba en dispositivo. Chromium distingue la
posición visual de la compensación interna de la lista. Queda medir la
misma estabilidad con Hermes y la lista nativa en Android. Las citas y
reacciones de Clientes dependen de que el servidor almacene y entregue esos
datos. Los chats muy grandes de Clientes aún pagan el costo de transferencia
del historial completo.

Para retirar C10, preparar una compilación del checkpoint C9 y usar un
versionCode superior al instalado si hace falta actualizar en sitio. No hay
migraciones ni configuración del servidor que revertir.

### Prueba física en Motorola Edge 50 Pro

1. Abrir un chat largo propio y comprobar que muestra el último mensaje.
   Subir más de una página y observar que el texto queda en su sitio.
2. Recibir un aviso con el chat abierto. Verificar seguimiento al estar
   abajo y contador al leer arriba. Probar «Ir al último».
3. En claro y oscuro, abrir foto, ampliar y cerrar. Revisar sticker, archivo,
   audio, teclado, cambios de estilo y regreso conservando scroll. Probar
   reacción y cita de Clientes cuando el servidor exponga esos campos.
4. En Equipo, abrir un hilo propio, revisar reacciones y enviar a un hilo de
   prueba. Confirmar que un hilo supervisado queda en lectura.
5. En Mi número, confirmar que la pestaña solo aparece con un número propio
   conectado. Verificar que el chat privado no aparece en Clientes.
