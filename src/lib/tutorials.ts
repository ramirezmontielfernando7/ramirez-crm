import type { Permission } from "@/lib/auth/permissions";
import type { ModuleKey } from "@/lib/modules/registry";

/**
 * Demo guiada y tutoriales (Plan de impulso, punto 5) — el contenido, en un
 * solo lugar y sin dependencias: el recorrido de bienvenida (`TOUR`) y las
 * guías cortas de «Tutoriales» (`TUTORIALS`). Cada una se esconde sola si el
 * plan no trae el módulo o el rol no puede usarla (solo cosmético: cada ruta
 * valida en el servidor).
 */

export type Gate = { module?: ModuleKey; permission?: Permission };

export type TourStep = Gate & {
  key: string;
  title: string;
  body: string;
  /** Nombre de ícono de lucide-react (lo traduce la ventana). */
  icon: "Inbox" | "Kanban" | "Sparkles" | "Megaphone" | "BarChart3" | "Settings" | "Bot";
  href: string;
  cta: string;
};

export const TOUR: readonly TourStep[] = [
  {
    key: "inbox",
    title: "Bandeja: todos tus chats en un lugar",
    body: "Aquí llegan los mensajes de tus clientes. Puedes contestar, asignar el chat a alguien de tu equipo, ponerle etiquetas y dejar notas. A la izquierda ves la lista; a la derecha, los datos del cliente.",
    icon: "Inbox",
    href: "/inbox",
    cta: "Abrir la Bandeja",
    module: "inbox",
  },
  {
    key: "pipeline",
    title: "Ventas: tus oportunidades paso a paso",
    body: "Cada cliente interesado es un avance en tu embudo. Arrastra las tarjetas de una etapa a otra. Tus clientes están en Contactos y tus pendientes en Agenda.",
    icon: "Kanban",
    href: "/pipeline",
    cta: "Ver mi embudo",
    module: "pipeline",
  },
  {
    key: "agent",
    title: "Agentes IA: tu agente que contesta por ti",
    body: "Cuéntale de tu negocio al creador y él arma a tu agente. Pruébalo escribiéndole como cliente (nada sale a WhatsApp mientras pruebas) y, cuando te guste, lo publicas y lo enciendes. Lo apagas cuando quieras.",
    icon: "Bot",
    href: "/lab",
    cta: "Armar mi agente",
    module: "agent",
    permission: "agent.manage",
  },
  {
    key: "campaigns",
    title: "Campañas: manda mensajes a muchos clientes",
    body: "Crea una plantilla, elige a quién se la mandas (solo a quienes aceptaron recibirla) y lanza tu campaña. Después ves cuántos la recibieron y respondieron.",
    icon: "Megaphone",
    href: "/campaigns",
    cta: "Ver campañas",
    module: "campaigns",
    permission: "campaigns.manage",
  },
  {
    key: "results",
    title: "Resultados: qué está funcionando",
    body: "Ventas, respuestas de tu agente, de dónde llegan tus clientes y qué chats quedaron sin atender. Para decidir con números, no con corazonadas.",
    icon: "BarChart3",
    href: "/results",
    cta: "Ver resultados",
    module: "results",
    permission: "results.read",
  },
  {
    key: "assistant",
    title: "Asistente: pregúntale lo que quieras saber",
    body: "Escríbele en español, por ejemplo «¿qué chats se quedaron sin respuesta esta semana?». Lee tus datos y, si propone algo (mandar un mensaje, crear una campaña), solo se hace cuando tú pulsas «Aplicar».",
    icon: "Sparkles",
    href: "/asistente",
    cta: "Abrir el asistente",
    module: "asistente",
    permission: "assistant.use",
  },
  {
    key: "settings",
    title: "Ajustes: conecta WhatsApp e invita a tu equipo",
    body: "Lo primero: conectar tu WhatsApp. Después invita a tu equipo, personaliza los colores y el logo, y revisa tu uso del mes en «Uso y plan».",
    icon: "Settings",
    href: "/settings/whatsapp",
    cta: "Conectar mi WhatsApp",
    permission: "settings.manage",
  },
];

type Tutorial = Gate & {
  key: string;
  title: string;
  summary: string;
  minutes: number;
  steps: readonly string[];
  tip?: string;
  href: string;
  cta: string;
  /** Solo para empresas con el complemento «Conector de IA» (lo filtra Tutoriales). */
  needsConectorIa?: boolean;
};

export const TUTORIALS: readonly Tutorial[] = [
  {
    key: "whatsapp",
    title: "Conecta el WhatsApp que ya usas",
    summary: "Si ya atiendes con WhatsApp Business en tu celular: mismo número, en el celular y en el CRM.",
    minutes: 2,
    steps: [
      "Ten a la mano el celular con WhatsApp Business (actualizado).",
      "Entra a Ajustes → WhatsApp y elige «Ya uso WhatsApp Business en mi celular».",
      "Pulsa «Conectar con Facebook» y entra con la cuenta de Facebook de tu negocio.",
      "Facebook te enseña un código QR: escanéalo desde WhatsApp Business en tu celular.",
      "Listo: en unos minutos llegan solos tus contactos y los chats de los últimos 6 meses.",
    ],
    tip: "Sigues contestando desde tu celular cuando quieras. Al conectar se cierran WhatsApp Web y otros dispositivos vinculados; los vuelves a vincular después.",
    href: "/settings/whatsapp",
    cta: "Conectar WhatsApp",
    permission: "settings.manage",
  },
  {
    key: "new-number",
    title: "Conecta un número nuevo",
    summary: "Un número que no está en ninguna app de WhatsApp. Te explicamos a dónde llega el código.",
    minutes: 4,
    steps: [
      "Ten contigo el teléfono de ese número (puede ser un chip nuevo o una línea fija que reciba llamadas).",
      "Si ese número estaba en WhatsApp, primero borra la cuenta en la app (Ajustes → Cuenta → Eliminar cuenta).",
      "En Ajustes → WhatsApp elige «Quiero un número nuevo» e inventa un PIN de 6 dígitos. El PIN no te llega: tú lo eliges y lo guardas.",
      "Pulsa «Conectar con Facebook». En la ventana de Facebook escribe el número nuevo y elige «SMS» o «Llamada».",
      "Meta manda un código de 6 dígitos a ESE número nuevo (por SMS o te marca). Escríbelo en la misma ventana de Facebook.",
      "Cierra la ventana cuando diga que terminó: tu número aparece en Ajustes → WhatsApp como conectado.",
    ],
    tip: "Si el código no llega en 1 o 2 minutos, pide que te marquen («Llamada»): funciona también con líneas fijas.",
    href: "/settings/whatsapp",
    cta: "Conectar número nuevo",
    permission: "settings.manage",
  },
  {
    key: "agent",
    title: "Crea tu agente de IA",
    summary: "Un agente que contesta preguntas de tus clientes con lo que tú le enseñas.",
    minutes: 5,
    steps: [
      "Entra a Agentes IA y pulsa para crear tu agente con el creador.",
      "Platica con él: qué vendes, tus horarios, precios y cómo quieres que hable.",
      "Revisa el resultado en la vista previa de la derecha.",
      "Agrega más conocimiento si quieres (preguntas frecuentes, documentos).",
    ],
    tip: "Entre más claro le expliques tu negocio, mejores respuestas da.",
    href: "/lab",
    cta: "Armar mi agente",
    module: "agent",
    permission: "agent.manage",
  },
  {
    key: "publish",
    title: "Pruébalo, publícalo y enciéndelo",
    summary: "Compruebas que contesta bien antes de que hable con clientes de verdad.",
    minutes: 3,
    steps: [
      "En la vista previa, escríbele como si fueras un cliente. Nada sale a WhatsApp.",
      "Si algo no te gusta, dile al creador qué cambiar.",
      "Pulsa «Publicar» cuando estés conforme.",
      "Enciende la IA con el interruptor de Agentes IA. La apagas cuando quieras.",
    ],
    tip: "Cuando un cliente pide hablar con una persona, el chat pasa a tu equipo y la IA se calla.",
    href: "/lab",
    cta: "Probar mi agente",
    module: "agent",
    permission: "agent.manage",
  },
  {
    key: "inbox",
    title: "Atiende tus chats",
    summary: "Contestar, asignar y no perder ningún mensaje.",
    minutes: 3,
    steps: [
      "Abre un chat de la lista y escribe abajo. Con «/» sacas tus respuestas rápidas.",
      "Asigna el chat a alguien de tu equipo desde el encabezado.",
      "Ponle etiquetas y una etapa del embudo desde los datos del cliente.",
      "Deja una nota de trabajo o una tarea para no olvidar el seguimiento.",
    ],
    href: "/inbox",
    cta: "Ir a la Bandeja",
    module: "inbox",
  },
  {
    key: "contacts",
    title: "Importa tus contactos",
    summary: "Sube tu lista de clientes desde Excel o CSV.",
    minutes: 3,
    steps: [
      "Entra a Contactos y pulsa «Importar».",
      "Sube tu archivo .xlsx o .csv.",
      "Contesta la pregunta de consentimiento: ¿esas personas aceptaron recibir mensajes tuyos?",
      "Revisa el resumen y confirma.",
    ],
    tip: "Solo a quienes aceptaron recibir mensajes les puedes mandar campañas.",
    href: "/contacts",
    cta: "Importar contactos",
    module: "contacts",
  },
  {
    key: "pipeline",
    title: "Sigue tus ventas en el embudo",
    summary: "Ve en qué etapa está cada cliente y qué sigue.",
    minutes: 2,
    steps: [
      "Abre el Pipeline: cada columna es una etapa.",
      "Arrastra la tarjeta de un cliente a la etapa siguiente cuando avance.",
      "Si se pierde la venta, anota el motivo: te sirve para mejorar.",
      "Edita las etapas con «Gestionar etapas» para que sean las de tu negocio.",
    ],
    href: "/pipeline",
    cta: "Ver mi embudo",
    module: "pipeline",
  },
  {
    key: "stages-tags",
    title: "Pon tus etapas y etiquetas",
    summary: "Que el CRM hable como tu negocio: tus pasos de venta y tus tipos de cliente.",
    minutes: 3,
    steps: [
      "En Ventas pulsa el botón de ajustes («Gestionar etapas»), junto a «Nuevo prospecto»: renombra, agrega o quita etapas (por ejemplo «Cotizó», «Visitó», «Pagó»).",
      "En Ajustes → Etiquetas crea las tuyas: «Mayoreo», «Urgente», «Recomendado»… cada una con su color.",
      "En cualquier chat, en los datos del cliente, ponle etiquetas y su etapa.",
    ],
    tip: "Pocas y claras: 4 a 6 etapas y unas cuantas etiquetas bastan para empezar.",
    href: "/pipeline",
    cta: "Ajustar mis etapas",
    module: "pipeline",
    permission: "settings.manage",
  },
  {
    key: "ai-connector",
    title: "Conecta ChatGPT o Claude",
    summary: "Pregúntale a tu IA de siempre por tus chats y ventas, sin abrir el CRM.",
    minutes: 4,
    steps: [
      "Propietario: en Ajustes → Conector del equipo enciende el conector y elige qué roles pueden usarlo.",
      "Cada persona: en Ajustes → Mi IA copia la «Dirección del conector».",
      "En Claude: Configuración → Conectores → «Agregar conector personalizado» y pega la dirección. En ChatGPT (Plus o más): Configuración → Apps y conectores → Avanzado → modo desarrollador → «Crear».",
      "Entra con tu cuenta de Dashfort y pulsa «Aceptar». Prueba con «¿Qué chats quedaron sin respuesta hoy?».",
    ],
    tip: "Tu IA solo ve y hace lo que tú puedes en el CRM. La IA la pagas en tu plan de Claude o ChatGPT.",
    href: "/settings/mi-ia",
    cta: "Conectar mi IA",
    needsConectorIa: true,
  },
  {
    key: "campaign",
    title: "Lanza tu primera campaña",
    summary: "Un mensaje a muchos clientes, con plantilla aprobada por Meta.",
    minutes: 6,
    steps: [
      "Crea una plantilla en Campañas → Plantillas y espera a que Meta la apruebe.",
      "Prepara tu audiencia (o importa una lista con consentimiento).",
      "Crea la campaña, elige plantilla y público, y revisa el costo estimado.",
      "Lanza la campaña y sigue los resultados en Métricas.",
    ],
    tip: "Hasta que no tengas WhatsApp conectado y una plantilla aprobada, no se puede lanzar.",
    href: "/campaigns",
    cta: "Ir a Campañas",
    module: "campaigns",
    permission: "campaigns.manage",
  },
  {
    key: "team",
    title: "Invita a tu equipo",
    summary: "Que tus asesores atiendan chats con su propio acceso.",
    minutes: 2,
    steps: [
      "Entra a Ajustes → Equipo y permisos y pulsa «Invitar persona».",
      "Elige el rol: Coordinador ve todo; Asesor solo lo que le asignen.",
      "Comparte el enlace de activación por WhatsApp.",
    ],
    href: "/settings/team",
    cta: "Invitar a mi equipo",
    permission: "settings.manage",
  },
  {
    key: "assistant",
    title: "Pregúntale al asistente",
    summary: "Respuestas sobre tu negocio, sin buscar en pantallas.",
    minutes: 1,
    steps: [
      "Abre el Asistente y escribe tu pregunta en español.",
      "Prueba con «Audita mis agentes de IA» o «¿qué chats quedaron sin respuesta?».",
      "Si propone mandar algo o cambiar algo, revisa y pulsa «Aplicar» solo si estás de acuerdo.",
    ],
    href: "/asistente",
    cta: "Abrir el asistente",
    module: "asistente",
    permission: "assistant.use",
  },
];

/** Lo que de verdad aplica a quien mira: módulo encendido y permiso del rol. */
export function visibleFor<T extends Gate>(
  items: readonly T[],
  viewer: { hasModule: (m: ModuleKey) => boolean; can: (p: Permission) => boolean },
): T[] {
  return items.filter(
    (i) => (!i.module || viewer.hasModule(i.module)) && (!i.permission || viewer.can(i.permission)),
  );
}
