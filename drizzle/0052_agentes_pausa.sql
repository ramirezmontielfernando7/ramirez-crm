-- 042 — Interruptores de los agentes de IA (freno de emergencia).
--
-- `agent_profile.paused_at`: pausa GENERAL de la organización. No NULL = todos
-- los agentes en pausa; sus chats pasan a atención humana (handoff 'pausa').
-- Es aparte de `agent_profile.enabled` (el encendido de siempre): pausar no
-- apaga ni borra nada, y reanudar deja todo como estaba.
-- `agent.paused_at`: el interruptor de UN agente (NULL = activo).
-- `paused_by`: quién lo movió (texto, sin FK: la bitácora no debe depender de
-- que la persona siga existiendo).
--
-- Solo aditiva: los agentes existentes quedan activos (NULL) y el código
-- anterior ignora las columnas. Las tablas ya tienen RLS: no hace falta
-- política nueva. Idempotente: re-ejecutable.
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN IF NOT EXISTS "paused_by" text;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "paused_at" timestamp;--> statement-breakpoint
ALTER TABLE "agent_profile" ADD COLUMN IF NOT EXISTS "paused_by" text;
