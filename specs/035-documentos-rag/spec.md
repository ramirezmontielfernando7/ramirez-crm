# 035 — Documentos del negocio para el agente (RAG ligero)

**Carril**: ciclo completo (tablas nuevas, migración `0040`). Un solo PR.
Decisiones del dueño (2026-10-07):

- Embeddings: **opción C** — un adaptador OpenAI-compatible
  (`/v1/embeddings`) con un contenedor local por defecto
  (`intfloat/multilingual-e5-small` en Hugging Face TEI, CPU) y la API de
  pago como cambio de variable. Prefijos e5 obligatorios: `query: ` para la
  pregunta del cliente y `passage: ` para los fragmentos.
- Nombre de la pestaña: **«Documentos»** (en el Laboratorio). «Conocimiento»
  ya lo usan el KB del agente (`kb_entry`) y el módulo «Conocimientos» (024).
- Límites aprobados tal cual (abajo).
- Sin pgvector: los vectores viven como `real[]` y la similitud se calcula en
  Node (≤ 3 000 fragmentos × 384 dimensiones por organización).

## Problema

El agente solo conoce lo que el dueño teclea a mano en su KB (preguntas y
respuestas o bloques) y lo recibe COMPLETO en cada turno. Los negocios tienen
manuales, listas de precios, FAQs y políticas en archivos; copiarlos al KB es
lento y el prompt crece sin control.

## Comportamiento observable

1. **Laboratorio → Documentos** (`/lab/documentos`, `agent.manage`, módulo
   `lab`, que requiere `agent`; además el interruptor de instancia `KB_DOCS`):
   lista de documentos con estado (En cola · Indexando · Listo · Listo (solo
   texto) · Falló + motivo), fragmentos, tamaño, fecha; subir; reindexar;
   eliminar con confirmación; uso contra los límites.
2. **Formatos**: `.txt`, `.md`/`.markdown` (UTF-8, o Windows-1252 de
   respaldo) y `.pdf` con capa de texto. Se rechazan con su motivo: PDF
   escaneado (sin texto), PDF cifrado, cualquier otro tipo (`.docx`,
   `.xlsx`, imágenes, HTML…). El archivo original NO se guarda: solo su texto.
3. **Indexado in-process**: el texto se divide en fragmentos (~800
   caracteres, 120 de solape, respetando párrafos y encabezados de markdown),
   se guardan con su `tsvector` en español (búsqueda por texto, siempre) y,
   si hay servicio de embeddings, con su vector. Si el servicio falla o no
   existe, el documento queda «Listo (solo texto)» y se busca por texto. Al
   arrancar se retoma lo que quedó a medias y se completan los vectores que
   falten o sean de otro modelo.
4. **En cada turno** (real, Laboratorio y vista previa): con la consulta de
   los últimos mensajes del cliente se recuperan hasta 4 fragmentos (máx.
   4 000 caracteres) de ESA organización: búsqueda por texto + similitud
   (fusión RRF), con umbral. Van en una sección delimitada del system
   prompt, después del KB. Sin documentos o sin fragmentos relevantes, el
   prompt es **idéntico byte a byte** al de antes (prueba dorada).
5. **Defensa contra inyección**: el contenido de los documentos es DATO. La
   sección lo dice explícitamente, cada fragmento va entre marcadores con un
   `nonce` aleatorio por turno, y se neutraliza cualquier `<<`/`>>` dentro
   del texto. El esquema de acciones sigue validando todo igual.
6. **Uso de IA**: los embeddings pasan por `embedForOrg` (única puerta,
   `src/server/ai-quota/embed.ts`) y se registran en `ai_usage` con
   `kind = 'embed'`. No gastan turnos del agente. Tope opcional
   `AI_DEFAULT_MONTHLY_EMBED_TOKENS` (útil con proveedor de pago).
7. **Aislamiento**: tablas con `organization_id`, FK compuestas, RLS
   forzado; una organización jamás ve, recupera ni borra lo de otra.

## Límites (por organización; variable de entorno por defecto, fila propia en `kb_document_limit`)

| Límite | Valor | Se mide |
|---|---|---|
| Tamaño por archivo | 5 MB (`KB_DOCS_MAX_FILE_MB`) | bytes del archivo, antes de leerlo (413) |
| Texto por documento | 300 000 caracteres | tras extraer (422 `too_long`) |
| Documentos | 50 (`KB_DOCS_MAX_DOCUMENTS`) | `count(kb_document)` con candado de la organización (409) |
| Fragmentos | 3 000 (`KB_DOCS_MAX_CHUNKS`) | suma de `chunk_count` al indexar (`failed: chunk_limit`) |
| Indexado concurrente | 1 por organización, 2 en total | en memoria (`indexer.ts`) |
| Subidas | 20 por hora por persona | `checkRateLimit` (429) |

## Fuera de alcance

pgvector; OCR; `.docx`/`.csv`; documentos por agente (todos los agentes de la
organización los leen); arreglar el Juez o las personas del Laboratorio (ver
plan: cómo alimentarlos después); exponer documentos al cliente final;
campañas, plantillas, Bandeja.
