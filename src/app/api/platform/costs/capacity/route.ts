import { getCapacityLines } from "@/server/costs/capacity";
import { withPlatformAdmin } from "@/server/platform-admin/http";

export const dynamic = "force-dynamic";

/** Topes de IA por organización para la calculadora de costo máximo. Solo números. */
export const GET = withPlatformAdmin(async () => {
  return Response.json({ organizations: await getCapacityLines() });
});
