/**
 * Siembra de marketing: "Ferretería El Martillo" completa sobre la instancia
 * LOCAL (build de producción + sidecar de mocks). Todo es ficticio.
 *
 * Lo que tiene regla de negocio o secreto pasa por la API de la app (registro,
 * usuarios con su contraseña hasheada, conexión de WhatsApp contra el mock,
 * plantillas, conocimientos, chat de equipo); el historial con fechas pasadas
 * (chats, embudo, bitácoras) se escribe directo en la BD local con el esquema
 * de la app, porque ninguna API permite fechar hacia atrás.
 *
 * Re-ejecutable: `scripts/marketing/reset.sh` borra la BD, migra y vuelve a
 * correr esto. Uso directo:
 *   node --env-file=.env.marketing scripts/marketing/.build/seed.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";
import { newId } from "@/lib/db/ids";

const BASE = process.env.APP_INTERNAL_URL ?? "http://127.0.0.1:3000";
const ORIGIN = process.env.APP_BASE_URL ?? "http://localhost:3000";
const MOCK = process.env.MOCK_URL ?? "http://127.0.0.1:4010";
export const PASSWORD = process.env.DEMO_PASSWORD ?? "Martillo-Demo-2026";
const MEDIA_DIR = process.env.MEDIA_DIR!;
const ASSETS = path.resolve("marketing/.assets");
const WABA = "WABA-MARTILLO";
const PHONE_NUMBER_ID = "PN-MARTILLO-DEMO";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms);

const sqlc = postgres(process.env.DATABASE_URL!, { max: 4, onnotice: () => {}, connection: { TimeZone: "UTC" } });
const db = drizzle(sqlc, { schema });

/* =================================================================== */
/* HTTP con cookie por usuario                                          */
/* =================================================================== */

type Client = { key: string; cookie: string; ip: string };
let ipSeq = 10;

async function call(c: Client | null, p: string, init: RequestInit & { json?: unknown } = {}) {
  const headers: Record<string, string> = {
    origin: ORIGIN,
    "x-forwarded-for": c?.ip ?? `10.99.0.${ipSeq++}`,
    ...(init.json !== undefined ? { "content-type": "application/json" } : {}),
    ...(c?.cookie ? { cookie: c.cookie } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const res = await fetch(BASE + p, {
    ...init,
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    redirect: "manual",
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (c && set.length) c.cookie = set.map((s) => s.split(";")[0]).join("; ");
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${p} → ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

async function login(key: string, email: string): Promise<Client> {
  const c: Client = { key, cookie: "", ip: `10.77.0.${ipSeq++}` };
  await call(c, "/api/auth/sign-in/email", { method: "POST", json: { email, password: PASSWORD } });
  return c;
}

/* =================================================================== */
/* Equipo                                                               */
/* =================================================================== */

type UKey = "carlos" | "sofia" | "marcela" | "diego" | "paola" | "ivan" | "andrea" | "hector" | "lucia";
const USERS: { key: UKey; name: string; email: string; role: "owner" | "coordinador" | "asesor" }[] = [
  { key: "carlos", name: "Carlos Martínez", email: "carlos@elmartillo.demo", role: "owner" },
  { key: "sofia", name: "Sofía Ramírez", email: "sofia@elmartillo.demo", role: "coordinador" },
  { key: "marcela", name: "Marcela Cruz", email: "marcela@elmartillo.demo", role: "coordinador" },
  { key: "diego", name: "Diego López", email: "diego@elmartillo.demo", role: "asesor" },
  { key: "paola", name: "Paola Núñez", email: "paola@elmartillo.demo", role: "asesor" },
  { key: "ivan", name: "Iván Salazar", email: "ivan@elmartillo.demo", role: "asesor" },
  { key: "andrea", name: "Andrea Vega", email: "andrea@elmartillo.demo", role: "asesor" },
  { key: "hector", name: "Héctor Molina", email: "hector@elmartillo.demo", role: "asesor" },
  { key: "lucia", name: "Lucía Ortega", email: "lucia@elmartillo.demo", role: "asesor" },
];
const uid: Record<UKey, string> = {} as never;
const clients: Partial<Record<UKey, Client>> = {};
async function as(k: UKey): Promise<Client> {
  if (!clients[k]) clients[k] = await login(k, USERS.find((u) => u.key === k)!.email);
  return clients[k]!;
}

/* =================================================================== */
/* Contactos con chat                                                   */
/* =================================================================== */

type Stage = "Nuevo" | "En conversación" | "Interesado" | "Cliente" | "Perdido";
type Tag = "Cliente frecuente" | "Cotización pendiente" | "Pedido grande" | "Mayoreo" | "Import: clientes-septiembre.csv";
type M = [dir: "in" | "out", text: string, minutesAgo: number, how?: "ai" | "op" | "tpl" | { img: string; caption?: string }];

type ChatSpec = {
  n: number; // teléfono +52 998 555 01NN
  name: string;
  to: UKey | null;
  stage: Stage;
  amount?: number; // pesos
  tags?: Tag[];
  optIn?: boolean;
  unread?: number;
  ai?: boolean; // bot activo
  handoff?: { minutesAgo: number; reason: "cliente" | "modelo" };
  archivedDaysAgo?: number;
  loss?: "precio" | "eligio_otro" | "nunca_contesto" | "sin_presupuesto";
  source?: "anuncio" | "organico" | "referido" | "conocido";
  ad?: string;
  note?: string;
  priority?: "alta" | "media" | "baja";
  createdDaysAgo?: number;
  thread: M[];
};

const H = 60; // minutos por hora
const D = 24 * H;

function longThreadRamos(): M[] {
  const t: M[] = [
    ["in", "Buenos días, soy el Ing. Alejandro Ramos de Constructora Ramos. Vamos a arrancar un fraccionamiento en Tulum", 6 * D + 120, undefined],
    ["out", "¡Buenos días, ingeniero! Con gusto le apoyamos. ¿Qué material necesita para arrancar?", 6 * D + 110, "op"],
    ["in", "Para la cimentación: 4 toneladas de varilla 3/8, 180 bultos de cemento y 60 de mortero", 6 * D + 100, undefined],
    ["out", "Perfecto. Por volumen le damos precio de mayoreo: varilla $16,900 la tonelada, cemento $229 y mortero $184 el bulto.", 6 * D + 90, "op"],
    ["in", "¿Me lo pueden entregar en obra? Está sobre la carretera Tulum–Cobá km 4", 6 * D + 80, undefined],
    ["out", "Sí, llegamos hasta ahí. Por ser pedido grande el flete va sin costo. Le preparo la cotización formal.", 6 * D + 70, "op"],
    ["out", "Le comparto la foto del cemento que tenemos en bodega, lote de esta semana 👇", 6 * D + 65, { img: "producto-cemento.png", caption: "Cemento gris CPC 30R · lote de esta semana" }],
    ["in", "Se ve bien. ¿Cuánto sería el total con IVA?", 6 * D + 40, undefined],
    ["out", "Total: $119,700 MXN con IVA y flete incluido. Le respeto el precio 7 días.", 6 * D + 30, "op"],
    ["in", "Va, lo platico con mi socio y le confirmo mañana", 6 * D + 20, undefined],
    ["in", "Ingeniero de nuevo por aquí. Confirmamos el pedido 👍", 5 * D + 200, undefined],
    ["out", "¡Excelente! ¿Nos puede anticipar el 50% para apartar la varilla?", 5 * D + 190, "op"],
    ["in", "Claro, ¿a qué cuenta deposito?", 5 * D + 185, undefined],
    ["out", "Le paso los datos por aquí: Ferretería El Martillo, CLABE terminación 4821. En concepto ponga «Pedido 1045».", 5 * D + 180, "op"],
    ["in", "Listo, ya transferí. Le mando el comprobante", 5 * D + 60, undefined],
    ["in", "Comprobante del anticipo", 5 * D + 58, { img: "comprobante-spei.png", caption: "Comprobante del anticipo · Pedido 1045" }],
    ["out", "Recibido, ingeniero. Ya quedó apartado. Primera entrega el lunes a las 8 am.", 5 * D + 40, "op"],
    ["in", "Perfecto. ¿Me pueden facturar a nombre de la constructora?", 4 * D + 300, undefined],
    ["out", "Claro, mándeme su constancia de situación fiscal y le timbro hoy mismo.", 4 * D + 290, "op"],
    ["in", "Enviada al correo de facturación", 4 * D + 280, undefined],
    ["out", "Factura enviada ✅ Cualquier cosa aquí estamos.", 4 * D + 200, "op"],
    ["in", "Ya llegó la primera entrega, todo completo. Gracias", 2 * D + 30, undefined],
    ["out", "¡Qué gusto! La segunda sale hoy a las 11 con el resto del cemento.", 55, "op"],
    ["in", "¿A qué hora llega la camioneta? Tengo a la cuadrilla esperando", 25, undefined],
  ];
  return t;
}

function longThreadSolis(): M[] {
  return [
    ["in", "Hola, soy Beatriz Solís, arquitecta. Estoy remodelando tres departamentos en Cancún", 3 * D + 400, undefined],
    ["out", "¡Hola arquitecta! Encantados de ayudarle. ¿Qué necesita para la obra?", 3 * D + 390, "op"],
    ["in", "Herramienta para la cuadrilla y pintura. ¿Qué rotomartillo me recomiendan?", 3 * D + 380, undefined],
    ["out", "Para trabajo pesado el rotomartillo 20V MAX. Aquí una foto del que tenemos en tienda:", 3 * D + 370, "op"],
    ["out", "", 3 * D + 369, { img: "producto-rotomartillo.png", caption: "Rotomartillo 20V MAX con 2 baterías · $3,450" }],
    ["in", "Me gusta. Necesitaría 3 piezas", 3 * D + 300, undefined],
    ["out", "Le hago precio especial por 3: $3,280 c/u. Incluye maletín y juego de brocas SDS.", 3 * D + 290, "op"],
    ["in", "¿Y de pintura? Son unos 600 m² de muro interior", 3 * D + 200, undefined],
    ["out", "Con vinílica premium necesita ~7 cubetas de 19 L. Le queda en $1,060 cada una por mayoreo.", 3 * D + 190, "op"],
    ["in", "Blanco ostión, mate", 3 * D + 185, undefined],
    ["out", "Anotado: 7 cubetas blanco ostión mate.", 3 * D + 180, "op"],
    ["in", "También ocupo impermeabilizante para las azoteas, unos 200 m²", 2 * D + 500, undefined],
    ["out", "Serían 5 cubetas del acrílico 5 años: $1,590 c/u por volumen.", 2 * D + 490, "op"],
    ["in", "¿Tienen en color terracota?", 2 * D + 480, undefined],
    ["out", "Sí, terracota y blanco. ¿Cuál prefiere?", 2 * D + 470, "op"],
    ["in", "Terracota", 2 * D + 460, undefined],
    ["out", "Le preparo la cotización completa con todo junto.", 2 * D + 450, "op"],
    ["out", "Cotización: 3 rotomartillos $9,840 · 7 cubetas vinílica $7,420 · 5 impermeabilizante $7,950 · otros materiales $13,290. Total $38,500 MXN con IVA.", 1 * D + 200, "op"],
    ["in", "Gracias, lo reviso con el cliente", 1 * D + 150, undefined],
    ["in", "Me aprobaron casi todo. ¿Me respetan el precio hasta el viernes?", 40, undefined],
    ["in", "Y otra pregunta: ¿cuánto tardan en entregar en la zona hotelera?", 12, undefined],
  ];
}

const CHATS: ChatSpec[] = [
  { n: 1, name: "Ing. Alejandro Ramos", to: "diego", stage: "Cliente", amount: 119700, tags: ["Cliente frecuente", "Pedido grande", "Mayoreo"], optIn: true, unread: 1, source: "referido", priority: "alta", createdDaysAgo: 7, note: "Constructora Ramos · fraccionamiento en Tulum. Paga por transferencia.", thread: longThreadRamos() },
  { n: 2, name: "Arq. Beatriz Solís", to: "paola", stage: "Interesado", amount: 38500, tags: ["Cotización pendiente", "Pedido grande"], optIn: true, unread: 2, source: "anuncio", ad: "Todo para tu remodelación", priority: "alta", createdDaysAgo: 4, thread: longThreadSolis() },
  { n: 3, name: "Juan Pablo Herrera", to: null, stage: "Nuevo", ai: true, unread: 1, source: "organico", createdDaysAgo: 0, thread: [
    ["in", "Hola buenas tardes", 7, undefined],
    ["out", "¡Hola! Soy Martillito, el asistente de Ferretería El Martillo 🔨 ¿Qué material o herramienta estás buscando hoy?", 7, "ai"],
    ["in", "¿Tienen varilla de 3/8? Ocupo como 30 piezas", 4, undefined],
    ["out", "La varilla corrugada de 3/8\" está en $168 MXN la pieza de 12 m; por 50 o más te queda en $158. ¿Te la aparto?", 4, "ai"],
  ] },
  { n: 4, name: "Guadalupe Chan", to: null, stage: "Nuevo", ai: true, unread: 1, source: "anuncio", ad: "Cemento a precio de mayoreo", createdDaysAgo: 0, thread: [
    ["in", "Buenas, ¿cuánto cuesta el bulto de cemento?", 19, undefined],
    ["out", "El bulto de cemento gris de 50 kg está en $245 MXN. A partir de 10 bultos te queda en $232 MXN cada uno, y la entrega local es el mismo día si confirmas antes de la 1 pm. ¿Cuántos necesitas?", 19, "ai"],
    ["in", "Serían 12 bultos para una losa", 18, undefined],
  ] },
  { n: 5, name: "Ricardo Pérez", to: null, stage: "Nuevo", ai: true, source: "organico", createdDaysAgo: 0, thread: [
    ["in", "¿A qué hora abren el domingo?", 48, undefined],
    ["out", "Nuestro horario es de lunes a sábado de 8:00 a 19:00 y domingos de 9:00 a 14:00. Estamos en Av. Hidalgo 245, colonia Centro. ¿Te aparto algo para que pases por él?", 48, "ai"],
    ["in", "Perfecto, paso el domingo temprano. Gracias", 46, undefined],
    ["out", "¡A ti! Aquí estamos para lo que necesites. 🔨", 46, "ai"],
  ] },
  { n: 6, name: "Verónica Aguilar", to: "diego", stage: "En conversación", unread: 1, handoff: { minutesAgo: 34, reason: "cliente" }, source: "organico", createdDaysAgo: 0, thread: [
    ["in", "Hola, compré una lijadora orbital el sábado", 36, undefined],
    ["out", "¡Hola! Soy Martillito, el asistente de Ferretería El Martillo 🔨 ¿En qué te ayudo con tu lijadora?", 36, "ai"],
    ["in", "Llegó dañada, no enciende. Quiero hablar con un asesor", 35, undefined],
    ["out", "Con gusto. Te paso con un asesor de nuestro equipo que te ayuda con eso en un momento. 🙌", 34, "ai"],
    ["in", "Traigo el ticket, es el 88213", 33, undefined],
  ] },
  { n: 7, name: "Hugo Sánchez", to: "ivan", stage: "En conversación", tags: ["Cotización pendiente"], optIn: true, source: "organico", createdDaysAgo: 1, thread: [
    ["in", "Qué tal, ¿manejan pintura para exterior?", 90, undefined],
    ["out", "Hola Hugo, sí: vinílica exterior 10 años en 19 L a $1,480. ¿Qué superficie vas a pintar?", 85, "op"],
    ["in", "Una fachada de unos 120 m²", 80, undefined],
    ["out", "Te alcanzan 2 cubetas. ¿Te mando la cotización con sellador incluido?", 70, "op"],
  ] },
  { n: 8, name: "Claudia Moreno", to: "andrea", stage: "Interesado", amount: 3360, source: "anuncio", ad: "Impermeabiliza antes de lluvias", createdDaysAgo: 1, thread: [
    ["in", "Hola, quiero impermeabilizar mi azotea antes de que empiecen las lluvias", 2 * H + 40, undefined],
    ["out", "¡Hola Claudia! El acrílico 5 años (19 L) está en $1,680 y cubre ~40 m². ¿De cuántos metros es?", 2 * H + 30, "op"],
    ["in", "Como 70 m²", 2 * H + 10, undefined],
    ["out", "Con 2 cubetas quedas bien: $3,360 MXN. Te lo puedo mandar mañana.", 2 * H, "op"],
  ] },
  { n: 9, name: "Miguel Ángel Torres", to: "hector", stage: "Cliente", amount: 6240, tags: ["Cliente frecuente"], optIn: true, handoff: { minutesAgo: 3 * H + 20, reason: "cliente" }, source: "conocido", createdDaysAgo: 12, thread: [
    ["in", "Buenas, necesito la factura de mi compra de ayer", 3 * H + 25, undefined],
    ["out", "Con gusto. Te paso con un asesor de nuestro equipo que te ayuda con eso en un momento. 🙌", 3 * H + 20, "ai"],
    ["out", "Hola Miguel Ángel, soy Héctor. ¿Me compartes tu RFC y uso de CFDI?", 3 * H + 5, "op"],
    ["in", "TOMM850101XXX, uso G03", 3 * H, undefined],
    ["out", "Listo, factura enviada a tu correo 📄", 2 * H + 45, "op"],
    ["in", "Gracias Héctor 👌", 2 * H + 40, undefined],
  ] },
  { n: 10, name: "Patricia Vázquez", to: "lucia", stage: "En conversación", unread: 1, source: "organico", createdDaysAgo: 0, thread: [
    ["in", "¿Hacen entregas en Puerto Morelos?", 4 * H + 15, undefined],
    ["out", "Hola Patricia, sí llegamos a Puerto Morelos los martes y viernes. ¿Qué material necesitas?", 4 * H, "op"],
    ["in", "20 bultos de mortero y 500 blocks", 3 * H + 50, undefined],
  ] },
  { n: 11, name: "Fernando Castillo", to: "sofia", stage: "Interesado", amount: 17800, tags: ["Mayoreo", "Pedido grande"], optIn: true, source: "referido", priority: "alta", createdDaysAgo: 2, thread: [
    ["in", "Buen día, ¿a cómo la tonelada de varilla de 3/8?", 5 * H + 30, undefined],
    ["out", "Hola Fernando, la tonelada está en $17,800 con entrega incluida en Cancún.", 5 * H + 20, "op"],
    ["in", "Si me llevo 3 toneladas, ¿me mejoran el precio?", 5 * H, undefined],
    ["out", "Déjame revisarlo con dirección y te confirmo hoy mismo.", 4 * H + 50, "op"],
  ] },
  { n: 12, name: "Laura Gómez", to: "marcela", stage: "Cliente", amount: 1899, source: "organico", createdDaysAgo: 9, thread: [
    ["in", "Hola, el taladro que compré hace un mes hace un ruido raro", 6 * H + 20, undefined],
    ["out", "Hola Laura, soy Marcela de postventa. Tráelo con tu ticket y lo revisamos por garantía sin costo.", 6 * H + 10, "op"],
    ["in", "¿Tiene que ser en la sucursal del centro?", 6 * H, undefined],
    ["out", "Sí, en Av. Hidalgo 245. Si no puedes venir, pasamos por él el jueves.", 5 * H + 50, "op"],
  ] },
  { n: 13, name: "Roberto Díaz", to: "paola", stage: "Perdido", loss: "precio", source: "anuncio", ad: "Cemento a precio de mayoreo", createdDaysAgo: 5, thread: [
    ["in", "¿A cómo el cemento por mayoreo? Serían 100 bultos", 3 * D + 60, undefined],
    ["out", "Hola Roberto, por 100 bultos te queda en $226 cada uno.", 3 * D + 50, "op"],
    ["in", "En otro lado me lo dan en 205, gracias", 3 * D + 20, undefined],
  ] },
  { n: 14, name: "Adriana Flores", to: "ivan", stage: "Nuevo", source: "organico", createdDaysAgo: 0, thread: [
    ["in", "Buenas, ¿tienen esmeriladora de 4 1/2?", 7 * H + 20, undefined],
    ["out", "¡Hola! Sí: la Truper de 4 1/2\" está en $899 y la Makita en $1,650. ¿Cuál te interesa?", 7 * H + 20, "ai"],
    ["out", "Hola Adriana, soy Iván. Si quieres te aparto la Makita, viene con 3 discos de regalo.", 7 * H, "op"],
  ] },
  { n: 15, name: "José Luis Medina", to: "diego", stage: "Interesado", amount: 9280, tags: ["Cotización pendiente", "Mayoreo"], optIn: true, source: "referido", createdDaysAgo: 1, thread: [
    ["in", "Hola Diego, me pasó tu número Don Chuy. Necesito 40 bultos de cemento", 9 * H + 20, undefined],
    ["out", "¡Qué tal José Luis! 40 bultos te quedan en $232 c/u: $9,280 MXN con entrega.", 9 * H + 10, "op"],
    ["in", "Déjame ver con el maestro de obra y te confirmo", 9 * H, undefined],
  ] },
  { n: 16, name: "Carmen Ortiz", to: "andrea", stage: "Cliente", amount: 2450, tags: ["Cliente frecuente"], optIn: true, source: "conocido", createdDaysAgo: 20, thread: [
    ["in", "Andrea, ¿me mandas lo de siempre para el taller?", 1 * D + 60, undefined],
    ["out", "¡Claro Carmen! Lijas, barniz marino 2 L y thinner. Total $2,450. ¿Te lo mando hoy?", 1 * D + 50, "op"],
    ["in", "Sí porfa, pago contra entrega", 1 * D + 45, undefined],
    ["out", "Listo, sale en la camioneta de las 4 🚚", 1 * D + 40, "op"],
  ] },
  { n: 17, name: "Alberto Jiménez", to: "hector", stage: "En conversación", source: "organico", createdDaysAgo: 1, thread: [
    ["in", "¿Cuánto cuesta el rollo de cable calibre 12?", 1 * D + 3 * H, undefined],
    ["out", "El rollo de 100 m THW calibre 12 está en $1,890. ¿Qué color lo necesitas?", 1 * D + 3 * H - 10, "op"],
    ["in", "Negro y blanco, uno de cada uno", 1 * D + 2 * H, undefined],
  ] },
  { n: 18, name: "Mónica Ruiz", to: "lucia", stage: "Interesado", amount: 21200, tags: ["Pedido grande"], optIn: true, source: "anuncio", ad: "Todo para tu remodelación", createdDaysAgo: 2, thread: [
    ["in", "Hola, voy a pintar la fachada de un edificio de 4 pisos", 1 * D + 6 * H, undefined],
    ["out", "¡Hola Mónica! Para ese tamaño te recomiendo vinílica exterior 10 años. ¿Tienes los metros?", 1 * D + 6 * H - 10, "op"],
    ["in", "Unos 1,200 m²", 1 * D + 5 * H, undefined],
    ["out", "Serían 20 cubetas: con precio de mayoreo $21,200 MXN. ¿Te preparo la cotización formal?", 1 * D + 4 * H, "op"],
  ] },
  { n: 19, name: "Eduardo Navarro", to: "sofia", stage: "Cliente", amount: 4870, tags: ["Cliente frecuente"], optIn: true, source: "referido", createdDaysAgo: 25, thread: [
    ["in", "Sofía, ya llegó el pedido completo. Excelente servicio", 2 * D + 60, undefined],
    ["out", "¡Gracias Eduardo! Un gusto atenderte siempre 🙌", 2 * D + 50, "op"],
  ] },
  { n: 20, name: "Sandra Reyes", to: "marcela", stage: "Perdido", loss: "eligio_otro", archivedDaysAgo: 3, source: "organico", createdDaysAgo: 8, thread: [
    ["in", "¿Tienen puertas de tambor de 90 cm?", 4 * D + 60, undefined],
    ["out", "Hola Sandra, nos llegan la próxima semana. ¿Te aviso?", 4 * D + 50, "op"],
    ["in", "Ya las conseguí en otro lado, gracias", 4 * D, undefined],
  ] },
  { n: 21, name: "Javier Cruz Pat", to: null, stage: "Nuevo", ai: true, source: "anuncio", ad: "Cemento a precio de mayoreo", createdDaysAgo: 0, thread: [
    ["in", "Vi su anuncio del cemento", 92, undefined],
    ["out", "¡Hola! Soy Martillito, el asistente de Ferretería El Martillo 🔨 El bulto de 50 kg está en $245 y por 10 o más en $232. ¿Cuántos necesitas?", 92, "ai"],
    ["in", "Unos 15, ¿hacen envío?", 90, undefined],
    ["out", "Sí hacemos entregas: el mismo día en la zona si confirmas antes de la 1 pm. El flete local es de $150 MXN y es gratis en compras mayores a $3,000 MXN.", 90, "ai"],
  ] },
  { n: 22, name: "Gabriela Estrada", to: null, stage: "Nuevo", ai: true, unread: 1, source: "anuncio", ad: "Impermeabiliza antes de lluvias", createdDaysAgo: 0, thread: [
    ["in", "Hola, info del impermeabilizante porfa", 2 * H + 20, undefined],
    ["out", "¡Hola! El acrílico 5 años (cubeta 19 L) está en $1,680 y cubre ~40 m². ¿De cuántos metros es tu azotea?", 2 * H + 20, "ai"],
    ["in", "Unos 90 metros, ¿me hacen descuento si llevo 3?", 2 * H + 15, undefined],
  ] },
  { n: 23, name: "Luis Alfonso Kú", to: "diego", stage: "En conversación", optIn: true, source: "organico", createdDaysAgo: 1, thread: [
    ["in", "Diego, ¿tienes block de 15 y arena?", 11 * H + 20, undefined],
    ["out", "Sí, block de 15x20x40 a $16 y el m³ de arena a $480. ¿Cuánto necesitas?", 11 * H, "op"],
    ["in", "800 blocks y 6 m³", 10 * H + 40, undefined],
    ["out", "Perfecto, te lo cotizo con flete y te lo mando en un rato.", 10 * H + 30, "op"],
  ] },
  { n: 24, name: "Norma Canché", to: "paola", stage: "Cliente", amount: 3180, tags: ["Cliente frecuente"], optIn: true, source: "conocido", createdDaysAgo: 30, thread: [
    ["in", "Paola, gracias por la entrega tan rápida 🙏", 2 * D + 4 * H, undefined],
    ["out", "¡A ti Norma! Aquí seguimos para lo que necesites.", 2 * D + 4 * H - 20, "op"],
  ] },
  { n: 25, name: "Pedro Uc", to: "ivan", stage: "Perdido", loss: "nunca_contesto", archivedDaysAgo: 2, source: "anuncio", ad: "Todo para tu remodelación", createdDaysAgo: 9, thread: [
    ["in", "Info de azulejo porfa", 6 * D + 60, undefined],
    ["out", "¡Hola Pedro! ¿Para piso o muro? ¿Cuántos metros?", 6 * D + 50, "op"],
    ["out", "Hola Pedro, ¿sigues interesado en el azulejo?", 5 * D, "op"],
  ] },
  { n: 26, name: "Teresa Hernández", to: "andrea", stage: "En conversación", optIn: true, source: "organico", createdDaysAgo: 1, thread: [
    ["in", "Se me está saliendo el agua del tinaco, ¿qué flotador me recomiendan?", 1 * D + 70, undefined],
    ["out", "Hola Teresa, el flotador Rotoplas universal de $189 queda en casi cualquier tinaco. ¿Te lo aparto?", 1 * D + 60, "op"],
  ] },
  { n: 27, name: "Rodrigo Salinas", to: "hector", stage: "Interesado", amount: 7350, tags: ["Cotización pendiente"], optIn: true, source: "referido", createdDaysAgo: 2, thread: [
    ["in", "Estoy equipando mi taller de herrería. ¿Qué soldadora tienen?", 13 * H + 20, undefined],
    ["out", "Hola Rodrigo, la inversora de 200 A está en $4,950 y la careta electrónica en $890.", 13 * H, "op"],
    ["in", "Cotízame también esmeril de banco y un juego de discos", 12 * H + 30, undefined],
    ["out", "Te quedaría todo en $7,350. Te mando el PDF.", 12 * H, "op"],
  ] },
  { n: 28, name: "Elena Mendoza", to: "lucia", stage: "Nuevo", optIn: true, source: "organico", createdDaysAgo: 1, thread: [
    ["in", "Hola, ¿venden llaves de paso de 1/2?", 20 * H, undefined],
    ["out", "¡Hola Elena! Sí, la de bronce a $145 y la de PVC a $58.", 19 * H + 40, "op"],
  ] },
  { n: 29, name: "Manuel Aké", to: "sofia", stage: "En conversación", source: "organico", createdDaysAgo: 3, thread: [
    ["in", "¿Me pueden cortar la lámina a medida?", 3 * D + 60, undefined],
    ["out", "Sí Manuel, cortamos lámina galvanizada sin costo extra. ¿Qué medidas?", 3 * D + 40, "op"],
  ] },
  { n: 30, name: "Isabel Domínguez", to: "marcela", stage: "Interesado", amount: 5620, tags: ["Cotización pendiente"], optIn: true, source: "anuncio", ad: "Todo para tu remodelación", createdDaysAgo: 1, thread: [
    ["in", "Quiero cotizar piso cerámico para 40 m²", 16 * H + 30, undefined],
    ["out", "Hola Isabel, el cerámico 45x45 beige está en $139 el m². Con pegazulejo y boquilla: $5,620.", 16 * H, "op"],
  ] },
  { n: 31, name: "Arturo Vela", to: null, stage: "Nuevo", source: "organico", unread: 2, createdDaysAgo: 0, thread: [
    ["in", "Buenas noches", 14 * H, undefined],
    ["in", "¿Tienen escalera de tijera de 6 escalones?", 14 * H - 1, undefined],
  ] },
  { n: 32, name: "Ferretera Don Beto", to: "sofia", stage: "Cliente", amount: 15600, tags: ["Mayoreo", "Cliente frecuente", "Pedido grande"], optIn: true, source: "referido", createdDaysAgo: 40, thread: [
    ["in", "Sofía, mándame 60 bultos de cemento y 10 rollos de alambre para la sucursal", 1 * D + 8 * H, undefined],
    ["out", "¡Claro Don Beto! Con su precio de distribuidor: $15,600. Sale mañana temprano.", 1 * D + 8 * H - 15, "op"],
    ["in", "Perfecto, como siempre", 1 * D + 8 * H - 20, undefined],
  ] },
];

/* Contactos históricos (sin chat abierto) para que Resultados tenga embudo. */
const HIST_NAMES = [
  "Raquel Ibarra", "Samuel Tzuc", "Diana Carrillo", "Omar Chablé", "Liliana Paredes", "Ernesto Góngora",
  "Karla Villanueva", "Mauricio Arceo", "Beatriz Loría", "Francisco Nah", "Yolanda Cervera", "Gerardo Mis",
  "Alejandra Puc", "Víctor Cámara", "Rebeca Zapata", "Andrés Cauich", "Maricela Borges", "Julio Sosa",
  "Ximena Rosado", "Sergio Couoh", "Leticia Ancona", "Rubén Tamayo", "Paulina Echeverría", "Cristian Yam",
  "Mireya Aguilar", "Emilio Várguez", "Sofía Aranda", "Ramiro Pool", "Irma Quintal", "Hernán Cetina",
  "Lorena Escalante", "Abel Moo", "Nayeli Castro", "Joaquín Herrera", "Wendy Magaña", "Iker Solís",
  "Rocío Bacab", "Mario Peraza", "Alicia Medina", "Jonathan Euán",
];

/* =================================================================== */

function phoneOf(n: number) {
  const nn = String(n).padStart(2, "0");
  return { display: `+52 998 555 01${nn}`, norm: `52998555 01${nn}`.replace(" ", "") };
}

async function main() {
  const t0 = Date.now();
  console.log("== 1. Registro del Propietario y equipo ==");
  const carlos: Client = { key: "carlos", cookie: "", ip: "10.77.0.1" };
  await call(carlos, "/api/auth/sign-up/email", {
    method: "POST",
    json: { email: USERS[0]!.email, password: PASSWORD, name: USERS[0]!.name },
  });
  clients.carlos = carlos;
  const [org] = await db.select().from(schema.organization);
  const orgId = org!.id;
  await db.update(schema.organization).set({ name: "Ferretería El Martillo" }).where(eq(schema.organization.id, orgId));
  for (const u of USERS.slice(1)) {
    await call(carlos, "/api/settings/team", {
      method: "POST",
      json: { name: u.name, email: u.email, password: PASSWORD, role: u.role },
      // El alta interna pasa por el límite de registros por IP: una IP simulada por alta.
      headers: { "x-forwarded-for": `10.88.0.${ipSeq++}` },
    });
  }
  for (const u of USERS) {
    const [row] = await db.select().from(schema.user).where(eq(schema.user.email, u.email));
    uid[u.key] = row!.id;
  }
  // Fechas de alta creíbles (el equipo existe desde hace meses).
  for (const [i, u] of USERS.entries()) {
    await db.update(schema.user).set({ createdAt: ago((200 - i * 15) * DAY) }).where(eq(schema.user.id, uid[u.key]));
  }

  console.log("== 2. Marca, WhatsApp (mock) y agente ==");
  await call(carlos, "/api/settings/branding", {
    method: "PUT",
    // Marca de la casa: Dashfort by Demfort con su teal (el logo solo se dibuja
    // con el nombre por defecto). El negocio sigue siendo la ferretería.
    json: { name: "Dashfort", accent: "#12999d", currency: "MXN", sidebar: "teal-deep" },
  });
  await call(carlos, "/api/settings/whatsapp", {
    method: "PUT",
    json: { wabaId: WABA, phoneNumberId: PHONE_NUMBER_ID, token: "demo-token-ficticio-0000" },
  });
  await call(carlos, "/api/agent/profile", {
    method: "PUT",
    json: {
      enabled: true,
      name: "Martillito",
      tone: "Cercano y práctico, de ferretería de confianza. Tutea al cliente.",
      instructions:
        "Ayuda a cotizar y cerrar ventas. Da precios en MXN solo si están en el conocimiento. Si piden mayoreo, menciona los mínimos.",
      escalationRules: "Escala a un humano si piden factura, si hay una queja de producto dañado o si lo piden explícitamente.",
      greeting: "¡Hola! Soy Martillito, el asistente de Ferretería El Martillo 🔨",
    },
  });
  const kb: [string, string][] = [
    ["¿Cuál es el horario?", "Lunes a sábado de 8:00 a 19:00 y domingos de 9:00 a 14:00."],
    ["¿Dónde están?", "Av. Hidalgo 245, colonia Centro, con estacionamiento para clientes."],
    ["¿Hacen envíos?", "Mismo día en la zona si confirmas antes de la 1 pm. Flete $150; gratis arriba de $3,000."],
    ["¿Precio del cemento?", "Bulto de 50 kg $245; 10 o más a $232 cada uno."],
    ["¿Formas de pago?", "Efectivo, tarjeta, transferencia SPEI y contra entrega en pedidos locales."],
  ];
  for (const [q, a] of kb) {
    await db.insert(schema.kbEntry).values({ id: newId("kbEntry"), organizationId: orgId, kind: "qa", question: q, answer: a });
  }
  // Agenda (bandera AGENDA): horario semanal para que la pantalla de Citas tenga sentido.
  const week = { start: "09:00", end: "18:00" };
  await db.insert(schema.calendarSettings).values({
    id: newId("calendarSettings"),
    organizationId: orgId,
    weeklyHours: { mon: [week], tue: [week], wed: [week], thu: [week], fri: [week], sat: [{ start: "09:00", end: "14:00" }] },
    slotMinutes: 30,
    meetingLink: "https://meet.example.com/el-martillo-demo",
  }).onConflictDoNothing();

  console.log("== 3. Plantillas (mock de Meta) ==");
  const tpls = [
    { name: "bienvenida", category: "MARKETING", body: "¡Hola {{1}}! 👋 Gracias por escribir a Ferretería El Martillo. Aquí encuentras material de construcción, pintura y herramienta con entrega el mismo día.", st: "APPROVED" },
    { name: "promocion", category: "MARKETING", body: "Hola {{1}}, esta semana tenemos {{2}} a precio especial de mayoreo en Ferretería El Martillo. ¿Te lo apartamos? 🔨", st: "APPROVED" },
    { name: "recordatorio_entrega", category: "UTILITY", body: "Hola {{1}}, tu pedido sale hoy en la camioneta de las {{2}}. Te avisamos cuando vaya en camino.", st: null },
    { name: "oferta_relampago", category: "MARKETING", body: "¡ÚLTIMAS HORAS! Todo al 50% SOLO HOY, compra YA antes de que se acabe!!!", st: "REJECTED" },
  ] as const;
  for (const t of tpls) {
    await call(carlos, "/api/templates", { method: "POST", json: { name: t.name, language: "es_MX", category: t.category, body: t.body } });
    if (t.st) {
      const r = await fetch(`${MOCK}/template-status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wabaId: WABA, name: t.name, language: "es_MX", event: t.st, reason: t.st === "REJECTED" ? "PROMOTIONAL" : undefined }),
      });
      if (!r.ok) throw new Error(`template-status ${t.name}: ${r.status} ${await r.text()}`);
    }
  }
  await db.update(schema.template).set({ createdAt: ago(20 * DAY), updatedAt: ago(19 * DAY) }).where(eq(schema.template.organizationId, orgId));

  console.log("== 4. Etiquetas ==");
  const TAGS: Record<Tag, string> = {} as never;
  const tagColor: Record<Tag, (typeof schema.contactTag.$inferInsert)["color"]> = {
    "Cliente frecuente": "verde",
    "Cotización pendiente": "ambar",
    "Pedido grande": "morado",
    Mayoreo: "azul",
    "Import: clientes-septiembre.csv": "gris",
  };
  for (const [name, color] of Object.entries(tagColor) as [Tag, string][]) {
    const id = newId("contactTag");
    TAGS[name] = id;
    await db.insert(schema.contactTag).values({ id, organizationId: orgId, name, color, createdAt: ago(30 * DAY) });
  }

  console.log("== 5. Contactos, chats, embudo y bitácoras ==");
  const stages = await db.select().from(schema.pipelineStage).where(eq(schema.pipelineStage.organizationId, orgId));
  const stage = (n: Stage) => stages.find((s) => s.name === n)!;
  mkdirSync(path.join(MEDIA_DIR, orgId), { recursive: true });
  const convByN = new Map<number, string>();
  const contactByN = new Map<number, string>();
  let position = 0;
  const openPath: Stage[] = ["Nuevo", "En conversación", "Interesado"];

  async function stageEvents(leadId: string, contactId: string, final: Stage, created: number, last: number, actor: string | null, loss?: string) {
    const steps: Stage[] =
      final === "Cliente" || final === "Perdido"
        ? ["Nuevo", ...(final === "Cliente" ? (["En conversación", "Interesado"] as Stage[]) : (["En conversación"] as Stage[])), final]
        : openPath.slice(0, openPath.indexOf(final) + 1);
    const span = Math.max(created - last, 10 * MIN);
    for (const [i, s] of steps.entries()) {
      const at = i === 0 ? created : created - (span * i) / (steps.length - 1 || 1);
      const st = stage(s);
      const prev = i > 0 ? stage(steps[i - 1]!) : null;
      await db.insert(schema.leadStageEvent).values({
        id: newId("leadStageEvent"),
        organizationId: orgId,
        leadId,
        contactId,
        fromStageId: prev?.id ?? null,
        fromStageName: prev?.name ?? null,
        toStageId: st.id,
        toStageName: st.name,
        toStageKind: st.kind,
        occurredAt: new Date(NOW - at),
        actorUserId: i === 0 ? null : actor,
        source: i === 0 ? "bot" : "dueno",
        lossReason: st.kind === "lost" ? ((loss ?? "otro") as never) : null,
      });
    }
  }

  async function assignment(contactId: string, leadId: string, to: string, at: number, actor: string, from: string | null = null, reason: string | null = null) {
    await db.insert(schema.contactAssignmentEvent).values({
      id: newId("assignmentEvent"),
      organizationId: orgId,
      contactId,
      leadId,
      fromUserId: from,
      toUserId: to,
      actorUserId: actor,
      source: "manual",
      reason,
      occurredAt: new Date(NOW - at),
    });
  }

  async function mediaFromAsset(file: string, caption?: string) {
    const id = newId("mediaAsset");
    const data = readFileSync(path.join(ASSETS, file));
    writeFileSync(path.join(MEDIA_DIR, orgId, id), data);
    await db.insert(schema.mediaAsset).values({
      id,
      organizationId: orgId,
      kind: "image",
      waMediaId: `mockmedia_seed_${id}`,
      mimeType: "image/png",
      fileName: file,
      fileSize: data.byteLength,
      caption: caption ?? null,
      storagePath: `${orgId}/${id}`,
      fetchStatus: "available",
    });
    return id;
  }

  const adRaw = (headline: string) => ({
    source_type: "ad",
    source_id: `1200000${headline.length}00${headline.charCodeAt(0)}`,
    source_url: "https://fb.me/anuncio-demo",
    headline,
    body: "Escríbenos por WhatsApp y cotiza al momento",
    media_type: "image",
  });

  for (const c of CHATS) {
    const ph = phoneOf(c.n);
    const createdMs = (c.createdDaysAgo ?? 0) * DAY + (c.thread[0]![2] + 5) * MIN;
    const firstMs = c.thread[0]![2] * MIN;
    const lastMs = Math.min(...c.thread.map((m) => m[2])) * MIN;
    const lastInMs = Math.min(...c.thread.filter((m) => m[0] === "in").map((m) => m[2])) * MIN;
    const contactId = newId("contact");
    contactByN.set(c.n, contactId);
    const assigned = c.to ? uid[c.to] : null;
    await db.insert(schema.contact).values({
      id: contactId,
      organizationId: orgId,
      waIdentity: ph.norm,
      phone: ph.norm,
      name: c.name,
      notes: c.note ?? null,
      source: c.source ?? "organico",
      waConsent: c.optIn ? "opt_in" : "desconocido",
      waConsentSource: c.optIn ? "Lo pidió por WhatsApp" : null,
      waConsentAt: c.optIn ? new Date(NOW - firstMs + MIN) : null,
      assignedUserId: assigned,
      assignedAt: assigned ? new Date(NOW - firstMs + 3 * MIN) : null,
      archivedAt: c.archivedDaysAgo ? ago(c.archivedDaysAgo * DAY) : null,
      createdAt: new Date(NOW - Math.max(createdMs, firstMs)),
      updatedAt: new Date(NOW - lastMs),
    });
    const conversationId = newId("conversation");
    convByN.set(c.n, conversationId);
    await db.insert(schema.conversation).values({
      id: conversationId,
      organizationId: orgId,
      contactId,
      aiEnabled: c.handoff ? false : c.ai ? true : false,
      handoffAt: c.handoff ? new Date(NOW - c.handoff.minutesAgo * MIN) : null,
      handoffReason: c.handoff?.reason ?? null,
      lastInboundAt: new Date(NOW - lastInMs),
      lastMessageAt: new Date(NOW - lastMs),
      unreadCount: c.unread ?? 0,
      createdAt: new Date(NOW - firstMs),
      updatedAt: new Date(NOW - lastMs),
    });
    let k = 0;
    for (const [dir, text, m, how] of c.thread) {
      const at = new Date(NOW - m * MIN + k++ * 1000);
      let mediaAssetId: string | null = null;
      let type = "text";
      if (how && typeof how === "object") {
        mediaAssetId = await mediaFromAsset(how.img, how.caption);
        type = "image";
      }
      await db.insert(schema.message).values({
        id: newId("message"),
        organizationId: orgId,
        conversationId,
        waMessageId: `wamid.demo.${newId("message")}`,
        direction: dir,
        type,
        text: type === "image" ? (how as { caption?: string }).caption ?? null : text,
        status: dir === "in" ? "delivered" : m < 30 ? "delivered" : "read",
        aiGenerated: how === "ai",
        origin: how === "ai" ? "ai" : how === "tpl" ? "template" : "operator",
        mediaAssetId,
        waTimestamp: at,
        createdAt: at,
      });
    }
    const leadId = newId("lead");
    const st = stage(c.stage);
    await db.insert(schema.lead).values({
      id: leadId,
      organizationId: orgId,
      contactId,
      stageId: st.id,
      position: position++,
      amountCents: c.amount ? c.amount * 100 : null,
      currency: c.amount ? "MXN" : null,
      priority: c.priority ?? null,
      priorityUpdatedAt: c.priority ? new Date(NOW - lastMs) : null,
      lastActivityAt: new Date(NOW - lastMs),
      createdAt: new Date(NOW - Math.max(createdMs, firstMs)),
      updatedAt: new Date(NOW - lastMs),
    });
    await stageEvents(leadId, contactId, c.stage, Math.max(createdMs, firstMs), lastMs, assigned ?? uid.carlos, c.loss);
    if (assigned) {
      const actor = ["diego", "paola", "ivan"].includes(c.to!) ? uid.sofia : uid.carlos;
      if (c.n === 2) {
        await assignment(contactId, leadId, uid.diego, firstMs - 3 * MIN, uid.sofia);
        await assignment(contactId, leadId, uid.paola, firstMs - 2 * HOUR, uid.sofia, uid.diego, "Paola lleva las obras de Cancún");
      } else {
        await assignment(contactId, leadId, assigned, firstMs - 3 * MIN, actor);
      }
    }
    if (c.ad) {
      await db.insert(schema.adAttribution).values({
        id: newId("adAttribution"),
        organizationId: orgId,
        contactId,
        conversationId,
        sourceId: adRaw(c.ad).source_id,
        sourceType: "ad",
        sourceUrl: "https://fb.me/anuncio-demo",
        headline: c.ad,
        body: "Escríbenos por WhatsApp y cotiza al momento",
        mediaType: "image",
        raw: adRaw(c.ad),
        createdAt: new Date(NOW - firstMs),
      });
    }
    for (const tg of c.tags ?? []) {
      await db.insert(schema.contactTagAssignment).values({ organizationId: orgId, contactId, tagId: TAGS[tg], createdAt: new Date(NOW - firstMs + 20 * MIN) });
      await db.insert(schema.contactActivityEvent).values({
        id: newId("activityEvent"), organizationId: orgId, contactId, kind: "tag_added",
        actorUserId: assigned ?? uid.carlos, source: "usuario", detail: { tag: tg }, occurredAt: new Date(NOW - firstMs + 20 * MIN),
      });
    }
    if (c.optIn) {
      await db.insert(schema.contactActivityEvent).values({
        id: newId("activityEvent"), organizationId: orgId, contactId, kind: "consent_changed",
        actorUserId: assigned ?? uid.carlos, source: "usuario",
        detail: { from: "desconocido", to: "opt_in", source: "Lo pidió por WhatsApp" },
        occurredAt: new Date(NOW - firstMs + MIN),
      });
    }
    if (c.handoff) {
      await db.insert(schema.contactActivityEvent).values({
        id: newId("activityEvent"), organizationId: orgId, contactId, kind: "ai_handoff",
        actorUserId: null, source: "bot", detail: { reason: c.handoff.reason },
        occurredAt: new Date(NOW - c.handoff.minutesAgo * MIN),
      });
    }
  }
  // Notas en la línea de tiempo del chat largo (video 04).
  const notas: [number, UKey, string, number][] = [
    [1, "diego", "Pide factura a nombre de Constructora Ramos SA de CV. Constancia ya en el correo.", 4 * D + 285],
    [1, "sofia", "Cliente estratégico: respetar precio de mayoreo en todas las entregas de la obra.", 3 * D],
    [1, "diego", "Segunda entrega programada hoy 11:00 — confirmar con almacén.", 70],
    [2, "paola", "Cotización enviada. Decide el viernes con su cliente.", 1 * D + 190],
    [11, "sofia", "Dirección aprobó $17,200/ton si se lleva 3 toneladas.", 4 * H],
  ];
  for (const [n, who, text, m] of notas) {
    await db.insert(schema.contactActivityEvent).values({
      id: newId("activityEvent"), organizationId: orgId, contactId: contactByN.get(n)!, kind: "note_added",
      actorUserId: uid[who], source: "usuario", detail: { text }, occurredAt: new Date(NOW - m * MIN),
    });
  }
  // Participante (026): Paola también atiende al Ing. Ramos.
  await db.insert(schema.contactParticipant).values({ organizationId: orgId, contactId: contactByN.get(1)!, userId: uid.paola, addedByUserId: uid.sofia, createdAt: new Date(NOW - 4 * DAY) });
  await db.insert(schema.contactParticipantEvent).values({ id: newId("participantEvent"), organizationId: orgId, contactId: contactByN.get(1)!, userId: uid.paola, action: "added", actorUserId: uid.sofia, occurredAt: new Date(NOW - 4 * DAY) });

  console.log("== 6. Histórico para Resultados ==");
  const histOwners: UKey[] = ["diego", "paola", "ivan", "andrea", "hector", "lucia", "sofia", "marcela"];
  const sources = ["anuncio", "organico", "referido", "conocido", "anuncio", "organico"] as const;
  const losses = ["precio", "eligio_otro", "sin_presupuesto", "nunca_contesto", "precio"] as const;
  for (const [i, name] of HIST_NAMES.entries()) {
    const n = 33 + i;
    const ph = phoneOf(n);
    const contactId = newId("contact");
    const owner = histOwners[i % histOwners.length]!;
    const createdMs = (3 + ((i * 37) % 52)) * DAY + (i % 7) * HOUR;
    const final: Stage = i % 5 === 0 || i % 5 === 3 ? "Cliente" : i % 5 === 1 ? "Perdido" : i % 5 === 2 ? "Interesado" : "Cliente";
    const endMs = Math.max(createdMs - (2 + (i % 9)) * DAY, 6 * HOUR);
    const amount = final === "Perdido" ? null : 1500 + ((i * 7919) % 28000);
    await db.insert(schema.contact).values({
      id: contactId, organizationId: orgId, waIdentity: ph.norm, phone: ph.norm, name,
      source: sources[i % sources.length], waConsent: i % 3 === 0 ? "opt_in" : "desconocido",
      waConsentSource: i % 3 === 0 ? "Formulario de mostrador" : null,
      assignedUserId: uid[owner], assignedAt: new Date(NOW - createdMs + HOUR),
      createdAt: new Date(NOW - createdMs), updatedAt: new Date(NOW - endMs),
    });
    const leadId = newId("lead");
    await db.insert(schema.lead).values({
      id: leadId, organizationId: orgId, contactId, stageId: stage(final).id, position: position++,
      amountCents: amount ? Math.round(amount) * 100 : null, currency: amount ? "MXN" : null,
      lastActivityAt: new Date(NOW - endMs), createdAt: new Date(NOW - createdMs), updatedAt: new Date(NOW - endMs),
    });
    await stageEvents(leadId, contactId, final, createdMs, endMs, uid[owner], losses[i % losses.length]);
    await assignment(contactId, leadId, uid[owner], createdMs - HOUR, uid.sofia);
    if (i < 6) {
      await db.insert(schema.contactTagAssignment).values({ organizationId: orgId, contactId, tagId: TAGS["Import: clientes-septiembre.csv"], createdAt: ago(20 * DAY) });
    }
  }

  console.log("== 7. Conocimientos ==");
  const know: { title: string; body: string; tags: string[]; file?: string }[] = [
    { title: "Horarios de atención", tags: ["tienda"], body: "🕗 Lunes a sábado: 8:00 a 19:00\n🕘 Domingo: 9:00 a 14:00\n📍 Av. Hidalgo 245, colonia Centro (estacionamiento gratuito en la calle lateral)." },
    { title: "Política de devoluciones", tags: ["postventa"], body: "Aceptamos devoluciones dentro de los 30 días con ticket y el producto en su empaque. Herramienta eléctrica con falla de fábrica: la revisamos por garantía sin costo y, si procede, se cambia al momento." },
    { title: "Catálogo principal", tags: ["ventas", "precios"], body: "Te comparto nuestro catálogo con precios de menudeo y mayoreo de septiembre 📄", file: "catalogo-el-martillo.pdf" },
    { title: "Formas de pago", tags: ["ventas"], body: "Aceptamos efectivo, tarjeta de crédito y débito, transferencia SPEI (CLABE terminación 4821) y pago contra entrega en pedidos locales. Facturamos el mismo día." },
    { title: "Zona de entrega", tags: ["logística"], body: "🚚 Entrega el mismo día en Cancún si confirmas antes de la 1 pm. Puerto Morelos: martes y viernes. Playa del Carmen y Tulum: pedidos mayores a $10,000. Flete local $150; gratis en compras mayores a $3,000." },
  ];
  for (const k of know) {
    if (k.file) {
      const fd = new FormData();
      fd.set("title", k.title);
      fd.set("body", k.body);
      fd.set("tags", k.tags.join(","));
      fd.set("file", new File([readFileSync(path.join(ASSETS, k.file))], k.file, { type: "application/pdf" }));
      await call(carlos, "/api/knowledge", { method: "POST", body: fd });
    } else {
      await call(carlos, "/api/knowledge", { method: "POST", json: { title: k.title, body: k.body, tags: k.tags } });
    }
  }
  await db.update(schema.knowledgeEntry).set({ createdAt: ago(15 * DAY), updatedAt: ago(10 * DAY) }).where(eq(schema.knowledgeEntry.organizationId, orgId));

  console.log("== 8. Citas (agenda) ==");
  const bookingSpecs: [number, number, "agendada" | "realizada" | "no_show", "ai" | "manual"][] = [
    [2, -1 * DAY - 3 * HOUR, "agendada", "manual"],
    [11, -2 * DAY - 5 * HOUR, "agendada", "ai"],
    [27, -26 * HOUR, "agendada", "ai"],
    [1, 5 * DAY + 2 * HOUR, "realizada", "manual"],
    [18, 3 * DAY + 4 * HOUR, "realizada", "ai"],
    [30, 2 * DAY + 1 * HOUR, "no_show", "ai"],
  ];
  for (const [n, whenAgo, status, source] of bookingSpecs) {
    const at = new Date(Math.floor((NOW - whenAgo) / (30 * MIN)) * 30 * MIN);
    await db.insert(schema.booking).values({
      id: newId("booking"), organizationId: orgId, kind: "session", status, source,
      contactId: contactByN.get(n)!, conversationId: convByN.get(n)!,
      scheduledAt: at, durationMinutes: 30, connector: "enlace-fijo",
      meetingLink: "https://meet.example.com/el-martillo-demo",
      notes: "Visita a obra para medir y cotizar",
    });
  }

  console.log("== 9. Chat de equipo ==");
  const threads = (await call(carlos, "/api/team-chat/threads")) as { threads: { id: string; kind: string }[] };
  const avisos = threads.threads.find((t) => t.kind === "announcements")!.id;
  const group = async (name: string, members: UKey[]) =>
    (await call(carlos, "/api/team-chat/groups", { method: "POST", json: { name, memberIds: members.filter((m) => m !== "carlos").map((m) => uid[m]) } }))
      .threadId as string;
  const ventas = await group("Equipo de ventas", ["carlos", "sofia", "diego", "paola", "ivan"]);
  // "Postventa" no incluye al Propietario: lo crea Carlos (queda como miembro) y luego sale.
  const postventa = await group("Postventa", ["carlos", "marcela", "andrea", "hector", "lucia"]);
  const coordinacion = await group("Coordinación", ["carlos", "sofia", "marcela"]);
  if (!ventas || !postventa || !coordinacion) throw new Error("No se pudieron crear los grupos");

  const posted: { thread: string; id: string; minutesAgo: number }[] = [];
  const mention = (n: number) => `@[chat:${convByN.get(n)}]`;
  async function post(thread: string, who: UKey, body: string, minutesAgo: number, reactions: [UKey, string][] = [], file?: string) {
    const c = await as(who);
    let msg: { id: string };
    if (file) {
      const fd = new FormData();
      fd.set("body", body);
      fd.set("file", new File([readFileSync(path.join(ASSETS, file))], file, { type: file.endsWith(".pdf") ? "application/pdf" : "image/png" }));
      msg = (await call(c, `/api/team-chat/threads/${thread}/messages`, { method: "POST", body: fd })).message;
    } else {
      msg = (await call(c, `/api/team-chat/threads/${thread}/messages`, { method: "POST", json: { body } })).message;
    }
    posted.push({ thread, id: msg.id, minutesAgo });
    for (const [r, emoji] of reactions) {
      await call(await as(r), `/api/team-chat/messages/${msg.id}/reactions`, { method: "PUT", json: { emoji } });
    }
  }

  // Avisos (todos los 9 lo ven por diseño)
  await post(avisos, "carlos", "¡Buenos días equipo! 🎉 Cerramos agosto con récord de ventas: +18% contra julio. Gracias a todos por el esfuerzo 🙌", 3 * D + 60, [["sofia", "🎉"], ["diego", "🎉"], ["paola", "🙌"], ["ivan", "🎉"], ["andrea", "❤️"], ["hector", "👏"], ["lucia", "🎉"], ["marcela", "👏"]]);
  await post(avisos, "sofia", "Recordatorio: a partir del lunes todas las cotizaciones mayores a $10,000 van con la etiqueta «Pedido grande» para darles seguimiento 📌", 2 * D + 200, [["diego", "👍"], ["paola", "👍"], ["ivan", "👍"], ["hector", "✅"]]);
  await post(avisos, "carlos", "Llegó el nuevo lote de rotomartillos 20V MAX. Ya están en el sistema a $3,450 y $3,280 por 3 piezas o más 🔨", 2 * D + 30, [["paola", "🔥"], ["diego", "🔥"], ["lucia", "👍"]]);
  await post(avisos, "sofia", "El viernes cerramos a las 17:00 por inventario. Avisen a sus clientes con entregas programadas ese día 🙏", 1 * D + 300, [["marcela", "👍"], ["andrea", "👍"], ["hector", "👍"], ["lucia", "✅"], ["ivan", "👍"]]);
  await post(avisos, "carlos", "Les comparto la lista de precios de mayoreo de octubre (borrador). Cualquier duda con Sofía 📄", 1 * D + 60, [["sofia", "👀"], ["diego", "👍"], ["paola", "👍"]], "lista-precios-mayoreo.pdf");
  await post(avisos, "sofia", "¡Felicidades a Diego por cerrar el pedido de Constructora Ramos! 🏆 Casi $120 mil en una sola venta 💪", 5 * H, [["carlos", "🏆"], ["paola", "🎉"], ["ivan", "💪"], ["andrea", "🎉"], ["hector", "👏"], ["lucia", "🎉"], ["marcela", "👏"]]);
  await post(avisos, "carlos", "Hoy tenemos promoción de impermeabilizante: 2x$3,200. Si les preguntan por azoteas, ofrézcanla ☔", 95, [["lucia", "👍"], ["andrea", "👍"]]);

  // Equipo de ventas
  const V: [UKey, string, number, [UKey, string][]?, string?][] = [
    ["sofia", "Equipo, ¿cómo vamos con las cotizaciones de la semana? 📊", 6 * H + 30],
    ["diego", "Yo tengo 3 abiertas. La más fuerte es la de " + mention(15) + ", 40 bultos de cemento", 6 * H + 20, [["sofia", "👍"]]],
    ["paola", "La arquitecta " + mention(2) + " ya casi cierra, pide que le respetemos precio hasta el viernes", 6 * H + 10],
    ["sofia", "Sí, respétaselo Paola. Es una obra grande y puede traer más 😉", 6 * H, [["paola", "🙌"]]],
    ["ivan", "Yo sigo con Hugo, el de la fachada. Le mandé la cotización con sellador", 5 * H + 40],
    ["carlos", "Muy bien todos. Recuerden ofrecer el flete gratis arriba de $3,000, está cerrando muchas ventas 🚚", 5 * H + 20, [["diego", "👍"], ["ivan", "👍"], ["paola", "👍"]]],
    ["diego", "Les paso la foto del rotomartillo nuevo para que la usen con clientes", 4 * H, [["paola", "🔥"]], "producto-rotomartillo.png"],
    ["paola", "¡Gracias Diego! Justo me la pidieron 😄", 3 * H + 50],
    ["sofia", "Diego, ¿ya viste el chat de " + mention(6) + "? El bot lo pasó a humano, es una lijadora dañada", 30, [["diego", "👀"]]],
    ["diego", "Voy en eso 🏃‍♂️", 28],
    ["ivan", "¿Alguien tiene existencia de varilla de 1/2? Me la están pidiendo", 15],
  ];
  for (const [w, b, m, r, f] of V) await post(ventas, w, b, m, r ?? [], f);

  // Postventa
  const P: [UKey, string, number, [UKey, string][]?][] = [
    ["marcela", "Buenos días, equipo de postventa ☀️ Hoy hay 4 garantías por revisar", 8 * H],
    ["marcela", "Andrea, ¿tomas la garantía del taladro de " + mention(12) + "?", 7 * H + 55],
    ["andrea", "Sí, yo la tomo 👍", 7 * H + 50, [["marcela", "🙏"]]],
    ["hector", "Yo ya facturé a " + mention(9) + ", quedó cerrado ✅", 7 * H + 20, [["marcela", "👏"]]],
    ["lucia", "Patricia Vázquez pregunta si llegamos a Puerto Morelos. Le dije que martes y viernes, ¿correcto?", 3 * H + 45],
    ["marcela", "Correcto Lucía 👌 Y si el pedido pasa de $10,000 podemos ir otro día", 3 * H + 40, [["lucia", "🙌"]]],
    ["andrea", "Carmen Ortiz ya recibió su pedido, muy contenta 😊", 1 * D + 20],
    ["hector", "¿Quién tiene la llave de la bodega 2? Llegó mercancía", 2 * H, [["andrea", "😅"]]],
    ["marcela", "La tengo yo, ahorita te la llevo 🔑", 110],
    ["lucia", "Gracias Marce 🙏", 100],
  ];
  for (const [w, b, m, r] of P) await post(postventa, w, b, m, r ?? []);

  // Coordinación
  const C: [UKey, string, number, [UKey, string][]?][] = [
    ["carlos", "Sofía, Marcela: quiero revisar el reparto de chats nuevos esta semana", 1 * D + 120],
    ["sofia", "Va. Diego trae mucha carga, le pasé la obra de Cancún a Paola", 1 * D + 110, [["carlos", "👍"]]],
    ["marcela", "En postventa vamos bien. Héctor está cubriendo facturación", 1 * D + 100],
    ["carlos", "Perfecto. ¿Cómo vamos contra la meta del mes? 🎯", 1 * D + 60],
    ["sofia", "Al 86% y faltan 5 días. Con lo de " + mention(11) + " pasamos la meta 💪", 1 * D + 50, [["carlos", "🔥"], ["marcela", "💪"]]],
    ["marcela", "Propongo llamar esta semana a los clientes frecuentes con la promo de impermeabilizante", 1 * D + 40],
    ["carlos", "Me gusta. Armen la campaña con la plantilla de promoción, solo a quienes aceptaron mensajes ✅", 1 * D + 30, [["sofia", "👍"], ["marcela", "👍"]]],
    ["sofia", "La preparo hoy y se las muestro antes de enviar", 1 * D + 20],
    ["marcela", "¿La revisamos mañana a las 10?", 45],
  ];
  for (const [w, b, m, r] of C) await post(coordinacion, w, b, m, r ?? []);

  // Directos
  async function direct(a: UKey, b: UKey) {
    const r = await call(await as(a), "/api/team-chat/threads", { method: "POST", json: { userId: uid[b] } });
    return r.threadId as string;
  }
  const dmSofiaCarlos = await direct("sofia", "carlos");
  for (const [w, b, m] of [
    ["sofia", "Carlos, ¿me autorizas precio especial de varilla para Fernando Castillo? Serían 3 toneladas", 4 * H + 30],
    ["carlos", "¿A cuánto lo quiere?", 4 * H + 20],
    ["sofia", "$17,200 la tonelada", 4 * H + 15],
    ["carlos", "Va, autorizado 👍 Es buen cliente", 4 * H + 10],
    ["sofia", "¡Gracias! Le aviso", 4 * H + 5],
    ["sofia", "Por cierto, ya quedó la campaña lista para revisión 📣", 20],
  ] as [UKey, string, number][]) await post(dmSofiaCarlos, w, b, m);
  const dmDiegoPaola = await direct("diego", "paola");
  for (const [w, b, m] of [
    ["diego", "Pao, te pasé el chat de la arquitecta Solís, ahí va la cotización completa", 2 * D],
    ["paola", "¡Gracias Diego! Ya la vi, está muy completa 🙌", 2 * D - 10],
    ["diego", "Ojo que pidió el impermeabilizante en terracota", 2 * D - 20],
    ["paola", "Anotado 📝", 2 * D - 25],
    ["paola", "¿Me cubres mañana de 2 a 3? Tengo cita con el dentista 🦷", 50],
  ] as [UKey, string, number][]) await post(dmDiegoPaola, w, b, m);
  const dmMarcelaHector = await direct("marcela", "hector");
  for (const [w, b, m] of [
    ["marcela", "Héctor, ¿puedes cubrir facturación esta semana?", 1 * D + 200],
    ["hector", "Claro Marcela, sin problema", 1 * D + 190],
    ["marcela", "Mil gracias 🙏", 1 * D + 185],
  ] as [UKey, string, number][]) await post(dmMarcelaHector, w, b, m);
  const dmCarlosDiego = await direct("carlos", "diego");
  for (const [w, b, m] of [
    ["carlos", "Diego, excelente cierre con el Ing. Ramos 👏", 5 * H - 5],
    ["diego", "¡Gracias Carlos! Todavía viene otra etapa del fraccionamiento", 5 * H - 15],
  ] as [UKey, string, number][]) await post(dmCarlosDiego, w, b, m);

  // Carlos no pertenece a Postventa: sale del grupo (lo creó él para armarlo).
  await db.delete(schema.teamChatMember).where(and(eq(schema.teamChatMember.threadId, postventa), eq(schema.teamChatMember.userId, uid.carlos)));

  // Fechar hacia atrás: el hilo de chat de equipo ocurre en los últimos días.
  for (const p of posted) {
    const at = new Date(NOW - p.minutesAgo * MIN);
    await db.update(schema.teamChatMessage).set({ createdAt: at }).where(eq(schema.teamChatMessage.id, p.id));
    await db.update(schema.teamChatReaction).set({ createdAt: new Date(at.getTime() + 5 * MIN) }).where(eq(schema.teamChatReaction.messageId, p.id));
  }
  await sqlc`update team_chat_thread t set last_message_at = (select max(created_at) from team_chat_message m where m.thread_id = t.id), created_at = coalesce((select min(created_at) from team_chat_message m where m.thread_id = t.id), t.created_at) - interval '1 day' where t.organization_id = ${orgId}`;
  await sqlc`update team_chat_attachment a set created_at = m.created_at from team_chat_message m where m.attachment_id = a.id`;

  // No leídos: cada quien leyó hasta cierto punto (los globos se ven para varios).
  await sqlc`delete from team_chat_read_state where organization_id = ${orgId}`;
  const readUpTo = async (thread: string, who: UKey, minutesAgo: number) => {
    await db.insert(schema.teamChatReadState).values({ organizationId: orgId, threadId: thread, userId: uid[who], lastReadAt: new Date(NOW - minutesAgo * MIN) });
  };
  // Carlos: le faltan lo último de ventas, coordinación y el directo de Sofía.
  await readUpTo(avisos, "carlos", 90);
  await readUpTo(ventas, "carlos", 3 * H);
  await readUpTo(coordinacion, "carlos", 1 * D + 25);
  await readUpTo(dmSofiaCarlos, "carlos", 4 * H + 6);
  await readUpTo(dmCarlosDiego, "carlos", 1);
  // Diego: avisos a medias, ventas al día salvo Iván, directo de Paola sin leer.
  await readUpTo(avisos, "diego", 1 * D);
  await readUpTo(ventas, "diego", 20);
  await readUpTo(dmDiegoPaola, "diego", 2 * D - 30);
  await readUpTo(dmCarlosDiego, "diego", 1);
  // Sofía casi al día.
  for (const t of [avisos, ventas, coordinacion, dmSofiaCarlos]) await readUpTo(t, "sofia", 1);
  // Marcela al día en postventa, coordinación pendiente.
  await readUpTo(avisos, "marcela", 1);
  await readUpTo(postventa, "marcela", 1);
  await readUpTo(coordinacion, "marcela", 1 * D + 45);
  await readUpTo(dmMarcelaHector, "marcela", 1);
  // Los demás asesores: sin leer los avisos recientes.
  for (const w of ["paola", "ivan", "andrea", "hector", "lucia"] as UKey[]) await readUpTo(avisos, w, 2 * D);
  await readUpTo(ventas, "paola", 3 * H);
  await readUpTo(ventas, "ivan", 1);
  await readUpTo(postventa, "andrea", 2 * H);
  await readUpTo(postventa, "hector", 1);
  await readUpTo(postventa, "lucia", 99);
  await readUpTo(dmDiegoPaola, "paola", 1);
  await readUpTo(dmMarcelaHector, "hector", 1);

  // Preferencias: Carlos arranca con el menú expandido.
  await db.insert(schema.userPreference).values({ organizationId: orgId, userId: uid.carlos, navMode: "expanded", navCollapsed: false }).onConflictDoNothing();

  // Sesiones de la siembra: fuera (nadie queda "conectado" por el script).
  await db.delete(schema.session);

  /* ---------- resumen ---------- */
  const q = async (s: string) => Number((await sqlc.unsafe(s))[0]!.n);
  const summary = {
    usuarios: await q(`select count(*) n from member`),
    contactos: await q(`select count(*) n from contact`),
    chats: await q(`select count(*) n from conversation`),
    chatsSinLeer: await q(`select count(*) n from conversation where unread_count > 0`),
    chatsBotActivo: await q(`select count(*) n from conversation where ai_enabled`),
    chatsHandoff: await q(`select count(*) n from conversation where handoff_at is not null`),
    chatsArchivados: await q(`select count(*) n from contact c join conversation v on v.contact_id=c.id where c.archived_at is not null`),
    chatsSinAsignar: await q(`select count(*) n from contact c join conversation v on v.contact_id=c.id where c.assigned_user_id is null`),
    mensajes: await q(`select count(*) n from message`),
    optIn: await q(`select count(*) n from contact where wa_consent='opt_in'`),
    etiquetas: await q(`select count(*) n from contact_tag`),
    plantillas: (await sqlc`select name, status from template order by name`).map((r) => `${r.name}:${r.status}`).join(", "),
    conocimientos: await q(`select count(*) n from knowledge_entry`),
    citas: await q(`select count(*) n from booking`),
    hilosEquipo: await q(`select count(*) n from team_chat_thread`),
    mensajesEquipo: await q(`select count(*) n from team_chat_message`),
    reacciones: await q(`select count(*) n from team_chat_reaction`),
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`[seed] listo en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  writeFileSync(path.resolve("marketing/.seed-ids.json"), JSON.stringify({ orgId, uid, conv: Object.fromEntries(convByN), contact: Object.fromEntries(contactByN), threads: { avisos, ventas, postventa, coordinacion, dmSofiaCarlos, dmDiegoPaola, dmMarcelaHector, dmCarlosDiego }, phoneNumberId: PHONE_NUMBER_ID, wabaId: WABA }, null, 2));
  await sqlc.end();
}

main().catch(async (e) => {
  console.error(e);
  await sqlc.end();
  process.exit(1);
});
