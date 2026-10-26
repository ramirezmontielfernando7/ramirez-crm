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
  becomeCompany: "Pasar este número a la empresa",
  becomeCompanyConfirm:
    "¿Pasar tu número a la empresa? Tu coordinador y el propietario podrán ver sus chats y decidir sus ajustes. Solo ellos lo pueden volver a hacer personal.",
} as const;
