import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Fase 3, PR 3 — Los módulos opcionales son POR ORGANIZACIÓN. Las variables
 * `CAMPAIGNS`, `AGENDA`, `ATRIBUCION`, `CHANNELS` y `CAMPAIGN_SEND_RATE` solo
 * son el valor por defecto y se leen en UN lugar: src/server/modules/
 * defaults.ts. Un `process.env.AGENDA` suelto en otro archivo volvería a
 * encender o apagar un módulo para TODA la instancia, saltándose lo que la
 * plataforma decidió para cada organización.
 */
const PERMITIDOS = new Set(["src/server/modules/defaults.ts", "src/lib/env.ts"]);
const LECTURA = /\b(?:process\.env|env|getEnv\(\))\.(CAMPAIGNS|AGENDA|ATRIBUCION|CHANNELS|CAMPAIGN_SEND_RATE)\b/;
const COMO_INDICE = /process\.env\[\s*["'`](CAMPAIGNS|AGENDA|ATRIBUCION|CHANNELS|CAMPAIGN_SEND_RATE)["'`]\s*\]/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    if (statSync(full).isDirectory()) return archivos(full);
    return /\.(ts|tsx|mjs)$/.test(f) ? [full] : [];
  });
}

describe("módulos por organización: las variables de entorno solo como valor por defecto", () => {
  it("nadie fuera de src/server/modules/defaults.ts lee CAMPAIGNS, AGENDA, ATRIBUCION, CHANNELS ni CAMPAIGN_SEND_RATE", () => {
    const root = process.cwd();
    const mal = archivos(path.join(root, "src"))
      .map((f) => path.relative(root, f))
      .filter((f) => !PERMITIDOS.has(f))
      .filter((f) => {
        const src = readFileSync(path.join(root, f), "utf8");
        return LECTURA.test(src) || COMO_INDICE.test(src);
      });
    expect(mal, "Pregunta por la organización: src/server/modules/ (orgHasAgenda, etc.)").toEqual([]);
  });

  it("las preguntas de bandera piden la organización (no hay versión de instancia)", async () => {
    const agenda = await import("@/server/agenda/flag");
    const campaigns = await import("@/server/campaigns/flag");
    const atribucion = await import("@/server/attribution/flag");
    const channels = await import("@/server/channels/enabled");
    expect(agenda.agendaEnabled.length).toBe(1);
    expect(campaigns.campaignsEnabled.length).toBe(1);
    expect(campaigns.campaignSendRate.length).toBe(1);
    expect(atribucion.atribucionEnabled.length).toBe(1);
    expect(channels.enabledChannels.length).toBe(1);
    expect(channels.isChannelEnabled.length).toBe(2);
  });
});
