# Respaldos y recuperación (Coolify)

Guía para quien opera Dashfort **sin programar**. Explica cómo tener copias
de seguridad automáticas, dónde quedan, cómo llevarte una copia a tu
computadora, cómo **probar cada mes** que una copia sirve y qué hacer si un
día hay que restaurar.

> **Antes de empezar.** Esta guía describe **Coolify v4** (los nombres de
> botones y campos se revisaron contra la versión 4.4.6). Para ver tu
> versión, abre Coolify: el número aparece **abajo a la izquierda** del menú
> (algo como `v4.0.0-beta.4xx`); también en **Settings**. Si tu pantalla no
> se parece a lo que aquí se describe (un botón con otro nombre, una pestaña
> en otro lugar), **toma una captura de pantalla** y compártela antes de
> seguir: no adivines.

## Lo que hay que respaldar (son TRES cosas)

| Qué | Dónde vive | Quién la respalda |
|---|---|---|
| **La base de datos** (contactos, chats, campañas, ajustes…) | El recurso **PostgreSQL** de Coolify (contenedor `x1rilm10dmhsci06wg6nmia6`, PostgreSQL 18) | Los **respaldos programados de Coolify** (Paso 1) |
| **Los archivos** (adjuntos, logo, ícono, documentos del agente) | La carpeta `/data/media` del contenedor de la **app** | Una **tarea programada** en la app (Paso 2). Coolify **no** los respalda solo |
| **La llave `ENCRYPTION_KEY`** | Las variables de la app en Coolify | **Tú**, en tu gestor de contraseñas (Paso 3) |

**Sin la llave, una copia de la base sirve a medias**: los tokens de WhatsApp,
Instagram, Messenger y los conectores van cifrados con ella. Restaurada con
otra llave, la app arranca pero queda desconectada de WhatsApp.

---

## Paso 1 — Activar los respaldos programados de la base

1. En Coolify abre tu **proyecto** → el recurso **PostgreSQL** de Dashfort
   (el que dice PostgreSQL 18).
2. Entra a la pestaña **Backups**.
3. Pulsa **+ Add** para crear un respaldo programado.
4. En **Frequency** escribe `0 3 * * *` (todos los días a las 3:00 a. m.).
   También acepta palabras como `daily`.
5. Guarda. Luego abre el respaldo que acabas de crear (**Manage**) y revisa:
   - **Timezone**: la tuya (`America/Mexico_City`, por ejemplo). Si la dejas
     vacía usa la del servidor.
   - **Databases to back up**: el nombre de la base de Dashfort (lo que va
     después de la última `/` en `DATABASE_URL` de la app). Vacío = la base
     por defecto del recurso.
   - Si ves una opción para respaldar **todas las bases** («all
     databases» / `pg_dumpall`), déjala **apagada**: ese formato no lo puede
     revisar la prueba de restauración del Paso 5.
   - **S3 storage**: déjalo **sin elegir** por ahora (es el Paso 6B).
6. En la parte de retención (**Local backups**) pon:
   - **Backups to keep**: `14` → dos semanas de copias diarias en el servidor.
   - **Days to keep**: `14`.
   - **Maximum storage (GB)**: déjalo vacío, o pon lo que te sobre de disco.
7. Pulsa **Back up now** para sacar el primero sin esperar a la noche.

- **Debes ver**: en **Executions** una línea nueva con **Status** de éxito
  y un **Size** mayor que cero.
- **Si falla** (estado **Failed**): abre la ejecución y copia el mensaje de
  error. No sigas con los demás pasos hasta resolverlo.

> **¿Por qué 14?** Si alguien borra algo por error y nadie se da cuenta en
> unos días, todavía tienes una copia de antes. Más copias = más disco: cada
> copia pesa más o menos lo que pesa la base comprimida.

### ¿Dónde quedan?

En el **disco del servidor**, en una carpeta parecida a:

```
/data/coolify/backups/databases/<tu-equipo>-<número>/<nombre-de-la-base>-<id>/
```

con archivos llamados `pg-dump-<base>-<número>-<código>.dmp` (en
**Executions**, el botón **Copy backup path** copia la ruta completa). Para
encontrar la ruta
exacta, abre la **terminal del servidor** (en Coolify: **Servers** → tu
servidor → **Terminal**, o por SSH) y escribe:

```sh
find /data/coolify/backups -name "*.dmp" | sort | tail -5
```

- **Debes ver**: las rutas de los últimos 5 respaldos.

> **Importante:** estas copias viven en el **mismo servidor** que la base.
> Si el servidor se pierde, se pierden con él. Por eso existe el Paso 4.

---

## Paso 2 — Respaldar los archivos (tarea programada)

Coolify no respalda la carpeta de archivos de la app. Dashfort trae un guion
para eso (`ops/respaldo.mjs`).

1. En Coolify abre el recurso de la **app** de Dashfort → pestaña
   **Scheduled Tasks** → **+ Add**.
2. Llena:
   - **Name**: `Respaldo de archivos`
   - **Command**: `node ops/respaldo.mjs --solo-media --guardar 7`
   - **Frequency**: `0 4 * * *` (todos los días a las 4:00 a. m.)
3. Guarda. Para probarlo ya, abre la pestaña **Terminal** de la app, elige el
   contenedor de la app y escribe el mismo comando:

   ```sh
   node ops/respaldo.mjs --solo-media --guardar 7
   ```

- **Debes ver**: `✔ Archivos respaldados: /data/backups/dashfort-…-media.tar.gz (… MB)`.
- **Si falla**: copia el mensaje que empieza con `Error:`.

Quedan en `/data/backups/` **dentro del contenedor de la app** (el volumen
de la app; sobrevive a los despliegues). El guion conserva los 7 más nuevos.

> Cada copia pesa más o menos lo que pesan tus archivos. Si el disco se
> aprieta, baja `--guardar` a `3`; no bajes la frecuencia.

### Respaldo completo a mano (antes de algo delicado)

Antes de un cambio grande (una migración importante, una rotación de llave),
saca un respaldo de la base **y** los archivos en un solo paso, desde la
**Terminal** de la app:

```sh
node ops/respaldo.mjs
```

- **Debes ver**: `✔ Base respaldada: …` y `✔ Archivos respaldados: …`.
- **Si dice** `pg_dump es versión X y el servidor es Y`: la imagen de la app
  quedó con un `pg_dump` más viejo que la base. Usa mejor **Back up now** de
  Coolify (Paso 1) y avisa a quien mantiene el código.

---

## Paso 3 — Guardar la `ENCRYPTION_KEY` aparte

1. En el recurso de la **app** → **Environment Variables**, busca
   `ENCRYPTION_KEY` y pulsa el ojo para verla.
2. Cópiala **completa** (44 caracteres) a tu gestor de contraseñas
   (Bitwarden, 1Password…) con el nombre:
   «Dashfort ENCRYPTION_KEY v1 — desde <fecha de hoy>».
3. Si tienes `ENCRYPTION_KEY_VERSION`, anota también su número.

4. **Guarda también TODAS las demás variables de la app.** Si el servidor se
   pierde, para levantar Dashfort en otro hacen falta las mismas
   (`BETTER_AUTH_SECRET`, `VOCERO_APP_DB_PASSWORD`, `VOCERO_SYSTEM_DB_PASSWORD`,
   `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, la llave de la IA…) y
   Coolify las guarda **solo en ese servidor**. En **Environment Variables**
   pulsa **Developer view**: aparecen todas juntas como texto. Copia todo a
   una nota segura del gestor: «Dashfort variables — <fecha de hoy>».
   Repítelo cada vez que cambies una variable.

- **Debes ver**: la llave y la nota con todas las variables en el gestor.
- **Nunca** la guardes junto a las copias de la base (si alguien se lleva
  las dos cosas, puede leer los tokens).
- Si algún día **rotas** la llave ([credenciales.md](credenciales.md)),
  guarda la nueva **sin borrar la vieja** mientras exista algún respaldo
  anterior a la rotación: esos respaldos solo se abren con la vieja.

---

## Paso 4 — Bajar una copia a tu computadora (cada semana o cada mes)

Así, si el servidor se pierde, tienes la copia fuera.

**A. Con el botón de descarga.** En **PostgreSQL → Backups → Executions**,
cada respaldo tiene en **Actions** el botón **Download backup**. Úsalo con el
más reciente que haya salido bien. (Si tu versión no lo tiene, usa la B.)

**B. Si no hay botón: desde tu computadora con `scp`.** Necesitas el acceso
SSH al servidor (usuario e IP). En Windows abre **PowerShell**; en Mac,
**Terminal**:

```sh
scp root@IP-DEL-SERVIDOR:"/data/coolify/backups/databases/…/pg-dump-….dmp" .
```

(La ruta exacta sale del comando `find` del Paso 1.)

**Los archivos de la app** están dentro del contenedor. En la terminal del
servidor, primero cópialos a una carpeta normal:

```sh
docker ps --format '{{.Names}}'            # busca el nombre del contenedor de la app
mkdir -p /root/descargas
docker cp NOMBRE-DEL-CONTENEDOR:/data/backups/. /root/descargas/
```

y luego, desde tu computadora:

```sh
scp -r root@IP-DEL-SERVIDOR:/root/descargas .
```

Cuando ya estén en tu computadora, bórralos del servidor:
`rm -rf /root/descargas`.

- **Debes ver**: los archivos `.dmp` y `-media.tar.gz` en tu computadora,
  con tamaño mayor que cero.
- Guárdalos en un lugar privado (son todos los datos de tus clientes).
  Conserva por lo menos **las 3 últimas** copias mensuales.

---

## Paso 5 — Prueba de restauración (UNA VEZ AL MES)

Un respaldo que nunca se probó **no es un respaldo**. Esta prueba restaura
una copia en una base **temporal**, revisa que esté completa y que tu llave
la abra, y luego la borra. **Nunca toca la base de producción.**

Hazla en un horario tranquilo (usa el mismo servidor de Postgres).

1. En Coolify, **PostgreSQL → Backups → Back up now** (o usa el de anoche).
   - Debes ver: la ejecución nueva con éxito en **Executions**.
2. En la **terminal del servidor**, copia ese respaldo al contenedor de la
   app (el `find` del Paso 1 te da la ruta; `docker ps` el nombre del
   contenedor):

   ```sh
   docker cp "/data/coolify/backups/databases/…/pg-dump-….dmp" NOMBRE-DEL-CONTENEDOR:/data/backups/
   ```

3. En la **Terminal** de la app (Coolify → app → **Terminal**):

   ```sh
   node ops/probar-restauracion.mjs
   ```

   (Sin opciones usa el respaldo más nuevo de `/data/backups`. Para uno en
   particular: `--archivo /data/backups/pg-dump-….dmp`.)

4. **Debes ver** algo así, y al final **PRUEBA APROBADA**:

   ```
   ✔ Se restauró sin errores en 12 s
   ✔ Organizaciones en la copia: 3
   ✔ Migraciones: la copia trae 52 de 52
     Conteos (copia · producción hoy):
       contact                   1520 ·      1531
       ...
   ✔ Llave de cifrado: la llave actual abre los secretos de la copia (2 revisado(s))
   · Base temporal vocero_prueba_restauracion_… borrada.

   PRUEBA APROBADA: este respaldo se puede restaurar.
   ```

   Que la copia tenga **un poco menos** que producción es normal (es de unas
   horas antes).

5. Borra la copia que pasaste al contenedor:

   ```sh
   rm /data/backups/pg-dump-*.dmp
   ```

6. Anota el resultado en el registro (abajo).

### Si la prueba falla

| Línea con ✘ | Qué significa | Qué hacer |
|---|---|---|
| `no coincide con su .sha256` | El archivo se dañó o quedó a medias | Prueba con otro respaldo. Si fallan varios, revisa el disco del servidor |
| `pg_restore terminó con código…` | La copia no se pudo restaurar | Prueba con el respaldo anterior; guarda el mensaje y pide ayuda |
| `Organizaciones en la copia: 0` | La copia está vacía | Revisa el Paso 1 (¿respalda la base correcta?) |
| `La copia no trae la tabla de migraciones` | Es de otra base, no de Dashfort | Revisa en Coolify qué base respalda (**Databases to back up**) |
| `no es un respaldo en formato propio de pg_dump` | El respaldo se hizo con «todas las bases» (`pg-dump-all-….gz`) | Apaga esa opción (Paso 1, punto 5) y saca otro |
| `Llave de cifrado: … NO lo abre` o `… que este contenedor no tiene` | La `ENCRYPTION_KEY` actual no es la de esa copia (¿se rotó?) | Busca la llave de esa fecha en tu gestor (Paso 3). Sin ella, esa copia no sirve completa |
| `no se encontró «…/pg_restore»` | La imagen de la app no trae el cliente de Postgres | Avisa a quien mantiene el código |

### Registro de pruebas

Copia esta tabla donde lleves tus notas y agrega una fila cada mes:

| Fecha | Respaldo probado | Resultado | Quién |
|---|---|---|---|
| | | APROBADA / FALLIDA | |

Simulacro del 2026-11-09 (fuera de producción, con datos de demostración):
respaldo, servidor «perdido» y restauración en un servidor nuevo siguiendo
el Caso B. Las 107 tablas y los archivos quedaron idénticos, la app arrancó
sobre la copia y la prueba falló con una llave distinta, como debe. **No
sustituye** la prueba mensual con un respaldo real de producción.

---

## Paso 6 — Copias fuera del servidor (obligatorio antes de tener datos reales de clientes)

Sin este paso, todas las copias viven en el mismo servidor que la base: si
el servidor se pierde, solo te queda lo último que bajaste a mano (Paso 4).
Hay dos formas; con datos reales ten **al menos una** (las dos es mejor).

### 6A — Backups de Hetzner (lo más fácil: un clic, sin terminal)

Hetzner guarda cada día una foto del servidor **completo** (base, archivos,
Coolify y sus variables) fuera del servidor, y conserva las 7 últimas.
Cuesta el 20 % del precio mensual del servidor.

1. Entra a [console.hetzner.cloud](https://console.hetzner.cloud) → tu
   proyecto → tu servidor.
2. Pestaña **Backups** → **Enable backups** (Activar).
   - Debes ver: «Backups enabled» y, al día siguiente, la primera copia en
     la lista.
3. Para recuperar: en esa lista, **Rebuild from backup** devuelve el servidor
   entero a como estaba ese día (se pierde lo posterior). **No lo pulses para
   probar**: reemplaza el servidor.

Es una foto del disco, no un respaldo de la base revisado: por eso **no
sustituye** al Paso 1 ni a la prueba del Paso 5; es la red de seguridad por
si el servidor entero se daña.

### 6B — Cloudflare R2 o Backblaze B2 (las copias de la base, en otra empresa)

Con esto Coolify sube cada respaldo de la base automáticamente a un
almacenamiento externo y ya no dependes de bajarlo a mano. No sube los
archivos de `/data/media`: esos van con el 6A o con el Paso 4.

1. Crea una cuenta y un **bucket privado** en
   [Cloudflare R2](https://developers.cloudflare.com/r2/) o
   [Backblaze B2](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api).
   Crea una **llave de acceso** (Access Key + Secret) que solo pueda usar ese
   bucket.
2. En Coolify: **S3 Storages** (en el menú; en algunas versiones dentro de
   **Settings**) → **+ Add**. Llena **Endpoint**, **Bucket**, **Region**
   (en R2 es `auto`), **Access Key** y **Secret Key**. Pulsa
   **Validate Connection**.
   - Debes ver: la conexión validada.
3. En **PostgreSQL → Backups**, abre tu respaldo programado (**Manage**) y
   en **S3 storage** elige ese almacenamiento. Deja encendida **Local copy**
   (así también queda la copia en el servidor). En la retención de **S3**,
   pon **Backups to keep** `30` y **Days to keep** `30`.
4. **Back up now** y revisa que el archivo aparezca en el bucket.

Las copias en R2/B2 también se prueban con el Paso 5: descarga una a tu
computadora y súbela al servidor con `scp`, luego sigue desde el punto 2.

---

## Paso 7 — Que Coolify te avise si un respaldo falla

Un respaldo que falla en silencio es el peor caso: te enteras el día que lo
necesitas.

1. En Coolify, menú **Notifications**.
2. Elige un canal que sí leas (**Email**, **Telegram** o **Discord**),
   llénalo y pulsa **Send Test Notification**.
   - Debes ver: el mensaje de prueba en tu correo o teléfono.
3. En la lista de eventos de ese canal enciende **Backup Failure** y
   **Scheduled Task Failure** (y, si quieres, **Server Disk Usage**).

Aun así, una vez por semana abre **PostgreSQL → Backups → Executions** y
comprueba que el de anoche salió con éxito.

---

## Cuánto se pierde en el peor caso

| Qué pasa | Con Pasos 1 y 2 nada más | Con el Paso 6 también |
|---|---|---|
| Se borran o dañan datos, el servidor vive | Base: hasta **24 h**. Archivos: hasta **24 h** | Igual |
| Se pierde el servidor entero | **Todo** desde la última copia que bajaste a mano (Paso 4) | Base y archivos: hasta **24 h** |

Los mensajes de WhatsApp que entraron después de la copia no vuelven: Meta
no los reenvía. Tiempo para volver a operar: de 1 a 3 horas con el servidor
vivo (Caso A); medio día si hay que montar uno nuevo (Caso B).

---

## Si hay que restaurar (emergencia)

Restaurar **reemplaza** la base actual con la copia: **todo lo que pasó
después de esa copia se pierde** (mensajes, chats, cambios). Meta no vuelve
a mandar los mensajes que ya entregó. Por eso:

- Si el problema es pequeño (un dato borrado), **no restaures todo**: pide
  ayuda para sacar solo ese dato de una copia (con la prueba del Paso 5 se
  puede revisar una copia sin tocar producción).
- Decide con calma **qué copia** usar: la más nueva de **antes** del
  problema.

### Caso A — El servidor sigue vivo (se dañaron o borraron datos)

1. **Detén la app**: Coolify → app → **Stop**. Así nada escribe mientras
   restauras.
   - Debes ver: la app en estado **Stopped**.
2. **Respaldo del estado actual**, por si acaso: PostgreSQL → Backups →
   **Back up now**. Debes verlo con éxito en **Executions**. No lo borres
   hasta terminar.
3. **Copia el respaldo elegido al contenedor de Postgres**, desde la
   terminal del servidor:

   ```sh
   docker cp "/data/coolify/backups/databases/…/pg-dump-….dmp" x1rilm10dmhsci06wg6nmia6:/tmp/restaurar.dmp
   ```

4. **Averigua el nombre de la base**: en las variables de la app,
   `DATABASE_URL` termina en `/<nombre>` (lo que va después de la última `/`
   y antes de un `?`). Abajo lo llamamos `NOMBRE_BASE`.
5. Abre la **Terminal del contenedor de Postgres** (Coolify → PostgreSQL →
   **Terminal**) y corre, cambiando `NOMBRE_BASE`:

   ```sh
   psql -U postgres -d template1 -c 'DROP DATABASE IF EXISTS "NOMBRE_BASE" WITH (FORCE)'
   psql -U postgres -d template1 -c 'CREATE DATABASE "NOMBRE_BASE"'
   pg_restore -U postgres --no-owner --no-acl --exit-on-error -d NOMBRE_BASE /tmp/restaurar.dmp
   ```

   - Debes ver: los tres comandos terminan sin `ERROR`.
   - Si `pg_restore` falla: **no arranques la app**. Repite el punto 5 con
     el respaldo del punto 2 para volver a como estabas, y pide ayuda.
6. **Pausa las campañas** que estaban enviando. La copia no sabe a quién se
   le envió después de sacarla: si arrancas así, **les volvería a enviar**.

   ```sh
   psql -U postgres -d NOMBRE_BASE -c "UPDATE campaign SET status = 'paused', auto_paused = false, resume_at = NULL, pause_reason = 'Pausada tras restaurar un respaldo: revisa a quién ya se le envió antes de reanudar' WHERE status IN ('sending', 'scheduled')"
   rm /tmp/restaurar.dmp
   ```

7. **La llave**: si la copia es de **antes** de una rotación de la
   `ENCRYPTION_KEY`, pon en las variables de la app la llave de esa fecha
   (Paso 3; ver [credenciales.md](credenciales.md)). Si no hubo rotación, no
   toques nada.
8. **Arranca la app**: Coolify → app → **Start** (o **Redeploy**).
   - Debes ver en **Logs**: `[migrate]` sin errores (vuelve a dar los
     permisos de la app y aplica las migraciones que falten).
   - En la app: puedes entrar, ves tus chats, **Configuración → WhatsApp**
     dice «Conectado». Manda y recibe un mensaje de prueba.
9. Revisa cada campaña pausada en **Marketing → Campañas** antes de
   reanudarla.

### Caso B — Se perdió el servidor

1. Servidor nuevo con Coolify v4. Crea un recurso **PostgreSQL 18** y anota
   su nombre de contenedor.
2. En su **Terminal**, crea los roles de la app (los respaldos no los
   incluyen):

   ```sh
   psql -U postgres -c "CREATE ROLE vocero_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT"
   psql -U postgres -c "CREATE ROLE vocero_system NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS NOINHERIT"
   ```

3. Sube tu copia `.dmp` (la de tu computadora o de R2/B2) al servidor con
   `scp` y sigue el **Caso A desde el punto 3** (con el contenedor nuevo).
4. Crea la app como la primera vez ([getting-started.md](getting-started.md))
   con **las mismas variables**, sobre todo la **misma `ENCRYPTION_KEY`**,
   `BETTER_AUTH_SECRET` y las contraseñas `VOCERO_*_DB_PASSWORD`.
   **No la arranques todavía.**
5. **Los archivos**: arranca la app una vez para que se cree su volumen,
   copia el `-media.tar.gz` al contenedor y descomprímelo desde su
   **Terminal**:

   ```sh
   tar -xzf /data/backups/dashfort-…-media.tar.gz -C /data
   ```

6. Apunta el dominio y el webhook de Meta al servidor nuevo y comprueba
   como en el punto 8 del Caso A.

---

## Resumen (para pegar en la pared)

- **Diario 3 a. m.**: Coolify respalda la base (14 copias).
- **Diario 4 a. m.**: tarea de la app respalda los archivos (7 copias).
- **Fuera del servidor**: Backups de Hetzner y/o R2/B2 (Paso 6), y avisos
  de fallo encendidos (Paso 7).
- **Cada mes**: baja una copia a tu computadora **y** haz la prueba de
  restauración (Paso 5). Anótala.
- **Siempre**: la `ENCRYPTION_KEY` y todas las variables de la app guardadas
  aparte, en tu gestor de contraseñas.

Referencia técnica: `scripts/respaldo.mjs`, `scripts/probar-restauracion.mjs`
(en la imagen: `/app/ops/`), reglas en `scripts/lib/respaldos-core.mjs`.
