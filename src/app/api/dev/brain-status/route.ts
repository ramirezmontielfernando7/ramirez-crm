import { mockGuard } from "@/lib/dev-guard";
import { resetBrainStatusState } from "@/server/bot/status";

export const dynamic = "force-dynamic";

/**
 * Solo con los mocks: olvida lo que el proceso recuerda del cerebro externo
 * (última llamada por organización y caché de su /health), como si el
 * servidor acabara de arrancar. Lo usan los guiones E2E que comparten un
 * mismo `next start` y presuponen «sin cerebro externo visto».
 */
export async function DELETE() {
  const guard = mockGuard();
  if (guard) return guard;
  resetBrainStatusState();
  return Response.json({ cleared: true });
}
