import { redirect } from "next/navigation";

/** Fase D — «Navegación» se mudó a Ajustes → Personalización → Navegación. */
export default function NavigationSettingsRedirect() {
  redirect("/settings/personalization/navegacion");
}
