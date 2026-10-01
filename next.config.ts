import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import { ENFORCED_CSP, OWN_CSP_SOURCE, securityHeaders } from "./src/lib/security/headers";

// La versión sale de package.json y no de una constante aparte: duplicarla es
// tenerla desactualizada en uno de los dos lados, y justo esta no puede mentir.
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8")
) as { version: string };

const nextConfig: NextConfig = {
  // standalone es para la imagen Docker (Linux). En Windows el trazado crea
  // symlinks que requieren permisos elevados, así que ahí se omite.
  output: process.platform === "win32" ? undefined : "standalone",
  // El paquete `postgres` usa APIs de Node que no deben empaquetarse en el bundle.
  serverExternalPackages: ["postgres"],
  // Se congelan al construir: lo que queda aquí va dentro del binario y no
  // cambia en tiempo de ejecución. El commit solo se congela si `SOURCE_COMMIT`
  // llega AL BUILD (build arg `SOURCE_COMMIT`; con docker compose,
  // `--build-arg`). Si no llega, esto queda vacío y el servidor cae al
  // `SOURCE_COMMIT` del entorno al arrancar, marcado como NO verificado
  // (`src/lib/version.ts`, #50): puede no ser el del código que corre.
  // Fase 3, PR 2 (H10): cabeceras de seguridad en TODA respuesta.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders(process.env.NODE_ENV !== "production") },
      // Todo MENOS las rutas de adjuntos, que traen su propia CSP `sandbox`.
      { source: OWN_CSP_SOURCE, headers: [ENFORCED_CSP] },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_BUILD_COMMIT: process.env.SOURCE_COMMIT ?? "",
  },
};

export default nextConfig;
