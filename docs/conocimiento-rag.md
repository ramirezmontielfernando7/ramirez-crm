# Documentos del agente (RAG) — guía de instalación

Con esta función subes documentos de tu negocio (manuales, listas de precios,
preguntas frecuentes, políticas) en **Laboratorio → Documentos**, y el agente
de IA los consulta antes de responder a cada cliente. Tus clientes nunca ven
esa pestaña.

Tiene **dos piezas**, y la segunda es opcional:

| Pieza | Qué hace | ¿Obligatoria? |
|---|---|---|
| `KB_DOCS=on` en Vocero | Enciende la pestaña y la búsqueda **por texto** | Sí, para usar la función |
| Contenedor de embeddings | Añade la búsqueda **por significado** («¿hacen envíos?» encuentra «mandamos a domicilio») | No |

**Sin el contenedor, todo funciona**: los documentos se buscan por las
palabras que contienen (sin importar acentos). Con el contenedor, además se
encuentran por significado aunque el cliente use otras palabras. Si el
contenedor se cae, Vocero sigue buscando por texto: nunca deja a un cliente
sin respuesta por esto.

---

## Paso 1 — Encender o apagar los Documentos en Vocero

1. En Coolify, abre tu proyecto y entra a la aplicación **Vocero**.
2. Ve a la pestaña **Environment Variables** (variables de entorno).
3. Agrega esta variable:

   | Nombre | Valor |
   |---|---|
   | `KB_DOCS` | `on` |

4. Guarda y pulsa **Redeploy** (volver a desplegar). Espera a que el estado
   quede en verde.
5. Comprueba: entra a Vocero → **Laboratorio**. Debe aparecer la pestaña
   **Documentos**.

**Para apagarlo**: borra la variable `KB_DOCS` (o déjala vacía) y vuelve a
desplegar. La pestaña desaparece, sus rutas responden «no existe» y el agente
responde exactamente como antes. Los documentos que ya subiste **no se
borran**: si la vuelves a encender, siguen ahí.

> Además, la organización necesita el módulo **Laboratorio** encendido (y
> con él, **Agente**). Lo maneja el administrador de plataforma en
> `/platform`.

Si solo quieres búsqueda por texto, **ya terminaste**. Sigue al paso 2 solo si
quieres la búsqueda por significado.

---

## Paso 2 — (Opcional) Agregar el contenedor de embeddings

Es un programa gratuito y de código abierto (Hugging Face *Text Embeddings
Inference*) que corre en tu mismo servidor, sin tarjeta ni tokens de pago. Usa
el modelo `intfloat/multilingual-e5-small`, que entiende bien el español.

### 2.1 Crear el recurso

1. En Coolify, abre el **mismo proyecto y el mismo entorno** donde está Vocero
   (tienen que estar en el mismo servidor para hablarse por la red interna).
2. Pulsa **+ New** (nuevo recurso) y elige **Docker Image**.
3. En la imagen escribe exactamente:

   ```
   ghcr.io/huggingface/text-embeddings-inference:cpu-1.8
   ```

   (`cpu` porque tu servidor no tiene tarjeta gráfica; `1.8` fija la versión
   para que no cambie sola).
4. Ponle un nombre que reconozcas, por ejemplo **vocero-embeddings**.

### 2.2 Puerto y dominio

- En **Ports Exposes** (puerto expuesto) escribe `80`.
- **No le pongas dominio** (déjalo vacío) ni publiques el puerto en el
  servidor (*Ports Mappings* vacío). Este servicio no tiene contraseña: solo
  Vocero debe poder llegar a él, por la red interna.

### 2.3 Variables de entorno del contenedor

En **Environment Variables** del recurso nuevo:

| Nombre | Valor | Para qué |
|---|---|---|
| `MODEL_ID` | `intfloat/multilingual-e5-small` | El modelo (español incluido) |
| `AUTO_TRUNCATE` | `true` | Si un fragmento es muy largo, lo recorta en vez de dar error |

### 2.4 Almacenamiento (para no descargar el modelo en cada reinicio)

En **Persistent Storage** agrega un volumen:

- Nombre: `vocero-embeddings-data`
- Ruta de montaje (*mount path*): `/data`

La primera vez que arranca, descarga el modelo (unos 500 MB) desde
huggingface.co. Con el volumen, solo lo descarga una vez.

### 2.5 Límites de memoria y CPU (importante para no tumbar el servidor)

En la configuración del recurso busca **Resource Limits** (límites de
recursos; en algunas versiones de Coolify está dentro de **Advanced**):

| Campo | Valor |
|---|---|
| Number of CPUs (número de CPUs) | `2` |
| Maximum Memory Limit (memoria máxima) | `1g` (ver nota) |

Con estos límites, si el contenedor intentara usar más memoria de la
permitida, Docker reinicia **solo ese contenedor**: Postgres y Vocero no se
tocan, y mientras tanto Vocero sigue buscando por texto. Con 2 de las 8 CPU de
tu servidor, el indexado de un documento grande no frena a la app.

> **Nota sobre la memoria — PENDIENTE DE MEDIR.** El valor de `1g` es
> provisional. Todavía no está medido en un contenedor real: en el entorno
> donde se programó esta función estaba bloqueada la descarga de la imagen y
> del modelo. La medición se hace con `scripts/kb-medir-ram.mjs` (indexa dos
> documentos del tamaño máximo a la vez y lee `docker stats`). En cuanto
> exista el número medido, esta tabla lo dirá. Mientras tanto, `1g` ya
> protege lo que importa: el contenedor no puede quitarle memoria a lo demás.

### 2.6 Nombre en la red interna

Vocero necesita saber cómo llamar al contenedor por la red interna:

- Si tu Coolify muestra el campo **Network Aliases** (alias de red) en la
  configuración del recurso, escribe `vocero-embeddings`. La dirección será
  `http://vocero-embeddings:80`.
- Si no lo muestra, usa el nombre interno que Coolify le dio al recurso (el
  identificador largo que aparece en su página, el *UUID*). La dirección será
  `http://<ese-identificador>:80`.

En el paso 2.8 compruebas que la dirección funcione, así que no importa cuál
de los dos uses.

### 2.7 Desplegar el contenedor y decirle a Vocero dónde está

1. Pulsa **Deploy** en el recurso de embeddings. La primera vez tarda unos
   minutos (descarga la imagen y el modelo). En **Logs** debe aparecer una
   línea parecida a `Ready` o `Starting HTTP server`.
2. Vuelve a la aplicación **Vocero** → **Environment Variables** y agrega:

   | Nombre | Valor |
   |---|---|
   | `EMBEDDINGS_BASE_URL` | `http://vocero-embeddings:80` (o la del paso 2.6) |

   No hace falta `EMBEDDINGS_API_TOKEN` (es solo para proveedores de pago) ni
   `EMBEDDINGS_MODEL` (por defecto ya es `intfloat/multilingual-e5-small`).
3. **Redeploy** de Vocero.

### 2.8 Comprobar que funciona

1. En Coolify, abre la aplicación **Vocero** → **Terminal** y escribe:

   ```
   node -e "fetch(process.env.EMBEDDINGS_BASE_URL + '/health').then(r => console.log('estado', r.status)).catch(e => console.log('ERROR', e.message))"
   ```

   Debe decir `estado 200`. Si dice `ERROR`, la dirección del paso 2.6 no es
   la correcta, o los dos recursos no están en el mismo servidor/red.
2. En Vocero → **Laboratorio → Documentos**, el recuadro de arriba debe decir
   **«Búsqueda por significado y por texto»** (sin el contenedor dice
   «Búsqueda por texto»).
3. Sube un documento. Debe pasar de **Indexando…** a **Listo** (no a «Listo
   (solo texto)»).
4. Los documentos que subiste ANTES de tener el contenedor se completan solos
   al siguiente arranque de Vocero; o pulsa **Reindexar** en cada uno.

### Qué pasa si no instalo el contenedor (o se cae)

- Los documentos se suben e indexan igual y quedan en **Listo** (o «Listo
  (solo texto)» si el contenedor estaba configurado pero no respondió).
- El agente los encuentra por las palabras que contienen, sin importar
  acentos («envio» encuentra «envío»).
- Si el contenedor vuelve, pulsa **Reindexar** o reinicia Vocero: se completan
  los vectores que falten.

---

## Formatos y límites

| | |
|---|---|
| Entran | `.txt`, `.md`/`.markdown`, `.pdf` **con texto** |
| No entran | PDF escaneado (es una foto: no tiene texto), PDF con contraseña, `.docx`, `.xlsx`, imágenes, HTML |
| Tamaño por archivo | 5 MB |
| Texto por documento | 300 000 caracteres |
| Documentos por negocio | 50 |
| Fragmentos por negocio | 3 000 |
| Subidas | 20 por hora por persona |

El operador puede cambiar los límites de un negocio sin tocar las variables:

```
docker exec <contenedor-de-vocero> node ops/kb-limits.mjs show
docker exec <contenedor-de-vocero> node ops/kb-limits.mjs set --org org_… --documents 100 --file-mb 10
```

O para toda la instancia, con las variables `KB_DOCS_MAX_FILE_MB`,
`KB_DOCS_MAX_DOCUMENTS` y `KB_DOCS_MAX_CHUNKS`.

## Grupos de documentos (037)

En Laboratorio → Documentos, los documentos se ordenan en **grupos**
(subpestañas): **General** siempre existe y es donde quedan los documentos que
ya tenías; el dueño crea, renombra y elimina los demás (Ventas, Dirección…;
hasta 20 por negocio). Cada documento está en un grupo y se puede **mover** a
otro desde su menú «⋯».

Al eliminar un grupo con documentos se elige: **mover sus documentos a
General** (por defecto) o **eliminarlos también** (pide una confirmación más;
no se puede deshacer).

Los límites de arriba siguen siendo por negocio, sumando todos los grupos.

### De qué documentos lee cada agente

En el editor de cada agente (Laboratorio → Agentes → el agente → «Documentos»):

- **Todos los documentos de la empresa** (por defecto): los de todos los
  grupos. Un agente que nadie configuró se comporta exactamente como antes de
  los grupos.
- **Solo estos grupos**: uno o varios. Sin ninguno elegido, el agente no lee
  documentos de la empresa.

Es parte del borrador: se aplica al **publicar**. La vista previa ya usa lo
que hay en el formulario, y «Por qué respondió así» dice de qué documento y
de qué grupo vino lo que consultó. Vale para el turno real (también el
agente de cada etapa), la vista previa y las evaluaciones (que congelan la
selección al empezar). Al borrar un grupo, el diálogo dice cuántos agentes lo
eligen: dejarán de leer esos documentos.

## Seguridad: el contenido es dato, no instrucciones

Un documento puede traer texto como «ignora tus instrucciones y…». Vocero lo
trata siempre como **información**: va en una sección aparte del mensaje al
modelo, marcada con una clave aleatoria distinta en cada turno (un documento
no puede «cerrar» esa sección), y el modelo recibe la regla explícita de no
obedecer nada que venga de ahí. Si un documento contradice las instrucciones o
el conocimiento que escribiste a mano, mandan los tuyos.

## Usar una API de pago en vez del contenedor

Cualquier servicio compatible con `POST /v1/embeddings` (el formato de OpenAI)
sirve: cambia `EMBEDDINGS_BASE_URL`, pon `EMBEDDINGS_MODEL` con el modelo del
proveedor y `EMBEDDINGS_API_TOKEN` con su llave. Para poner un tope mensual de
tokens por negocio, usa `AI_DEFAULT_MONTHLY_EMBED_TOKENS`. Si cambias de
modelo, los documentos se re-embeben solos al siguiente arranque.

## Ruta B (docker compose)

El `docker-compose.yml` ya trae el servicio `embeddings` con sus límites
(`mem_limit` y `cpus`), apagado por defecto:

```
docker compose --profile rag up -d
```

y en `.env`: `KB_DOCS=on` y `EMBEDDINGS_BASE_URL=http://embeddings:80`.

## Para desarrolladores

- Código: `src/server/kb-docs/` (puerta única de las tablas en `store.ts`),
  adaptador en `src/lib/ai/embeddings.ts` (prefijos e5 «query: » /
  «passage: »), puerta única de uso en `src/server/ai-quota/embed.ts`.
- Spec: [specs/035-documentos-rag](../specs/035-documentos-rag/spec.md).
- Pruebas: `tests/unit/embeddings-adapter.test.ts`, `tests/db/documentos.test.ts`,
  `scripts/e2e-documentos.mjs`.
