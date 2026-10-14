import { isMockEnabled } from "@/lib/env";

/**
 * Gate del entorno de pruebas interno (FR-080).
 * Los mocks solo existen con WA_MOCK_ENABLED=true Y fuera de producción
 * (o en el runner de CI con la app compilada: ALLOW_CI_MOCKS=true y
 * APP_BASE_URL en localhost/127.0.0.1, ver `isMockEnabled`); en cualquier
 * otro caso responden 404 incondicional, indistinguible de una ruta
 * inexistente.
 */
export function mockGuard(): Response | null {
  if (!isMockEnabled()) {
    return new Response(null, { status: 404 });
  }
  return null;
}
