import { JUDGE_MARKER } from "@/server/ai/prompts";
import { CABECERA_HUECOS } from "@/server/agenda/offers";
import { WRITING_ASSIST_MARKER } from "@/server/writing-assist/prompts";

/**
 * Proveedor LLM determinista para el self-test (contrato mocks.md).
 * Despacha por contenido del último mensaje `user` (o del system si es el
 * juez). JAMÁS es fallback en runtime: solo responde si OPENROUTER_BASE_URL
 * apunta explícitamente a él y el gate de mocks está activo.
 */

type InMessage = { role: string; content: string };

export function aiMockCompletion(messages: InMessage[]): string {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  // 023 — Asistente de redacción: transformación determinista del borrador.
  if (system.includes(WRITING_ASSIST_MARKER)) return writingAssistMock(lastUser);

  // Juez del Laboratorio: veredicto determinista por persona. Para cerrar el
  // loop del self-test, la persona fuera_de_kb pasa a verde si el CONOCIMIENTO
  // configurado ya cubre garantías/devoluciones (sugerencia aplicada).
  if (system.includes(JUDGE_MARKER)) {
    const kbSection =
      lastUser
        .split("CONOCIMIENTO CONFIGURADO:")[1]
        ?.split("TRANSCRIPT COMPLETO:")[0] ?? "";
    const kbCoversWarranty = /garant|devoluc/i.test(kbSection);
    if (lastUser.includes("fuera_de_kb") && !kbCoversWarranty) {
      return JSON.stringify({
        veredicto: "rojo",
        hallazgos: [
          {
            tipo: "fuera_de_kb",
            evidencia:
              "El cliente preguntó por garantías y devoluciones y el conocimiento no lo cubre.",
            sugerencia: {
              pregunta: "¿Cuál es la política de garantías y devoluciones?",
              respuesta:
                "Aceptamos devoluciones dentro de los 30 días con ticket de compra; la garantía depende del fabricante.",
            },
          },
        ],
      });
    }
    return JSON.stringify({ veredicto: "verde", hallazgos: [] });
  }

  const text = lastUser.toLowerCase();

  /**
   * 015 — La agenda, ejercitando el camino REAL.
   *
   * El mock reserva copiando el `startUtc` del mapa de huecos, igual que tiene
   * que hacer un modelo de verdad. Si ese mapa deja de llegar, aquí no hay de
   * dónde sacar el instante y la reserva falla — que es exactamente el fallo
   * que se vivió en producción (#50), en vez de un test que lo simula.
   *
   * Se buscan TODOS los mensajes `system`, no solo el primero: el mapa va al
   * final, después del historial.
   */
  const huecos = messages
    .filter((m) => m.role === "system" && m.content.includes(CABECERA_HUECOS))
    .flatMap((m) => m.content.match(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g) ?? []);

  /**
   * Solo ofrece horarios si el prompt le ENSEÑÓ `offer_slots`, como un modelo
   * real. Con la agenda apagada el prompt no la trae (ni el esquema del turno
   * la acepta), y el mock la contestaba igual: la conversación acababa en
   * "Error del proveedor de IA", algo que en producción no pasa (R11).
   */
  const agendaEnseñada = messages.some(
    (m) => m.role === "system" && m.content.includes('"action":"offer_slots"')
  );
  const quiereCita = /cita|agendar|agenda|horario|reserv/.test(text);
  if (agendaEnseñada && quiereCita && huecos.length === 0) {
    return JSON.stringify({
      action: "offer_slots",
      reply: "Claro, tengo estos horarios:",
    });
  }
  const eligeUno = /primero|segundo|ese|esa|confirmo|quiero|me sirve/.test(text);
  if (huecos.length > 0 && eligeUno) {
    return JSON.stringify({
      action: "book_slot",
      startUtc: huecos[0],
      reply: "¡Listo! Te agendé.",
    });
  }

  // Persona pide_humano (el regex de respaldo captura la frase canónica; esta
  // rama cubre variantes que llegan al modelo).
  if (text.includes("humano") || text.includes("asesor")) {
    return JSON.stringify({ action: "handoff", reason: "cliente" });
  }

  // Intención de compra → mover a Interesado.
  if (
    text.includes("lo compro") ||
    text.includes("quiero comprar") ||
    text.includes("me lo llevo")
  ) {
    return JSON.stringify({
      action: "move_stage",
      stage: "Interesado",
      reply: "¡Excelente! Te aparto el producto y un compañero te confirma el pago.",
    });
  }

  const eco = lastUser.slice(0, 80);
  return JSON.stringify({
    action: "reply",
    text: `Respuesta de prueba sobre: ${eco}`,
  });
}

/**
 * 023 — Mock del asistente de redacción. `FALLA-IA` en el borrador simula un
 * modelo que no devuelve JSON (el adaptador reintenta y acaba en error).
 */
function writingAssistMock(lastUser: string): string {
  const action = lastUser.match(/^ACCIÓN: (\w+)(?: \((\w+)\))?/m);
  const draft = lastUser.split("BORRADOR:\n")[1] ?? "";
  if (draft.includes("FALLA-IA")) return "lo siento, no puedo ayudar con eso";

  const clean = draft.replace(/\s+/g, " ").trim();
  const sentence = (t: string) => {
    const s = t.charAt(0).toUpperCase() + t.slice(1);
    return /[.!?…]$/.test(s) ? s : `${s}.`;
  };
  const words = clean.split(" ");
  const improved = sentence(clean.replace(/\bsi\b/g, "sí").replace(/ y /, ", y "));
  const lower = improved.charAt(0).toLowerCase() + improved.slice(1);

  let text: string;
  switch (action?.[1]) {
    case "tone":
      text =
        action[2] === "casual"
          ? `¡Claro! ${improved} 😊`
          : action[2] === "empatico"
            ? `Entiendo perfectamente lo que necesitas. ${improved}`
            : `Le comento que ${lower}`;
      break;
    case "summarize":
      text = sentence(words.slice(0, 8).join(" "));
      break;
    case "shorten":
      text = sentence(words.slice(0, Math.max(3, Math.ceil(words.length / 2))).join(" "));
      break;
    case "lengthen":
      text = `${improved} Si tienes cualquier duda sobre el producto, el pago o la entrega, con gusto te ayudo.`;
      break;
    default:
      text = improved;
  }
  return JSON.stringify({ text });
}
