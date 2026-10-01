import { mockGuard } from "@/lib/dev-guard";
import { aiMockCompletion } from "@/server/dev/ai-mock";

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
  return Response.json({
    id: "aimock",
    choices: [{ index: 0, message: { role: "assistant", content } }],
    usage: {
      prompt_tokens: Math.ceil(promptChars / 4),
      completion_tokens: Math.ceil(content.length / 4),
      total_tokens: Math.ceil(promptChars / 4) + Math.ceil(content.length / 4),
    },
  });
}
