# 08 · Tareas para Codex

Orden recomendado: T-M1 → T-M2 → T-M3 → T-M4, y después el resto por prioridad. Una tarea a la vez; cada una termina con la app corriendo contra los mocks y capturas lado a lado con el prototipo.

Cómo se usa (flujo que Fer ya definió): Codex programa; Claude revisa, abre el PR y fusiona cuando el CI está verde. El sandbox de Codex no puede abrir PRs.

Nota: dónde vive el código móvil (carpeta `mobile/` nueva o el prototipo de React Native existente) lo confirma Fer antes de T-M1; el texto de abajo dice «usa el prototipo existente si Fer lo indica».

| Tarea | Alcance | Prioridad |
|---|---|---|
| T-M1 | Base de la app: tema, componentes, navegación por rol y acceso · AUTH-02..AUTH-06, DS-01..DS-06, MORE-08 | P0 |
| T-M2 | Bandeja: lista de Clientes, búsqueda, filtros y selección · INB-01..INB-10, INB-08, INB-09 | P0 |
| T-M3 | Chat: enviar, adjuntar, plantillas y ventana de 24 h · INB-11..INB-18, INB-27, INB-28, INB-29 | P0 |
| T-M4 | Detalles del contacto y acciones del chat, incluida la conexión del chat · INB-19..INB-26, INB-30 | P0 |
| T-M5 | Notificaciones push con la app cerrada · SET-14 | P1 |
| T-M6 | Equipo y Mi número · EQP-01..EQP-06, NUM-01..NUM-04, SET-13, SET-13A | P1 |
| T-M7 | Pipeline y Contactos · CRM-01..CRM-17, CRM-07C, CRM-07D | P1 |
| T-M8 | Más, Ajustes esenciales y cuenta · MORE-01, MORE-05, SET-01..SET-03B, SET-15, SET-16 | P1 |
| T-M9 | Agenda, Tareas y notas, Biblioteca · CRM-20..CRM-25, CRM-30..CRM-33, CRM-40..CRM-42 | P2 |
| T-M10 | Estudio de IA · LAB-01..LAB-31 | P2 |
| T-M11 | Marketing · MKT-01..MKT-31 | P2 |
| T-M12 | Asistente, Resultados y Uso y plan · AST-01..AST-04, RES-01, RES-02, MORE-06, MORE-07, MORE-09, MORE-10 | P2 |
| T-M13 | Ajustes restantes, funciones nuevas pendientes y Plataforma · SET-04..SET-12, SET-17, AUTH-01, PLT-01..PLT-03 | P3 |

---

## Prompts listos (cada uno va completo en un solo bloque)

### T-M1 · Base de la app: tema, componentes, navegación por rol y acceso

```
Tarea T-M1: Base de la app: tema, componentes, navegación por rol y acceso.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): AUTH-02..AUTH-06, DS-01..DS-06, MORE-08.

Qué construir: Crea el proyecto Expo (o usa el prototipo existente si Fer lo indica), theme.ts con los tokens claros/oscuros, los componentes reutilizables de la §3 de la especificación (AppBar, SegmentedControl, ListRow, Sheet, Dialog, PopMenu, Toast, Button, Field, Switch, Skeleton, EmptyState, ErrorState, TabBar flotante), la barra inferior por rol (Propietario 5, Coordinador 4, Asesor 3), BackHandler de Android (cerrar capa → pila → Bandeja → «pulsa otra vez para salir»), sesión de 30 días en expo-secure-store y las pantallas de acceso.

Criterios de aceptación: La barra cambia con el rol; Atrás se comporta como en el prototipo; iniciar y cerrar sesión funcionan contra el CRM; todos los componentes tienen una pantalla de galería igual a DS-03..DS-06. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

### T-M2 · Bandeja: lista de Clientes, búsqueda, filtros y selección

```
Tarea T-M2: Bandeja: lista de Clientes, búsqueda, filtros y selección.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): INB-01..INB-10, INB-08, INB-09.

Qué construir: Lista virtual con FlashList, filtros Todos / No leídos / Míos / Campañas, buscador, selección múltiple (mantener presionado), nuevo chat, pestaña Campañas, punto de IA bajo el avatar, cápsulas de etapa y etiquetas, tiempo real por SSE de /api/events con catch-up por since=, pull-to-refresh.

Criterios de aceptación: La fila se ve como INB-01; el filtro del Asesor lo aplica el servidor; llegan mensajes en vivo; con 1,000 chats desplaza fluido. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

### T-M3 · Chat: enviar, adjuntar, plantillas y ventana de 24 h

```
Tarea T-M3: Chat: enviar, adjuntar, plantillas y ventana de 24 h.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): INB-11..INB-18, INB-27, INB-28, INB-29.

Qué construir: Burbujas (cliente, equipo, IA, IA conectada, nota, sistema), estados de entrega, compositor redondo, adjuntos con los topes de WhatsApp por tipo, respuestas rápidas con /atajo, Biblioteca, emojis, asistente de redacción, plantilla cuando la ventana de 24 h está cerrada, visor de imagen, eliminar chat (solo con permiso) y mensaje no entregado con motivo y reintentar. Botón de llamar en el encabezado (marcador nativo, aprobado por Fer).

Criterios de aceptación: Cada flujo de INB-11..INB-29 funciona contra los mocks del repo (WA_MOCK_ENABLED); con la ventana cerrada solo se puede enviar plantilla. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

### T-M4 · Detalles del contacto y acciones del chat, incluida la conexión del chat

```
Tarea T-M4: Detalles del contacto y acciones del chat, incluida la conexión del chat.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): INB-19..INB-26, INB-30.

Qué construir: Detalles, historial, cambiar etapa, asignar, etiquetas, IA en este chat, motivo de pérdida, tarea del chat. INB-30 «Conexión del chat»: solo aparece si el complemento Conexión directa está activo y la persona tiene permiso; PUT /api/conversations/[id]/mode con Meta / Conexión directa / Conexión híbrida; salir de Meta exige dispositivo vinculado y sin pausa de emergencia; volver a Meta siempre se puede. Nunca escribas «no oficial».

Criterios de aceptación: Las hojas coinciden con las capturas; INB-30 no se ofrece sin el complemento ni sin permiso; el error del servidor se muestra en español. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

### T-M5 · Notificaciones push con la app cerrada

```
Tarea T-M5: Notificaciones push con la app cerrada.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): SET-14.

Qué construir: NUEVO y aprobado por Fer. Requiere trabajo de servidor (tabla de tokens de dispositivo con migración y envío) y un APK/IPA nuevo: NO lo empieces sin que Claude abra primero una tarea de backend aparte (una migración a la vez). Del lado de la app: permisos, registro del token, pantalla SET-14 con tipos de aviso, abrir el chat correcto al tocar el aviso.

Criterios de aceptación: Con la app cerrada llega el aviso de un mensaje entrante y al tocarlo abre ese chat. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

### T-M6 · Equipo y Mi número

```
Tarea T-M6: Equipo y Mi número.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): EQP-01..EQP-06, NUM-01..NUM-04, SET-13, SET-13A.

Qué construir: Chat de equipo (directos, grupos, Avisos, menciones, supervisión) y Mi número (chats del WhatsApp personal con privacidad por defecto; vincular dispositivo con QR). Respeta que Mi número solo existe con el complemento.

Criterios de aceptación: Un chat privado nunca aparece a quien no es su dueño; los grupos y menciones funcionan. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

### T-M7 · Pipeline y Contactos

```
Tarea T-M7: Pipeline y Contactos.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): CRM-01..CRM-17, CRM-07C, CRM-07D.

Qué construir: Pipeline una etapa por pantalla con deslizamiento lateral y hoja «Mover a…» (sin arrastrar), detalle del trato, monto, motivo de pérdida, nuevo lead, gestionar etapas; Contactos con ficha, filtros, acciones masivas e importar con la pregunta obligatoria de consentimiento.

Criterios de aceptación: Mover un trato cambia su etapa en el servidor; importar no termina sin responder el consentimiento. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

### T-M8 · Más, Ajustes esenciales y cuenta

```
Tarea T-M8: Más, Ajustes esenciales y cuenta.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): MORE-01, MORE-05, SET-01..SET-03B, SET-15, SET-16.

Qué construir: Pantalla Más, Avisos, Ajustes (índice), Canales y conexiones con salud del número y Conexión directa (SET-02C incluye «Aplicar a todos los chats»), Equipo y permisos con invitar, Apariencia (tema claro/oscuro/automático) y Marca.

Criterios de aceptación: Cada apartado respeta permisos; el tema se guarda por persona. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

### T-M9 · Agenda, Tareas y notas, Biblioteca

```
Tarea T-M9: Agenda, Tareas y notas, Biblioteca.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): CRM-20..CRM-25, CRM-30..CRM-33, CRM-40..CRM-42.

Qué construir: Agenda por día y mes, bloquear y mover citas; Tareas y Notas; Biblioteca con los dos destinos (Envío en chat y Lectura IA; al menos uno).

Criterios de aceptación: Una cita de prueba nunca llega a un conector real; la Biblioteca exige un destino. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

### T-M10 · Estudio de IA

```
Tarea T-M10: Estudio de IA.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): LAB-01..LAB-31.

Qué construir: Agentes (creador conversacional, editor, vista previa, publicar, versiones, pausa, archivar), documentos, asignación por etapa y clientes simulados. Solo Propietario.

Criterios de aceptación: La vista previa y las pruebas nunca envían a WhatsApp real; publicar pide confirmación. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

### T-M11 · Marketing

```
Tarea T-M11: Marketing.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): MKT-01..MKT-31.

Qué construir: Campañas (asistente, detalle, ajustes), Audiencias, Plantillas y Métricas. Incluye lo nuevo aprobado: MKT-04 confirmación reforzada (escribir el número de destinatarios) y MKT-12 subir una base desde el teléfono. Solo audiencia con consentimiento (opt_in).

Criterios de aceptación: No se puede confirmar una campaña sin escribir el número correcto; la base subida pasa por la pregunta de consentimiento. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

### T-M12 · Asistente, Resultados y Uso y plan

```
Tarea T-M12: Asistente, Resultados y Uso y plan.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): AST-01..AST-04, RES-01, RES-02, MORE-06, MORE-07, MORE-09, MORE-10.

Qué construir: Asistente interno (todo lo que cambia o envía se propone y corre solo con «Aplicar»), Resultados, Uso y plan sin dólares ni precios internos, Mejora tu plan y solicitud de cambio.

Criterios de aceptación: «Aplicar» usa la sesión de quien pulsa; el cliente nunca ve dólares. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

### T-M13 · Ajustes restantes, funciones nuevas pendientes y Plataforma

```
Tarea T-M13: Ajustes restantes, funciones nuevas pendientes y Plataforma.

Contexto: app móvil de Dashfort (CRM de WhatsApp), React Native + Expo (expo-router, TypeScript estricto). El diseño aprobado está en /mnt/project-files/diseno-mobile/ : lee LEEME.md, docs/03-sistema-de-diseno.md, docs/05-especificacion-react-native.md y busca tus pantallas por ID en docs/04-inventario-pantallas.csv y en dashfort-mobile-prototipo.html (abre #/ID). Las capturas por pantalla están en capturas/claro y capturas/oscuro.
Reglas: solo trabajas en la carpeta de la app móvil. No modifiques el CRM web, el backend, la app Android TWA ni la base de datos. Usa solo las rutas de API que el CRM ya tiene (ver CLAUDE.md del repo). Todo permiso se valida en el servidor; la app solo lo refleja. Español sencillo en toda la interfaz. Implementa claro y oscuro, y los estados cargando / vacío / error / sin conexión. Zonas táctiles >= 44 pt. No fusiones ni despliegues nada.

Pantallas de esta tarea (IDs del inventario): SET-04..SET-12, SET-17, AUTH-01, PLT-01..PLT-03.

Qué construir: Etiquetas, respuestas rápidas, motivos de pérdida, agenda y conectores, chat de equipo, bajas automáticas, Mi IA, Conector del equipo; SET-17 navegación (elegir los 4 pilares de la barra); AUTH-01 animación de apertura (< 1 s, solo la primera vez, se apaga con reducir movimiento); Plataforma en modo consulta.

Criterios de aceptación: Las funciones nuevas coinciden con su captura; Plataforma solo muestra metadatos, nunca contenido de un negocio. Además, todos los generales de la §10 de docs/05-especificacion-react-native.md (parecido al prototipo en claro y oscuro a 390x844 y 360x640, sin texto cortado, sin botones muertos, permisos por rol, Atrás cierra la capa superior, reducir movimiento y tamaño de letra del sistema).

Entrega: código de la tarea, pruebas, y un reporte en español con qué cambió, qué no se probó, riesgos y cómo revertir.
```

