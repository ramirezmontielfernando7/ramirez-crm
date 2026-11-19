# Lote 05 · Conocimiento compartido con Biblioteca

Desde `1c63841cce16c4d569df70aaaac038d3021d70de`, misma rama aislada B. **LAB-10, LAB-11 y LAB-12 implementadas; 79/158 IDs, 79 pendientes**. No se cuentan Agentes, Asignación ni Pruebas: sus pestañas indican «Próximo lote» y permiten volver a Conocimiento.

## Funciones y coherencia

Estudio IA abre la sección Conocimiento, con encabezado modular B, pestañas aprobadas, grupos, listado virtualizado y hojas nativas de carga/detalle. Se usan la misma fuente y la misma instancia `LibraryStore` que CRM/Biblioteca. Las entradas marcadas Lectura IA aparecen sin copiar archivos. Cambios de título/grupo/destino son visibles en ambos módulos; el editor de Biblioteca conserva y muestra el grupo actual.

El catálogo inicial muestra las tres entradas Lectura IA que ya existen en Biblioteca. No inventa una copia de catálogo ni añade muestras a la Biblioteca aprobada. Los estados Procesando y No se pudo leer se generan al elegir las muestras de manual y escaneo en el cargador. La galería incluye esos estados y las cuatro variantes generales de carga/vacío/error/offline.

Carga exclusivamente metadatos ficticios de PDF/TXT/MD, hasta 20 MB. «Elegir archivo» ofrece muestras incluidas: **no abre archivos del teléfono**, no sube bytes ni extrae texto. Grupos propios persistentes, «Todos los agentes» o dos lectores ficticios estables de las maquetas (Ventas — general, Citas y agenda), vista Exclusivos. Estos lectores son un catálogo de referencia: no representan agentes ejecutándose ni prueban sus pantallas pendientes.

La indexación es simulada mediante un único temporizador de 1,2 segundos, solo con la pantalla montada y la app activa. Se cancela al salir/pasar a segundo plano. Tras reiniciar puede completar los registros ficticios pendientes al entrar; no hay cola, trabajador ni proceso permanente nativo. Un fallo de escritura conserva el estado anterior y ofrece reintento; no entra en un ciclo continuo de intentos. No se usa RAG/IA real ni se consume crédito.

Borrar un documento compartido con Chat **solo desactiva Lectura IA**, conservando archivo y destino Chat. Una entrada exclusiva de IA se borra con confirmación explícita. Traslado, borrado y finalización comprueban versiones. Los documentos creados exclusivamente en Estudio no se filtran al selector de material para Chat ni a la lista anterior de Biblioteca; sus metadatos y grupos sí comparten el documento atómico de almacenamiento.

La extensión opcional del formato anterior conserva esquema 1 y restaura documentos sin metadatos nuevos con valores General/Todos/Indexado. Valida grupos, lectores, estados y scope antes de aceptar cachés. Estudio mantiene la política de roles existente: Propietario; Asesor/Coordinador no acceden por ruta ni por operaciones. Coordinador conserva sus permisos anteriores sobre Biblioteca, pero no puede abrir por ID un archivo exclusivo de Estudio.

## Pruebas y evidencia

- **281 pruebas de lógica aprobadas**: 15 nuevas, las 266 anteriores conservadas. TypeScript y formato aprobados.
- Se prueban fuente única, conservación de Chat, carga, indexación legible/fallida, no escrituras repetidas, grupo persistido/restaurado, lector exclusivo, roles y acceso directo, límites/tipos, error/reintento, versiones obsoletas, borrado sin resurrección, formato anterior, scope/caché inválido y tamaño UTF-8 sin depender de TextEncoder en Hermes.
- **18 capturas reales**: tres IDs × dos temas × dos tamaños (12), procesando/fallido (2), cuatro estados (4). **6 referencias oficiales**. `evidence/knowledge/comparacion.html` compara las dos versiones; los datos provienen de Biblioteca y pueden diferir del prototipo estático.
- Seis comprobaciones agrupadas de navegación/comportamiento de Conocimiento, más estados capturados. Cero errores de página/cero solicitudes de red.
- Regresión completa de Biblioteca: siete comprobaciones agrupadas, 24 capturas reales y seis referencias. Búsqueda, destinos, adjuntos ficticios, edición, borradores/descarte, guardar/reintentar/restaurar, carpeta/etiqueta/borrar, roles y ruta directa.
- Se repitieron Tareas y Resultados después de integrar Conocimiento: diez y siete comprobaciones agrupadas, respectivamente; sin errores/red. Incluyen scroll real de navegador, TaskSheet anterior, contacto canónico y conservación de filtros.

## Corrección de evidencia visual

La inspección de PNG detectó una carrera en el capturador: algunas imágenes se guardaban antes de que el portal Modal hubiera dibujado la hoja. Los recorridos funcionales pasaban porque los controles se esperaban antes de interactuar. `scripts/qa-settle.mjs` ahora espera el título de cada hoja y dos frames antes de guardar la imagen. Se regeneraron las comparaciones de Tareas y Resultados; los archivos anteriores siguen recuperables en sus commits originales. No se cambia LayerProvider ni el diseño para corregir una prueba.

Toda esta QA es **RN Web/Chromium offline**, con componentes/proveedores/capas reales y dobles del host de sesión, navegación y almacenamiento. No acredita Expo Router completo, Android/iOS, procesamiento nativo ni notificaciones. Las pestañas pendientes no se contabilizan como funcionalidad terminada.

## Límites y checkpoint

Solo `apps/mobile`. Sin nueva dependencia, cambio de paleta/tokens B, firma, APK ni configuración Android. Backend reservado `562a8b386b7f0d0df9292406167357aa988fd4d0` intacto y sin arrancar. Sin red de aplicación, PostgreSQL, WhatsApp, IA real, producción, servicios externos, push/PR/merge/despliegue o costos. El espacio sigue siendo insuficiente para Gradle; no se intenta compilar ni se elimina otro respaldo.

Se entrega un checkpoint verificable por límite de esta ejecución, con commits por lote, bundle incremental y paquete offline nuevos. No se declara completado el proyecto entero ni se ocultan las 79 pantallas pendientes.

**Siguiente lote exacto:** Agentes LAB-01/02/03/04 y menús LAB-08/09/09A, con repositorio ficticio de borradores que reutilice los IDs `demo-agent-a1/a2`. Después versiones/confirmaciones LAB-05/06/06C/07, y solo después Asignación LAB-20/21 y Pruebas LAB-30/31. «Publicar» en ese módulo debe ser únicamente una transición local simulada con confirmación; no activar agentes reales ni cuotas. Auditar dependencias y maquetas de cada sublote antes de contar sus IDs.

Pendientes nativos: teclado, fuentes al 130–200%, TalkBack/VoiceOver, áreas seguras, Android Back, restauración después de terminar proceso y comportamiento AppState real del temporizador simulado. Para APK: otro almacenamiento local con al menos 15 GiB libres conservadores, misma fuente/keystore experimental, compilación ARM64 local y verificación de firma. No se ha contratado ni activado otro entorno.
