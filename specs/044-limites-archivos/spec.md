# 044 — Límites de archivos (50/100 MB) y Biblioteca segura

**Carril**: ligero. **Sin migraciones.** Un PR. Pedido el 2026-10-21 (punto 2
de la cola antes del Buen Fin): que se puedan subir y compartir archivos
pesados sin que el sistema falle, con mensajes claros y sin romper los topes
de Plataforma (`storage_limit_bytes`, modo `warn` / `block_uploads`).

## Topes

| Dónde | Tope | Por qué |
|---|---|---|
| Bandeja → WhatsApp | fotos 5 MB · audio y video 16 MB · documentos 100 MB | los fija la Cloud API de Meta; no se pueden subir |
| Biblioteca (Conocimientos) | 100 MB; solo PDF, Word, texto e imágenes; además lo de WhatsApp | lo que se guarda se tiene que poder mandar |
| Chat de equipo | 50 MB (antes 16) | interno, no sale a Meta |
| Documentos del agente (RAG) | `KB_DOCS_MAX_FILE_MB`, 20 MB por defecto (antes 5); Plataforma lo cambia por organización hasta 50 | el PDF se abre entero en memoria para sacarle el texto |
| Biblioteca → «Entrenar también a la IA» | el mismo tope de Documentos de la organización | antes no tenía tope: un PDF de 100 MB se abría entero |

SVG y HTML no se aceptan en ningún lado (antes la Biblioteca y la Bandeja los
guardaban; los que ya existan se siguen sirviendo solo como descarga).

## Comportamiento observable

1. El navegador revisa tipo y tamaño ANTES de subir, con el mismo mensaje que
   daría el servidor (p. ej. «La foto pesa 8 MB y WhatsApp solo acepta fotos
   de hasta 5 MB. Redúcela o mándala en PDF.»). Reglas únicas en
   `src/lib/upload-limits.ts`.
2. El servidor rechaza por `content-length` antes de leer el cuerpo (413) y,
   si no viene o miente, cuenta los bytes mientras llegan y corta en el tope
   (`readUploadForm`, `src/server/uploads/body.ts`).
3. A lo más 3 subidas de más de 10 MB a la vez en el proceso; la cuarta
   recibe 503 «Hay otras subidas grandes en curso. Intenta de nuevo en un
   minuto.» (`withUploadSlot`). Las chicas nunca hacen fila.
4. Si el proxy corta la subida (413, 502, 504 sin nuestro JSON), la pantalla
   dice por qué en español en vez de «Error 413» (`uploadHttpMessage`).
5. La Bandeja mostraba «Error 413» en vez del motivo porque leía `message` y
   la API responde `{ error: { message } }`: corregido.
6. `block_uploads` sigue igual: `assertCanUpload` corre después de leer el
   archivo y antes de guardarlo, como antes.

## Lo que depende del servidor (Coolify), no del código

- **Traefik** (el proxy de Coolify) no limita el tamaño por defecto, pero en
  v3 corta las lecturas a los **60 s** (`respondingTimeouts.readTimeout`). Un
  archivo de 100 MB con 10 Mbps de subida tarda ~80 s. Si una subida grande
  falla a ~1 minuto, en Coolify → Servers → Proxy agregar
  `--entrypoints.https.transport.respondingTimeouts.readTimeout=600s` (y lo
  mismo para `http`) y reiniciar el proxy.
- **Cloudflare** (si el dominio pasa por su nube naranja): el plan gratis
  corta en 100 MB por petición; un documento de casi 100 MB más el sobre del
  formulario puede no pasar.
- **Node** corta una petición a los 300 s (`requestTimeout`): con menos de
  ~3 Mbps de subida, 100 MB no alcanza.
