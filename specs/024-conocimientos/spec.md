# 024 — Conocimientos

**Estado:** implementado · guion E2E [`tests/e2e/us-conocimientos.md`](../../tests/e2e/us-conocimientos.md)
(`pnpm test:e2e:conocimientos`) · carril **ciclo completo** (tabla nueva y
contrato de API nuevo; plan y tareas quedan en esta spec por su tamaño).

## Problema

El equipo manda una y otra vez lo mismo: el catálogo, la política de envíos,
la ficha técnica, la garantía. Hoy lo busca en su teléfono o su computadora y
lo adjunta a mano, cada quien con su versión.

## Qué NO es

No es la base de conocimiento del **agente** (`kb_entry`, en Agente), que es
lo que el agente de IA lee en su prompt. Conocimientos es material para las
PERSONAS del equipo; el agente no lo lee (un test lo vigila).

## Historias

1. **Sección propia.** "Conocimientos" en el menú lateral, justo después de
   Contactos (ícono de libro). Todos los roles la ven.
2. **Entradas.** Título, contenido de texto y/o archivo (PDF, imagen, Word,
   texto), etiquetas opcionales y fecha de actualización. Texto o archivo:
   al menos uno.
3. **Mantenerla.** Crear, editar (incluido reemplazar o quitar el archivo) y
   borrar: **Propietario y Coordinador** (`knowledge.manage`). El Asesor no
   ve esos botones y la API le responde 403.
4. **Buscar.** Por título, contenido, etiquetas y nombre de archivo, sin
   acentos ni mayúsculas (la regla de `lib/search.ts`); filtro por etiqueta.
   Versión básica: no se lee el texto de dentro de PDF/Word (decisión del
   dueño, 2026-09-25).
5. **Enviar desde un chat.** En el editor de la Bandeja, el botón de libro o
   `/` en el editor vacío abre un buscador. Por entrada: **Enviar texto**
   (el contenido como mensaje), **Enviar archivo** (el archivo, con el
   contenido como pie si cabe en 1024) e **Insertar** (el contenido va al
   editor para revisarlo). Enter = la acción natural; Esc cierra. Todos los
   roles, solo en chats que pueden ver.
6. **Chat interno (preparado, no construido).** `KnowledgePicker` no conoce
   el canal: devuelve la entrada y la acción. La entrega pasa por
   `deliverKnowledgeEntry(target, entry, mode)` con `KnowledgeTarget`, que hoy
   solo tiene `whatsapp_conversation`; el chat interno agrega su variante ahí.

## Diseño

**Datos** — `knowledge_entry` (migración `0019`, aditiva y re-ejecutable):
`id` (`kn_`), `organization_id` NOT NULL, `title`, `body`, `tags text[]`,
`file_path/file_name/file_mime/file_size` (NULL = solo texto),
`created_by_user_id`, `created_at`, `updated_at`. Índice
`(organization_id, updated_at)`. Todo acceso por `scoped()` en
`src/server/knowledge/store.ts` (datos del negocio, no de clientes).

**Archivos** — en el volumen local `MEDIA_DIR` (`<org>/<id>`), sin terceros
(constitución II). Se validan con los límites de WhatsApp al subir
(`validateOutgoing`): lo que se sube, se puede enviar. Se sirven con sesión,
`nosniff`, `CSP: sandbox` y `attachment` salvo imágenes y PDF: un archivo
subido nunca se ejecuta como página.

**API**

| Ruta | Quién | Qué |
|---|---|---|
| `GET /api/knowledge?q=&tag=` | todos | `{ entries, tags }` (máx. 200) |
| `POST /api/knowledge` | `knowledge.manage` | multipart (`title`, `body`, `tags`, `file`) o JSON sin archivo → 201 |
| `GET /api/knowledge/[id]` | todos | `{ entry }` |
| `PATCH /api/knowledge/[id]` | `knowledge.manage` | mismos campos + `removeFile=true`; no puede quedar vacía (422) |
| `DELETE /api/knowledge/[id]` | `knowledge.manage` | 204; borra también el archivo |
| `GET /api/knowledge/[id]/file` | todos | el binario |
| `POST /api/conversations/[id]/messages/knowledge` | todos, chat visible | `{ entryId, mode: "text" \| "file" }` → 201; reutiliza `sendText`/`sendMediaMessage` (sandbox del Laboratorio, ventana de 24 h, límites de adjuntos) |

## Fuera de alcance

Texto de dentro de PDF/Word en la búsqueda, carpetas, versiones, estadísticas
de uso, el chat interno mismo.
