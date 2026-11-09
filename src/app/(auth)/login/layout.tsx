import { redirect } from "next/navigation";
import { getSessionOrNull } from "@/lib/auth/session";

/**
 * Con sesión activa «/login» no se muestra: «Regresar» (Android) o un enlace
 * viejo no deben pedir la contraseña otra vez. Usa la MISMA validación que el
 * marco de la app, así no hay vuelta entre una y otra.
 */
export default async function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (await getSessionOrNull()) redirect("/inbox");
  return children;
}
