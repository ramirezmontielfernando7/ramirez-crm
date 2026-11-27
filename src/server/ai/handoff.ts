/**
 * Patrón de RESPALDO de intención de escalado (FR-022). Se evalúa sobre el
 * mensaje del cliente ANTES del LLM: si matchea, el handoff ocurre aunque el
 * modelo no lo detecte. Diseñado para exigir un verbo de contacto cerca del
 * objeto humano — "somos 4 personas" NO matchea (test unitario).
 */
const HANDOFF_BACKUP_REGEX =
  /(hablar|comunicar|contactar)[\s\S]{0,40}?(asesor|humano|persona|alguien)|un asesor|atenci[oó]n humana/i;

export function matchesHandoffIntent(text: string): boolean {
  return HANDOFF_BACKUP_REGEX.test(text);
}

/**
 * Lo que oye el cliente cuando el patrón de respaldo lo traspasa.
 *
 * El camino del modelo se despide con su `farewell`; este no mandaba NADA, y
 * justo atrapa las peticiones más directas («quiero hablar con un humano»).
 * El traspaso ocurría por dentro, pero del lado de WhatsApp se leía como que
 * el bot había dejado de contestar a quien pidió una persona.
 *
 * Es fijo porque el perfil del agente no tiene un campo para esto
 * (`escalationRules` dice CUÁNDO escalar, no qué decir) y el turno corta
 * antes del modelo a propósito: no hay de dónde sacar otro texto. No promete
 * un plazo ni un nombre que el CRM no conoce.
 */
export const HANDOFF_BACKUP_ACK =
  "Claro, te comunico con una persona del equipo. En breve te responden.";
