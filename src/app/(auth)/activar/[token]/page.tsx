import { SetPasswordForm } from "@/components/platform/set-password-form";

export const dynamic = "force-dynamic";

/** Fase 3, PR 2 — Enlace de un solo uso para poner contraseña (sin sesión). */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SetPasswordForm token={token} kind="activar" />;
}
