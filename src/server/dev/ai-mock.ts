import { DOCS_MARKER } from "@/server/ai/prompts";
import { SIM_CLIENTS_MARKER, SIM_REVIEW_MARKER, SIM_TURN_MARKER } from "@/server/lab/simulated";
import { foldAccents } from "@/lib/kb-docs";
import { CABECERA_HUECOS } from "@/server/agenda/offers";
import { WRITING_ASSIST_MARKER } from "@/server/writing-assist/prompts";
import { ASSISTANT_MARKER } from "@/lib/assistant-engine";
import { ANALYSIS_MARKER } from "@/lib/conversation-insight";

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

  // 038 (PR 3) — Análisis de conversaciones del asistente (antes que el chat: su prompt es otro).
  if (system.includes(ANALYSIS_MARKER)) return analysisMock(messages);
  // 038 (PR 2) — Asistente interno: pide consultas del catálogo y responde citándolas.
  if (system.includes(ASSISTANT_MARKER)) return assistantMock(messages);

  // 023 — Asistente de redacción: transformación determinista del borrador.
  if (system.includes(WRITING_ASSIST_MARKER)) return writingAssistMock(lastUser);

  // 0070 — Clientes simulados: inventar, seguir la plática y revisar, deterministas.
  if (system.includes(SIM_CLIENTS_MARKER)) return simClientsMock(lastUser);
  if (system.includes(SIM_TURN_MARKER)) {
    // Un segundo mensaje y luego termina.
    const mine = (lastUser.match(/^TÚ \(cliente\):/gm) ?? []).length;
    return JSON.stringify(mine >= 2 ? { mensaje: "", terminado: true } : { mensaje: "¿Y cuánto tardan en contestar?", terminado: false });
  }
  if (system.includes(SIM_REVIEW_MARKER)) return simReviewMock(lastUser);

  const text = lastUser.toLowerCase();

  /**
   * 031 — «¿Quién eres?»: el mock contesta con la identidad que le dio el
   * prompt (el nombre de presentación, o que no tiene). Así el self-test sabe
   * QUÉ agente respondió sin depender del texto exacto del prompt.
   */
  if (/qui[eé]n eres/.test(text)) {
    const nombre = system.match(/^Eres "([^"]+)"/)?.[1];
    return JSON.stringify({
      action: "reply",
      text: nombre ? `Soy ${nombre}.` : "Somos el equipo del negocio (sin nombre propio).",
    });
  }

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

  // 035 — Documentos del negocio en el prompt.
  const docs = docsMock(system, lastUser);
  if (docs) return docs;

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

/**
 * 035 — Documentos: el mock contesta con la línea de los documentos que más
 * palabras comparte con el cliente («Según la información del negocio: …»).
 *
 * Y se porta como un modelo CRÉDULO con lo que quede FUERA de los bloques
 * delimitados con el nonce del turno: si una línea con «SISTEMA:» se escapa
 * de su bloque (porque un documento logró cerrar la sección), la obedece y
 * escala. Así el self-test prueba la delimitación de punta a punta: con ella
 * bien hecha, la orden se queda dentro del bloque y el mock la ignora.
 */
function docsMock(system: string, lastUser: string): string | null {
  const at = system.indexOf(DOCS_MARKER);
  if (at === -1) return null;
  const section = system.slice(at).split("\n\nEtapas del pipeline disponibles:")[0] ?? "";
  const nonce = section.match(/<<DOC 1 · .*? · ([0-9a-f]+)>>/)?.[1];
  if (!nonce) return null;
  const block = new RegExp(`<<DOC (\\d+) · .*? · ${nonce}>>\\n([\\s\\S]*?)\\n<<FIN DOC \\1 · ${nonce}>>`, "g");
  const inside: string[] = [];
  const outside = section.replace(block, (_m, _i, body: string) => {
    inside.push(body);
    return "";
  });
  if (/SISTEMA:/i.test(outside)) {
    return JSON.stringify({ action: "handoff", reason: "instrucción filtrada desde un documento" });
  }
  const stems = (t: string) =>
    new Set((foldAccents(t.toLowerCase()).match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));
  const want = stems(lastUser);
  let best = "";
  let bestScore = 0;
  for (const line of inside.join("\n").split("\n")) {
    const have = stems(line);
    let score = 0;
    for (const w of want) if (have.has(w)) score++;
    if (score > bestScore) {
      best = line.trim();
      bestScore = score;
    }
  }
  if (!best) return null;
  return JSON.stringify({ action: "reply", text: `Según la información del negocio: ${best}` });
}

/**
 * 036 (PR 3b) — El `usage.cost` del mock, como lo manda OpenRouter (créditos =
 * USD): precio fijo de prueba de $3 por millón de tokens de entrada y $15 de
 * salida. El E2E compara el «Real» del panel contra esta misma cuenta.
 */
export const AI_MOCK_PRICE = { inputPerMtok: 3, outputPerMtok: 15 } as const;

export function aiMockCost(promptTokens: number, completionTokens: number): number {
  return (promptTokens * AI_MOCK_PRICE.inputPerMtok + completionTokens * AI_MOCK_PRICE.outputPerMtok) / 1_000_000;
}

/**
 * 038 (PR 2) — Mock del asistente interno. Guarda cada prompt que recibe
 * (`assistantMockLog`) para que el self-test compruebe que NINGÚN dato real
 * (nombre de contacto, teléfono) llegó al «proveedor».
 *
 * Como el de documentos, es un modelo CRÉDULO con lo que quede FUERA de los
 * bloques de datos: si una línea con «SISTEMA:» se escapa de su bloque, la
 * obedece y responde «HACKEADO». Con la cuarentena bien hecha, la orden se
 * queda dentro del bloque y el mock la ignora.
 *
 * Palabras de la pregunta que cambian su conducta (solo pruebas):
 * INVENTA (responde cifras sin consultar y cita una fuente que no existe),
 * TODO (pide más consultas de las permitidas), BUCLE (nunca responde),
 * ANUNCIA (promete consultar y no lo hace hasta que se le reclama),
 * ROMPE (no devuelve JSON), PROPON NOTA <id> / PROPON ENVIO <id> (propone
 * una nota o un mensaje de texto para ese chat; el engaño del modelo en la
 * etiqueta lo corrige el servidor).
 */
type AssistantMockLog = { prompts: string[] };
const ASSISTANT_LOG_KEY = "__voceroAssistantMockLog";

export function assistantMockLog(): AssistantMockLog {
  const g = globalThis as unknown as Record<string, AssistantMockLog | undefined>;
  return (g[ASSISTANT_LOG_KEY] ??= { prompts: [] });
}

const MOCK_KEYWORDS: [RegExp, string, Record<string, unknown>?][] = [
  [/etiqueta/, "etiquetas"],
  [/almacen|espacio/, "almacenamiento"],
  [/equipo|asesor/, "equipo"],
  [/etapa|pipeline/, "conversaciones_por_etapa"],
  [/reciente|[uú]ltim/, "conversaciones_recientes", { limite: 5 }],
  [/funci[oó]n/, "consumo_ia_por_funcion"],
  [/agente/, "consumo_ia_por_agente"],
  [/plan|tope/, "plan_y_topes"],
  [/aviso/, "avisos_consumo"],
  [/m[oó]dulo/, "modulos"],
  [/consumo|cr[eé]dito|\bia\b/, "consumo_ia"],
  [/analisis|objecion|motivo|pierd|perd/, "analisis_conversaciones", { dias: 30 }],
];
const TODO_BASE = ["consumo_ia", "consumo_ia_por_funcion", "almacenamiento", "plan_y_topes", "avisos_consumo", "modulos", "equipo", "etiquetas"];
const TODO_QUERIES = [...TODO_BASE, ...TODO_BASE, ...TODO_BASE];

function assistantMock(messages: InMessage[]): string {
  const log = assistantMockLog();
  log.prompts.push(messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"));
  if (log.prompts.length > 200) log.prompts.splice(0, log.prompts.length - 200);

  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const nonce = system.match(/<<DATOS qN · consulta · ([0-9a-f]+)>>/)?.[1] ?? "";
  const block = new RegExp(`<<DATOS (q\\d+) · ([a-z_]+) · ${nonce}>>\\n([^\\n]*)\\n<<FIN DATOS \\1 · ${nonce}>>`, "g");
  const results = messages.filter((m) => m.role === "user" && m.content.startsWith("RESULTADOS DE LAS CONSULTAS"));
  const question =
    [...messages].reverse().find((m) => m.role === "user" && !m.content.startsWith("RESULTADOS DE LAS CONSULTAS") && !m.content.startsWith("Ya no puedes") && !m.content.startsWith("Tu respuesta trae cifras") && !m.content.startsWith("No anuncies"))
      ?.content ?? "";
  const q = foldAccents(question.toLowerCase());

  const data: { id: string; name: string; json: unknown }[] = [];
  for (const r of results) {
    const outside = r.content.replace(block, (_m, id: string, name: string, json: string) => {
      try {
        data.push({ id, name, json: JSON.parse(json) });
      } catch {
        data.push({ id, name, json: null });
      }
      return "";
    });
    if (/SISTEMA:/i.test(outside)) return JSON.stringify({ action: "answer", text: "HACKEADO", sources: [] });
  }

  const propon = /propon (nota|envio) ([a-z0-9_]+)/.exec(q);
  if (propon) {
    const conversation_id = question.match(/PROPON (?:NOTA|ENVIO) (\S+)/i)?.[1] ?? propon[2];
    const change =
      propon[1] === "nota"
        ? { tool: "add_note", args: { conversation_id, text: "Nota que propuso el asistente" }, label: "Anotar en el chat" }
        : { tool: "send_message", args: { conversation_id, text: "Hola, ¿sigues interesado?" }, label: "Mensaje inofensivo" };
    return JSON.stringify({ action: "propose", text: "Propongo este cambio.", sources: [], changes: [change] });
  }
  if (q.includes("rompe")) return "lo siento, hoy no tengo ganas de JSON";
  if (q.includes("bucle")) return JSON.stringify({ action: "query", queries: [{ name: "consumo_ia" }] });
  if (q.includes("anuncia")) {
    // Anuncia lo que va a hacer; solo si se le reclama («No anuncies…») consulta de verdad y responde.
    const reclamado = messages.some((m) => m.role === "user" && /No anuncies lo que vas a hacer/.test(m.content));
    if (!reclamado) return JSON.stringify({ action: "answer", text: "Siguiente paso: voy a consultar el consumo.", sources: [] });
    if (data.length === 0) return JSON.stringify({ action: "query", queries: [{ name: "consumo_ia" }] });
    return JSON.stringify({ action: "answer", text: "Ya lo consulté.", sources: ["q1"] });
  }
  if (q.includes("inventa")) return JSON.stringify({ action: "answer", text: "Tienes 42 contactos nuevos.", sources: ["q9"] });

  const sinMas = messages.some((m) => m.role === "user" && /Ya no (puedes hacer más|quedan) consultas/.test(m.content));
  if (q.includes("todo") && !sinMas && data.length < TODO_QUERIES.length) {
    const next = TODO_QUERIES.slice(data.length, data.length + 6).map((name) => ({ name }));
    if (next.length > 0) return JSON.stringify({ action: "query", queries: next });
  }

  if (data.length === 0 && results.length === 0) {
    if (/audit|contesto la ia/.test(q)) return JSON.stringify({ action: "query", queries: [{ name: "auditoria_agentes" }] });
    const wanted = MOCK_KEYWORDS.filter(([re]) => re.test(q)).map(([, name, args]) => ({ name, ...(args ? { args } : {}) }));
    if (q.includes("inexistente")) wanted.unshift({ name: "borrar_todo" });
    if (wanted.length > 0) return JSON.stringify({ action: "query", queries: wanted.slice(0, 4) });
    return JSON.stringify({ action: "answer", text: "Puedo ayudarte con el uso y el plan de tu organización. ¿Qué quieres saber?", sources: [] });
  }

  const lines = data.map((d) => assistantMockLine(d.name, d.json));
  return JSON.stringify({ action: "answer", text: lines.join(" ") || "No encontré datos para responder.", sources: data.map((d) => d.id) });
}

function assistantMockLine(name: string, json: unknown): string {
  const d = (json ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (name) {
    case "consumo_ia": {
      const t = d.ia_total ?? {};
      if (t.tokens_usados !== undefined || t.tokens) return `La IA del mes va en ${t.porcentaje_del_tope ?? "?"} % (${t.estado}); llevas ${t.tokens?.used ?? t.tokens_usados} tokens.`;
      return t.porcentaje_del_tope === null || t.porcentaje_del_tope === undefined
        ? `La IA del mes está: ${t.estado}.`
        : `La IA del mes va en ${t.porcentaje_del_tope} % del tope (${t.estado}).`;
    }
    case "etiquetas":
      return `Etiquetas: ${(d.etiquetas ?? []).map((e: { etiqueta: string; contactos: number }) => `${e.etiqueta} (${e.contactos})`).join(", ")}.`;
    case "equipo":
      return `Equipo: ${(d.personas ?? []).map((p: { persona: string; rol: string }) => `${p.persona} (${p.rol})`).join(", ")}.`;
    case "conversaciones_recientes":
      return `Chats recientes: ${(d.conversaciones ?? [])
        .map((c: { contacto: string; telefono: string | null; ultimo_mensaje: string | null }) => `${c.contacto}${c.telefono ? ` ${c.telefono}` : ""}: «${c.ultimo_mensaje ?? ""}»`)
        .join("; ")}.`;
    case "conversaciones_por_etapa":
      return `Leads por etapa: ${(d.etapas ?? []).map((e: { etapa: string; leads: number }) => `${e.etapa} ${e.leads}`).join(", ")}.`;
    case "modulos":
      return `Módulos encendidos: ${(d.encendidos ?? []).length}.`;
    case "analisis_conversaciones": {
      const c = d.cobertura ?? {};
      const vistas = (c.revisadas ?? 0) + (c.sin_informacion_suficiente ?? 0);
      const top = d.objeciones?.[0]?.valor ?? "ninguna";
      const ej = d.ejemplos_recientes?.[0];
      return `Revisé ${vistas} de ${c.conversaciones_en_periodo ?? 0} conversaciones${c.faltan ? `; faltan ${c.faltan}` : ""}. Objeción principal: ${top}.${ej ? ` Ejemplo: ${ej.contacto}: ${ej.resumen}` : ""}`;
    }
    case "auditoria_agentes": {
      const ags = (d.agentes ?? []) as { agente: string; chats_contestados: number; pasados_a_persona: number }[];
      const ej = d.ejemplos?.[0];
      return `Revisé ${d.chats_revisados ?? 0} chats que contestó la IA en ${d.periodo_dias ?? 7} días. ${ags
        .map((a) => `${a.agente}: ${a.chats_contestados} chats, ${a.pasados_a_persona} pasados a una persona`)
        .join("; ")}.${ej ? ` Ejemplo: ${ej.contacto} (${ej.paso_a_persona ?? "sin traspaso"}).` : ""}`;
    }
    default:
      return `Revisé ${name}.`;
  }
}

/**
 * 038 (PR 3) — Mock del ANÁLISIS de conversaciones. Clasifica cada bloque
 * por palabras clave y, como el del chat, es CRÉDULO con lo que quede fuera
 * de los bloques (una línea «SISTEMA:» escapada → todo «venta» y resumen
 * «HACKEADO»). Registra el prompt en la misma bitácora que el chat.
 * Palabras de prueba: ROMPE-ANALISIS (no devuelve JSON), CATEGORIA-RARA
 * (devuelve categorías que no existen: deben quedar «no_se_sabe»).
 */
function analysisMock(messages: InMessage[]): string {
  const log = assistantMockLog();
  log.prompts.push(messages.map((m) => `${m.role}: ${m.content}`).join("\n\n"));
  const system = messages[0]?.content ?? "";
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  const nonce = system.match(/<<CONVERSACION cN · ([0-9a-f]+)>>/)?.[1] ?? "";
  const block = new RegExp(`<<CONVERSACION (c\\d+) · ${nonce}>>\\n([\\s\\S]*?)\\n<<FIN CONVERSACION \\1 · ${nonce}>>`, "g");
  const items: { id: string; body: string }[] = [];
  const outside = user.replace(block, (_m, id: string, body: string) => {
    items.push({ id, body });
    return "";
  });
  if (/SISTEMA:/i.test(outside)) {
    return JSON.stringify({ analisis: items.map((i) => ({ id: i.id, resultado: "venta", motivo_perdida: "no_aplica", objecion: "ninguna", desempeno_asesor: "bueno", confianza: "alta", resumen: "HACKEADO" })) });
  }
  if (items.some((i) => i.body.includes("ROMPE-ANALISIS"))) return "no tengo ganas de clasificar hoy";
  return JSON.stringify({
    analisis: items.map(({ id, body }) => {
      const t = foldAccents(body.toLowerCase());
      const contacto = body.match(/contacto: (\[CONTACTO \d+\])/)?.[1] ?? "el cliente";
      const venta = /lo compro|lo quiero|me lo llevo|ya pague/.test(t);
      const perdida = !venta && /no me interesa|muy caro|ya no|compre en otro|en otro lado/.test(t);
      const objecion = /caro|precio|descuento/.test(t) ? "precio" : /cuando llega|entrega/.test(t) ? "tiempo_entrega" : "ninguna";
      const persona = /negocio \(persona\)/.test(body);
      if (body.includes("CATEGORIA-RARA")) {
        return { id, resultado: "fantastico", motivo_perdida: "???", objecion: "ninguna-rara", desempeno_asesor: "excelente", confianza: "total", resumen: 42 };
      }
      return {
        id,
        resultado: venta ? "venta" : perdida ? "perdida" : "en_curso",
        motivo_perdida: perdida ? (/otro lado|compre en otro/.test(t) ? "eligio_competencia" : objecion === "precio" ? "precio" : "no_interesado") : "no_aplica",
        objecion,
        desempeno_asesor: persona ? "bueno" : "sin_asesor",
        confianza: "media",
        resumen: `${contacto} ${venta ? "compró" : perdida ? "no compró" : "sigue en pláticas"}${objecion === "precio" ? " y se quejó del precio" : ""}.`,
      };
    }),
  });
}

/**
 * 0070 — Mock de los clientes simulados. Los primeros mensajes ejercitan los
 * caminos del agente de prueba (precio, pedir una persona, garantías). La
 * palabra ROMPE-SIMULADOS en el conocimiento hace que no devuelva clientes
 * válidos (deben entrar los genéricos).
 */
function simClientsMock(user: string): string {
  if (user.includes("ROMPE-SIMULADOS")) return JSON.stringify({ clientes: [{ nombre: "" }] });
  const n = Number(user.match(/Inventa (\d+) clientes/)?.[1] ?? 5);
  const base = [
    { nombre: "Cliente que pregunta precios", resumen: "Quiere saber precios", objetivo: "Saber precios", estilo: "Directo", primer_mensaje: "Hola, ¿cuánto cuesta?" },
    { nombre: "Pide hablar con alguien", resumen: "Quiere una persona", objetivo: "Hablar con una persona", estilo: "Insistente", primer_mensaje: "Quiero hablar con un humano por favor" },
    { nombre: "Pregunta por garantías", resumen: "Pregunta algo fuera del conocimiento", objetivo: "Saber de garantías y devoluciones", estilo: "Curioso", primer_mensaje: "¿Cuál es su política de garantías y devoluciones?" },
  ];
  const clientes = Array.from({ length: n }, (_, i) => ({ ...base[i % base.length]!, nombre: i < base.length ? base[i]!.nombre : `${base[i % base.length]!.nombre} ${Math.floor(i / base.length) + 1}` }));
  return JSON.stringify({ clientes });
}

/** Revisa: si el cliente preguntó por garantías y el conocimiento no las cubre → «revisar» con un arreglo. */
function simReviewMock(user: string): string {
  const agente = user.split("<<FIN AGENTE")[0] ?? "";
  const chat = user.split("<<CHAT")[1] ?? "";
  if (/garant/i.test(chat) && !/garant|devoluc/i.test(agente.split("CONOCIMIENTO DEL AGENTE:")[1] ?? "")) {
    return JSON.stringify({
      resultado: "revisar",
      notas: ["El cliente preguntó por garantías y devoluciones, y eso no está en lo que sabe el agente."],
      arreglo: "Si te preguntan por garantías o devoluciones y no está en tu conocimiento, no lo inventes: pasa el chat a una persona.",
    });
  }
  return JSON.stringify({ resultado: "bien", notas: [], arreglo: null });
}
