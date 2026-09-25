/**
 * 021 — Si esta instancia tiene Campañas (envío masivo) o no.
 *
 * Mismo patrón que `AGENDA` y `ATRIBUCION` (ADR-001): el código viaja en
 * main, la migración se aplica siempre, y la variable de despliegue decide si
 * la superficie EXISTE. Apagada, la pantalla y las rutas responden 404.
 *
 * Etiquetas, consentimiento e importar/exportar NO dependen de esta bandera:
 * son útiles por sí solos y no tocan la API de Meta.
 */

const ON_VALUES = new Set(["on", "1", "true", "si", "sí", "yes"]);

export function parseCampaignsFlag(raw: string | undefined): boolean {
  return ON_VALUES.has((raw ?? "").trim().toLowerCase());
}

/** De `process.env` directo, como `agendaEnabled()`: consultar no valida todo el entorno. */
export function campaignsEnabled(): boolean {
  return parseCampaignsFlag(process.env.CAMPAIGNS);
}

/** 404 y no 403: apagada, la superficie no existe en esta instancia. */
export function campaignsDisabledResponse(): Response {
  return new Response(null, { status: 404 });
}

/**
 * Mensajes por segundo del envío masivo. Meta admite ~80/s por número, pero
 * un número nuevo tiene límites diarios de destinatarios y la calidad cae si
 * se dispara todo junto: 10/s es conservador y se puede subir.
 */
export function campaignSendRate(): number {
  const n = Number(process.env.CAMPAIGN_SEND_RATE ?? "");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 80) : 10;
}
