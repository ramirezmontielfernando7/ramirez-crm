/**
 * Modelos de OpenAI dentro de Amazon Bedrock (GPT-6 Luna, GPT-6.1 Terra y
 * Sol…). Se eligen SOLO por el nombre del modelo, igual que Claude:
 * `global.openai.gpt-…`, `us.openai.gpt-…`, `openai.gpt-oss-…`. Van por
 * Chat Completions con la MISMA llave de Bedrock (Bearer):
 *
 * - `bedrock-runtime.<región>.amazonaws.com` → `/openai/v1/chat/completions`
 *   (el mismo OPENROUTER_BASE_URL que ya usa Claude, así se mezclan).
 * - `bedrock-mantle.<región>.api.aws` (o cualquier otro) → `/v1/chat/completions`.
 *
 * Funciones puras; el `fetch` vive en `index.ts`.
 */

export function isBedrockOpenAiModel(model: string): boolean {
  return /^(?:[a-z]{2,6}\.)?openai\.[a-z0-9]/i.test(model.trim());
}

export function bedrockOpenAiUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  let host = "";
  try {
    host = new URL(base).host.toLowerCase();
  } catch {
    host = "";
  }
  return /^bedrock-runtime\./.test(host) ? `${base}/openai/v1/chat/completions` : `${base}/v1/chat/completions`;
}
