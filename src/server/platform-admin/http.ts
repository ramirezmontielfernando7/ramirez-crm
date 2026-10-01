import { apiError } from "@/lib/api";
import { logger } from "@/lib/log";
import { clientIp } from "@/lib/rate-limit";
import { currentPlatformAdmin, type PlatformAdmin } from "./admins";
import { PlatformError } from "./organizations";

const log = logger("platform");

/**
 * Fase 3, PR 2 — Envuelve una ruta de /api/platform/*: solo para un
 * administrador de plataforma. A cualquier otra persona (sin sesión, o con
 * sesión de cualquier rol de cualquier organización) le responde 404, como si
 * la ruta no existiera: no hay nada que revelar sobre ella.
 */
export function withPlatformAdmin<Args extends unknown[]>(
  handler: (admin: PlatformAdmin, ip: string, req: Request, ...args: Args) => Promise<Response>
): (req: Request, ...args: Args) => Promise<Response> {
  return async (req: Request, ...args: Args) => {
    const admin = await currentPlatformAdmin();
    if (!admin) return new Response(null, { status: 404 });
    try {
      return await handler(admin, clientIp(req.headers), req, ...args);
    } catch (err) {
      if (err instanceof PlatformError) return apiError(err.status, err.code, err.message);
      log.error("error no controlado en /api/platform", { err });
      return apiError(500, "internal", "Error interno");
    }
  };
}

export function actorOf(admin: PlatformAdmin): { userId: string; email: string } {
  return { userId: admin.userId, email: admin.email };
}
