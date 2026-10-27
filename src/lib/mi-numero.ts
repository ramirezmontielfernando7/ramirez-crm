/**
 * Mi número (046) — Los textos de sus pantallas, en un solo lugar (la maqueta
 * aprobada por Fer). Jamás nombran el servidor ni la tecnología de debajo.
 */

export type NumberSwitch = "shareClients" | "overlapNotice" | "allowViewRequests" | "aiReplies";

export const SWITCH_TEXT: Record<NumberSwitch, { title: string; on: string; off: string }> = {
  shareClients: {
    title: "Compartir mis clientes con la empresa",
    on: "Te aparece el botón «Es cliente» en tus chats. Solo los chats que marques pasan al CRM (ficha del cliente y embudo) y tu coordinador puede verlos.",
    off: "Apagado: todos tus chats se quedan privados. Nada sale de aquí.",
  },
  overlapNotice: {
    title: "Avisar que también hablo con este cliente",
    on: "Solo en chats que marcaste como cliente. Si un compañero habla con el mismo cliente, los dos ven «También habla con…». Nunca se muestra lo que se escribieron.",
    off: "Es parejo: si lo apagas, tampoco ves los avisos de tus compañeros.",
  },
  allowViewRequests: {
    title: "Permitir solicitudes para ver mis chats",
    on: "Un compañero o tu coordinador te puede pedir ver un chat de cliente. Tú aceptas o rechazas cada vez; si aceptas, solo puede leer y le quitas el acceso cuando quieras.",
    off: "Apagado: nadie puede ni pedírtelo.",
  },
  aiReplies: {
    title: "La IA contesta mis chats",
    on: "La IA responde por tu número, solo en chats que marcaste como cliente. Cuando tú escribes, la IA se pausa en ese chat.",
    off: "Apagado: solo tú contestas.",
  },
};

export const SWITCH_ORDER: readonly NumberSwitch[] = ["shareClients", "overlapNotice", "allowViewRequests", "aiReplies"];

export const KIND_LABEL = { personal: "Personal", empresa: "De la empresa" } as const;

export const MI_NUMERO_TEXT = {
  pageIntro:
    "Tu WhatsApp vinculado a Dashfort, como WhatsApp Web. Por defecto todo es privado: nadie más ve tus chats y nada pasa al CRM hasta que tú lo decidas aquí.",
  personalOnly:
    "Solo tú puedes cambiar estos ajustes. Ni tu coordinador ni el propietario de la cuenta pueden verlos ni cambiarlos, porque es tu número personal.",
  companyDecides:
    "Este número es de la empresa: estos ajustes los decide tu coordinador o el propietario de la cuenta, y ellos pueden ver sus chats.",
  noViews: "Nadie ha visto tus chats.",
  viewsIntro: "Cada vez que alguien abre un chat tuyo con tu permiso, queda anotado aquí.",
  leaving:
    "Los chats que marcaste como cliente se quedan con la empresa para que otro compañero los atienda. Tus chats privados se borran de Dashfort. Tu WhatsApp en el celular no cambia.",
  storage:
    "Tus mensajes se guardan en el servidor de Dashfort para poder contestarlos desde aquí, pero nadie los puede ver dentro de la app sin tu permiso. Los grupos de WhatsApp no entran.",
  noticeTitle: "Antes de vincular tu número",
  notice: [
    "Tus chats son privados: nadie del equipo los ve, salvo lo que tú decidas compartir abajo.",
    "Usa tu WhatsApp con cuidado: mandar muchos mensajes a gente que no te conoce puede hacer que WhatsApp bloquee tu número. Dashfort pone pausas para cuidarlo.",
    "Si dejas la empresa, los chats que marcaste como cliente se quedan con ella y tus chats privados se borran de Dashfort.",
  ],
  noticeAccept: "Entiendo y acepto",
  teamIntro:
    "Da a cada persona su propio número de WhatsApp en Dashfort. Tú autorizas; cada quien escanea su código desde su cuenta. Nunca ves los chats de un número personal.",
  kindHelp: {
    personal: "Personal: el número es de la persona. Solo ella ve sus chats y decide qué comparte.",
    empresa: "De la empresa: un chip de la empresa. Tú y los coordinadores deciden sus ajustes y pueden ver sus chats.",
  },
  revokeConfirm: (name: string) =>
    `¿Revocar el número de ${name}? Se desvincula de Dashfort. Los chats que marcó como cliente pasan a la Bandeja de la empresa; sus chats privados se borran. Su WhatsApp en el celular no cambia.`,
  becomeCompany: "Pasar este número a la empresa",
  becomeCompanyConfirm:
    "¿Pasar tu número a la empresa? Tu coordinador y el propietario podrán ver sus chats y decidir sus ajustes. Solo ellos lo pueden volver a hacer personal.",
} as const;

/** Mi número (046), PR 4 — La pestaña «Mi número» de la Bandeja. */
export const MY_CHATS_TEXT = {
  privacy: "Solo tú ves estos chats. Nada pasa al CRM hasta que marques «Es cliente».",
  empty: "Aún no hay chats. Lo que te escriban a tu número aparece aquí.",
  pick: "Elige un chat de tu número",
  markClient: "Es cliente",
  markClientHelp: "Pasa este contacto al CRM (ficha y embudo) y queda a tu cargo si nadie lo atiende. El chat sigue siendo tuyo.",
  markClientConfirm:
    "¿Marcar como cliente? El contacto pasa al CRM (ficha y embudo). Tu coordinador podrá verlo como cliente; tus demás chats siguen privados.",
  shareOff: "Para marcar clientes, enciende «Compartir mis clientes con la empresa» en Ajustes → Mi número.",
  client: "Cliente",
  private: "Privado",
  placeholder: "Escribe por tu número…",
  queued: "En cola: sale en unos segundos para cuidar tu número.",
} as const;

/** Mi número (046), PR 6 — «También habla con…», solicitudes y bitácora. */
export const ACCESS_TEXT = {
  alsoTalks: (name: string, since: string) => `También habla con ${name} · desde el ${since}`,
  ask: "Pedir ver el chat",
  asked: "Solicitud enviada",
  rejected: "No aceptó",
  open: "Ver su chat",
  requestTitle: (who: string, contact: string) => `${who} quiere ver tu chat con ${contact}`,
  requestBody: (who: string, role: string | null = null) =>
    role
      ? `${who} es ${role} y quiere ver tu conversación con este cliente para darle seguimiento.`
      : `${who} también habla con este cliente y quiere ver tu conversación para darle seguimiento sin repetirle cosas.`,
  requestRules: [
    "Solo podrá leer, no escribir.",
    "Solo este chat, ninguno más.",
    "Le quitas el acceso cuando quieras, desde «Mi número».",
    "Queda anotado en «Quién ha visto tus chats».",
  ],
  accept: "Aceptar, solo lectura",
  reject: "Rechazar",
  requestFoot: "Si apagas «Permitir solicitudes para ver mis chats», nadie podrá pedírtelo.",
  pendingBanner: (n: number) => (n === 1 ? "1 persona quiere ver un chat tuyo" : `${n} personas quieren ver chats tuyos`),
  review: "Revisar",
  sharedTitle: "Compartidos contigo",
  sharedRow: (owner: string) => `Chat de ${owner} · solo lectura`,
  readOnly: (owner: string) => `Chat de ${owner}. Solo lectura: tu vista queda anotada para ${owner}.`,
  grantsTitle: "Pueden ver tus chats",
  grantRow: (who: string, contact: string) => `${who} puede ver tu chat con ${contact}`,
  removeAccess: "Quitar acceso",
  viewRow: (who: string, contact: string) => `${who} vio tu chat con ${contact}`,
} as const;

/** Mi número (046), PR 7 — Lo que ve quien supervisa los números del equipo. */
export const TEAM_TEXT = {
  note: "Los números de la empresa los lees en solo lectura. Los personales son privados: solo puedes pedir ver los chats de cliente que su dueño permita.",
  companyTitle: (owner: string, label: string | null) => `Número de la empresa · ${label ?? owner}`,
  companyEmpty: "Este número aún no tiene chats.",
  companyRow: (owner: string) => `Lo lleva ${owner}`,
  companyReadOnly: (owner: string) => `Solo lectura: contesta ${owner} desde su número. Tu vista queda anotada.`,
  requestTitle: "Chats de cliente en números personales",
  requestHelp: "Su dueño los marcó «Es cliente» y acepta solicitudes. Decide él; solo podrías leer.",
  requestRow: (owner: string, since: string) => `De ${owner} · ${since}`,
  nothing: "Nadie del equipo tiene chats que puedas ver o pedir todavía.",
  pick: "Elige un chat",
} as const;
