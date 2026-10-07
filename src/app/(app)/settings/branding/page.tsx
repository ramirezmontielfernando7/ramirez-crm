import { redirect } from "next/navigation";

/** Fase D — «Marca» se mudó a Ajustes → Personalización → Marca. */
export default function BrandingSettingsRedirect() {
  redirect("/settings/personalization/marca");
}
