# 06 · Funciones verificadas y funciones nuevas

## Parte A — Funciones verificadas del CRM actual

«Verificada» = la encontré en el código o en la guía del repositorio (no la inventé). Pantallas móviles en paréntesis.

**Bandeja y chat** — lista con filtros Todos / No leídos / Míos / Campañas y búsqueda (INB-01…09) · selección múltiple, archivar, eliminar, asignar (INB-03, 22, 28) · chat con estados de entrega, adjuntos de archivo, contacto y ubicación (INB-11, 13) · respuestas rápidas con `/atajo` (INB-14) · material de la Biblioteca (INB-15) · plantillas con ventana de 24 h cerrada (INB-17) · asistente de redacción, la varita (INB-18) · Detalles, historial/línea de tiempo (INB-19, 20) · etapa, asignación, etiquetas, motivo de pérdida, tarea del chat (INB-21…26) · IA por conversación (INB-24) · conexión del chat Meta/Directa/Híbrida, con el complemento (INB-30) · mensaje no entregado con motivo (INB-29) · borde del chat: «Atiende: …» y punto de IA bajo el avatar.

**Equipo y Mi número** — chat de equipo directo, grupos y Avisos, menciones, supervisión (EQP-01…06) · Mi número: chats del WhatsApp personal con los interruptores de privacidad (NUM-01…04, SET-13).

**CRM Comercial** — Pipeline con etapas editables, monto, prioridad, motivo de pérdida (CRM-01…09) · Contactos con filtros, acciones masivas, importar con consentimiento (CRM-10…17) · Agenda día/mes, bloquear, mover citas (CRM-20…25) · Tareas y Notas (CRM-30…33) · Biblioteca con destinos «Envío en chat» y «Lectura IA» (CRM-40…42).

**Estudio de IA** — varios agentes con borrador/publicado y versiones, creador conversacional, vista previa, pausa general y por agente, archivar (LAB-01…09A) · documentos RAG (LAB-10…12) · asignación por etapa (LAB-20, 21) · clientes simulados que reemplazan al juez (LAB-30, 31).

**Marketing** — campañas con asistente, confirmación, pausa de seguridad, métricas Estimado vs. Reportado por Meta (MKT-01…06, 30, 31) · audiencias .xlsx/.csv (MKT-10, 11) · plantillas con encabezado/pie/botones (MKT-20…22).

**Inteligencia y Asistente** — Resultados (ventas, agente, origen y anuncios, higiene) (RES-01, 02) · Asistente interno que lee y propone, con «Aplicar» para lo que cambia o envía, y modos Rápido/Normal/Profundo (AST-01…04).

**Ajustes y cuenta** — canales/conexión con Facebook y salud del número, equipo y permisos, anuncios, etiquetas, respuestas rápidas, motivos de pérdida, agenda y conectores, chat de equipo, bajas automáticas (STOP/BAJA), Mi IA y «Qué hizo tu IA», conector del equipo, Mi número, notificaciones, apariencia, marca, navegación (SET-01…16) · Uso y plan, Mejora tu plan, solicitud manual de cambio, aviso «a este ritmo» (MORE-06, 07, 09, 10).

**Plataforma (solo administrador)** — panel, organizaciones, ficha (PLT-01…03, como consulta).

## Parte B — Funciones nuevas en móvil (**aprobadas por Fer el 2026-11-10**)

| # | Propuesta | Pantalla | Por qué | Alternativa descartada |
|---|---|---|---|---|
| 1 | Animación de apertura de la marca (< 1 s, solo la primera vez, se apaga con «reducir movimiento») | AUTH-01 | Ya aprobaste la maqueta E; es parte de la sensación «WhatsApp-level» | Splash estático |
| 2 | Confirmación reforzada de campaña: escribir el número de destinatarios | MKT-04 | En móvil es fácil lanzar por accidente a toda la base | Diálogo de confirmación simple |
| 3 | Subir una base desde el teléfono con el selector de archivos | MKT-12 | Hoy solo se hace en la web | Se sigue subiendo en la web |
| 4 | Elegir qué 4 pilares van en la barra inferior | SET-17 | Hoy el menú personalizable es solo de la web | Barra fija por rol |
| 5 | Notificaciones push con la app cerrada | SET-14 | Imprescindible para un chat (requiere un cambio pequeño de base de datos y un APK nuevo: **trabajo de desarrollo aparte**) | Solo avisos con la app abierta |
| 6 | Botón de llamar en el encabezado del chat (abre el marcador del teléfono) | INB-11 | Atajo nativo; no existe en la web | Se oculta el botón |
| 7 | Administración de plataforma en móvil (consulta) | PLT-01…03 | Baja prioridad; hoy solo web | Queda solo en la web |

Añadido después de tu revisión (no es función nueva, existe en la web): **Conexión del chat** (INB-30), para elegir desde el chat Meta / Directa / Híbrida cuando el complemento está habilitado.

Nota: las notas de voz (micrófono) **no** se diseñaron porque la web no las tiene y no las aprobaste; si las quieres, es una propuesta nueva.

## Parte C — Cambios de experiencia respecto a la web (no son funciones nuevas)

- Pipeline: una etapa por pantalla con deslizamiento lateral y hoja «Mover a…», en lugar de arrastrar tarjetas.
- Paneles laterales → hojas inferiores.
- Tablas → listas de tarjetas.
- Barra inferior flotante por rol en lugar del menú lateral.
- Agenda semanal → lista por día + mes en miniatura.
- Botón Atrás de Android con la regla «Bandeja, luego salir».
