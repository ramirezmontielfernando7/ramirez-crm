# Cambios

Qué trae cada versión de Vocero CRM y qué hacer para actualizar. La versión
sigue el SemVer del [README](README.md#versiones): una menor trae funciones
nuevas y actualizar es redesplegar. En el upstream, desde 1.4.0 cada tag
`vX.Y.Z` publica la imagen `ghcr.io/kevinrivm/vocero-crm:X.Y.Z`; este fork no
ha publicado imagen propia, así que se instala construyendo desde el código.

## Sin publicar — versión propuesta: 1.5.0

Todo lo de abajo son funciones nuevas con migraciones que solo agregan, sin
variables obligatorias nuevas ni nada que reconectar: por el SemVer del README
es una **menor**, `1.5.0`. `package.json` sigue en 1.4.0 hasta el PR que la
publique (sube la versión, fecha esta sección y crea el tag `v1.5.0`).

### Actualizar desde 1.4.0

- **Respaldo.** Respalda la base antes, como en cualquier actualización.
- **Migraciones `0015`–`0019`.** Corren solas al arrancar y solo agregan
  columnas y tablas. Ver abajo qué cambia en 020 (cuentas de equipo → Coordinador)
  y 021 (consentimiento «sin confirmar»).
- **docker compose (Ruta B).** El compose ya no descarga
  `ghcr.io/kevinrivm/vocero-crm` (no trae nada de esto): **construye desde el
  código**. Actualiza con `git pull` y `docker compose up -d --build`. Si tu
  `.env` tenía `VOCERO_CRM_VERSION`, ya no se usa: bórrala.
- **`META_APP_SECRET` (recomendada).** Sin ella la instancia sigue igual, pero
  el log de arranque advierte y Configuración → WhatsApp muestra «Firma no
  verificada». Al definirla, los eventos del webhook sin firma válida se
  rechazan con 401.

### Seguridad y mantenimiento

- **Next.js 15.5.26** (antes 15.5.20): corrige el RCE sin autenticación del
  optimizador de imágenes (AVIF) y en servidores Windows (15.5.24), y los
  avisos de 15.5.21 (DoS y SSRF en Server Actions, SSRF en rewrites, bypass de
  middleware, confusión de caché, DoS de imágenes SVG). Sin salto a Next 16.
- **Dependencias transitivas parcheadas** con `overrides` de pnpm
  (`pnpm-workspace.yaml`): postcss, nanoid, brace-expansion, js-yaml,
  browserslist, baseline-browser-mapping y sharp. `pnpm audit` pasa de 35
  avisos (3 críticos) a 8 (1 crítico y 2 altos). Pendientes:
  `drizzle-orm` (PR aparte), vitest/vite (salto mayor) y esbuild.
- **Firma del webhook de WhatsApp.** Con `META_APP_SECRET` se exige; sin ella
  se avisa al arrancar y en Configuración → WhatsApp. Tests de ambos casos y
  guion E2E `pnpm test:e2e:firma`.
- **Ruta B construye desde este código** (`build: .`, `pull_policy: build`,
  imagen local `ramirez-crm:local`).
- Se borra `.f.mjs`, un script suelto de depuración que nada usaba.

### Asistente de redacción y Conocimientos (specs 023 y 024)

- **Asistente de redacción.** Una varita junto al clip del editor reescribe el
  borrador del asesor: Mejorar redacción, Cambiar tono (Formal, Casual,
  Empático), Resumir, Más corto, Más largo, con «Deshacer». No es el agente:
  no lee la conversación ni envía nada. Usa la misma configuración
  `OPENROUTER_*`; sin IA configurada, la varita se deshabilita.
- **Conocimientos.** Sección para el material que el EQUIPO envía una y otra
  vez (catálogo, políticas, fichas): título, texto y/o archivo, etiquetas y
  búsqueda. Se envían al chat desde el editor. Todos los roles los ven y los
  envían; crearlos, editarlos y borrarlos es de Propietario y Coordinador. El
  agente de IA no los lee.
- **Actualizar.** La migración `0019_conocimientos` crea la tabla
  `knowledge_entry`. Los archivos van al mismo volumen de adjuntos (`/data`).

### Menú lateral, panel de Detalles y línea de tiempo (spec 022)

- **Menú lateral de tres estados** en escritorio (expandido → íconos →
  oculto), guardado por usuario. El Asesor arranca con íconos; Coordinador y
  Propietario, expandido.
- **Línea de tiempo del chat.** Notas con autor y hora (ya no un solo campo
  que se sobrescribía), cambios de etapa, asignaciones, pausas de la IA,
  consentimiento y etiquetas, en orden, en el panel de Detalles.
- **Bandeja más compacta**, buscador que se estira, emojis, pegar imágenes con
  Ctrl+V y la marca **Dashfort by Demfort** (logo y menú lateral teal).
- **Actualizar.** Migraciones `0017_linea_de_tiempo_y_preferencias` y
  `0018_menu_tres_estados`: solo agregan. Lo que ya había en las notas
  del contacto se muestra como «Nota inicial». Etapas y asignaciones traen
  su historial; el de notas, IA, consentimiento y etiquetas empieza con la
  actualización (antes no se registraba).

### Etiquetas, consentimiento, CSV y campañas (spec 021)

- **Etiquetas de contacto.** Configuración → Etiquetas; se asignan desde el
  panel de la Bandeja o Editar en Contactos, y la lista filtra por ellas.
- **Consentimiento de WhatsApp.** Cada contacto dice si acepta mensajes
  masivos (`opt_in`), no quiere (`opt_out`) o está sin confirmar (default),
  con su origen y fecha.
- **Importar y exportar CSV** desde Contactos. La importación deduplica por
  teléfono, etiqueta cada contacto con el archivo del que vino y devuelve el
  detalle de cada fila que no entró. La exportación respeta los filtros.
  Importar y exportar: Propietario y Coordinador.
- **Campañas** (opcional, `CAMPAIGNS=on`): envío de una plantilla aprobada
  a un público por etiquetas, **solo a contactos con `opt_in`**, en segundo
  plano y con registro por destinatario.
- **Actualizar.** La migración `0016_etiquetas_consentimiento_campanas` solo
  agrega columnas y tablas; todo contacto existente queda «sin confirmar», así
  que nadie recibe una campaña hasta que se marque su consentimiento.

### Roles y asignación de chats (spec 020)

- **Tres roles.** Propietario (todo, como hoy), Coordinador (ve a todo el
  equipo, reparte chats, edita etapas y plantillas, ve los resultados de todos)
  y Asesor (solo sus chats, leads y resultados). Los permisos se validan en el
  servidor en cada ruta: antes, varias pantallas de configuración no
  revisaban rol.
- **Asignación.** Cada lead/chat puede tener a alguien asignado; los nuevos
  llegan sin asignar. Reasignación en lote (Ajustes → Equipo o selección en la
  Bandeja) e historial de quién tuvo cada lead.
- **Actualizar.** La migración `0015_roles_y_asignacion` solo agrega columnas y
  tablas. Todo contacto queda sin asignar y el propietario sigue siendo
  propietario. **Las cuentas de equipo que ya existían pasan a Coordinador**
  (siguen viendo todo, como hasta hoy); bájalas a Asesor desde Ajustes → Equipo
  cuando hayas repartido sus chats, o dejarán de verlos.

## 1.4.0 — 2026-09-22

### Actualizar desde 1.3.0

Actualizar es redesplegar: no hay variables obligatorias nuevas ni nada que
reconectar. Respalda la base antes, como en cualquier actualización.

- **Cómo.** En Coolify, con la app que construye desde el repo (la de la guía
  hasta 1.3.0), redespliega. Con docker compose, `git pull` y
  `docker compose up -d`: el compose ahora descarga la imagen publicada. Con
  `--build` la sigue construyendo desde el código, que es lo que necesitas en
  un VPS ARM (la imagen es `linux/amd64`) o si tu fork tiene cambios propios.
- **Migraciones.** Corren solas al arrancar el contenedor, sin
  Pre-Deployment Command. Hay dos nuevas, y las dos solo agregan:
  - `0013_nombre_del_contacto`: la columna `contact.name_source`.
  - `0014_anuncio_de_origen`: la columna `ad_attribution.image_asset_id`, su
    llave foránea a `media_asset` y un índice.

  Van en una sola transacción: si una falla no queda ninguna, la app no
  arranca y el log dice `[migrate] falló tras varios intentos`. Si tu fork
  tiene migraciones propias posteriores a la `0012`, comprueba después que
  existan esas dos columnas: el migrador salta en silencio toda migración
  cuyo `when` no sea mayor que el de la última aplicada. Si falta una, corre a
  mano su SQL de `drizzle/`.
- **Nombres de contacto.** El nombre ahora sigue al perfil de WhatsApp, salvo
  que lo haya escrito una persona en el CRM. La `0013` deja como «del perfil»
  todos los contactos que ya existían: uno que renombraste a mano tomará su
  nombre de WhatsApp la próxima vez que escriba. Para conservar esos nombres,
  corre esto en la consola de Postgres justo después de actualizar (antes la
  columna no existe; con docker compose,
  `docker compose exec postgres psql -U postgres -d vocero`):

  ```sql
  UPDATE "contact" SET "name_source" = 'manual';
  ```

  Con eso ningún contacto viejo sigue a su perfil; los nuevos, sí. Quien
  escriba entre el arranque y el `UPDATE` ya habrá tomado su nombre de perfil.
- **Adjuntos, logo e icono.** La imagen los guarda en `/data/media` (trae
  `MEDIA_DIR=/data/media`) y arranca como root solo para darle el volumen de
  `/data` al usuario de la app. Qué hacer según cómo esté tu contenedor:

  | Tu instancia en 1.3.0 | Qué hacer |
  |---|---|
  | `MEDIA_DIR` sin definir o `./.dev-media` (la guía y el `.env.example` de 1.3.0) | Quita `MEDIA_DIR` si la tienes y monta un volumen en `/data` si aún no hay (en Coolify, un persistent storage). No hay nada que rescatar: esa ruta no era escribible y guardar un adjunto, el logo o el icono fallaba. |
  | Volumen en `/data/media`, con `MEDIA_DIR=/data/media` (la nota del `.env.example` de 1.3.0) | No muevas el volumen: 1.4.0 usa esa misma ruta y le arregla los permisos al arrancar. `MEDIA_DIR` ya sobra. Para montarlo en `/data`, como dice la guía nueva, primero pasa su contenido a una carpeta `media/` dentro del volumen. |
  | `MEDIA_DIR=/data/media` sin volumen | Tus archivos están dentro del contenedor y el redeploy los borra. Sácalos antes de actualizar (`docker cp <contenedor>:/data/media ./media`); con el volumen ya en `/data`, devuélvelos (`docker cp ./media/. <contenedor>:/data/media`) y reinicia la app para que el contenedor les dé dueño. |
  | docker compose | Nada: el compose nuevo monta el volumen `vocero_app_data` en `/data`. El de 1.3.0 no montaba volumen para la app, así que no había archivos guardados. |

  La imagen ya no declara `USER`: `docker exec` entra como root. Para actuar
  como la app, `docker exec -u vocero …`.
- **Variables.** Ninguna obligatoria nueva.
  - `BRAIN_HEALTH_URL` (opcional): el `/health` de tu cerebro externo, p. ej.
    `http://nea:8000/health`, para la tarjeta «Quién responde a tus
    clientes». Tiene que ser una URL `http://` o `https://` completa; si no
    lo es, la tarjeta lo marca como problema de configuración y el resto de
    la app sigue funcionando ([#74]). Vacía cuenta como no definida.
  - `SOURCE_COMMIT` escrito a mano en la plataforma: si el build no trae su
    propio commit, la barra lo marca «commit sin verificar» y `/api/health`
    responde `"commitVerified":false`. Quítalo, o pásalo como build arg en
    cada build (README → Versiones). La imagen publicada ya trae el suyo.
  - Solo docker compose: `VOCERO_CRM_VERSION` elige la versión de la imagen
    (por defecto, la de esta versión). Y el compose ahora le pasa a la app
    `CHANNELS`, `AGENDA`, `ATRIBUCION`, `BOT_API_KEY` y `BRAIN_HEALTH_URL`: en
    1.3.0 no le llegaban, así que lo que tengas escrito de ellas en tu `.env`
    empieza a surtir efecto.
- **Banderas.** `AGENDA`, `ATRIBUCION` y `CHANNELS` no cambian de nombre y
  siguen apagadas por defecto. Cambia lo que cubre `ATRIBUCION`: de qué
  anuncio llegó cada conversación (titular, texto, creativo, enlace) se guarda
  y se ve siempre, con o sin la bandera. Sin ella no se guarda el `ctwa_clid`
  ni se le reporta nada a Meta.
- **Override del webhook (cerebro externo o modo agencia).** En 1.3.0, cada
  vez que guardabas la conexión en Configuración → WhatsApp (o rotabas el
  token) se re-suscribía la app sin cuerpo, que es como Meta borra el
  override de callback de la WABA. 1.4.0 ya no lo hace, pero no devuelve uno
  que ya se perdió: revisa `GET /{WABA_ID}/subscribed_apps` y, si falta
  `override_callback_uri`, vuelve a ponerlo con la URL de quien debe recibir
  los webhooks (la llamada está en README → modo agencia, paso 4).
- **Si conectas tu propio cerebro por `/api/bot/*`.**
  - Límite nuevo: primero se autentica y después se cuenta. Con la llave
    buena hay 1200 llamadas por minuto (antes 600, contadas antes de mirar la
    llave). Las fallidas, sin llave o con una mala, se frenan por IP: pasadas
    30 en un minuto responden `429 rate_limited` («Demasiados intentos
    fallidos») en vez de `401`. Si tu bot recibe ese 429, revisa su llave.
  - `GET /api/bot/availability` sin `limit`, `perDay` ni `days` ahora
    devuelve los defaults del contrato (12 huecos, 3 por día, 5 días); antes,
    un solo hueco.
  - Lo demás es aditivo (`booking` en el contexto, `date` y `query` en los
    huecos): un bot que no lee los campos nuevos no nota nada.
- **Imagen publicada.** `ghcr.io/kevinrivm/vocero-crm:1.4.0`, solo
  `linux/amd64`, con el commit horneado. Es el camino nuevo para instalar
  ([INSTALL-IA.md](INSTALL-IA.md)). Una instancia que construye desde el repo
  puede seguir así. Si la pasas a la imagen con otra app de Coolify, su
  volumen de `/data` es otro: copia los archivos antes de apagar la vieja.

### Nuevo

- **Resultados** (`/results`, en el menú, sin bandera): ventas, origen y
  anuncios, el agente y lo que se está cayendo, contra el periodo anterior.
  Todo sale de la base propia: sin gasto publicitario ni conectores, y el
  Laboratorio no cuenta. Las citas del agente, solo con `AGENDA`. Los días se
  cortan en la zona de la agenda; si no hay agenda configurada, en
  `America/Mexico_City`. ([#70])
- **De qué anuncio llegó cada conversación**, sin bandera: marca «Anuncio ·
  titular» y filtro «Anuncios» en la bandeja; tarjeta con el creativo, el
  texto y el enlace en el panel del contacto y en el cajón del trato. La
  imagen del creativo se copia al volumen (solo de hosts de Meta, hasta
  300 KB). Solo WhatsApp. ([#67])
- **Calendario de Citas** (con `AGENDA`): vistas Día, Semana, Mes y Lista en
  la zona del negocio, panel de la cita con «Abrir conversación», reprogramar
  con todos los huecos de la ventana y bloquear un horario tocando la
  rejilla. `GET /api/bookings` acepta `from` y `to` (hasta 92 días); sin
  ellos responde igual que antes. ([#66])
- **«Quién responde a tus clientes»**, arriba de la pantalla Agente: el
  agente incluido, tu cerebro externo o los dos, con aviso rojo porque el
  cliente recibiría dos respuestas. `GET /api/agent/brain-status`. ([#69])
- Para tu bot, con `AGENDA`: `GET /api/bot/context` trae las citas del lead
  (`booking`), y `GET /api/bot/availability` con `date=AAAA-MM-DD` da las
  horas libres de ese día, con `query` diciendo hasta dónde llega lo
  consultado. ([#65], [#71])
- El logo que subes se ve en la barra lateral, en el login y en la vista
  previa de Configuración → Marca. ([#64])
- La imagen de Docker se construye en cada PR y se publica en GHCR con cada
  tag. ([#68])
- `/api/health` dice si el commit salió del build (`commitVerified`). ([#65])

### Cambió

- La barra lateral es azul marino en los dos temas, y el tema oscuro sube la
  página un escalón sobre ella: diálogos y cajones flotan, su texto pasa AA de
  contraste y el foco por teclado se ve. Con un acento propio claro (verde,
  amarillo…), la tinta de botones y distintivos pasa de blanco a casi negro
  cuando el blanco no llega a 4.5:1. ([#64], [#72])
- El Agente y «IA en esta conversación» usan el mismo interruptor, con el
  pomo dentro de la pista. ([#64])
- El nombre del contacto sigue a su perfil de WhatsApp, salvo que lo haya
  escrito una persona. ([#56])
- `/api/bot/*` autentica antes de contar: 1200 llamadas por minuto con llave
  válida y 30 fallidas por minuto por IP. ([#73])
- `ATRIBUCION` ya no decide si ves el anuncio de origen: solo el `ctwa_clid`,
  la Conversions API y Configuración → Anuncios. ([#67])
- La imagen trae `MEDIA_DIR=/data/media` y un entrypoint que deja `/data`
  escribible antes de bajar al usuario de la app. ([#63])
- La insignia de versión marca «commit sin verificar» cuando el commit no
  salió del build. ([#65])
- docker compose usa la imagen publicada, `--build` la construye desde el
  código, y ahora le pasa a la app `CHANNELS`, `AGENDA`, `ATRIBUCION`,
  `BOT_API_KEY` y `BRAIN_HEALTH_URL`.

### Corregido

- Cuando el patrón de respaldo detecta que el cliente pide un humano, el
  agente le avisa antes del traspaso («Claro, te comunico con una persona del
  equipo. En breve te responden.»); antes lo traspasaba sin mandarle nada.
  ([#65])
- El agente incluido reserva el horario que el cliente elige; antes no
  acertaba el instante y la conversación entraba en bucle. ([#54])
- A un contacto sin teléfono (solo BSUID) se le responde; antes Meta
  devolvía 131026. ([#57])
- Con Postgres fuera de UTC, un saliente enseñaba otra hora en el hilo que en
  la lista. Las filas escritas antes conservan su valor; en Docker nunca
  pasó. ([#58])
- En la instalación por defecto, guardar un adjunto, el logo o el icono
  fallaba por permisos. ([#63])
- Guardar la conexión de WhatsApp, o rotar el token, borraba el override de
  callback de la WABA y dejaba sin mensajes a un cerebro externo. ([#63])
- La prueba de conexión de Google Calendar daba 403 con credenciales
  correctas, y un cambio de credenciales de Google o Zoom tardaba hasta una
  hora en surtir efecto. ([#55])
- A «¿mañana en la tarde?» tu bot solo veía las primeras horas del día:
  `/api/bot/availability` ignoraba `date`. ([#71])
- `GET /api/bot/context?waIdentity=bsuid:…` respondía 404 a quien escribió
  primero con teléfono. ([#73])
- 600 llamadas por minuto sin llave dejaban a tu bot en 429. ([#73])
- Calendario: el bloqueo tomaba la hora del navegador, reprogramar ofrecía
  solo 12 huecos, cada evento recalculaba la disponibilidad y la lista se
  quedaba en las últimas 200 citas. ([#66])
- El pomo del interruptor del Agente no se veía y, encendido, se salía de la
  pista. ([#56], [#64])

Gracias a @Diony7004, @federicorv25, @fondeur27-09-73, @dev-bahari,
@davidcaroo y @dean-wya por los reportes, los diagnósticos y el código.

## 1.3.0 y anteriores

Sin entrada aquí: lo anterior está en el tag
[`v1.3.0`](https://github.com/kevinrivm/vocero-crm/tree/v1.3.0) (2026-09-01).

[#54]: https://github.com/kevinrivm/vocero-crm/pull/54
[#55]: https://github.com/kevinrivm/vocero-crm/pull/55
[#56]: https://github.com/kevinrivm/vocero-crm/pull/56
[#57]: https://github.com/kevinrivm/vocero-crm/pull/57
[#58]: https://github.com/kevinrivm/vocero-crm/pull/58
[#63]: https://github.com/kevinrivm/vocero-crm/pull/63
[#64]: https://github.com/kevinrivm/vocero-crm/pull/64
[#65]: https://github.com/kevinrivm/vocero-crm/pull/65
[#66]: https://github.com/kevinrivm/vocero-crm/pull/66
[#67]: https://github.com/kevinrivm/vocero-crm/pull/67
[#68]: https://github.com/kevinrivm/vocero-crm/pull/68
[#69]: https://github.com/kevinrivm/vocero-crm/pull/69
[#70]: https://github.com/kevinrivm/vocero-crm/pull/70
[#71]: https://github.com/kevinrivm/vocero-crm/pull/71
[#72]: https://github.com/kevinrivm/vocero-crm/pull/72
[#73]: https://github.com/kevinrivm/vocero-crm/pull/73
[#74]: https://github.com/kevinrivm/vocero-crm/pull/74
