# 01 · Auditoría del CRM web (Fase 1)

**Cómo se hizo:** lectura del código del frontend y de la guía del repositorio (`CLAUDE.md`, registro de módulos `src/lib/modules/registry.ts`, matriz de permisos `src/lib/auth/permissions.ts`, tokens `src/app/globals.css`, la barra móvil actual `mobile-tabbar.tsx` / `mobile-more.tsx`) y de las maquetas móviles que ya aprobaste (`/mnt/project-files/app-movil/`). **No se inventó ninguna función:** cada pantalla del prototipo declara su función web de origen (columna «Función web» del inventario). Lo que no existe en la web se marca **PROPUESTA**.

## 1. Estructura actual del CRM

El menú web son **5 pilares + Asistente + Ajustes** (las claves internas se conservan para que la personalización de menú siga valiendo):

| Pilar | Qué contiene hoy | Quién lo ve |
|---|---|---|
| **Bandeja** | Clientes (lista, filtros, chat, detalles, historial), Equipo (chat interno, directos, grupos, Avisos, supervisión), Mi número (el WhatsApp de cada persona, complemento oculto) | Todos (Mi número solo con el complemento) |
| **CRM Comercial** | Pipeline, Contactos (con importar/exportar), Agenda (citas), Tareas y notas, Biblioteca (material para enviar y para la IA) | Todos, según módulos |
| **Estudio de IA** | Agentes (varios, borrador/publicado, versiones), Conocimiento y documentos (RAG), Asignación por etapa, Evaluaciones (clientes simulados) | Propietario (`agent.manage`) |
| **Marketing** | Campañas, Audiencias, Plantillas, Métricas y costos | Propietario y Coordinador |
| **Inteligencia** | Resultados (ventas, agente, origen y anuncios, higiene) | Según permisos |
| **Asistente** | Asistente interno con acciones («Aplicar») | Propietario |
| **Ajustes** | Canales y conexiones, Equipo y permisos, Anuncios, Etiquetas, Respuestas rápidas, Motivos de pérdida, Agenda y conectores, Chat de equipo, Bajas automáticas, Mi IA, Conector del equipo, Mi número, Notificaciones, Apariencia, Marca, Navegación, Uso y plan | Según rol |
| **Plataforma** | Panel, Organizaciones y Planes, IA, Webhooks sin ruta, Administradores | Solo administrador de plataforma |

Roles: **Propietario** (todo), **Coordinador** (casi todo menos Estudio de IA, Asistente y Uso y plan), **Asesor** (solo sus chats y lo que le asignan). Los permisos se validan en el servidor; la app móvil solo los refleja.

## 2. Lo que ya existe para móvil (y se respeta)

- Barra inferior móvil de la web: 4 pilares + «Más».
- Maquetas aprobadas A–E: barra flotante, título que se vuelve buscador, Clientes/Equipo/Mi número como segmentos, encabezado del chat, pantalla Más, animación de apertura.
- Reglas del dueño: Clásico claro como estilo por defecto (nunca Demfort Premium en maquetas), acento white-label (teal de fábrica), español sencillo.

## 3. Estados que ya maneja el CRM (y se diseñaron todos)

Cargando (esqueletos), vacío (con acción sugerida), error de carga (reintentar), sin conexión, sin permiso (404 por módulo o 403), módulo apagado (la superficie no aparece), ventana de 24 h cerrada (solo plantilla), mensaje no entregado (con motivo traducido), IA en pausa / traspasada a persona, tope de IA o de almacenamiento (avisos 80 % y 100 %), sesión caducada.

## 4. Matriz: función web ↔ pantalla móvil

| Función de la web | Pantalla(s) móvil | Estado |
|---|---|---|
| Lista de chats, filtros (Todos/No leídos/Míos/Campañas), búsqueda, selección múltiple | INB-01…INB-09 | adaptada |
| Chat: burbujas, estados de entrega, adjuntos, plantillas, respuestas rápidas `/`, Biblioteca, emojis, asistente de redacción, tomar chat, IA on/off | INB-11…INB-18, INB-24, INB-27, INB-29 | actual/adaptada |
| Detalles del contacto, historial/línea de tiempo, etapa, asignación, etiquetas, tareas, motivo de pérdida | INB-19…INB-26 | adaptada |
| Chat de equipo (directos, grupos, menciones, supervisión) | EQP-01…EQP-06 | adaptada |
| Mi número | NUM-01…NUM-04, SET-13/13A | adaptada |
| Pipeline (etapas, monto, mover, perdido, gestionar etapas) | CRM-01…CRM-09, CRM-07/07C/07D | adaptada (una etapa por pantalla, sin arrastrar) |
| Contactos (ficha, filtros, acciones masivas, importar con consentimiento) | CRM-10…CRM-17 | adaptada |
| Agenda (día, mes, cita, bloquear, mover) | CRM-20…CRM-25 | adaptada |
| Tareas y notas | CRM-30…CRM-33 | adaptada |
| Biblioteca (chat y lectura IA) | CRM-40…CRM-42 | adaptada |
| Agentes: creador conversacional, editor, vista previa, publicar, versiones, pausa, archivar | LAB-01…LAB-09A | adaptada |
| Documentos, asignación por etapa, clientes simulados | LAB-10…LAB-12, LAB-20/21, LAB-30/31 | adaptada |
| Campañas (asistente, confirmar, detalle, ajustes), audiencias, plantillas, métricas | MKT-01…MKT-31 | adaptada (MKT-04 y MKT-12 propuestas) |
| Resultados | RES-01/02 | adaptada |
| Asistente interno (propone, «Aplicar», modos, crédito) | AST-01…AST-04 | adaptada |
| Uso y plan, Mejora tu plan, solicitud de cambio | MORE-06, 07, 09, 10 | adaptada |
| Ajustes (los 17 apartados) | SET-01…SET-17 | adaptada |
| Plataforma | PLT-01…PLT-03 | propuesta, baja prioridad |
| Acceso (login, activar, restablecer) | AUTH-02…AUTH-06 | actual/adaptada |

## 5. Lo que NO se lleva a móvil (decisión de diseño, pendiente de tu OK)

- Arrastrar tarjetas del pipeline (en móvil se mueve con una hoja «Mover a…»).
- Tablas anchas (Contactos, Métricas, Equipo): pasan a lista de tarjetas con detalle en hoja.
- Edición de prompts internos y administración avanzada de plataforma: quedan en la web.
- Exportar CSV y subir archivos pesados: quedan en la web (MKT-12 propone subir una base desde el teléfono).

El inventario completo, pantalla por pantalla, está en `04-inventario-pantallas.md`.
