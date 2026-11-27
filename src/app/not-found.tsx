import Link from "next/link";
import { PLATFORM_BRANDING } from "@/lib/branding";
import { BrandLogo } from "@/components/brand-mark";

/**
 * Página 404 en español con el mismo fondo que la entrada (auditoría UX
 * 2026-11, punto 9). Sin datos del negocio: se pinta igual con o sin sesión.
 */
export default function NotFound() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-subtle p-4">
      <div className="brand-grid absolute inset-0" aria-hidden />
      <div className="brand-glow brand-glow-a" aria-hidden />
      <div className="relative flex w-full max-w-sm flex-col items-center gap-6 text-center">
        <BrandLogo branding={PLATFORM_BRANDING} size="lg" />
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">No encontramos esta página</h1>
          <p className="text-sm text-text-3">
            Puede que el enlace esté mal escrito o que esta sección no esté incluida en tu plan.
          </p>
        </div>
        <Link
          href="/inbox"
          className="inline-flex h-9 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Ir a la Bandeja
        </Link>
      </div>
    </main>
  );
}
