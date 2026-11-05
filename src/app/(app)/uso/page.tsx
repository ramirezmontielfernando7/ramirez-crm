import { redirect } from "next/navigation";

/** «Uso y plan» es una ventana: la dirección vieja la abre sobre la Bandeja. */
export default function UsoRedirect() {
  redirect("/settings/uso");
}
