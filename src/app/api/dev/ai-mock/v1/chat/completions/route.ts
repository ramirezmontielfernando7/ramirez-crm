import { mockGuard } from "@/lib/dev-guard";
import { aiMockCompletion, aiMockCost } from "@/server/dev/ai-mock";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;

  const body = (await req.json().catch(() => ({}))) as {
    messages?: { role: string; content: string }[];
  };
  const messages = body.messages ?? [];
  const content = aiMockCompletion(messages);
  // Fase 3: `usage` con la forma de OpenRouter (~4 caracteres por token), para
  // que la cuota por organización se pruebe de punta a punta.
  const promptChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  const prompt = Math.ceil(promptChars / 4);
  const completion = Math.ceil(content.length / 4);
  return Response.json({
    id: `gen-aimock-${Date.now()}`,
    choices: [{ index: 0, message: { role: "assistant", content } }],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
      // 036 (PR 3b): el costo real como lo manda OpenRouter (créditos = USD),
      // a precio fijo de prueba ($3 / $15 por millón de tokens).
      cost: aiMockCost(prompt, completion),
    },
  });
}
