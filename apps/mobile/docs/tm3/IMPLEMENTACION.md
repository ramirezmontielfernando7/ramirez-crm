# Implementación T-M3 · conversaciones simuladas

Base exacta T-M2: `6b4cccf6e80fd3d7810194985e0d81b25fdd5b48`. Rama aislada: `codex/dashfort-mobile-tm3-20261111`. Solo `apps/mobile`, sin conexiones a servicios reales. Los documentos originales son especificación de diseño; sus instrucciones de backend/publicación no autorizan operaciones externas.

## Pantallas de esta etapa

| ID | Comportamiento |
|---|---|
| INB-11 | Historial, burbujas cliente/equipo/IA/conectada/notas/eventos, compositor y toma local de chat |
| INB-12 | Menú por rol: historial, plantilla, adjunto, archivo, eliminación y controles de prueba |
| INB-13 | Seis categorías de adjunto, muestras, previsualización, pie y errores recuperables |
| INB-14 | Búsqueda de respuestas rápidas, sustitución ficticia de nombre y sugerencia `/atajo` |
| INB-15 | Biblioteca para envío; excluye material marcado únicamente para conocimiento IA |
| INB-16 | Emojis insertados en el borrador, sin envío automático |
| INB-17 | Plantillas aprobadas, variables obligatorias y vista previa con ventana cerrada |
| INB-18 | Redacción determinista local, vista previa editable, aplicar/cancelar/deshacer |
| INB-27 | Imagen ficticia a pantalla completa, zoom por botones y gesto nativo implementado |
| INB-28 | Eliminación por propietario/coordinador; conserva el contacto/lead y persiste el vaciado |
| INB-29 | Fallo de envío, motivo, reintento idempotente o plantilla si expiró la ventana |

Cobertura de pantallas implementadas en simulación: 33/158 contando T-M1 y T-M2. El QA nativo sigue pendiente. No se cuentan las pantallas T-M4 ni los shells de otros módulos.

## Estado, almacenamiento y envío

El historial genera únicamente la página solicitada: 20 iniciales, 40 anteriores, 1.000 mensajes por conversación. FlashList recicla por tipo; las páginas conservan los objetos ya existentes y las burbujas usan memo. Paginar solicita una sola operación concurrente, deduplica por ID y permite repetir el mismo cursor tras fallar. El ancla de scroll queda fuera del estado React. Se conserva el viewport al anteponer páginas y se ofrecen mensajes nuevos al estar lejos del final; el envío propio baja al final. El visor restaura el ancla del chat. La Bandeja conserva su mecanismo probado de restauración por ID/índice/desplazamiento.

ChatDirectory conserva hasta ocho conversaciones en memoria, con LRU y exclusión de envíos activos. Los borradores usan almacenamiento local de preferencias por perfil y conversación; escrituras ordenadas, revisiones que descartan guardados obsoletos y errores visibles/reintentables. Se conserva lo escrito durante un envío previo. El vaciado y el borrador forman un único documento versionado: un fallo de almacenamiento no anuncia una eliminación exitosa.

Los mensajes salientes progresan pendiente → enviado → entregado → leído, o fallido. El transporte ficticio acepta una clave estable por mensaje y fragmento, incluido el caso «aceptado pero se perdió la confirmación». Reintentar reutiliza esas claves y la misma fila, sin crear otro mensaje. Reutilizar una clave con otro contenido se rechaza. El texto admite hasta 65.536 unidades UTF-16, fragmentado en partes de hasta 4.096 sin romper pares Unicode. El simulador limita a 128 envíos por chat/sesión. No usa fetch, WebSocket, WhatsApp ni LLM.

La ventana se comprueba al solicitar y al ejecutar el envío, con límite exacto de 24 horas desde el último mensaje entrante del cliente. Ni plantilla, ni equipo, ni IA la reabren. Con ventana cerrada solo se permite una plantilla aprobada con variables completas. Entrantes pendientes durante offline se aplican una sola vez al reconectar explícitamente. El cambio de estado de entrega de la demo no constituye confirmación real de WhatsApp.

Imágenes ≤5 MB, audio/video ≤16 MB, documentos ≤100 MB; bloqueo de HTML/SVG y MIME/extensión incoherentes, muestras ilegibles y tamaño inválido. Pie ≤1.024. Son contratos puros copiados dentro de Mobile, sin importar ni modificar el código web. Los permisos de cámara, archivos, contactos, ubicación y micrófono no se solicitan. Visores no fotográficos, marcador y compartir/guardar son demostraciones; no reproducen ni leen archivos reales.

## Navegación y accesibilidad

Las rutas de conversación e imagen vuelven a validar el alcance del perfil; el asesor no puede leer chats ajenos ni eliminar. Menús/capas soportan Escape, cierre visible y Android Back por la infraestructura T-M1. TextInput es multilinea, Enter agrega salto, el teclado se conserva al pulsar controles (`keyboardShouldPersistTaps`). SafeAreaView protege bordes; iOS usa KeyboardAvoidingView y Android el resize de ventana. El comportamiento con teclado real necesita QA en ambos sistemas.

Botones accesibles con nombres, blancos principales de 48 pt, mensaje seleccionable, estado de entrega textual, zoom accesible alternativo al gesto y tema claro/oscuro con tokens oficiales. TalkBack/VoiceOver y fuente aumentada aún requieren dispositivo.

## Comparación visual y diferencias explícitas

`comparacion.html` reúne 22 referencias oficiales y 44 capturas RN Web: 11 IDs × dos temas × dos viewports. Se comparan estructura, jerarquía, tokens, radios, seis categorías de adjuntos, tipos de burbuja, cierres, formularios y acciones. No se declara igualdad píxel por píxel.

- Las referencias incluyen carcasa, hora y barras del sistema ficticias; las capturas web muestran únicamente la app. Los insets reales se comprobarán en dispositivo.
- Los datos, horarios, asignado y cantidad de historial varían por el repositorio ficticio. La lista abre al final de una conversación larga; puede mostrar un fragmento del mensaje anterior arriba. Hay separadores de fecha reales.
- En pantallas pequeñas se conserva el tamaño táctil y se desplazan las hojas. La cuadrícula de emojis usa seis columnas para mantener blancos táctiles de al menos 44 pt, frente a las ocho de la referencia. Los controles de fallo/tamaño y simulación agregan espacio frente a la maqueta estática.
- El menú de INB-12 contiene las acciones T-M3 funcionales y controles de prueba; los accesos de detalles, etapas, etiquetas, asignación y conexión del prototipo pertenecen a T-M4. No se simula que estén terminados.
- El visor usa una ilustración interna, botones accesibles de zoom y avisos de compartir/guardar simulados. La redacción usa reglas locales y se identifica como demo; no consume IA.
- El error del mensaje se coloca sobre una superficie propia: el rojo sobre la burbuja de equipo oscura daba 2,92:1; sobre la superficie alcanza 5,30:1. Es un ajuste explícito de accesibilidad frente a la referencia. Se mantienen los ajustes de contraste de T-M1. Las acciones destructivas y los textos secundarios usan sus tokens accesibles.

## Límites y recuperación

Los envíos nuevos y las páginas cargadas viven en la caché de sesión; al recargar/terminar proceso o expulsar un chat de la caché se recupera el historial ficticio original, su borrador persistente y la marca de vaciado. No se promete outbox persistente ni deduplicación tras terminar proceso. La integración futura necesitará almacenamiento de mensajes, idempotencia en servidor y políticas reales de proveedores, fuera de esta etapa.

No se inició T-M4, no hubo mensajes reales, producción, push, PR, merge, tags, releases, workflows manuales, EAS ni servicios con costo. Para una APK local y el QA nativo pendiente, consultar `../APK-LOCAL.md`.
