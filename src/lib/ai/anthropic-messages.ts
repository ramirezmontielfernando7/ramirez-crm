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

type Turn = { role: "user" | "assistant"; content: string };

/**
 * Chat Completions → Messages. Todos los `system` (el inicial, la cola del
 * pipeline y el STRICT de los reintentos) van juntos al `system` de arriba:
 * Messages no los acepta dentro de `messages`. Turnos seguidos del mismo rol
 * se unen; si la plática empieza con el agente se antepone un turno del
 * cliente, y si termina con el agente se agrega uno: estos modelos rechazan
 * (400) un último turno `assistant`.
 */
export function toMessagesBody(model: string, messages: ChatMessage[], effort: "low" | "medium") {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const turns: Turn[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === m.role) prev.content += `\n\n${m.content}`;
    else turns.push({ role: m.role, content: m.content });
  }
  if (turns[0]?.role !== "user") turns.unshift({ role: "user", content: "(inicio de la conversación)" });
  if (turns[turns.length - 1]?.role === "assistant") turns.push({ role: "user", content: "(continúa)" });
  return {
    model,
    max_tokens: MAX_TOKENS,
    ...(system ? { system } : {}),
    messages: turns,
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
 * (`thinking`) se ignoran; una negativa del modelo (`refusal`) o una respuesta
 * sin texto lanzan error, igual que una respuesta vacía de Chat Completions.
 * La entrada cuenta también los tokens de caché. Bedrock no reporta costo.
 */
export function fromMessagesResponse(json: MessagesResponse): { content: string; usage: LlmUsage } {
  if (json.stop_reason === "refusal") throw new Error("el modelo se negó a responder (refusal)");
  const content = (json.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("");
  if (content.length === 0) throw new Error("respuesta del proveedor sin contenido");
  const u = json.usage;
  return {
    content,
    usage: {
      promptTokens: count(u?.input_tokens) + count(u?.cache_creation_input_tokens) + count(u?.cache_read_input_tokens),
      completionTokens: count(u?.output_tokens),
    },
  };
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}
