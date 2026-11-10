# 04 · Inventario de pantallas

Generado del prototipo (158 pantallas, hojas, diálogos y menús). Cada ID es único y estable: es el mismo del prototipo HTML, del PDF y de la especificación para Codex.

Leyenda de estado: **actual** = existe igual en el CRM; **adaptada** = existe en la web y se rehízo para móvil; **NUEVA** = no existe hoy en la web; Fer la aprobó el 2026-11-10.

## Acceso y arranque (AUTH) — 6

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| AUTH-01 | Animación de apertura | Pantalla (se apila) | **NUEVA (aprobada)** | (solo app) | P3 |
| AUTH-02 | Iniciar sesión | Pantalla (se apila) | actual | /login | P0 |
| AUTH-03 | Activar cuenta (enlace) | Pantalla (se apila) | actual | /activar/[token] | P0 |
| AUTH-04 | Nueva contraseña (enlace) | Pantalla (se apila) | actual | /restablecer/[token] | P0 |
| AUTH-05 | Crear cuenta (cerrado) | Pantalla (se apila) | adaptada | /register | P0 |
| AUTH-06 | ¿Olvidaste tu contraseña? | Diálogo | actual | (texto) | P0 |

## Bandeja · Clientes (INB) — 30

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| INB-01 | Bandeja · lista de Clientes | Pantalla raíz (pestaña) | actual | /inbox | P0 |
| INB-02 | Búsqueda en la Bandeja | Pantalla raíz (pestaña) | adaptada | /inbox (buscar) | P0 |
| INB-03 | Selección múltiple de chats | Pantalla raíz (pestaña) | adaptada | /inbox (Seleccionar varios) | P0 |
| INB-06 | Bandeja · cargando | Pantalla raíz (pestaña) | actual | /inbox | P0 |
| INB-07 | Bandeja · vacía | Pantalla raíz (pestaña) | actual | /inbox | P0 |
| INB-08 | Bandeja · sin conexión | Pantalla raíz (pestaña) | actual | /inbox | P0 |
| INB-09 | Bandeja · pestaña Campañas | Pantalla raíz (pestaña) | actual | /inbox (Campañas) | P1 |
| INB-04 | Menú ⋮ de la Bandeja | Menú emergente | adaptada | /inbox (menú) | P0 |
| INB-05 | Filtros de la Bandeja | Hoja inferior | actual | /inbox (filter-menu) | P0 |
| INB-10 | Nuevo chat | Hoja inferior | actual | /inbox (Nuevo chat) | P0 |
| INB-11 | Chat abierto | Pantalla (se apila) | actual | /inbox (chat) | P0 |
| INB-12 | Menú ⋮ del chat | Menú emergente | adaptada | /inbox (menú del chat) | P0 |
| INB-13 | Adjuntar | Hoja inferior | actual | /inbox (compositor › adjuntar) | P0 |
| INB-14 | Respuestas rápidas | Hoja inferior | actual | /inbox (⚡ o /atajo) | P1 |
| INB-15 | Biblioteca · enviar material | Hoja inferior | actual | /inbox (Conocimientos) | P1 |
| INB-16 | Emojis | Hoja inferior | adaptada | /inbox (emoji) | P1 |
| INB-17 | Enviar plantilla (ventana cerrada) | Hoja inferior | actual | /inbox (template-sender) | P0 |
| INB-18 | Asistente de redacción | Hoja inferior | actual | /inbox (varita) | P1 |
| INB-19 | Detalles del contacto | Pantalla (se apila) | adaptada | /inbox (panel Detalles) | P0 |
| INB-20 | Historial del chat | Pantalla (se apila) | adaptada | /inbox (Historial) | P1 |
| INB-21 | Cambiar etapa | Hoja inferior | actual | /inbox (etapa del lead) | P0 |
| INB-22 | Asignar chat | Hoja inferior | actual | /inbox (asignar) | P0 |
| INB-23 | Etiquetas del contacto | Hoja inferior | actual | /inbox (etiquetas) | P1 |
| INB-24 | IA en este chat | Hoja inferior | actual | /inbox (IA en esta conversación) | P1 |
| INB-30 | Conexión del chat | Hoja inferior | actual | /inbox (selector «Conexión del chat») | P0 |
| INB-25 | Motivo de pérdida | Diálogo | actual | /pipeline (loss-reason-dialog) | P1 |
| INB-26 | Nueva tarea para este chat | Hoja inferior | actual | /inbox (Nueva tarea para este chat) | P1 |
| INB-27 | Visor de imagen | Pantalla (se apila) | adaptada | /inbox (image-lightbox) | P1 |
| INB-28 | Eliminar chat | Diálogo | actual | /inbox (eliminar) | P1 |
| INB-29 | Mensaje no entregado | Pantalla (se apila) | actual | /inbox (error de envío) | P1 |

## Bandeja · Equipo (EQP) — 6

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| EQP-01 | Equipo · lista de conversaciones | Pantalla raíz (pestaña) | adaptada | /chat | P1 |
| EQP-02 | Chat de equipo | Pantalla (se apila) | adaptada | /chat | P1 |
| EQP-06 | Chat de equipo · supervisión | Pantalla (se apila) | actual | /chat (supervisión) | P1 |
| EQP-03 | Nuevo mensaje o grupo | Hoja inferior | actual | /chat (nuevo) | P1 |
| EQP-04 | Información del grupo | Pantalla (se apila) | adaptada | /chat (participantes) | P1 |
| EQP-05 | Mencionar | Hoja inferior | actual | /chat (mención) | P1 |

## Bandeja · Mi número (NUM) — 4

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| NUM-01 | Mi número · lista | Pantalla raíz (pestaña) | adaptada | /inbox/mi-numero | P1 |
| NUM-02 | Mi número · chat | Pantalla (se apila) | adaptada | /inbox/mi-numero (chat) | P1 |
| NUM-03 | Mi número · opciones del chat | Hoja inferior | adaptada | /inbox/mi-numero (detalles) | P1 |
| NUM-04 | Nuevo chat desde Mi número | Hoja inferior | adaptada | /inbox/mi-numero (nuevo) | P1 |

## CRM Comercial (CRM) — 32

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| CRM-01 | Pipeline | Pantalla raíz (pestaña) | adaptada | /pipeline | P1 |
| CRM-02 | Detalle del trato | Hoja inferior | adaptada | /pipeline (lead-drawer) | P1 |
| CRM-03 | Mover a otra etapa | Hoja inferior | adaptada | /pipeline (mover) | P1 |
| CRM-04 | Editar monto | Hoja inferior | actual | /pipeline (amount-dialog) | P2 |
| CRM-05 | Motivo de pérdida (trato) | Diálogo | actual | /pipeline (loss-reason-dialog) | P1 |
| CRM-06 | Nuevo lead | Hoja inferior | actual | /pipeline (Nuevo lead) | P1 |
| CRM-08 | Buscar lead | Hoja inferior | adaptada | /pipeline (buscar) | P2 |
| CRM-09 | Menú ⋮ del Pipeline | Menú emergente | adaptada | /pipeline (menú) | P2 |
| CRM-07 | Gestionar etapas | Pantalla (se apila) | adaptada | /pipeline (stage-manager) | P2 |
| CRM-07C | Color de la etapa | Hoja inferior | actual | /pipeline (color de etapa) | P2 |
| CRM-07D | Eliminar etapa | Diálogo | actual | /pipeline (eliminar etapa) | P2 |
| CRM-10 | Contactos | Pantalla raíz (pestaña) | adaptada | /contacts | P1 |
| CRM-11 | Ficha del contacto | Pantalla (se apila) | adaptada | /contacts (editar contacto) | P1 |
| CRM-12 | Nuevo contacto / editar | Hoja inferior | actual | /contacts (new-contact-dialog) | P1 |
| CRM-13 | Menú ⋮ del contacto | Menú emergente | adaptada | /contacts (acciones) | P2 |
| CRM-14 | Filtros de contactos | Hoja inferior | actual | /contacts (filtros) | P2 |
| CRM-15 | Acciones con seleccionados | Hoja inferior | adaptada | /contacts (selección) | P2 |
| CRM-16 | Menú ⋮ de Contactos | Menú emergente | adaptada | /contacts (menú) | P2 |
| CRM-17 | Importar contactos | Pantalla (se apila) | adaptada | /contacts (import-dialog) | P2 |
| CRM-20 | Agenda · día | Pantalla (se apila) | adaptada | /bookings | P2 |
| CRM-21 | Detalle de la cita | Hoja inferior | actual | /bookings (booking-drawer) | P2 |
| CRM-22 | Bloquear horario | Hoja inferior | actual | /bookings (block-dialog) | P2 |
| CRM-23 | Mover cita | Hoja inferior | actual | /bookings (Mover a) | P2 |
| CRM-24 | Agenda · mes | Pantalla (se apila) | adaptada | /bookings (mes) | P2 |
| CRM-25 | Menú ⋮ de Agenda | Menú emergente | adaptada | /bookings (opciones) | P2 |
| CRM-30 | Tareas | Pantalla (se apila) | adaptada | /trabajo/tareas | P1 |
| CRM-31 | Detalle de la tarea | Hoja inferior | actual | /trabajo/tareas (detalle) | P1 |
| CRM-32 | Notas | Pantalla (se apila) | adaptada | /trabajo/notas | P2 |
| CRM-33 | Editor de nota | Hoja inferior | actual | /trabajo/notas (detalle) | P2 |
| CRM-40 | Biblioteca | Pantalla raíz (pestaña) | adaptada | /knowledge | P2 |
| CRM-41 | Entrada de la Biblioteca | Pantalla (se apila) | adaptada | /knowledge (editor) | P2 |
| CRM-42 | Menú ⋮ de Biblioteca | Menú emergente | adaptada | /knowledge (menú) | P2 |

## Estudio de IA (LAB) — 18

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| LAB-01 | Agentes | Pantalla raíz (pestaña) | adaptada | /lab | P2 |
| LAB-02 | Creador de agentes (chat) | Pantalla (se apila) | adaptada | /lab (agent-creator) | P2 |
| LAB-03 | Editor del agente | Pantalla (se apila) | adaptada | /lab/agents/[id] | P2 |
| LAB-04 | Vista previa del agente | Hoja inferior | actual | /lab/agents/[id] (agent-preview) | P2 |
| LAB-05 | Publicar agente | Diálogo | actual | /lab (publicar) | P2 |
| LAB-06 | Versiones publicadas | Hoja inferior | actual | /lab (versiones) | P2 |
| LAB-06C | Cargar versión al borrador | Diálogo | actual | /lab (confirmar) | P2 |
| LAB-07 | Pausar todos los agentes | Diálogo | actual | /lab (agent-pause-bar) | P2 |
| LAB-08 | Menú ⋮ de Agentes | Menú emergente | adaptada | /lab (menú) | P2 |
| LAB-09 | Menú ⋮ del agente | Menú emergente | adaptada | /lab/agents/[id] (más opciones) | P2 |
| LAB-09A | Archivar agente | Diálogo | actual | /lab (archivar) | P2 |
| LAB-10 | Conocimiento y documentos | Pantalla raíz (pestaña) | adaptada | /lab/documentos | P2 |
| LAB-11 | Subir documento | Hoja inferior | actual | /lab/documentos (subir) | P2 |
| LAB-12 | Detalle del documento | Hoja inferior | actual | /lab/documentos (detalle) | P2 |
| LAB-20 | Asignación por etapa | Pantalla raíz (pestaña) | adaptada | /lab/asignacion | P2 |
| LAB-21 | Elegir agente de la etapa | Hoja inferior | actual | /lab/asignacion (elegir) | P2 |
| LAB-30 | Pruebas · clientes simulados | Pantalla raíz (pestaña) | adaptada | /lab/evaluaciones | P2 |
| LAB-31 | Detalle de la prueba | Pantalla (se apila) | adaptada | /lab/evaluaciones (detalle) | P2 |

## Marketing (MKT) — 14

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| MKT-01 | Campañas | Pantalla raíz (pestaña) | adaptada | /campaigns | P2 |
| MKT-02 | Detalle de la campaña | Pantalla (se apila) | adaptada | /campaigns/[id] | P2 |
| MKT-03 | Nueva campaña (asistente) | Pantalla (se apila) | adaptada | /campaigns/new | P2 |
| MKT-04 | Confirmar el envío | Diálogo | **NUEVA (aprobada)** | /campaigns/new (confirmar) | P3 |
| MKT-05 | Menú ⋮ de Campañas | Menú emergente | adaptada | /campaigns (menú) | P2 |
| MKT-06 | Menú ⋮ de la campaña | Menú emergente | adaptada | /campaigns/[id] (opciones) | P2 |
| MKT-31 | Ajustes de campañas | Pantalla (se apila) | adaptada | /campaigns/settings | P2 |
| MKT-10 | Audiencias | Pantalla raíz (pestaña) | adaptada | /campaigns/audiences | P2 |
| MKT-11 | Detalle de la base | Pantalla (se apila) | adaptada | /campaigns/audiences (resultado) | P2 |
| MKT-12 | Subir una base (desde el teléfono) | Hoja inferior | **NUEVA (aprobada)** | (no existe en móvil) | P3 |
| MKT-20 | Plantillas de WhatsApp | Pantalla raíz (pestaña) | adaptada | /campaigns/templates | P2 |
| MKT-21 | Detalle de la plantilla | Pantalla (se apila) | adaptada | /campaigns/templates (detalle) | P2 |
| MKT-22 | Nueva plantilla | Pantalla (se apila) | adaptada | /campaigns/templates (nueva) | P2 |
| MKT-30 | Métricas y costos | Pantalla raíz (pestaña) | adaptada | /campaigns/metrics | P2 |

## Más (MORE) — 7

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| MORE-01 | Más | Pantalla raíz (pestaña) | adaptada | (menú lateral + tarjeta de cuenta) | P0 |
| MORE-08 | Cerrar sesión | Diálogo | actual | (menú de cuenta) | P0 |
| MORE-05 | Avisos | Hoja inferior | adaptada | (menú de Avisos) | P0 |
| MORE-06 | Uso y plan | Pantalla (se apila) | adaptada | (ventana Uso y plan) | P2 |
| MORE-07 | Mejora tu plan | Pantalla (se apila) | adaptada | (Mejora tu plan) | P2 |
| MORE-09 | Solicitar cambio de plan | Diálogo | actual | POST /api/usage/plan-request | P2 |
| MORE-10 | Aviso «a este ritmo» | Diálogo | adaptada | (usage-prompt) | P2 |

## Resultados (RES) — 2

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| RES-01 | Resultados | Pantalla (se apila) | adaptada | /results | P2 |
| RES-02 | Periodo y asesor | Hoja inferior | actual | /results (periodo) | P2 |

## Asistente (AST) — 4

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| AST-01 | Asistente | Pantalla (se apila) | adaptada | /asistente | P2 |
| AST-02 | Conversaciones del asistente | Hoja inferior | actual | /asistente (hilos) | P2 |
| AST-03 | Modo y crédito | Hoja inferior | actual | /asistente (speed-picker, crédito) | P2 |
| AST-04 | Asistente · sin crédito | Pantalla (se apila) | actual | /asistente (sin tope) | P2 |

## Ajustes (SET) — 26

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| SET-01 | Ajustes | Pantalla (se apila) | adaptada | /settings | P1 |
| SET-02 | Canales y conexiones | Pantalla (se apila) | adaptada | /settings/whatsapp | P1 |
| SET-02A | Conectar con Facebook | Hoja inferior | actual | /settings/whatsapp (embedded-signup) | P2 |
| SET-02B | Salud del número | Hoja inferior | actual | /settings/whatsapp (number-health) | P2 |
| SET-02C | Conexión directa | Pantalla (se apila) | adaptada | /settings/direct-connection | P2 |
| SET-03 | Equipo y permisos | Pantalla (se apila) | adaptada | /settings/team | P1 |
| SET-03A | Invitar persona | Hoja inferior | actual | /settings/team (invitar) | P2 |
| SET-03B | Persona del equipo | Hoja inferior | actual | /settings/team (fila) | P2 |
| SET-04 | Anuncios (Meta) | Pantalla (se apila) | adaptada | /settings/ads | P2 |
| SET-05 | Etiquetas | Pantalla (se apila) | adaptada | /settings/tags | P2 |
| SET-05A | Editar etiqueta | Hoja inferior | actual | /settings/tags (editar) | P2 |
| SET-06 | Respuestas rápidas | Pantalla (se apila) | adaptada | /settings/quick-replies | P2 |
| SET-06A | Editar respuesta rápida | Hoja inferior | actual | /settings/quick-replies (editar) | P2 |
| SET-07 | Motivos de pérdida | Pantalla (se apila) | adaptada | /settings/loss-reasons | P2 |
| SET-08 | Agenda y conectores | Pantalla (se apila) | adaptada | /settings/calendar | P2 |
| SET-09 | Chat de equipo (ajustes) | Pantalla (se apila) | adaptada | /settings/team-chat | P2 |
| SET-10 | Bajas automáticas | Pantalla (se apila) | adaptada | /settings/opt-out | P2 |
| SET-11 | Mi IA | Pantalla (se apila) | adaptada | /settings/mi-ia | P2 |
| SET-11A | Qué hizo tu IA | Pantalla (se apila) | adaptada | /settings/mi-ia (actions-log) | P2 |
| SET-12 | Conector del equipo | Pantalla (se apila) | adaptada | /settings/conector-ia | P2 |
| SET-13 | Mi número | Pantalla (se apila) | adaptada | /settings/my-number | P2 |
| SET-13A | Vincular dispositivo | Hoja inferior | actual | /settings/my-number (QR) | P2 |
| SET-14 | Notificaciones | Pantalla (se apila) | adaptada | /settings/personalization/notificaciones | P1 |
| SET-15 | Apariencia | Pantalla (se apila) | adaptada | /settings/personalization | P1 |
| SET-16 | Marca | Pantalla (se apila) | adaptada | /settings/personalization/marca | P2 |
| SET-17 | Navegación | Pantalla (se apila) | **NUEVA (aprobada)** | /settings/personalization/navegacion | P3 |

## Plataforma (administrador) (PLT) — 3

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| PLT-01 | Mi panel | Pantalla (se apila) | **NUEVA (aprobada)** | /platform/panel | P3 |
| PLT-02 | Organizaciones | Pantalla (se apila) | **NUEVA (aprobada)** | /platform/organizaciones | P3 |
| PLT-03 | Ficha de la organización | Pantalla (se apila) | **NUEVA (aprobada)** | /platform/organizaciones/[id] | P3 |

## Sistema de diseño (DS) — 6

| ID | Pantalla | Tipo | Estado | Función web | Prioridad |
|---|---|---|---|---|---|
| DS-01 | Colores y modo oscuro | Pantalla (se apila) | actual | src/app/globals.css | P0 |
| DS-02 | Tipografía, espaciado y radios | Pantalla (se apila) | actual | --font-ui · Inter 400/500/600 | P0 |
| DS-03 | Botones, campos y controles | Pantalla (se apila) | actual | components/ui/* | P0 |
| DS-04 | Componentes de chat | Pantalla (se apila) | actual | components/inbox/message-bubble.tsx | P0 |
| DS-05 | Estados: cargando, vacío, error y avisos | Pantalla (se apila) | actual | (patrones del CRM) | P0 |
| DS-06 | Navegación: barra, hoja, menú y diálogo | Pantalla (se apila) | actual | src/components/mobile-tabbar.tsx | P0 |

