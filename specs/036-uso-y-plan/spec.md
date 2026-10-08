# 036 — Uso y plan (Plataforma reorganizada + panel de consumo del Propietario)

Estado: PR 1 implementado (consumo por agente). PR 2–6 pendientes; cada uno
arranca solo cuando el dueño lo indica, y solo hay una migración en curso a la
vez (el número se asigna al implementar, leyendo `drizzle/` en `main`).

## Objetivo

1. **Plataforma** (administrador de plataforma) con dos pestañas:
   - «Mi panel»: resumen personal (organizaciones por estado, IA del mes vs.
     lo asignado, almacenamiento total aprox., cerca del tope, más consumo,
     bitácora reciente). Solo metadatos.
   - «Organizaciones»: lista minimalista. Fila cerrada: nombre, plan, IA
     (asignado vs. consumido), almacenamiento (aprox.), módulos activos
     (x/12). Fila desplegada: plan, límites, módulos, consumo del mes,
     personas y estado.
2. **«Uso y plan»** del Propietario (permiso `usage.read`, SOLO Propietario),
   desde el menú de la cuenta abajo en la barra lateral (sin módulo nuevo):
   consumo de IA, almacenamiento y documentos contra sus límites; qué función
   consume más (agente, Laboratorio y vista previa, juez, redacción;
   embeddings aparte) y qué agente.
3. **Plan**: campo «Plan» = «Personalizado» (`plan_key = 'custom'`), diseñado
   para que después entren planes base con ajustes manuales encima.

## Decisiones del dueño

- «Uso y plan» solo para el Propietario.
- Los 12 interruptores actuales de /platform son la base del «x/12»
  (incluido «Menú personalizable»).
- Almacenamiento: interruptor por organización con dos modos — «Solo avisar»
  (por defecto) y «Bloquear subidas manuales» (rechaza subidas desde el CRM:
  documentos del RAG, archivos de Conocimientos, adjuntos del chat de
  equipo). La multimedia ENTRANTE de WhatsApp se recibe y guarda SIEMPRE.
- La organización de plataforma, sin tope por defecto.
- Bajar un límite por debajo del uso actual solo impide crecer.
- La pantalla dice «Almacenamiento (aprox.)» con nota de qué incluye.

## PRs

| PR | Contenido | Migración |
|---|---|---|
| 1 | Consumo de IA por agente (`ai_usage_agent`) | Sí — `0042_consumo_por_agente` |
| 2 | Medición de almacenamiento (`src/server/usage/storage.ts`) | No |
| 3 | Límites y plan (`organization_plan`, puerta `src/server/limits/`, modo de almacenamiento) | Sí (número al implementar) |
| 4 | Plataforma con pestañas: «Organizaciones» | No |
| 5 | Plataforma: «Mi panel» | No |
| 6 | «Uso y plan» del Propietario | No |

## PR 1 — Consumo por agente (hecho)

- Tabla `ai_usage_agent` (organización, mes UTC, agente, tipo ∈ {agent, lab,
  judge}; turnos y tokens). FK compuesta a `agent` (CASCADE), RLS forzado.
  Solo reporta: los topes siguen contra la fila `total` de `ai_usage`.
- `chatJsonForOrg(org, kind, schema, msgs, { agentId })`: tras contar el
  turno, lo anota también al agente. El `agentId` no viaja al proveedor. Solo
  turnos que se reservaron; el turno cuenta aunque el proveedor falle (igual
  que `ai_usage`). Un fallo al anotar se registra y el turno sigue.
- Quién pasa el agente: el turno real (`DecideInput.agentId`, el agente que
  resolvió `loadTurnContext`, incluido el de la etapa), las conversaciones del
  Laboratorio, la vista previa (el agente que se edita) y el juez (el agente
  del snapshot evaluado). La redacción y los embeddings: «sin agente».
- Sin relleno retroactivo: el desglose existe desde el despliegue.
- Lectura: `getAgentUsage(org)` (la usarán los PR 4 y 6).
