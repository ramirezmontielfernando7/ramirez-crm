import { testServer } from "@/server/platform-admin/direct-servers";
import { withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Conexión directa (PR 2) — Probar un servidor: ¿responde y acepta la llave? Nunca devuelve la llave. */
export const POST = withPlatformAdmin(async (_admin, _ip, _req, { params }: Params) => {
  const { id } = await params;
  return Response.json(await testServer(id));
});
