# 027 — Credenciales y webhooks endurecidos (Fase 3 multitenant, PR 1)

**Estado:** implementado · guion E2E [`tests/e2e/us-credenciales.md`](../../tests/e2e/us-credenciales.md)
(`pnpm test:e2e:credenciales`) · migración `0028_credenciales_y_webhooks.sql` ·
reversa `scripts/sql/0028-reversa.sql` · operación: [docs/credenciales.md](../../docs/credenciales.md).

Es la parte de la Fase 2 del [diagnóstico](../../docs/diagnostico-multitenant.md)
que no depende de Meta (Embedded Signup queda para después), hecha antes del
alta de organizaciones (PR 2) porque hoy no hay credenciales de clientes:
rotar la llave es barato.

## Historias

1. **Puerta única de credenciales.** `getOrgCredentials(orgId, tipo)`
   (`src/server/credentials/`) para WhatsApp, Instagram, Messenger, CAPI,
   Zoom y Google. Lee con el pool de la app a nombre de la organización
   (RLS), descifra con la llave de la versión de cada fila y devuelve errores
   tipados: `not_connected`, `reconnect_required` (con `requireUsable`),
   `decrypt_failed`, `key_unavailable`. Pedir las de otra organización
   desde el trabajo de una lanza. El enrutamiento inverso (número/WABA/
   página/cuenta → organización) está aparte (`resolve.ts`), con el pool de
   sistema y sin descifrar tokens. Guardarraíl:
   `tests/unit/credentials-gate.test.ts` (nadie más importa `lib/crypto`).
2. **Llave versionada y rotación.** `key_version` en toda fila cifrada.
   `ENCRYPTION_KEY` + `ENCRYPTION_KEY_VERSION` (la actual) y, solo durante la
   rotación, `ENCRYPTION_KEY_OLD` + `ENCRYPTION_KEY_OLD_VERSION`. Al
   arrancar (`maintenance.ts`, candado de Postgres) se re-cifra fila por fila
   con verificación; solo conteos al log. El operador no vuelve a pegar
   ninguna credencial.
3. **H8.** `whatsapp_business_account`: `waba_id` único en la instancia y
   `meta_credentials` con FK compuesta `(organization_id, waba_id)`. Los
   eventos de plantillas se enrutan por ahí: ya no hay "la primera
   organización con ese WABA". IDs de Meta: solo dígitos (con los mocks se
   aceptan ids simples de prueba).
4. **H25.** Al guardar a mano: `GET {waba}/phone_numbers` (paginado) con el
   mismo token; si el número no es de esa WABA → 422 `phone_not_in_waba`;
   sin permiso → 422 `missing_permission`. Si el número o la WABA ya son de
   otra organización → 409 `phone_in_use` / `waba_in_use` (también si la
   carrera la frena la BD: 23505/23503), nunca un 500. Se pregunta después de
   que Meta aceptó el token.
5. **`webhook_unrouted`** (tabla de plataforma): eventos FIRMADOS de un
   número, WABA, perfil de IG o página que nadie conectó. Payload cifrado,
   huella con llave para no duplicar reintentos, tope de 5000 filas, 7 días
   (limpieza al arrancar y cada hora). `vocero_app` no tiene permisos sobre
   ella. Sin pantalla ni reprocesamiento (decisión del dueño).
6. **Firmas.** Instagram y Messenger de Meta: firma obligatoria como en
   WhatsApp (`checkMetaSignature`; sin `META_APP_SECRET` → 401, salvo mocks).
   Zernio: una cuenta sin secreto → 401 (antes se aceptaba). El secreto de
   Zernio se guarda cifrado (el arranque cifra el que estaba en claro) y es
   obligatorio en Ajustes (vacío = conservar el guardado).
7. **Cuota de IA por organización.** `ai_quota` (topes propios) + defaults
   `AI_DEFAULT_MONTHLY_TURNS/TOKENS` (vacíos = sin tope). Mes calendario
   UTC. Reserva atómica del turno ANTES de llamar al modelo
   (`chatJsonForOrg`, única puerta: `tests/unit/ai-quota-gate.test.ts`);
   tokens de `usage` después. Agotada: el agente pasa a una persona (motivo
   `cuota`), el Laboratorio se calla, el asistente de redacción responde 429.
   Operador: `scripts/ai-quota.mjs show|set`.

## Datos (0028, aditiva e idempotente)

Columnas `key_version` (6 tablas) y `webhook_secret_cipher/iv/tag`
(Instagram, Messenger). Tablas: `whatsapp_business_account`, `ai_quota`,
`ai_usage` (dominio, RLS forzado) y `webhook_unrouted` (plataforma).

## Fuera de alcance

Embedded Signup, varios números por organización (el esquema lo admite),
llave de IA propia por organización, pantalla de `webhook_unrouted`,
reprocesar eventos, alta de organizaciones y /platform (PR 2).
