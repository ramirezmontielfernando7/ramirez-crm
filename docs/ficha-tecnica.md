# Ficha técnica de Dashfort

Inventario de todas las funcionalidades del CRM (v1.4.0, octubre 2026), qué hace cada una y quién la usa. P = Propietario, C = Coordinador, A = Asesor. El diagnóstico está en [diagnostico-2026-10.md](diagnostico-2026-10.md).

## Bandeja (chats de WhatsApp)

Ruta: `/inbox` · núcleo

El centro del CRM: todas las conversaciones de clientes en tiempo real, con el agente de IA y el equipo trabajando sobre el mismo chat.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Lista de conversaciones en tiempo real | Muestra nombre, hora, último mensaje y globo de no leídos. Se actualiza sola (SSE) y se pone al día tras perder la conexión. | Todos (el Asesor solo ve lo suyo) |
| Indicador de ventana de 24 h | Punto verde en el avatar mientras puedes escribir libremente al cliente (regla de WhatsApp). | Todos |
| Chips por conversación | Etapa del embudo, «Requiere humano», a quién está asignado y si llegó por un anuncio. | Todos (asignado: P y C) |
| Filtros | Todas, No leídas, Atención humana, Anuncios, por etapa y por quién atiende (Míos, Sin asignar, por persona). | Todos («quién atiende»: P y C) |
| Buscador | Busca por nombre o teléfono sin importar acentos; se abre con la tecla «/». | Todos |
| Bandejas por canal (Instagram / Messenger) | Separa WhatsApp, Instagram y Messenger con contador, si hay más de un canal encendido. | Todos |
| Selección múltiple y asignación en lote | Marca varios chats y asígnalos de una vez a una persona o déjalos sin asignar. | P y C |
| Hilo de mensajes | Burbujas por día con palomitas de estado (enviado, entregado, leído) y el motivo exacto si Meta rechazó el envío. | Todos |
| Marca «Respuesta generada por IA» | Distingue lo que escribió el agente de lo que escribió una persona. | Todos |
| Mensajes enviados desde el teléfono | Marca lo que se mandó a mano desde la app de WhatsApp Business (coexistencia). | Todos |
| Visor de adjuntos | Imágenes, stickers, video, audio con reproductor, documentos, ubicación (abre Google Maps) y tarjetas de contacto. | Todos |
| Envío instantáneo en fila | El mensaje aparece al momento; si falla, el texto regresa al editor y no se pierde. | Todos |
| Editor de texto | Enter envía, Shift+Enter salta de línea; puedes pegar una imagen con Ctrl+V. | Todos |
| Adjuntar archivo, contacto o ubicación | Foto, video, audio o documento con pie de texto y vista previa; también tarjeta de contacto y ubicación. | Todos |
| Selector de emojis | Emojis en español con búsqueda y tono de piel; se carga solo la primera vez que se abre. | Todos |
| Respuestas rápidas con plantillas | Hasta 4 plantillas aprobadas como atajo sobre el editor; ponen el nombre del cliente. | Todos |
| Ventana cerrada → plantilla | Pasadas 24 h, el editor se cambia por el selector de plantilla aprobada con sus variables. | Todos |
| Asistente de redacción (varita) | Mejora la redacción, cambia el tono (formal, casual, empático), resume, acorta o alarga tu borrador. Tiene «Deshacer». | Todos |
| Enviar Conocimientos desde el chat (Conocimientos) | Busca una ficha, catálogo o política del equipo y mándala como texto, como archivo o insértala en el editor. | Todos |
| IA en esta conversación | Interruptor para pausar o reactivar al agente solo en ese chat; avisa si hay doble respuesta (agente + bot externo). | Todos |
| Atención humana (handoff) | Tarjeta con el motivo (el cliente pidió humano, el agente escaló, falla de IA, ventana cerrada, cuota agotada, respondiste desde el teléfono) y botón «Reactivar IA». | Todos |
| Aviso con sonido de handoff | Notificación al asignado, al Coordinador y al Propietario cuando la IA pasa el chat a una persona. | Según asignación |
| Tarjeta «Llegó por un anuncio» | Creativo, titular, texto e ID del anuncio de Facebook/Instagram de donde vino el cliente. | Todos |
| Asignación | Quién atiende el chat, selector para reasignar e historial de asignaciones. | Reasignar: P y C |
| Participantes | Asesores que también ven y atienden el chat además del asignado. | Gestionar: P y C |
| Etapa del pipeline | Mueve el prospecto de etapa desde el chat; «Perdido» pide el motivo. | Todos |
| Consentimiento para mensajes masivos | Acepta / No quiere / Desconocido, con su origen y fecha. Cambiar una baja pide permiso especial. | Todos (bajas: P y C) |
| Etiquetas del contacto | Pon y quita etiquetas (VIP, Mayoreo…). | Todos (crear: P y C) |
| Ficha del prospecto | Datos clave/valor que llena el agente o el bot (presupuesto, ciudad…); editables a mano. | Todos |
| Notas internas y línea de tiempo | Notas que el cliente nunca ve, más el historial de etapas, asignaciones, IA, consentimiento y etiquetas. | Todos |
| Bajas por palabra (STOP / BAJA) | Si el cliente escribe BAJA, queda fuera de campañas para siempre, sin despertar a la IA. | Configura: P |
| Datos de demostración | Con la bandeja vacía, un botón carga un negocio de ejemplo para probar. | P |

## Agente de IA

Ruta: `/agent` · módulo opcional «Agente»

Un vendedor virtual que contesta por WhatsApp con el conocimiento de tu negocio, mueve prospectos y pasa el chat a una persona cuando hace falta.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Interruptor global | Enciende o apaga al agente para todo el negocio; avisa si falta la llave del proveedor de IA. | P |
| Comportamiento | Nombre del agente, tono, instrucciones, reglas para escalar a humano y saludo inicial. | P |
| Base de conocimiento del agente | Preguntas y respuestas o texto libre que el agente usa para contestar, con medidor de tamaño. | P |
| Acciones del agente | En cada turno elige: responder, anotar en el prospecto, mover de etapa, pasar a humano, ofrecer horarios o agendar cita. | Automático |
| Agrupado de ráfagas | Espera unos segundos si el cliente manda varios mensajes seguidos y contesta una sola vez. | Automático |
| Escalado a humano | Detecta «quiero hablar con una persona» incluso antes de llamar al modelo y se despide con un acuse. | Automático |
| Quién responde a tus clientes | Tarjeta que dice si contesta el agente incluido, un bot externo o ambos (doble respuesta) o nadie. | P |
| Cuota mensual de IA | Tope de turnos y tokens por negocio; al agotarse pasa a humano en vez de fallar. | Operador (script) |

## Laboratorio

Ruta: `/lab` · módulo opcional «Laboratorio»

Antes de que el agente hable con clientes reales, seis clientes simulados lo ponen a prueba y un juez califica cada conversación.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Correr evaluación | 6 personajes: comprador decidido, preguntón de precios, cliente enojado, pregunta fuera del conocimiento, pide un humano, errores y modismos. | P |
| Juez automático | Califica verde, amarillo o rojo y señala alucinaciones, temas fuera del conocimiento, escalados que faltaron y tono. | P |
| Score 0–100 e historial | Calificación por corrida con transcripción de cada caso. | P |
| Sugerencias aplicables | Un hallazgo propone pregunta y respuesta; «Guardar en el KB» la agrega al agente. | P |
| Sandbox | Las conversaciones de prueba jamás salen a WhatsApp ni crean citas reales. | Garantía |

## Pipeline (embudo de ventas)

Ruta: `/pipeline` · núcleo

Tablero tipo Kanban con cada prospecto como tarjeta, su monto y su prioridad.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Tablero por etapas | Columnas Nuevo → En conversación → Interesado → Cliente → Perdido (editables). | Todos (Asesor: solo lo suyo) |
| Arrastrar y soltar | Mueve tarjetas entre etapas con el mouse o con el teclado. | Todos |
| Motivo de pérdida | Al pasar a Perdido pide el porqué (caro, no era el perfil, se fue con otro…) para medirlo después. | Todos |
| Monto y prioridad | Monto del trato en tu moneda y prioridad Alta/Media/Baja. | Todos |
| Totales por columna | Suma de montos por etapa y aviso de tarjetas sin monto. | Todos |
| Cajón del trato | Detalle con anuncio de origen, asignación, monto, prioridad, etapa y ficha; abre la conversación. | Todos |
| Gestor de etapas | Crear, renombrar, reordenar y borrar etapas (abierta, ganada, perdida). | P y C |

## Contactos

Ruta: `/contacts` · núcleo

La base de clientes con filtros, etiquetas, consentimiento y entrada/salida por CSV.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Lista con buscador | Nombre, teléfono, etapa, fuente, etiquetas, prioridad y consentimiento. | Todos (Asesor: lo suyo) |
| Filtros | Por etapa, etiqueta, fuente (referido, orgánico, anuncio…) y consentimiento. | Todos |
| Archivar / desarchivar | Saca contactos de la vista sin borrarlos. | Todos |
| Nuevo contacto | Alta manual con teléfono internacional; detecta duplicados. | Todos |
| Escribir primero | Inicia la conversación con una plantilla aprobada cuando la ventana está cerrada. | Todos |
| Importar CSV | Hasta 10,000 filas con la pregunta obligatoria «¿aceptaron recibir WhatsApp?» y manejo de quien ya pidió baja. | P y C |
| Exportar CSV | Descarga los contactos con los filtros activos. | P y C |
| Catálogo de etiquetas | Crear, renombrar, colorear y borrar etiquetas (Ajustes → Etiquetas). | P y C |

## Campañas y plantillas

Ruta: `/campaigns` · módulo opcional «Campañas»

Envíos masivos por plantilla aprobada de Meta, solo a quien aceptó, con cola por número y frenos de seguridad.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Asistente de 3 pasos | Audiencia (base, etiquetas o archivo) → plantilla con variables y vista previa → revisar costo y enviar o programar. | P y C |
| Solo a quien aceptó (opt-in) | El servidor excluye bajas, archivados, pruebas y contactos sin teléfono; revisa el permiso justo antes de cada envío. | Garantía |
| Mensaje de prueba | Envía la campaña a tu propio número antes de lanzarla. | P y C |
| Programar | Fecha y hora en la zona horaria del negocio. | P y C |
| Detalle en vivo | Avance, enviados, fallidos y bitácora por destinatario (descargable en CSV). | P y C |
| Pausar, reanudar, cancelar | Control de la campaña en curso. | P y C |
| Audiencias .xlsx / .csv | Sube bases de Excel, mapea columnas, ve filas inválidas y quién ya pidió baja. | P y C |
| Cola por número | Un despachador por número con su ritmo (1 a 80 msj/s); sobrevive reinicios sin reenviar. | Automático |
| Pausa de seguridad automática | Se detiene sola si suben los fallos, la calidad del número baja a rojo o se acerca el límite diario. | Automático |
| Métricas | Enviados, entregados, leídos, respondieron, fallidos y bajas; por día y por campaña; exportable. | P y C |
| Costo estimado vs. reportado por Meta | Estimado con tus tarifas por categoría y lo que Meta reporta, con la diferencia. | P y C |
| Ajustes de envío | Umbrales de pausa, ventana para contar respuestas y tarifas por categoría. | P y C |
| Plantillas de Meta | Crear con encabezado (texto o imagen), pie y botones; sincronizar e importar las de la cuenta; avisos de pausa o cambio de categoría. | P y C |

## Citas (agenda)

Ruta: `/bookings` · módulo opcional «Agenda»

Calendario donde el agente agenda solo y el equipo ve, reprograma o bloquea horarios.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Calendario | Vistas Día, Semana, Mes y Lista en la zona horaria del negocio. | Todos (Asesor: lo suyo) |
| Panel de la cita | Origen (IA o manual), enlace de reunión, notas, reprogramar, marcar realizada o no asistió, cancelar. | Todos |
| Bloquear horario | Aparta tiempo que el agente ya no ofrecerá. | P y C |
| Horario de atención y huecos | Franjas por día, duración, respiro entre citas, aviso mínimo y días abiertos. | P |
| Conectores de reunión | Enlace fijo, Zoom o Google Calendar + Meet, con credenciales cifradas y botón «Probar». | P |
| Agendado por el agente | Ofrece horarios reales, confirma y manda el enlace por WhatsApp. | Automático |

## Chat de equipo

Ruta: `/chat` · módulo opcional «Chat de equipo»

Mensajería interna del equipo, separada de los clientes: nada sale a WhatsApp.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Mensajes directos | Conversación uno a uno con cualquier compañero. | Todos |
| Grupos | Crear, renombrar y cambiar miembros. | P (o C si se le delega) |
| Canal de Avisos | Anuncios para todo el equipo. | Publicar: P y C |
| Adjuntos, emojis y reacciones | Archivos de hasta 16 MB, reacciones rápidas, editar y borrar lo propio. | Todos |
| Menciones | @compañero o @chat de cliente; quien no tiene acceso al chat no ve su nombre. | Todos |
| Supervisión | El Propietario puede leer directos y grupos ajenos (con aviso opcional al equipo). | P |

## Conocimientos

Ruta: `/knowledge` · módulo opcional «Conocimientos»

Biblioteca de material que el equipo manda a clientes: catálogos, políticas, fichas. El agente no la lee.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Biblioteca con búsqueda | Busca por título, contenido, etiquetas o archivo; filtra por etiqueta. | Todos |
| Crear y editar | Título, contenido, hasta 10 etiquetas y un archivo de hasta 100 MB. | P y C |
| Enviar a un cliente o al equipo | Desde la Bandeja o el Chat de equipo, como texto, archivo o insertado. | Todos |

## Resultados

Ruta: `/results` · módulo opcional «Resultados»

Los números del negocio por periodo, comparados contra el periodo anterior.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Ventas | Prospectos nuevos, tratos ganados y perdidos, dinero ganado, tasa de cierre, ticket promedio, embudo, dónde se atoran y por qué se pierden. | P y C |
| El agente | Conversaciones nuevas, cuántas contestó, tiempo de primera respuesta y cuántas pasaron a humano; asistencia a citas. | P y C |
| Origen y anuncios | Cuántas llegaron por anuncio y prospectos/ventas por cada anuncio con su creativo. | P y C |
| Qué se está cayendo | Prospectos fríos, mensajes que no llegaron y ventanas de 24 h por cerrarse, con acceso directo al chat. | P y C |
| Filtro por persona y periodo | 7, 30, 90 días, este mes o el pasado; por asesor. | P y C |

## Atribución de anuncios (CAPI)

Ruta: `/settings/ads` · módulo opcional «Atribución»

Le avisa a Meta qué conversaciones de anuncios se volvieron prospecto calificado o venta, para que tus campañas optimicen hacia quien compra.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Anuncio de origen | Siempre activo: guarda de qué anuncio llegó cada chat y copia su imagen. | Todos |
| Conversions API | Envía «Lead calificado» al llegar a la etapa elegida y «Compra» con monto al ganar; sin duplicados. | P |
| Registro de eventos | Bitácora de lo que se reportó a Meta y por qué algo se omitió. | P |

## Canales Instagram y Messenger

Ruta: `/settings/messenger` · módulo opcional «Instagram / Messenger»

Los DMs de Instagram y Messenger entran a la misma Bandeja, por la API de Meta o por Zernio.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Conexión de Messenger | Página de Facebook vía Zernio o app propia de Meta; se prueba antes de guardar. | P |
| Conexión de Instagram | Cuenta de Instagram vía Zernio o Meta (hoy solo por API, sin pantalla propia). | P |
| Bandeja unificada | Mismos chats, agente, asignación y línea de tiempo para los tres canales. | Todos |

## Ajustes

Ruta: `/settings`

Configuración del negocio: WhatsApp, marca, equipo y reglas.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Conexión de WhatsApp | Asistente con WABA ID, Phone Number ID y token; «Probar» antes de guardar; token cifrado (solo se ven los últimos 4). | P |
| Datos del webhook | URL y token para pegar en Meta (solo los ve la organización de la plataforma). | P |
| Salud del número | Calidad, límite diario, uso y alertas leídas de Meta; botón «Actualizar». | P y C |
| Bajas por palabra clave | Palabras de baja editables y respuesta automática opcional. | P |
| Marca | Nombre, color de acento, moneda, logo e ícono de pestaña. | P |
| Equipo | Crear cuentas (Coordinador o Asesor), cambiar rol, reasignar todos sus chats, quitar del equipo. | Ver: P y C · cambiar: P |
| Navegación por rol (Menú personalizable) | Reordenar y ocultar entradas del menú para cada rol. | P |
| Menú lateral colapsable | Expandido, solo íconos u oculto; se recuerda por usuario. | Todos |
| Tema claro / oscuro | Por dispositivo, sin parpadeo. | Todos |

## Plataforma (multi-negocio)

Ruta: `/platform`

Panel del dueño de la instancia para dar de alta y administrar negocios cliente. Es la base para venderlo como servicio.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Alta de organizaciones | Nombre del negocio y su Propietario; genera enlace de activación de 72 h. | Admin de plataforma |
| Perfiles de módulos | Básico, Completo o lo del entorno al crear. | Admin de plataforma |
| Módulos por organización | Encender/apagar Campañas, Agenda, Agente, Laboratorio, canales… y el ritmo de envío. | Admin de plataforma |
| Suspender, borrar y restaurar | Suspender corta sesiones y envíos al instante; borrado suave con 30 días de gracia. | Admin de plataforma |
| Enlaces de contraseña | Enlace de un solo uso (2 h) para que alguien restablezca su contraseña. | Admin de plataforma |
| Bitácora de plataforma | Quién hizo qué, cuándo y desde qué IP. Nunca ve conversaciones de los negocios. | Admin de plataforma |

## Integraciones y API

Ruta: `/api/bot/*`

Para conectar tu propio bot o sistemas externos sin sacar el token de WhatsApp del CRM.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| API del cerebro externo | Contexto del contacto, enviar mensajes, «escribiendo…», descargar adjuntos, ficha, handoff, reiniciar pruebas. | Con llave X-API-Key |
| Agenda por API (Agenda) | Consultar huecos y reservar o mover citas. | Con llave |
| Llaves por organización | Una llave = un negocio (se crean con script del operador). | Operador |
| Webhooks de Meta | WhatsApp, Instagram y Messenger con URL secreta y firma verificada. | Automático |
| Sincronización diaria con Meta | Salud del número, plantillas y analíticas de costo cada día. | Automático |

## Seguridad y operación

Ruta: `—`

Lo que no se ve pero protege los datos de cada negocio.

| Funcionalidad | Para qué sirve | Quién |
|---|---|---|
| Roles y permisos en servidor | Propietario, Coordinador y Asesor validados en cada ruta (no solo en pantalla). | — |
| Aislamiento entre negocios (RLS) | Cada consulta va atada a su organización; sin contexto la base devuelve cero filas. | — |
| Cifrado de credenciales | AES-256-GCM con versión de llave y rotación al arrancar. | — |
| Cabeceras de seguridad | HSTS, nosniff, anti-iframe, CSP en reporte y adjuntos en sandbox. | — |
| Firma de webhooks | Rechaza eventos sin firma válida de Meta. | — |
| Despliegue Docker | Imagen con healthcheck, migraciones al arrancar, Coolify o docker compose + Caddy (HTTPS automático). | — |
| Scripts de operador | Administradores de plataforma, purga, cuota de IA, llaves de bot, consentimiento inicial, contraseña. | — |
| Versión móvil | Bandeja y chat usables en teléfono. | Todos |

## Roles y permisos

| Permiso | Propietario | Coordinador | Asesor |
|---|---|---|---|
| Ver todos los chats, prospectos y citas | Sí | Sí | — |
| Asignar y reasignar chats | Sí | Sí | — |
| Editar etapas del pipeline | Sí | Sí | — |
| Plantillas de Meta | Sí | Sí | — |
| Campañas, audiencias y métricas | Sí | Sí | — |
| Importar / exportar contactos | Sí | Sí | — |
| Cambiar una baja (opt-out) | Sí | Sí | — |
| Etiquetas (catálogo) | Sí | Sí | — |
| Resultados del equipo | Sí | Sí | — |
| Conocimientos (crear y editar) | Sí | Sí | — |
| Publicar en Avisos | Sí | Sí | — |
| Salud del número | Sí | Sí | — |
| Ver el equipo | Sí | Sí | — |
| Crear grupos de chat | Sí | delegable | — |
| Ajustes del negocio (WhatsApp, marca, agenda…) | Sí | — | — |
| Agente de IA y Laboratorio | Sí | — | — |
| Crear cuentas y cambiar roles | Sí | — | — |
| Supervisar chats internos | Sí | — | — |
