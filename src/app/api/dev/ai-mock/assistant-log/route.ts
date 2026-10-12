import { mockGuard } from "@/lib/dev-guard";
import { assistantMockLog } from "@/server/dev/ai-mock";

export const dynamic = "force-dynamic";

/** 038 (PR 2) — Los prompts que recibió el mock del asistente (para comprobar el enmascarado). */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json({ prompts: assistantMockLog().prompts });
}

export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  assistantMockLog().prompts.length = 0;
  return Response.json({ ok: true });
}
