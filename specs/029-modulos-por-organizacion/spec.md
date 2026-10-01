# 029 — Módulos por organización (Fase 3 multitenant, PR 3)

Las banderas de despliegue `CAMPAIGNS`, `AGENDA`, `ATRIBUCION` y `CHANNELS`
(H15) eran para TODA la instancia. Con varias organizaciones, cada una tiene
los suyos y los decide el administrador de plataforma. Las variables quedan
como valor por defecto.

## Historias

1. **Mi organización no cambia.** Al desplegar, cada organización sin fila en
   `organization_module` recibe, al arrancar, lo que las variables tienen
   encendido hoy (`backfillOrgModules`, idempotente, nunca pisa una fila).
   Mientras tanto, sin fila, valen las variables: entre migrar y arrancar no
   cambia nada.
2. **Organizaciones nuevas.** El alta (desde /platform o el primer registro)
   siembra los módulos de las variables.
3. **El administrador de plataforma** enciende o apaga, por organización:
   Campañas, Agenda, Atribución, Instagram y Messenger, y el ritmo de las
   campañas (1–80 mensajes/s; vacío = `CAMPAIGN_SEND_RATE` o 10). Cada cambio
   va a la bitácora con el antes y el después. Una usuaria común → 404.
4. **Un módulo apagado no existe para esa organización**, aunque otra lo
   tenga: sus rutas y pantallas responden 404 en el servidor (403 si además
   falta el permiso, que se valida antes) y su menú no lo muestra.
   - Agenda: también el bloque de citas del agente, del contexto del cerebro
     externo (`/api/bot/*`, que ahora valida la llave antes que la agenda) y
     de Resultados.
   - Atribución: el `ctwa_clid` no se guarda y no se le reporta nada a Meta;
     el origen del anuncio se sigue viendo (spec 018).
   - Campañas: no se reanudan al arrancar y una campaña enviando se detiene
     si se apaga a la mitad.
   - Instagram / Messenger: no se envía por ese canal. Las URLs de webhook
     son de la plataforma: existen si ALGUNA organización tiene el canal; el
     evento, ya enrutado, se ignora con aviso si su organización lo tiene
     apagado.
5. **`organization.parent_id`** opcional (FK a sí misma, `RESTRICT`, no puede
   apuntar a sí misma) para la futura reventa por agencias. Nada lo usa; la
   purga se niega con hijas.

## Diseño

- `src/server/modules/`: `defaults.ts` (único lector de las variables; test
  de vigilancia `tests/unit/modules-guard.test.ts`), `store.ts` (lectura con
  el pool de sistema y caché de 5 s por proceso, relleno, alta, edición),
  `index.ts` (preguntas de una línea).
- Las funciones de siempre (`agendaEnabled`, `campaignsEnabled`,
  `atribucionEnabled`, `isChannelEnabled`, `enabledChannels`,
  `campaignSendRate`) piden ahora la organización y son asíncronas: el
  compilador encontró cada lector.

## Datos (0030, aditiva e idempotente)

- `organization_module` (dominio, RLS forzado): `organization_id` PK,
  `campaigns`, `agenda`, `atribucion`, `channels text[]` (solo instagram y
  messenger), `campaign_send_rate` (1–80 o nulo), `updated_at`, `updated_by`.
- `organization.parent_id` + índice + checks.
- Reversa sin migración nueva: `scripts/sql/0030-reversa.sql`.
