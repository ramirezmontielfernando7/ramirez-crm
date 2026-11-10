# T-M2 · Bandeja con datos ficticios

Rama de trabajo: `codex/dashfort-mobile-tm2-20261110`, creada desde `codex/dashfort-mobile-tm1-20261110` en `5b4c7e54d3949efaf8baf3b0292b216cb50712b9`. No se modifica el respaldo remoto de T-M1 ni main.

## Alcance funcional

- INB-01: lista virtual FlashList con 2.000 conversaciones deterministas, claves estables, avatares, IA activa/en pausa/apagada, cápsulas y no leídos. Respeta texto del sistema; por encima de 130% elimina cápsulas secundarias para conservar la vista previa. Contadores según datos visibles al rol.
- INB-02: búsqueda controlada con actualización diferida, por nombre, teléfono, vista previa y etiqueta. Normalización de acentos y separadores de teléfono precalculada en el repositorio. Las pestañas y chips se ocultan mientras se busca.
- INB-03: selección mediante botón visible o pulsación prolongada. La selección conserva sus IDs al cambiar de pestaña; archivo reversible y asignación ficticia a personas del equipo. Asesor no ve asignación y el repositorio también la rechaza.
- INB-04: menú de filtros, archivados, selección y nuevo chat. Añade un apartado explícito de estados de demostración.
- INB-05: filtros combinados por etapa, etiqueta y responsable; cuenta previa de resultados; limpiar y aplicar. El Asesor mantiene el alcance de sus conversaciones incluso al quitar todos los filtros.
- INB-06: esqueletos de carga y control de finalización de simulación accesible en teléfono pequeño.
- INB-07: vacío y ausencia de resultados con acción para quitar filtros.
- INB-08: error recuperable con reintento; variante sin conexión que conserva datos; eventos ficticios recibidos sin conexión se aplican una sola vez al reconectar mediante el botón de simulación.
- INB-09: campañas sin respuesta fuera de Clientes. Una respuesta de prueba mueve solo esa conversación a Clientes y actualiza su no leído.
- INB-10: buscar contacto ficticio, abrirlo, crear contacto local básico con validación de nombre/teléfono y protección contra duplicados fuera de alcance. La ficha completa de Contactos pertenece a T-M7.

El destino `/conversation/[id]` sirve únicamente para probar apertura/regreso, permisos y restauración. Muestra los datos de la conversación y si requiere plantilla. **No es INB-11, no implementa mensajería y no inicia T-M3**. No envía texto, plantillas, archivos ni push.

## Arquitectura y rendimiento

`src/features/inbox/model.ts` define el contrato del repositorio, datos sintéticos y consulta pura. El adaptador de demo no importa código del CRM ni utiliza endpoints. Comprueba alcance en lecturas y mutaciones, incluidas operaciones masivas; una petición parcialmente prohibida no cambia ningún registro.

`store-core.ts` mantiene un snapshot estable para useSyncExternalStore, filtros, selección, estado y cola ficticia. `store.tsx` conserva una instancia por ID de sesión. Cerrar sesión o cambiar de perfil elimina el estado anterior y evita mezclar datos entre personas. La persistencia cubre navegación en la misma sesión de aplicación; no se promete conservar filtros/selección después de matar el proceso o recargar el documento web.

El scroll se almacena fuera del snapshot y no notifica a React. Al volver, reconstruye la ventana visible de FlashList con el ID estable, el índice y el desplazamiento dentro de la fila, usando initialScrollIndex y sus parámetros. Los datos y la selección no se recargan. Descarta eventos previos a la carga y de vistas sin foco o con filtros anteriores. Cambiar filtros reinicia posición; abrir/regresar conserva posición y consulta. La pestaña Bandeja activa permite volver al principio. Android Back prioriza capas, selección/búsqueda, pila y Bandeja; la ejecución física de Back sigue pendiente.

Las filas usan memo, objetos sin cambios conservan identidad, callbacks de fila estables y renderizado virtual con margen acotado. Las actualizaciones modifican solo el registro afectado. Las cuentas de navegación se suscriben a un selector escalar y no necesitan renderizar por cada cambio de búsqueda o selección.

No se añade SSE real: la autorización limita la etapa a datos ficticios. La cola local ofrece la simulación de recepción/reconexión; un futuro adaptador deberá implementar since/catch-up e idempotencia de eventos del servidor, autorización y límites reales. El pull-to-refresh vuelve a consultar la fuente local y no finge conectividad externa si se ha activado la simulación offline.

## Límites y comprobaciones pendientes

La validación visual y de navegación en Linux usa React Native Web en Chromium. No sustituye Android/iOS. Falta verificar teclado, safe areas de dispositivo, TalkBack/VoiceOver, fuente del sistema a 130%, Android Back, terminación de proceso y perfil de rendimiento nativo. No se midieron FPS, memoria ni batería.

Las 20 imágenes de `reference/` proceden del paquete aprobado. El comparador etiqueta originales y capturas reales de React Native Web. Diferencias explícitas: el navegador no incluye barra de estado ni marco del prototipo; las cantidades corresponden a 2.000 registros; los controles de demo y el destino de retorno no forman parte del producto conectado. Los controles conservan mínimo 48 dp; algunas hojas ocupan más altura y sus pies se desplazan en teléfonos pequeños. No se afirma igualdad píxel por píxel.

No se usan credenciales productivas, servicios de pago, APIs reales ni infraestructura. Los únicos cambios autorizados están en apps/mobile. T-M3 y push/PR/merge/deploy permanecen sin autorización en esta ejecución.
