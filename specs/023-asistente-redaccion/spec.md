# 023 — Asistente de redacción en el editor de mensajes

**Estado:** implementado · guion E2E [`tests/e2e/us-redaccion.md`](../../tests/e2e/us-redaccion.md)
(`pnpm test:e2e:redaccion`) · carril **ligero** (sin modelo de datos ni
contrato publicado).

## Problema

El asesor escribe rápido y con prisa: faltas, frases largas o un tono que no
va con el cliente. Quiere pulir su borrador ANTES de enviarlo, sin salir de
la Bandeja.

## Qué NO es

No es el agente de IA (`src/server/ai/`): no lee la conversación, no responde
al cliente, no mueve el pipeline ni traspasa. Solo reescribe el texto que el
asesor le da y lo devuelve al editor; enviar sigue siendo decisión humana.
Comparte con el agente únicamente el adaptador (`chatJson` de `src/lib/ai`) y
la configuración `OPENROUTER_*` — sin integración nueva. Un test vigila que
`src/server/writing-assist/` no importe nada del agente.

## Historias

1. **La varita.** Junto al clip del editor hay un botón de IA
   (`WandSparkles`). Con el editor vacío está deshabilitado ("Escribe algo
   primero"); sin IA configurada, deshabilitado ("IA no configurada").
2. **El menú.** Con texto, abre: Mejorar redacción · Cambiar tono ▸ (Formal,
   Casual, Empático) · Resumir · Hacer más corto · Hacer más largo.
3. **Carga.** Mientras la IA trabaja: spinner en la varita, el editor en solo
   lectura (atenuado), "La IA está reescribiendo…" y Enviar bloqueado (también
   con Enter).
4. **Resultado.** El texto del editor se REEMPLAZA y aparece "Texto reescrito
   con IA · Deshacer"; Deshacer devuelve el borrador original. Si el asesor
   retoca el resultado, Deshacer desaparece.
5. **Fallo.** Error visible bajo el editor y el texto original intacto. Nunca
   se pierde lo escrito.
6. **Permisos.** Todos los roles (Asesor, Coordinador, Propietario).

## Diseño

- `POST /api/writing-assist` `{ action, tone?, text }` → `{ text }`.
  - `action`: `improve | tone | summarize | shorten | lengthen`;
    `tone` (`formal | casual | empatico`) obligatorio si `action = tone`;
    `text` 1–4000 caracteres. Inválido → 422.
  - Sin IA → 503 `not_configured` (sin llamar al proveedor). Proveedor caído
    o salida inválida tras los reintentos de `chatJson` → 502 con mensaje.
  - 30 peticiones/min por usuario (in-process) → 429.
  - El borrador no se guarda ni se loguea.
- `GET /api/writing-assist` → `{ available }` para habilitar la varita.
- Prompt en `src/server/writing-assist/prompts.ts`: conserva el idioma, no
  inventa datos, sin saludos ni comentarios, responde `{"text": …}`.
- Mock determinista en `src/server/dev/ai-mock.ts` (marca
  `[VOCERO-ASISTENTE-REDACCION]`); `FALLA-IA` en el borrador simula un modelo
  sin JSON.

## Fuera de alcance

Streaming del resultado, historial de varias versiones, idioma de destino
(traducir).
