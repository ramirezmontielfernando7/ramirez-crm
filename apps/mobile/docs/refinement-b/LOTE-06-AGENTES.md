# Lote 06 · Agentes y pausa solicitada

Base verificada: `7ee7fd91001e42c42e767fb89efa8efde4453d7c`, rama `codex/dashfort-mobile-b-continuation-20261119`.

**Se implementan LAB-01, LAB-02, LAB-03, LAB-04, LAB-08, LAB-09 y LAB-09A. Total 86/158 IDs; 72 pendientes.** Se detiene la ejecución por petición expresa del propietario antes de iniciar el siguiente lote de validación. No se suman otros IDs aunque existan contratos o métodos preparados.

## Funciones comprobadas

- Lista virtualizada de agentes con resumen ficticio coherente con Resultados, estado general/publicado/borrador/pausa, acceso al creador y editor.
- Creador conversacional determinista, sin IA ni créditos: conserva conversación y genera/ajusta un borrador. Las sugerencias usan el mismo flujo; error de almacenamiento conserva el texto y permite reintentar sin duplicar.
- Editor por secciones: identidad, instrucciones, tono, handoff, saludo y conocimiento. Guardado local de borradores con debounce de 650 ms; los cambios no modifican ninguna versión publicada. Entrada nueva durante una escritura lenta se conserva y se guarda después. Ante fallo, el formulario mantiene el búfer y ofrece reintento.
- Vista previa sin efectos: conversación y decisiones ficticias, modelo explícitamente local, tokens estimados/simulados y fuentes indexadas permitidas. No escribe chats, preview de Bandeja, versiones ni conversación del creador.
- Menús, nuevo agente en blanco, nombre interno independiente del nombre de presentación, pausa por agente, archivo con elección de documentos y retorno seguro. El agente general no se puede archivar hasta elegir otro publicado.
- Archivo y documentos exclusivos se actualizan en **una escritura**: pasar a General o quitar Lectura IA; si un archivo también tiene destino Chat se conserva. Incluye referencias de documentos que ya tenían Lectura IA desactivada, evitando lectores huérfanos.
- Roles anteriores: Estudio disponible para Propietario. Coordinador y Asesor son rechazados por pantalla y operaciones. Aislamiento por organización/usuario ficticios mediante la clave existente de Biblioteca.

## Arquitectura y diseño

`LibraryStore` extiende su documento local con un bloque opcional `studio`, compatible con el formato anterior. Conserva agentes, borradores, versiones, referencias, recibos y contratos de los siguientes sublotes. Si el bloque no existe, lo restaura desde las muestras aprobadas sin sobrescribir el archivo anterior. Los lectores de Conocimiento ahora provienen de esos agentes y sus nombres, en lugar de duplicar un catálogo estático. Una transacción atómica permite archivar junto con sus referencias de documentos.

`StudioStore` conserva búferes, serializa operaciones e identifica reintentos. Los snapshots publicados son inmutables; hay controles de revisión, tamaño, rol y referencias. Se añaden identidades locales para las etapas actuales del repositorio ficticio, preparando asignaciones; el listado y funcionamiento previo del Pipeline se mantienen. La persistencia/recreación de etapas y la reconciliación de asignaciones requieren pruebas del próximo sublote correspondiente; no se acreditan como completadas aquí.

La pestaña Estudio abre Agentes. Conocimiento sigue usando su panel y el mismo LibraryStore. Editor y creador son rutas internas protegidas, sin TabBar. Encabezados modulares usan B original; los internos conservan 17/22 y las maquetas con subtítulo. No cambian tokens, tipografías globales, componentes aprobados, dependencias ni configuración Android. Burbujas y compositor de prueba usan componentes RN reales, con los tokens existentes y sin horas/estados de entrega fingidos de un mensaje real.

## Verificación

- **303 pruebas de lógica aprobadas**: 22 nuevas y las 281 anteriores. TypeScript y formato aprobados.
- Casos: lectores únicos, roles, nuevo borrador/restauración/idempotencia, creador/ajustes/reintento, escritura lenta con texto posterior, error de guardado, separación borrador/publicado, preview sin efectos/fuentes permitidas, renombrar, archivo atómico y fallido, conservación de Chat, general protegido, conflictos, caché inválido, otra organización, observadores reentrantes y snapshots inmutables.
- **32 capturas reales**: siete IDs × dos temas × dos tamaños (28), más cargando/vacío/offline/error (4). **14 referencias** oficiales. Galería `evidence/agents/comparacion.html`.
- Ocho comprobaciones web agrupadas: siete IDs/rutas, creador/error/reintento, editor/acordeones/autoguardado, preview, renombrar/pausa, archivo/cancelar, Agentes↔Conocimiento y roles. También recuperación del estado de error.
- Regresión de Conocimiento: seis comprobaciones agrupadas, 18 capturas reales y seis referencias. Ahora comprueba que la pestaña Agentes es real y permite volver a Conocimiento; no espera un marcador pendiente que ya fue sustituido.
- Cero errores de página y solicitudes de red. Chromium offline con UI, proveedores y capas reales; sesión, almacenamiento y host de navegación son dobles. Sin servidor HTTP/Metro.

Esto es **código RN implementado y QA web**. No acredita Expo Router completo, teclado Android/iOS, TalkBack/VoiceOver, gestos, scroll nativo ni funcionamiento tras terminar el proceso. No se genera APK: ~1,7 GiB libres sigue siendo insuficiente. La APK 0.1.2, firma y respaldos anteriores se conservan; la configuración preparada 0.1.3 no cambia.

## Qué está preparado, pero NO se cuenta

El modelo y algunas capas contienen publicación local, carga de versiones, general y pausa global porque los menús/editor dependen de esos contratos. **LAB-05/06/06C/07 siguen pendientes de su lote completo de pruebas y capturas.** No es publicación real ni activación de atención a clientes. Asignación y Pruebas siguen sin pantallas funcionales: no se contabilizan LAB-20/21/30/31.

## Reanudación exacta

1. Confirmar la rama, árbol limpio y commit de este checkpoint, sin rehacer los siete IDs entregados.
2. Continuar **LAB-05, LAB-06, LAB-06C y LAB-07**: validar publicación/versionado local, cargar al borrador sin alterar lo publicado, confirmaciones/cancelar, pausa global y fallback a persona. Añadir pruebas adversariales e idempotentes, capturas y regresión. Ya existen `StudioStore.publish/loadVersion/pauseAll/makeGeneral` y las capas en `overlays.tsx`; revisarlos y completar lo necesario, no duplicarlos.
3. Después LAB-20/21: vincular etapas reales del repositorio ficticio y agentes publicados/no generales; probar eliminación/recreación de etapas, persistencia, conflictos y pausa.
4. Después LAB-30/31: simulaciones sin IA/créditos, snapshot de la versión probada, errores/repetición/arreglo solo en borrador y destino del asistente. No contar un enlace pendiente como resuelto.
5. Continuar otros IDs solo cuando el propietario avise que se puede retomar. No compilar Android sin almacenamiento suficiente ni activar servicios/infraestructura.

Backend reservado `562a8b386b7f0d0df9292406167357aa988fd4d0` sin cambios/arranque. Todo cambio pertenece a `apps/mobile`. Sin push, PR, merge, despliegue, publicaciones remotas, proveedores, bases de datos, WhatsApp, autenticación/HTTP real o costos.
