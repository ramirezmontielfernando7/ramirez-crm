import { isPublicSignupAllowed } from "@/server/auth/registration";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

/**
 * «Crear la cuenta inicial» solo mientras la instancia no tiene organización:
 * después el registro está cerrado y el enlace solo confundía a los clientes
 * (auditoría UX 2026-11, punto 14).
 */
export default async function LoginPage() {
  const signupOpen = await isPublicSignupAllowed().catch(() => false);
  return <LoginForm signupOpen={signupOpen} />;
}
