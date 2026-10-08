import { mockGuard } from "@/lib/dev-guard";
import { embedMockStats, embeddingsMock } from "@/server/dev/embeddings-mock";

export const dynamic = "force-dynamic";

/** 035 — Mock de `/v1/embeddings` (TEI/OpenAI-compatible). Solo con el gate de mocks. */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = (await req.json().catch(() => ({}))) as { model?: unknown; input?: unknown };
  const r = embeddingsMock(body);
  return Response.json(r.json, { status: r.status });
}

/** Cuántas llamadas recibió y con qué prefijo (lo lee el E2E). */
export async function GET() {
  const guard = mockGuard();
  if (guard) return guard;
  return Response.json(embedMockStats());
}
