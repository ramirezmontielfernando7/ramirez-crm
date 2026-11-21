> P1 CANCELADO por decisión posterior del propietario. Documento histórico: no aplicar ni usar como propuesta vigente. Ver [Original corregido](../original-corregido/RESULTADOS.md).

# Teclado y propuesta visual P1: pendiente de aprobación visual y validación nativa

Base exacta de la APK probada: cd13180bd1521a6e39c9e93c21d8161b0918cb9b. Rama local nueva codex/dashfort-mobile-ux-keyboard-20261120. Fuente y lógica anteriores conservadas. La autorización nueva permite corregir el teclado y explorar P1; no sustituye masivamente B ni autoriza push/Actions/otra compilación remota.

## Corrección crítica implementada

Causa comprobada en código: Screen deshabilitaba KeyboardAvoidingView en Android y lo activaba solo con prop explícita. Muchos formularios no la especificaban. Modales usaban otra ventana con otro cálculo. Una navegación inferior flotante puede además tapar campos cuando la ventana se reduce por adjustResize.

Nueva política compartida sin dependencias nativas:
- KeyboardViewport mide su posición/altura en coordenadas de ventana y calcula SOLO su intersección con el IME. Si Android ya redujo la ventana por adjustResize, añade cero. Atiende también Android edge-to-edge donde esa reducción no llega al contenido. No suma la altura del teclado a ciegas ni reutiliza la altura vieja del teléfono en un modal.
- Screen habilita esa política de forma predeterminada. LayerProvider usa la misma política dentro de SU ventana. Sus hojas/diálogos conservan el límite habitual y pueden reducirse con el espacio disponible.
- KeyboardScrollView conserva API, refs/callbacks/offsets de ScrollView y revela el input enfocado al cambiar foco o espacio de teclado. PageScroll y los hosts de formularios compartidos la reutilizan; los compositores flex de Chat/Equipo/Mi número se elevan con su viewport. No se modifica envío, repositorios, navegación de negocio ni datos.
- TabBar se oculta mientras el IME está visible. No cambia su diseño en reposo. Eventos de teclado compartidos, sin polling/procesos permanentes; callbacks de medidas obsoletas se descartan. En iOS se sigue la animación del evento del teclado. Teclados flotantes/split no colapsan toda la pantalla; requieren prueba específica del foco.

Esto es una corrección de código verificada por geometría y regresiones, NO confirmación de que se haya resuelto ya en el Motorola. No hay emulador/dispositivo disponible ni se generó otra APK. Android16/Gboard, teclado alternativo, navegación gestual/tres botones, landscape, flotante y restauración desde segundo plano quedan para validación física; iOS también pendiente.

## Hallazgos de consistencia

1. Clientes y Mi número tienen3 segmentos, Equipo solo2. Cambia ancho de celdas y desaparece el tercer destino. Los contenedores de cabecera también tienen padding diferente. P1 mantiene los3 destinos en un marco único y reutilizable.
2. CRM SectionTabs e Inbox SegmentedControl tienen recetas de radio/padding distintas. FilterChips, etiquetas y etapas mezclan medidas; unificar medidas sin eliminar el significado de etapa/IA/estado.
3. TabBar actual cambia minHeight64/72 según altura de ventana: el teclado puede cruzar ese umbral. El arreglo la oculta con IME; P1 propone altura visual fija y espacio reservado en contenido.
4. Hay paddings inferiores fijos130/140/150/180 y botones absolutos92/100. P1 propone una única función dockReserve(insets) para evitar superposición y huecos. No se aplicó ese cambio visual global aún.
5. App Stack usa animation:none y distintas áreas montan cabeceras propias. La evolución debe mantener un shell de Bandeja estable y reutilizar stores; no forzar remontajes para animar. No hay prueba nativa de rendimiento/flashazos con este lote.

## Propuesta P1: aprobación antes de aplicar

COMPARADOR-P1.html es autónomo y abre sin servidor.24 capturas reales: actual/propuesta × Bandeja/Chat/CRM × claro/oscuro ×390×844/360×640. Los actuales usan pantallas de producción RN Web; P1 es showcase aislado, no reemplaza flujos ni cuenta como IDs nuevos. Sus acciones son demostrativas, sin persistencia en repositorios de la app. La comparación es compositiva, no una prueba pixel-perfect con los datos idénticos.

Sistema propuesto:
- Identidad Dashfort conservada: Inter, acento turquesa, diferenciación de IA/equipo/cliente. Fondos más neutros y jerarquía tipográfica sobria; no SF Pro propietario ni nuevas fuentes obligatorias.
- Header56; título26/32 semibold; nombres15,5; secundario13,5; cuerpo15/21. Margen horizontal16.
- Segmento56 alto, padding4, radio28, cada celda48 alto y ancho exactamenteigual; tamaño calculado del ancho disponible, no de la etiqueta seleccionada. Slider180ms; respeta reducir movimiento. Accesibilidad conserva nombre completo con una línea visual.
- Cápsulas32 visual/48 táctil, radio16 y gap8. Variantes seleccionada/neutra/semántica comparten geometría. No añadir selectores en pantallas que no los necesitan.
- Tarjetas radio20, divisores suaves, iconos22 y targets48. Las filas de Bandeja mantienen información legible; Chat conserva colores de origen y compositor accesible.
- Dock flotante72, radio32, márgenes12, fondo sólido con sombra sutil. Reserva96+inset inferior: el último elemento queda por encima. Se evita blur obligatorio que penalice Android.

Animación/gestos/feedback propuestos para la fase posterior: transform/opacity nativos180–240ms, rutas nativas propias de cada plataforma y Back predictivo Android cuando soporte, scroll y borradores preservados, gesto de hoja solo desde el asa y sin competir con selección/texto. Reducir movimiento elimina desplazamientos. Haptics solo confirmaciones/selecciones relevantes, nunca cada tecla o scroll; requiere evaluar expo-haptics y su permiso Android antes de una nueva dependencia/compilación. No se añadió haptics, nuevos gestos o transiciones a producción en esta fase.

Recomendación: aprobar un único sistema P1 y aplicarlo primero al shell de Bandeja + CRM + Chat, medir en Motorola, después extender por familias. La corrección del teclado puede validarse de forma independiente de la aprobación estética. No cambiar lógica ni añadir servicios.

## Auditoría de los158 IDs y validación

AUDITORIA-158.json recorre los158 IDs y40 módulos fuente, ubicando controles, inputs, capas y hosts compartidos. Es revisión estática/trazabilidad y candidatos de revisión, NO158 auditorías manuales o nativas aprobadas. La auditoría física debe cubrir por familias todos los botones, campos, formularios, modales y rutas de ese registro: teclado/foco/errores/acciones simultáneas, targets, texto grande, contraste, lector, Back/gestos, estados de carga/vacío/error y persistencia al entrar/salir. No se altera el inventario de158 simulados ni se convierte cobertura en aprobación nativa.

610 pruebas de lógica aprobadas (13 nuevas de geometría/foco IME y3 de componentes propuestos), TypeScript/formato aprobados.22 comprobaciones del laboratorio sin erroresJS ni solicitudes de red: invariancia de selector al cambiar todas sus opciones, navegación de muestra, contenido libre del dock, formulario real con viewport compacto y borrador conservado al abrir/cerrar modal. Regresiones Bandeja/Chat/CRM/Contactos70 capturas y recorridos, Equipo, aprobadas. Estas pruebas web NO abren un IME Android real; reducen viewport y prueban layout/foco/datos.

No APK nueva, no Gradle local con~641MiB iniciales, no push/PR/merge/Actions/despliegue/servicios reales. Conservar APK0.1.3 firmada, APK0.1.2, clave,26 protegidos y bundles anteriores. Próximo paso: aprobación de P1 y autorización separada si se desea compilar un candidato del teclado para prueba física. No reutilizar el workflow de una sola ejecución sin autorización.
