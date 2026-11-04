import type { ChatMessage, LlmUsage } from "@/lib/ai";

/**
 * Formato «Messages» de Anthropic para Claude en Amazon Bedrock. Claude 5.5 en
 * Bedrock NO acepta Chat Completions, solo Messages / Converse / Invoke, en
 * `{OPENROUTER_BASE_URL}/anthropic/v1/messages` con la llave de Bedrock en
 * `x-api-key`. Se elige SOLO por el nombre del modelo (`global.anthropic.claude-…`,
 * `us.anthropic.claude-…`, `anthropic.claude-…`): los nombres de OpenRouter
 * (`anthropic/claude-…`, con diagonal) y los de OpenAI siguen por Chat
 * Completions como siempre. Aquí solo hay funciones puras; el `fetch` vive en
 * `index.ts` (única frontera con el proveedor).
 */

export const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 8192;

export function isBedrockClaudeModel(model: string): boolean {
  return /^(?:[a-z]{2,6}\.)?anthropic\.claude-/i.test(model.trim());
}

export function messagesUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/anthropic/v1/messages`;
}

type Turn = { role: "user" | "assistant"; content: string; cache?: boolean };
type TextBlock = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };
const EPHEMERAL = { type: "ephemeral" } as const;

/**
 * Chat Completions → Messages. Todos los `system` (el inicial, la cola del
 * pipeline y el STRICT de los reintentos) van juntos al `system` de arriba:
 * Messages no los acepta dentro de `messages`. Turnos seguidos del mismo rol
 * se unen; si la plática empieza con el agente se antepone un turno del
 * cliente, y si termina con el agente se agrega uno: estos modelos rechazan
 * (400) un último turno `assistant`.
 */
export function toMessagesBody(model: string, messages: ChatMessage[], effort: "low" | "medium" | "high") {
  const joined = (list: ChatMessage[]) => list.map((m) => m.content).join("\n\n");
  const systems = messages.filter((m) => m.role === "system");
  const cachedSystem = systems.filter((m) => m.cache);
  // Caché de prompts: lo marcado `cache` va primero y es un bloque aparte con
  // punto de caché (prefijo estable); el resto (cola, STRICT, código del
  // turno) va después, sin caché. Sin nada marcado, el texto de siempre.
  const system: string | TextBlock[] =
    cachedSystem.length === 0
      ? joined(systems)
      : [
          { type: "text", text: joined(cachedSystem), cache_control: EPHEMERAL },
          ...(systems.length > cachedSystem.length ? [{ type: "text" as const, text: joined(systems.filter((m) => !m.cache)) }] : []),
        ];
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === m.role) {
      prev.content += `\n\n${m.content}`;
      if (m.cache) prev.cache = true;
    } else turns.push({ role: m.role, content: m.content, ...(m.cache ? { cache: true } : {}) });
  }
  if (turns[0]?.role !== "user") turns.unshift({ role: "user", content: "(inicio de la conversación)" });
  if (turns[turns.length - 1]?.role === "assistant") turns.push({ role: "user", content: "(continúa)" });
  // Un solo punto de caché en la conversación: el ÚLTIMO turno marcado (máx. 4 en total).
  const lastCached = turns.map((t) => !!t.cache).lastIndexOf(true);
  return {
    model,
    max_tokens: MAX_TOKENS,
    ...(system.length > 0 ? { system } : {}),
    messages: turns.map((t, i) =>
      i === lastCached
        ? { role: t.role, content: [{ type: "text" as const, text: t.content, cache_control: EPHEMERAL }] }
        : { role: t.role, content: t.content }
    ),
    output_config: { effort },
  };
}

type MessagesResponse = {
  id?: unknown;
  content?: { type?: unknown; text?: unknown }[];
  stop_reason?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_creation_input_tokens?: unknown;
    cache_read_input_tokens?: unknown;
  };
};

/**
 * Texto y tokens de una respuesta Messages. Los bloques de razonamiento
 * (`thinking`) se ignoran; las negativas y respuestas sin texto conservan
 * su consumo para que la frontera común decida si corresponde reintentar.
 * La entrada cuenta también los tokens de caché (y se desglosan aparte para
 * estimar el costo: leer de la caché cuesta ~10 %, escribirla ~125 %).
 * Bedrock no reporta costo.
 */
export function fromMessagesResponse(json: MessagesResponse): { content: string; usage: LlmUsage; refusal?: boolean } {
  const content = (json.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  const u = json.usage;
  const cacheRead = count(u?.cache_read_input_tokens);
  const cacheWrite = count(u?.cache_creation_input_tokens);
  return {
    content,
    ...(json.stop_reason === "refusal" ? { refusal: true } : {}),
    usage: {
      promptTokens: count(u?.input_tokens) + count(u?.cache_creation_input_tokens) + count(u?.cache_read_input_tokens),
      completionTokens: count(u?.output_tokens),
      ...(cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
      ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
    },
  };
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
