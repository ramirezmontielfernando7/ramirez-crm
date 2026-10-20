# 042 — Interruptores de los agentes de IA

Freno de emergencia para el Estudio de IA: apagar un agente o TODOS sin borrar
su configuración (p. ej. durante una campaña masiva).

## Reglas

- Dos interruptores: **general** (`agent_profile.paused_at`) y **por agente**
  (`agent.paused_at`). NO NULL = pausado. Son aparte de `agent_profile.enabled`
  (el encendido de siempre, que sigue callando como siempre).
- Pausado → el chat real que el agente iba a atender **pasa a atención humana**:
  `applyHandoff(…, "pausa")`, igual que cualquier traspaso (aviso al asignado y
  a quien ve todo, línea de tiempo `ai_handoff`). No responde, ni siquiera el
  aviso del patrón de respaldo; no gasta IA; no toca asignación, etapa ni no
  leídos. Las conversaciones del Laboratorio (`isTest`) no se pausan.
- Reanudar solo quita la marca: los chats que ya pasaron a una persona se
  quedan con ella (como todo handoff); los nuevos vuelven al agente.
- Permiso: `agent.manage` (Propietario) en las tres rutas. Ampliarlo al
  Coordinador pide un permiso nuevo y un lugar para el interruptor, porque hoy
  no puede abrir el Estudio de IA (decisión pendiente del dueño).
- Aviso rojo («Los agentes de IA están en pausa») arriba del Estudio de IA y de
  `/agent` mientras el general esté pausado; con la pausa general, los
  interruptores por agente quedan bloqueados.

## Dónde vive

- Regla pura: `src/lib/agent-pause.ts` · decisión: `loadTurnContext` en
  `src/server/ai/pipeline.ts` (`paused_handoff`, ANTES del patrón de respaldo)
  con el estado en `ResolvedAgent.pause` (`resolve.ts`).
- Única puerta de escritura: `setOrgPaused` / `setAgentPaused` en
  `src/server/agents/store.ts`.
- Rutas: `GET/PUT /api/agent/pause` (módulo `agent`),
  `PUT /api/lab/agents/[id]/pause` (módulos `lab` + `agent`).
- UI: `components/lab/agent-pause-bar.tsx` (barra + aviso) e interruptor por
  fila en `agents-list.tsx`.
- Migración `0052_agentes_pausa` (aditiva, idempotente).
- Pruebas: `tests/unit/agent-pause.test.ts`, `tests/db/agente-pausa.test.ts`,
  `scripts/e2e-pausa-agentes.mjs`.

## Fuera de alcance / pendiente

- El punto de IA de la fila de la Bandeja (`agentOn` en `queries.ts`) sigue
  leyendo solo `agent_profile.enabled`: no refleja la pausa hasta que alguien
  lo agregue (otra sesión trabaja esa pantalla).
- El cerebro externo (`/api/bot/*`) no es un agente de esta tabla: la pausa no
  lo detiene (`brain-status` sí deja de decir que el agente incluido contesta).
