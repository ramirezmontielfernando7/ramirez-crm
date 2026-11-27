# 048 — Plataforma para vender

Fase 5 del masterplan de lanzamiento (Fer, 2026-11-11; autonomía total el
2026-11-12). Plataforma ya encendía los 13 módulos, los 3 complementos
ocultos, los topes, los precios y los costos. Le faltaba lo que pide COBRAR y
CUIDAR a clientes reales, sin pasarela de pago todavía.

Una sola migración: `0078_plataforma_vender` (aditiva e idempotente; reversa
`scripts/sql/0078-reversa.sql`).

## Reglas de producto

1. **Prueba gratis con fecha de fin.** Desde la ficha de la empresa → «Cobro
   y prueba»: 14 o 7 días desde hoy, o una fecha. El cliente ve el aviso 3
   días antes. Al vencer se apagan la IA (agentes, creador, varita,
   documentos) y el ENVÍO de campañas, y sale una franja roja que no se
   cierra. La Bandeja sigue recibiendo y enviando mensajes de personas:
   nunca se pierde un chat.
2. **Cobro a mano mientras no hay pasarela.** «Pagado hasta», «Registrar
   pago» y días de gracia (5 por defecto, 0 a 60). Vencido el pago: aviso
   amarillo en los días de gracia; pasada la gracia, la misma suspensión
   SUAVE que la prueba terminada. La suspensión dura de siempre (Accesos y
   estado) no cambia.
3. **Extras con un clic** (con su efecto al guardar y su bitácora):
   mensualidad (alarga «pagado hasta» N meses de calendario), restablecer la
   IA del mes (suma otra bolsa completa SOLO este mes), persona extra (+N al
   tope), 50 GB extra, alta asistida y otro (solo bitácora). Precios
   sugeridos del doc de precios; se pueden cambiar al registrar.
4. **Sin fila de cobro = como hasta hoy.** Las empresas que ya existen no
   cambian. La organización de la plataforma nunca lleva prueba ni cobro.
5. **Semáforo de clientes** en la lista de Organizaciones: verde «Bien»,
   amarillo «Revisar», rojo «Llamar», con el porqué (WhatsApp sin conectar,
   sin uso en 7/14 días —ni mensajes ni entradas—, envíos fallidos en 7
   días, IA del mes al 80/100 %, agente sin encender, prueba o pago). Filtro
   «A quién llamar». Solo conteos y fechas, nunca contenido.
6. **Interruptores de emergencia** (Plataforma → Controles) para TODAS las
   empresas a la vez: IA, envío de campañas y envíos por conexión directa.
   Llegan a todos en ≤10 s. Ante una falla al leerlos, NO se frena nada.
7. **Aviso a todos los clientes**: una franja (novedad azul o aviso
   amarillo) que cada persona puede cerrar; uno vigente a la vez; se quita a
   mano o sola a las N horas.
8. **Pantalla de funciones** en «Plan y módulos»: cada interruptor dice si
   está «Incluido en su plan», es «Extra», está «Apagado (su plan lo trae)»
   o «No incluido», y de qué depende (el Laboratorio necesita al Agente). Un
   Personalizado se compara con su plan más parecido. Los complementos
   siguen aparte como «ocultos».
9. **Cambiar de plan con vista previa**: elegir un plan muestra qué se
   enciende, qué se apaga, cómo quedan personas y almacenamiento y que
   ningún dato se borra. Nada cambia hasta «Aplicar».
10. **Planes editables sin programar**: en «Planes y precios» cada plan
    tiene sus 13 casillas. Valen para altas nuevas y para «Cambiar de plan»;
    las empresas que ya tienen el plan no cambian solas. «Volver a los de
    fábrica» borra lo guardado.

## Datos (0078)

- `organization_billing` (RLS): `trial_ends_at`, `paid_until`, `grace_days`,
  `ai_bonus_usd` + `ai_bonus_month` (la IA extra vale solo en su mes),
  `note`. ÚNICA puerta `src/server/billing/store.ts`.
- `organization_payment` (RLS): bitácora de pagos y extras.
- `platform_kill_switch` y `platform_broadcast`: tablas de PLATAFORMA (solo
  pool de sistema). ÚNICA puerta `src/server/platform-controls/store.ts`.
- `platform_plan_catalog.modules` (jsonb): los 13 interruptores de cada plan
  (claves de `PLATFORM_MODULE_TOGGLES`); NULL = de fábrica.

## Dónde vive

- Reglas puras: `src/lib/billing.ts`, `src/lib/platform-health.ts`,
  `src/lib/platform-controls.ts`, `src/lib/platform-modules.ts`
  (`FACTORY_PLAN_PROFILES`, `mergePlanProfiles`, `featureMark`,
  `planChangeDiff`, `nearestPlan`).
- Frenos: al inicio de `chatJsonForOrg` y `embedForOrg` (`aiBlockedDetail`,
  responde como tope alcanzado: cada camino ya degrada a una persona);
  `launchCampaign`, reanudar y el despachador (`campaignsBlockedReason`,
  pausa con el motivo); `sendDirect` (interruptor `direct_send`; lo que ya
  estaba en la fila sigue).
- IA extra: `resolveAiChoice` y `orgUsdLimit` suman `getAiBonusUsd`;
  `orgBaseUsdLimit` es la bolsa sin extra (lo que cuesta «restablecer»).
- Plataforma: `src/server/platform-admin/billing.ts`, `health.ts`; rutas
  `GET/PUT /api/platform/organizations/[id]/billing`,
  `POST …/billing/payments`, `GET/PUT /api/platform/controls`; el semáforo
  viaja en `GET /api/platform/organizations`; la ficha recibe `planProfiles`
  y `planCaps` de `…/summary`; `PUT /api/platform/plans` acepta
  `{ scope, modules }`.
- Cliente: `GET /api/notices` (cualquier rol; el enlace de WhatsApp solo al
  Propietario) y `src/components/platform-notice-banner.tsx` en
  `app-shell.tsx`.
- UI de Plataforma: pestaña «Cobro y prueba» (`billing-section.tsx`),
  «Controles» (`controls-client.tsx`), semáforo en `organizations-client.tsx`,
  funciones y vista previa en `organization-detail.tsx`, módulos por plan en
  `plan-catalog-client.tsx`.

## Fuera de este cambio

- Cobro automático (Stripe / Mercado Pago): con 5 o más clientes.
- «Uso y plan» del Propietario sigue diciendo qué plan trae cada módulo con
  los de fábrica.
- Los mensajes que ya estaban en la fila de la conexión directa salen aunque
  se apague el interruptor (la fila dura segundos o minutos).
