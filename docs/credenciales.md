# Credenciales, llave de cifrado y webhooks (Fase 3 multitenant · PR 1)

Spec: [specs/027-credenciales-webhooks](../specs/027-credenciales-webhooks/spec.md) ·
migración `0028_credenciales_y_webhooks.sql` · reversa
`scripts/sql/0028-reversa.sql`.

## Qué cambió

| Antes | Ahora |
|---|---|
| Cada módulo descifraba sus credenciales por su cuenta | Una sola puerta: `getOrgCredentials(org, tipo)` (`src/server/credentials/`), con errores tipados |
| Una llave sin versión: rotarla obligaba a volver a pegar todo | `key_version` en cada fila cifrada; la rotación se hace sola al arrancar |
| El secreto de webhook de Zernio se guardaba en claro | Cifrado; el arranque cifra el que estaba en claro |
| El WABA no era único: los eventos de plantillas iban a "la primera organización" | `whatsapp_business_account`: cada WABA es de una sola organización |
| Guardar un número de otra organización daba un 500 | 409 con un mensaje claro; además se valida que el número sea de esa WABA |
| Un evento de un número desconocido se perdía | Se guarda 7 días, cifrado, en `webhook_unrouted` |
| Instagram/Messenger (Meta) y Zernio aceptaban eventos sin firma si faltaba el secreto | Se rechazan (401), como WhatsApp |
| La llave de OpenRouter no tenía tope por organización | Cuota mensual (turnos y/o tokens) por organización |

## La llave de cifrado

### Formato exacto de `ENCRYPTION_KEY`

32 bytes **aleatorios** codificados en **base64 estándar**: exactamente **44
caracteres**, de `A-Z a-z 0-9 + /`, terminados en un `=`. Ejemplo de la
**forma** (no la uses): `q3J0…(40 caracteres más)…Xw=`. Si no son 32 bytes,
la app no arranca y lo dice en el log (sin mostrar el valor).

### Generarla en Windows (PowerShell), sin que aparezca en pantalla

Abre PowerShell y pega esta línea entera:

```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b) | Set-Clipboard; $b = $null
```

- No imprime nada: la llave queda **solo en el portapapeles**.
- Pégala directo en tu gestor de contraseñas (entrada nueva, p. ej.
  «Vocero ENCRYPTION_KEY v2») y después en Coolify.
- Al terminar, vacía el portapapeles: `Set-Clipboard -Value $null`.
- Funciona en Windows PowerShell 5.1 y en PowerShell 7.

La llave **nunca** debe ir a un chat, un correo, un ticket ni un log. Vocero
nunca la registra: el log del arranque solo dice **números de versión y
conteos de filas**.

### Las variables

| Variable | Qué es |
|---|---|
| `ENCRYPTION_KEY` | La llave **actual**. Todo lo nuevo se cifra con ella. |
| `ENCRYPTION_KEY_VERSION` | Su número (por defecto `1`). Súbelo en cada rotación: 1 → 2 → 3… |
| `ENCRYPTION_KEY_OLD` | **Solo durante una rotación**: la llave anterior, tal cual. |
| `ENCRYPTION_KEY_OLD_VERSION` | Su número (el que tenía como `ENCRYPTION_KEY_VERSION`). |

Todas son de **tiempo de ejecución** (en Coolify, sin marcar «Build
Variable»).

### Backups y la llave vieja (importante)

Un backup de la base guarda los tokens **cifrados con la llave que tenían
ese día**. Por eso:

- **Cualquier backup anterior a la rotación solo se puede usar con la llave
  vieja.** Si lo restauras, tienes que volver a poner la llave vieja en
  `ENCRYPTION_KEY` (con su versión, `1`) o los tokens no se podrán leer.
- **Conserva la llave vieja en tu gestor de contraseñas mientras exista
  algún backup anterior a la rotación.** Anota junto a ella la fecha de la
  rotación: los backups de antes de esa fecha la necesitan.
- Cuando el último backup anterior a la rotación se borre por antigüedad,
  ya puedes borrar la llave vieja.

## Paso a paso en Coolify (PR 1)

> Antes de nada: corre la **consulta de solo lectura** de abajo y revisa el
> resultado. Si tu organización usa Zernio **sin** secreto de webhook, ponlo
> antes de desplegar (sección siguiente) o esos mensajes empezarán a
> rechazarse.

1. **Backup de la base.** En Coolify, abre el recurso de **PostgreSQL** →
   pestaña **Backups** → **Backup Now**.
   - Debes ver: el backup nuevo en la lista con estado **Success** y tamaño
     mayor que cero.
   - Si falla: no sigas.
2. **Guarda la llave actual.** En el recurso de la **app** → **Environment
   Variables**, copia el valor de `ENCRYPTION_KEY` (el ojo para mostrarlo)
   y guárdalo en tu gestor de contraseñas como «Vocero ENCRYPTION_KEY v1 —
   válida para backups anteriores a <fecha de hoy>».
   - Debes ver: el valor guardado completo (44 caracteres) en el gestor.
3. **Fusiona el PR y despliega** (sin tocar variables).
   - Debes ver en **Logs** de la app, al arrancar:
     - `[migrate]` sin errores (aplica la 0028);
     - `[credentials] meta_credentials: 1 fila(s) (versión 1: 1) · 0 re-cifrada(s) a la versión 1 …`;
     - `mantenimiento de credenciales: llave actual versión 1; 0 fila(s) con llaves no disponibles`.
   - En la app: **Configuración → WhatsApp** dice «Conectado» con los
     mismos 4 últimos caracteres del token de antes. Manda y recibe un
     mensaje de prueba.
   - Revertir: despliega el commit anterior (las columnas nuevas no le
     estorban). Si además quieres quitar la 0028, ver «Reversa» abajo.
4. **Genera la llave nueva** en tu computadora con el comando de PowerShell
   de arriba y guárdala en tu gestor como «Vocero ENCRYPTION_KEY v2».
5. **Cambia las variables** en **Environment Variables** de la app, en este
   orden, y guarda cada una:
   1. Crea `ENCRYPTION_KEY_OLD` = el valor **actual** de `ENCRYPTION_KEY`
      (el del paso 2).
   2. Crea `ENCRYPTION_KEY_OLD_VERSION` = `1`.
   3. Cambia `ENCRYPTION_KEY` = la llave **nueva** (paso 4).
   4. Crea (o cambia) `ENCRYPTION_KEY_VERSION` = `2`.

   Después pulsa **Redeploy** (o **Restart**). Hazlo en un momento de poco
   tráfico: durante unos segundos conviven el contenedor viejo (que solo
   tiene la llave vieja) y el nuevo (que ya re-cifró), y un envío en ese
   instante puede fallar y verse como «no enviado» en la bandeja.
   - Debes ver en **Logs**:
     - `[credentials] meta_credentials: 1 fila(s) (versión 2: 1) · 1 re-cifrada(s) a la versión 2 · … · 0 sin llave · 0 que no descifran`
       (y una línea así por cada tabla con datos: Zoom, Google, CAPI…);
     - `mantenimiento de credenciales: llave actual versión 2; 0 fila(s) con llaves no disponibles`.
   - Revertir (si algo sale mal aquí): vuelve a poner `ENCRYPTION_KEY` = la
     v1, `ENCRYPTION_KEY_VERSION` = `1`, `ENCRYPTION_KEY_OLD` = la v2,
     `ENCRYPTION_KEY_OLD_VERSION` = `2`, y redespliega: el arranque
     re-cifra todo de vuelta a la versión 1. Ninguna credencial se pierde
     mientras tengas las dos llaves.
6. **Verifica.**
   - **Configuración → WhatsApp**: «Conectado», mismos 4 últimos caracteres.
   - Manda un mensaje desde la bandeja y responde desde un teléfono: los dos
     se ven.
   - Si usas Zoom/Google/CAPI/Messenger: su pantalla de Configuración sigue
     diciendo «Conectado» y su botón **Probar** pasa.
7. **Unos días después** (cuando estés seguro), borra `ENCRYPTION_KEY_OLD` y
   `ENCRYPTION_KEY_OLD_VERSION` y redespliega.
   - Debes ver en **Logs**: `… llave actual versión 2; 0 fila(s) con llaves no disponibles`.
   - Si dice más de 0: vuelve a poner las dos variables (algo no se
     re-cifró) y avísame con esa línea del log.
   - **No borres la v1 del gestor**: ver «Backups y la llave vieja».

> Si algún día despliegas código **anterior** a este PR, `ENCRYPTION_KEY`
> debe ser la llave con la que están cifradas las filas en ese momento (tras
> la rotación, la **nueva**): el código viejo no sabe de versiones.

## Zernio sin secreto de webhook: cómo ponerlo antes de desplegar

Desde este PR, un evento de una cuenta de Zernio **sin secreto guardado**
responde 401 (antes se aceptaba sin verificar). Si la consulta de solo
lectura dice que tu conexión de **Messenger** por Zernio no tiene secreto:

1. En el panel de **Zernio**, en la configuración del webhook de tu cuenta,
   define un secreto (o copia el que ya tenga). Guárdalo también en tu
   gestor de contraseñas.
2. En Vocero, **Configuración → Messenger**: deja *Zernio*, pega de nuevo el
   `accountId`, la API key y el **secreto del webhook**, y pulsa **Probar y
   guardar**. (Esto funciona con el código actual, antes de desplegar.)
3. Verifica que un mensaje de prueba por Messenger sigue entrando.

Al desplegar, el arranque cifra ese secreto y deja la columna en claro
vacía. Para **Instagram** no hay pantalla (se configura por la API
`/api/settings/instagram`); si la consulta dice que tienes Instagram por
Zernio sin secreto, avísame y te doy los pasos.

## Consulta de solo lectura (antes de desplegar)

Pega esto en tu sesión local de Claude Code conectada por SSH al servidor:

> Conéctate por SSH al servidor de Coolify y abre `psql` contra la base de
> Vocero en producción **en modo solo lectura**: empieza con `BEGIN READ
> ONLY;` y termina con `ROLLBACK;`. No ejecutes nada que escriba. No
> muestres el valor de ninguna columna que termine en `_cipher`, `_iv`,
> `_tag`, ni de `webhook_secret`, ni ninguna variable de entorno. Corre y
> muéstrame el resultado de:
>
> 1. `select count(*) as conexiones, count(distinct waba_id) as wabas_distintas, count(distinct phone_number_id) as numeros_distintos from meta_credentials;`
> 2. `select source, count(*) as total, count(*) filter (where webhook_secret is null or webhook_secret = '') as sin_secreto from messenger_credentials group by source;`
> 3. `select source, count(*) as total, count(*) filter (where webhook_secret is null or webhook_secret = '') as sin_secreto from instagram_credentials group by source;`
> 4. `select (select count(*) from zoom_credentials) as zoom, (select count(*) from google_credentials) as google, (select count(*) from capi_settings) as capi;`
> 5. `show server_version;`
>
> Si alguna tabla no existe, dilo y sigue con las demás.

Qué espero: (1) `1, 1, 1`; (2) y (3) `sin_secreto = 0` en las filas con
`source = zernio` (o ninguna fila); (5) 18.x.

## `webhook_unrouted`

- Solo eventos **firmados** por Meta (WhatsApp, Instagram, Messenger) cuyo
  número/WABA/perfil/página no tiene ninguna organización. Zernio no entra:
  sin la cuenta no hay secreto con qué verificar la firma, así que se
  rechaza.
- Contenido **cifrado** (con la llave actual; la rotación también lo
  re-cifra). El log solo dice fuente, tipo de llave, la llave
  (`phone_number_id`, etc.) y el campo.
- 7 días: se borra al arrancar y cada hora. Tope de 5000 filas.
- Solo la usa `vocero_system`: `vocero_app` no tiene permisos sobre ella
  (`scripts/migrate.mjs` los revoca en cada arranque).
- No hay pantalla ni reprocesamiento automático (decisión del dueño): sirve
  para diagnosticar «me escribieron y no llegó» (consulta de solo lectura
  por `route_key`).

## Cuota de IA

- Por organización, por **mes calendario en UTC** (el 1 a las 00:00 UTC son
  las 18:00 del último día del mes en Ciudad de México).
- Un **turno** es una llamada al modelo (con sus reintentos internos): un
  turno del agente, del Laboratorio, del juez o del asistente de redacción.
  Los **tokens** son los que reporta OpenRouter (entrada + salida).
- Sin tope propio vale el default `AI_DEFAULT_MONTHLY_TURNS` /
  `AI_DEFAULT_MONTHLY_TOKENS`; vacíos = **sin tope** (tu organización hoy
  no cambia).
- Al agotarse: el agente pasa la conversación a una persona (motivo «Se
  agotó la cuota mensual de IA», en la línea de tiempo y en el aviso), el
  Laboratorio no contesta y el asistente de redacción responde 429.
- Ver y cambiar, hasta que exista /platform (PR 2): `scripts/ai-quota.mjs`
  en desarrollo o donde haya Node y acceso a la base:

  ```
  node --env-file=.env scripts/ai-quota.mjs show
  node --env-file=.env scripts/ai-quota.mjs set --org org_… --turns 2000 --tokens none --dry-run
  ```

  `set` muestra el antes y el después; sin `--dry-run` lo guarda. La carpeta
  `scripts/` **no viaja en la imagen de Docker**: en producción, pídeme el
  prompt para tu sesión SSH (hace lo mismo con `psql`, mostrando el cambio
  antes de escribir). Hoy no hace falta: sin tope, nada cambia.

## Reversa (sin migración nueva)

1. **Código:** despliega el commit anterior al PR. Lee «Si algún día
   despliegas código anterior» arriba (qué llave poner).
2. **Base (opcional):** con el código viejo ya corriendo, como dueño del
   esquema: `scripts/sql/0028-reversa.sql`. Quita la FK, las tablas y las
   columnas nuevas, y la fila de la 0028 del registro de migraciones (para
   que volver a desplegar el PR la aplique otra vez; es idempotente).
3. **Zernio:** el código viejo lee el secreto de la columna en claro, que el
   arranque dejó vacía: vuelve a pegarlo en **Configuración → Messenger**.
4. Último recurso: restaurar el backup del paso 1 (con la llave v1).

## Lo que un correo transaccional cerraría más adelante

(Para el PR 2.) Sin correo, los enlaces de activación y de restablecimiento
de contraseña los ve quien los entrega. Un correo transaccional los mandaría
directo al usuario. Por la constitución (II) entraría como **conector
opcional**, apagado por defecto.
