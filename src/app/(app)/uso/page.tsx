import { redirect } from "next/navigation";

/** 039 — «Uso y plan» vive en Ajustes; la dirección vieja sigue funcionando. */
export default function UsoRedirect() {
  redirect("/settings/uso");
}
