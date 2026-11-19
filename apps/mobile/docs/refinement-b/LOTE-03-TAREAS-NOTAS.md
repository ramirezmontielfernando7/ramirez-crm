# Lote 03 · Tareas y Notas compartidas

Desde `cca411de501a21f26ab5ad7e2827bb164d68a133`, misma rama aislada. **CRM-30…33 implementadas; 74/158 IDs, 84 pendientes**. Más sigue siendo un shell y no se contabiliza por añadir enlaces.

## Comportamiento y datos

Tareas: creación con Enter, vista propia/equipo según rol, lista virtual FlatList, completar/reabrir, detalle, título, notas, fecha/hora, responsable activo, contacto buscable, borrado confirmado, conflicto de revisión y errores sin perder el formulario. Se conservan pestaña/filtro/borrador local al navegar. Notas: título opcional, cuerpo, cuatro colores aprobados en claro/oscuro, fijadas/otras, vínculo con contacto autorizado, edición y borrado. Son internas: no modifican mensajes ni previews.

`ContactDirectory.workRepo` es la única fuente de tareas y notas. Chat, ficha de contacto y Pipeline usan sus TaskSheet anteriores, delegando en el mismo repositorio. Las proyecciones del contacto se actualizan al crear, completar, editar, trasladar o borrar. Agenda abre el contacto autorizado desde la fila Cliente de la cita; desde allí se puede gestionar su trabajo. No añade un segundo catálogo ni cambia los formularios previos.

La lectura inicial importa tareas/notas del formato local anterior, solo de documentos del mismo usuario y contactos accesibles. Conserva sus bytes originales. Cuando existe el documento canónico, no vuelve a importar tareas borradas ni trasladadas. Esto es conversión de preferencias locales ficticias, **no una migración de base de datos**. AsyncStorage enumera solo las claves necesarias; los adaptadores antiguos sin enumeración tienen fallback acotado.

Una escritura JSON contiene tarea/nota, asociación, historial y comprobante idempotente. Las respuestas reentrantes no interrumpen la cola. Se comprueban ambos contactos al trasladar, incluso después de escribir; si cambian permisos se revierte. Una reversión fallida bloquea escrituras hasta recargar. Los editores obsoletos no sobrescriben revisiones posteriores. El caché está separado por organización/usuario; la demostración sigue usando una organización, sin sincronización entre dispositivos.

## Verificación

- **254 pruebas de lógica aprobadas**, incluidas 19 nuevas: fuente compartida, traslado atómico, formato anterior, no resurrección, recibos tras reinicio, reintentos, revisiones, permisos/revocación, rollback incierto, historial interno, metadatos, scope, observadores reentrantes, capacidad 5000, payload mutable y validación.
- TypeScript y formato aprobados. Sin dependencias nuevas ni cambios nativos.
- **20 capturas reales**: cuatro IDs × dos temas × dos tamaños (16), más cargando/vacío/offline/error. **8 referencias** originales. Comparación offline: `evidence/work/comparacion.html`.
- Nueve comprobaciones agrupadas de recorrido real RN Web: Más→Tareas, creación/edición/vínculo/completar, nota/color/fijar, escritura fallida y reintento, borrar, Agenda→Contacto, TaskSheet real→Tareas y borrado de vuelta, asesor y estados. Cero errores/cero solicitudes de red.
- Regresión adicional de 19 IDs CRM con proveedores/capas reales y Bandeja→Chat, búsquedas/filtros, ficha/edición y permisos: 70 capturas nuevas en `artifacts/continuation-work/regression`, resultados incluidos. Las 12 capturas raíz Bandeja/CRM/Contactos permanecen iguales (tolerancia máxima de un canal). Chat conserva geometría/estilo; difieren las horas ficticias generadas al ejecutar el historial. No se declara igualdad de píxeles para esos cuatro archivos.

Las capturas son React Native Web/Chromium offline con dobles de sesión, almacenamiento, tema y host de navegación. No son Android/iOS ni un arranque completo de Expo Router. Pendientes: teclado físico/virtual, scroll restaurado nativo, texto ampliado, TalkBack/VoiceOver, gestos y persistencia después de terminar el proceso. No se declara rendimiento nativo por la capacidad probada de 5000 tareas.

## Conservación y siguiente lote

Solo `apps/mobile`. Backend reservado `562a8b386b7f0d0df9292406167357aa988fd4d0` intacto. B original y las APK, firma, bundles y evidencia anterior se conservan. ~1,8 GiB libres sigue siendo insuficiente para el umbral conservador de 15 GiB: no se ejecuta Gradle ni se crea una APK.

Siguiente lote seguro: **Resultados RES-01/RES-02**, con datos ficticios y filtros funcionales, sin atribución ni reporte a Meta. No depende de activar agentes, backend, anuncios ni infraestructura. Después se continúa por dependencias; no se solicita otra aprobación visual de B. No push/PR/merge/distribución, servicios externos, migraciones, producción ni costos.
