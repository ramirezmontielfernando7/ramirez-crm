# 021 — Plan técnico

## Modelo de datos (migración `0016_etiquetas_consentimiento_campanas`)

Aditiva y re-ejecutable (IF NOT EXISTS + bloques DO en las FK, como 0015).
Verificada contra una BD de prueba con contactos existentes antes de tocar
producción: quedan en `desconocido`; re-aplicarla no da error.

| Tabla | Columnas | Llaves |
|---|---|---|
| `contact` (+3) | `wa_consent` text `opt_in/opt_out/desconocido` NOT NULL DEFAULT `desconocido` · `wa_consent_source` text · `wa_consent_at` timestamp | índice `(organization_id, wa_consent)` |
| `contact_tag` | `id` (`tag_`), `organization_id`, `name`, `color` (clave de paleta), `created_at` | UNIQUE `(organization_id, name)` |
| `contact_tag_assignment` | `organization_id`, `contact_id`, `tag_id`, `created_at` | PK `(contact_id, tag_id)` · cascada en contacto y etiqueta · índice `(organization_id, tag_id)` |
| `campaign` | `id` (`cmp_`), `organization_id`, `template_id` (FK **restrict**), `name`, `variables` jsonb, `audience` jsonb, `created_by` (set null), `status` `draft/sending/completed/failed`, `total`, `error`, `created_at`, `started_at`, `finished_at` | índices `(organization_id, created_at)`, `(status)` |
| `campaign_recipient` | `id` (`cmr_`), `organization_id`, `campaign_id` (cascade), `contact_id` (set null), `contact_name`, `phone` (copias para auditoría), `status` `pending/sent/failed`, `message_id`, `error_message`, `sent_at`, `created_at` | UNIQUE `(campaign_id, contact_id)` · índice `(campaign_id, status)` |

`restrict` en la plantilla: una plantilla con campañas no se borra y deja un
registro de auditoría que ya no dice qué se mandó.

## API

| Ruta | Permiso | Notas |
|---|---|---|
| `GET /api/contact-tags` | sesión | con `contactCount` |
| `POST /api/contact-tags` · `PATCH/DELETE /api/contact-tags/[id]` | `tags.manage` | 409 duplicada |
| `PUT /api/contacts/[id]/tags` | ver el contacto (`scopedContacts`) | reemplaza la lista |
| `PATCH /api/contacts/[id]` | ver el contacto | + `waConsent`, `waConsentSource` |
| `GET /api/contacts?tag=&source=&consent=` | ver (filtrado) | filtros nuevos |
| `POST /api/contacts/import` (multipart `file`, `tagName?`, `createLeads?`) | `contacts.import` | resumen con detalle |
| `GET /api/contacts/export?…mismos filtros` | `contacts.export` | CSV, BOM, anti-fórmulas |
| `GET/POST /api/campaigns` | `campaigns.manage` + bandera | POST crea borrador |
| `POST /api/campaigns/preview` | ídem | elegibles / sin consentimiento |
| `GET/DELETE /api/campaigns/[id]` | ídem | DELETE solo borradores |
| `POST /api/campaigns/[id]/send` | ídem | 202; 409 si ya se lanzó |
| `GET /api/campaigns/[id]/recipients?status=&format=csv` | ídem | log de auditoría |

SSE: `campaign.progress { campaignId, status, counts }`, solo a quien ve todo.

## Módulos

- `src/lib/csv.ts` — parser/serializador sin dependencias.
- `src/lib/tags.ts` — paleta, consentimiento (contrato compartido).
- `src/lib/campaigns.ts` — DTOs, variables por destinatario.
- `src/lib/fetch-json.ts` — fetch de UI que siempre devuelve el error.
- `src/server/contact-filter.ts` — EL filtro (lista, export y público).
- `src/server/tags/tags.ts` — etiquetas.
- `src/server/contacts-io/{validate,import}.ts` — validación pura + BD.
- `src/server/campaigns/{flag,audience,service,runner,http}.ts`.
- `SendError.metaCode` (aditivo) para distinguir un límite de ritmo.

## Ejecución en segundo plano

In-process, como el Laboratorio (sin colas: Constitución II). Registro en
`globalThis` para no correr dos ejecutores de la misma campaña; el paso
`draft → sending` es condicional en BD (doble clic → 409). Al arrancar,
`instrumentation.ts` reanuda las campañas en `sending` (solo si la bandera
está encendida).

## Pruebas

- Unit: `csv`, `contacts-import`, `campaigns` (R1 inspeccionando el SQL,
  clasificación de errores de Meta, variables, bandera), matriz de permisos y
  tabla de rutas.
- E2E: `scripts/e2e-campanas.mjs` (60 verificaciones). El wa-mock simula
  131026 (número terminado en `00000`) y 130429 una vez (`42900`).
  `CAMPAIGN_BACKOFF_SCALE` acorta las pausas en pruebas.
