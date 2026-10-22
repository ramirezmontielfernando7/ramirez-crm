import { orgHasWhatsAppConnection } from "@/server/credentials";
import { orgHasConexionDirecta } from "@/server/modules";

/**
 * Conexión directa (PR 6) — Empresa SIN Meta: tiene el complemento y no tiene
 * número de WhatsApp de Meta guardado. No es un ajuste aparte: en cuanto la
 * empresa conecta su número de Meta, vuelve a ser una empresa normal (Oficial
 * de fábrica), y si lo quita, pasa a operar solo con el dispositivo.
 *
 * En una empresa sin Meta: lo que escribe el contacto entra por el
 * dispositivo (`inbound.ts`), todo chat de WhatsApp es Directa sin ventana de
 * 24 h, y la IA contesta por el dispositivo solo si la plataforma lo enciende.
 */
export async function isOrgWithoutMeta(organizationId: string): Promise<boolean> {
  if (!(await orgHasConexionDirecta(organizationId))) return false;
  return !(await orgHasWhatsAppConnection(organizationId));
}
