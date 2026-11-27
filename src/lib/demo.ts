/**
 * Datos de demostración (FR-075) — lo que el navegador y el servidor
 * necesitan saber para reconocerlos (auditoría UX 2026-11, punto 6): los
 * teléfonos fijos de sus contactos y el nombre de su agente.
 */
export const DEMO_PHONES: readonly string[] = [
  "5215612340001",
  "5215612340002",
  "5215612340003",
  "5215612340004",
  "5215612340005",
  "5215612340006",
  "5215612340007",
  "5215612340008",
];

export const DEMO_AGENT_NAME = "Martillito";

/** ¿Este teléfono (normalizado, sin «+») es de un contacto de ejemplo? */
export function isDemoPhone(phone: string | null | undefined): boolean {
  if (!phone) return false;
  // Los 10 dígitos nacionales: el teléfono puede venir con «521» o «52».
  const national = phone.replace(/\D/g, "").slice(-10);
  return national.length === 10 && DEMO_PHONES.some((p) => p.endsWith(national));
}
