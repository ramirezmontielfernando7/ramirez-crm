# 021 — Etiquetas, consentimiento, importar/exportar CSV y campañas

**Estado:** implementado · guion E2E [`tests/e2e/us-campanas.md`](../../tests/e2e/us-campanas.md)
(`pnpm test:e2e:campanas`) · [plan](plan.md) · [tareas](tasks.md) · [quickstart](quickstart.md)

## Problema

Una agencia que adapta Vocero para un negocio llega con la base de clientes
del negocio en una hoja de cálculo y quiere avisarles de una promoción por
WhatsApp. Vocero no podía importar esa base, no sabía quién había aceptado
recibir mensajes y solo mandaba plantillas de una en una.

El objetivo es ese flujo completo: **importar una base → saber de dónde vino
cada contacto → enviarles una plantilla aprobada por Meta, solo a los que
aceptaron, con registro de qué pasó con cada envío.** Las etiquetas, el
consentimiento y el CSV existen para eso; no son un CRUD aparte.

## Historias

1. **Etiquetas.** Como coordinador creo, renombro y borro etiquetas
   (Configuración → Etiquetas). Borrar una etiqueta la quita de sus
   contactos; los contactos se quedan. Cualquiera etiqueta a un contacto que
   puede ver (panel de la Bandeja o Editar en Contactos) y filtra la lista
   por etiqueta.
2. **Consentimiento.** Cada contacto tiene `waConsent`: `opt_in`, `opt_out`
   o `desconocido` (default de todo contacto, existente o nuevo), con su
   origen (`waConsentSource`) y fecha. Se cambia a mano desde el CRM; para
   marcar `opt_in` la UI pide anotar de dónde salió.
3. **Importar CSV.** Subo un CSV (`name`, `phone` obligatorias; `source`,
   `waConsent`, `waConsentSource`, `tags` opcionales; también en español) y
   recibo un resumen: creados, ya existentes, no importados, con el detalle
   por fila (línea y motivo) descargable. Todos los contactos del archivo
   reciben la etiqueta `Import: <archivo>` o la que yo elija.
4. **Exportar CSV.** Descargo los contactos con los filtros activos
   (búsqueda, etapa, etiqueta, fuente, consentimiento, archivados), con sus
   etiquetas y consentimiento. El export se puede volver a importar.
5. **Campañas** (bandera `CAMPAIGNS`). Elijo una plantilla **aprobada**, un
   público (etiquetas y/o fuente — siempre `opt_in`), lleno las variables
   (texto fijo o nombre del contacto), veo a cuántos les llegará y a cuántos
   no por falta de consentimiento, confirmo, y el envío corre en segundo
   plano. En el detalle veo el avance en vivo y, al final, enviados /
   fallidos / pendientes con el motivo de cada fallo, descargable.

## Reglas duras

- **R1 — Solo `opt_in` recibe campañas.** Cableado en
  `server/campaigns/audience.ts` (la única función que arma el público); el
  esquema de la API no acepta otro consentimiento; y el ejecutor lo vuelve a
  comprobar contacto por contacto justo antes de enviar. No es un aviso
  visual.
- **R2 — Solo plantillas `approved`.** Al crear el borrador y otra vez al
  lanzar (pudo pausarse o rechazarse en medio). La UI ni las muestra.
- **R3 — Un `opt_out` es pegajoso.** Ninguna importación lo revierte (queda
  un aviso por fila); solo una persona a mano desde el CRM.
- **R4 — La importación no pisa lo capturado.** En un contacto existente
  solo se llenan campos vacíos (teléfono, fuente); el nombre no se toca.
- **R5 — El envío reusa `sendTemplate()`**, contacto por contacto, sobre la
  conversación del contacto (creada si no existía, igual que "Escribir
  primero"). No hay otra llamada a Meta.
- **R6 — Nunca dos veces al mismo contacto por campaña.** Índice único
  `(campaign_id, contact_id)` y estado por fila; reanudar tras un reinicio
  solo toma los `pending`.
- **R7 — Sandbox.** Los contactos solo-Laboratorio quedan fuera del público;
  `sendTemplate` sigue lanzando si una conversación es de prueba.

## Decisiones (confirmadas por el dueño, 2026-09-24)

- **D1 — `opt_out` pegajoso** (R3).
- **D2 — Existentes: solo campos vacíos** (R4).
- **D3 — La importación NO crea leads** en el Pipeline por defecto; hay una
  casilla opcional para crearlos. Importar 500 contactos no debe llenar el
  tablero.
- **D4 — Campañas detrás de bandera** `CAMPAIGNS` (apagada, superficie en
  404, patrón ADR-001). Etiquetas, consentimiento e importar/exportar están
  siempre encendidos: no tocan la API de Meta.
- **D5 — Teléfono con código de país obligatorio**, la misma regla que el
  alta manual, y `normalizeMx` (521→52). Un número de 10 dígitos se rechaza
  con un mensaje explícito: sin lada no se sabe de qué país es y adivinar
  produce un número equivocado en silencio. (Afecta también a países cuyo
  número completo mide 10 dígitos, p. ej. Noruega o Singapur: raro para el
  público de Vocero y el error lo explica.)
- **D6 — Variables iguales para todos o el nombre de pila** del contacto
  (`{ kind: "contact_name" }`), que es lo que una promo necesita ("Hola
  {{1}}"). Per-contacto arbitrario queda fuera.

## Permisos (020)

| Permiso | Propietario | Coordinador | Asesor |
|---|:-:|:-:|:-:|
| `tags.manage` — crear/renombrar/borrar etiquetas | ✓ | ✓ | — |
| Etiquetar a un contacto que ve | ✓ | ✓ | ✓ |
| `contacts.import` | ✓ | ✓ | — |
| `contacts.export` (ya existía, sin ruta) | ✓ | ✓ | — |
| `campaigns.manage` | ✓ | ✓ | — |

Exportar lo tiene también el Coordinador (decisión del dueño, 2026-09-25):
importar y exportar la base es parte de la operación diaria. El Asesor no,
porque solo ve lo asignado a él y exportar es sacar la base entera.

## Límites y errores (todos con mensaje específico)

| Caso | Respuesta |
|---|---|
| Archivo > 5 MB | 413 `too_large` |
| > 10,000 filas | 413 `too_many_rows` |
| Excel (.xlsx) o extensión que no es CSV | 415 `not_csv`, con la instrucción |
| Falta `name`/`phone` | 422 `missing_columns`, nombrando las que encontró |
| Comilla sin cerrar | 422 `malformed`, con la línea |
| Fila: sin nombre, teléfono inválido / sin lada, repetido en el archivo, fuente o consentimiento irreconocible, etiqueta > 60 | la fila no entra; motivo por fila en el resumen y el CSV de errores |
| Codificación Windows-1252 (Excel en Windows) | se decodifica; los acentos se conservan |

## Envío (ritmo y fallos de Meta)

- Ritmo `CAMPAIGN_SEND_RATE` mensajes/segundo (default 10, máx. 80).
  Antes de 021 no existía ningún control de ritmo en `src/server/whatsapp`.
- **130429 / 80007 / 4** (throughput): pausa creciente (5 s → 2 min) y
  reintento al MISMO destinatario; si persiste, la campaña se detiene y los
  pendientes quedan pendientes.
- **Token vencido, plantilla rota (132xxx), número frenado por calidad
  (131048)**: la campaña se detiene (`failed`) con el motivo; no se "queman"
  los demás envíos.
- **131026 (sin WhatsApp), 131056, 131050…**: falla solo ese destinatario,
  con motivo legible.
- Meta caído (5xx): 3 reintentos y luego falla ese destinatario.

## Pendiente (fuera de alcance, anotado a propósito)

- **STOP/BAJA automático.** No existía manejo de palabras clave de opt-out en
  la ingesta y no se inventó aquí: el campo está listo para conectarlo
  (poner `wa_consent = 'opt_out'` desde `server/inbox/ingest.ts` al detectar
  la palabra). Mientras tanto, la baja se marca a mano.
- **Reenvío al reiniciar**: si el proceso muere DESPUÉS de que Meta aceptó un
  mensaje pero ANTES de marcarlo `sent`, al reanudar ese destinatario se
  reintenta (a lo más uno por reinicio). Evitarlo pediría un estado
  intermedio "en vuelo" con reconciliación contra los webhooks de estado.
- Programar una campaña para más tarde; cancelar una en curso.
- Header/botones de plantilla con parámetros (hoy las plantillas de Vocero
  solo tienen BODY).
