# T-M4 · Detalles y acciones de conversaciones

Rama aislada `codex/dashfort-mobile-tm4-20261111`, creada desde el checkpoint de la APK probada (`bd3ba4f`), descendiente del respaldo T-M3 `d849c0d`. T-M1 y T-M2 se conservan como ancestros. Solo cambia `apps/mobile`. React Native + Expo SDK 58, sin dependencias nuevas, sin WebView ni servicios externos.

## Pantallas y comportamiento

| ID | Implementación simulada |
|---|---|
| INB-19 | Detalles desde el encabezado o menú del chat. Nombre, teléfono, ventana real del simulador T-M3, origen de anuncio, etapa, asignado, etiquetas, IA, venta, tareas, consentimiento y acceso al historial. Grupo sin venta ni selector de conexión. Ficha del contacto de solo lectura, sin anticipar el módulo CRM. |
| INB-20 | Historial interno virtualizado, seis filtros, notas internas separadas de mensajes. Eventos de etapa, asignación, etiquetas, IA, conexión, venta y tareas. Borrador y filtro conservados al navegar. |
| INB-21 | Selector de las cinco etapas aprobadas. Elegir Perdido abre INB-25 sin cambiar aún la conversación. |
| INB-22 | Equipo activo ficticio y Sin asignar. Solo Propietario/Coordinador. Asesor mantiene lectura del asignado. No se ofrece personal inactivo. |
| INB-23 | Selección inmediata, validación de catálogo y cierre Listo. La conversación de muestra Cristal Joyas incluye una etiqueta de importación protegida. |
| INB-24 | IA atiende / En pausa / Apagada. Tomar el chat asigna al actor y pausa IA en una sola operación. Advertencia si agente y cerebro externo están simultáneamente activos. |
| INB-25 | Seis motivos, detalle opcional de hasta 2.000 caracteres, cancelar o confirmar. Solo confirma al persistir con éxito; registra motivo en historial. |
| INB-26 | Título, fecha/hora, responsable activo y validación de calendario. Asesor solo se crea tareas propias. Crear, completar y reabrir, con persistencia local y eventos. |
| INB-30 | Meta / Conexión directa / Conexión híbrida. Selector condicionado a complemento, permiso y chat individual. Directa/Híbrida requieren dispositivo ficticio vinculado y ausencia de pausa de emergencia. Meta sigue disponible dentro del selector autorizado. Un error conserva la selección anterior. |

Las instrucciones históricas del paquete que mencionan un PUT real no se ejecutan: prevalece la autorización actual de usar exclusivamente simulación. El acceso «Ir a Conexión directa» abre una muestra local de estado del dispositivo; no implementa SET-02C, no registra teléfonos ni produce códigos de conexión reales.

## Persistencia, permisos y concurrencia

`src/features/contact/model.ts` contiene contratos puros, catálogo activo, reglas de conexión, montos y calendario. `core.ts` implementa un almacén por actor/chat, con AsyncStorage mediante el puerto local existente. Cada operación vuelve a comprobar el alcance y valida los datos antes de guardar. La autorización es de demostración y no sustituye validación en servidor en una futura integración.

Los cambios de etapa, asignado, etiquetas e IA actualizan el repositorio ficticio de Bandeja. Las demás filas conservan identidad. Los selectores de React se suscriben solo a la conversación correspondiente. El chat hidrata los detalles mediante efecto, sin suscribirse al borrador de notas ni a los filtros del historial cuando queda oculto. Cambios de T-M2 en una conversación ya visitada se reconcilian sin notificaciones cuando nada cambió.

La escritura se serializa por conversación. Cada acción acepta un identificador idempotente: repetir la misma solicitud devuelve su resultado, un contenido distinto con la misma clave se rechaza, y una operación fallida se puede reintentar. La selección visible no se adelanta al guardado. Si Bandeja cambia el objeto mientras se guarda, se revierte el documento y se pide reintento, evitando sobreescribir el cambio concurrente. Al finalizar también se reconcilia la selección visible. Durante hidratación, solo los campos que realmente cambiaron en Bandeja prevalecen sobre su versión guardada: una actualización de la vista previa no descarta la etapa persistida. Se impide alterar las condiciones de conexión durante una escritura activa.

El documento persistido incluye versión de esquema, hasta 250 eventos y 100 tareas por chat. Se validan tipos, enumeraciones, IDs únicos y límites al leer; datos corruptos o almacenamiento fallido se muestran como error sin borrar el documento. No hay mensajes de WhatsApp ni transporte en este servicio. Guardar una nota no modifica la vista previa, el contador de mensajes ni su transporte. Una nota que termina de guardarse no borra texto nuevo escrito mientras esperaba.

La caché es LRU de 64 detalles: no expulsa escrituras, carga pendiente ni borradores de nota sin guardar. Si todos están ocupados se pide guardar antes de abrir otro. Los cambios confirmados vuelven de AsyncStorage después de expulsión. El borrador de nota, filtros y offsets de detalles/historial se conservan en memoria durante navegación; no se promete recuperarlos tras cerrar proceso o sesión. Los borradores del compositor de mensajes T-M3 mantienen su persistencia previa. Las preferencias de conexión de QA son de sesión y deliberadamente no habilitan servicios reales.

Los documentos son por perfil/chat para aislar muestras; no representan una base compartida entre personas. El catálogo de Bandeja y los chats nuevos siguen siendo la simulación T-M2 en memoria. No se promete persistencia integral de la Bandeja ni sincronización multiusuario.

## Navegación, teclado y rendimiento

Rutas protegidas `contact/[id]` y `history/[id]`. Entrar directamente a un chat ajeno devuelve acceso no permitido. El encabezado de chat captura su ancla antes de abrir detalles; volver conserva historial, borrador y posición de Bandeja. Los offsets no producen notificaciones React.

Historial usa FlashList y filas memo con IDs/tipos estables. No se materializan detalles de miles de chats: se crean al visitar. El límite de eventos es local y explícito, no una paginación de servidor inexistente. Los 1.000 mensajes paginados por chat y las 2.000 conversaciones T-M2 permanecen intactos.

Hojas/diálogos usan el Modal nativo existente, cierre visible, Escape en QA web y Android Back mediante onRequestClose; no se apilan capas. El gesto de cierre permanece en el asa. Formularios de pérdida/tarea conservan sus valores durante errores. La fecha y hora se editan con TextInput nativos desplegados dentro del campo aprobado; no se incorpora un selector de calendario del sistema. La pantalla de notas usa KeyboardAvoidingView/áreas seguras existentes; no envía con Enter, que añade una línea. Los estados cargando/vacío/error/sin conexión se prueban mediante el menú de QA.

Las radios, checks y etiquetas exponen estado accesible. Se amplió al mínimo de 44 el ancho del filtro IA, sin alterar tokens. La matriz comprueba blancos táctiles visibles >=44, ausencia de desborde horizontal y errores de JavaScript/red externa. Las hojas largas a 360×640 requieren scroll interior; sus acciones siguen accesibles.

No se declaran FPS, RAM, batería ni fluidez nativa basándose en Chromium. La revisión de teclado real, TalkBack/VoiceOver, texto de sistema ampliado, barras/gestos Android y comportamiento iOS sigue pendiente para T-M4.

## Comprobación manual

1. Entrar como Propietario, abrir Karla y tocar el nombre. Probar etapa/perdido, cancelar y confirmar, asignado, etiquetas, IA, monto y prioridad.
2. Crear tarea con fecha válida; completar/reabrir. Volver al chat y a Bandeja. Recargar app y revisar los cambios guardados del contacto.
3. Abrir historial, filtrar y escribir una nota. Volver y regresar: borrador/filtro se conservan. Guardar y comprobar que no es un mensaje enviado.
4. En Más opciones del contacto → Pruebas de detalles, habilitar complemento. Sin dispositivo, Directa falla y mantiene Meta; con dispositivo ficticio se permite. Con pausa de emergencia, solo se permite volver a Meta.
5. Entrar como Asesor y abrir Cristal Joyas: sin asignación, sin conexión salvo permiso delegado de demo, etiqueta de importación bloqueada. Probar enlace de Karla y comprobar denegación.
6. En un teléfono: repetir con teclado abierto, Atrás, gestos y tema oscuro; revisar el checklist de RESULTADOS.
