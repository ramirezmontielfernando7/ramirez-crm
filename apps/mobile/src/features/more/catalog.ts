import type { Role } from "../../domain/access";
export type Setting = {
  label: string;
  hint: string;
  route: string;
  owner?: boolean;
};
export const settingGroups: readonly {
  title: string;
  items: readonly Setting[];
}[] = [
  {
    title: "Negocio",
    items: [
      {
        label: "Canales y conexiones",
        hint: "WhatsApp, plantillas, conexión",
        route: "/channel-settings",
      },
      { label: "Equipo y permisos", hint: "Miembros y roles", route: "/team" },
      {
        label: "Anuncios (Meta)",
        hint: "CAPI y atribución",
        route: "/ads-settings",
        owner: true,
      },
      {
        label: "Uso y plan",
        hint: "Consumo y plan",
        route: "/usage",
        owner: true,
      },
    ],
  },
  {
    title: "Atención y ventas",
    items: [
      { label: "Etiquetas", hint: "", route: "/tags" },
      {
        label: "Respuestas rápidas",
        hint: "Atajos con /",
        route: "/quick-replies",
      },
      { label: "Motivos de pérdida", hint: "", route: "/loss-reasons" },
      {
        label: "Agenda y conectores",
        hint: "Zoom, Meet",
        route: "/calendar-settings",
      },
      {
        label: "Chat de equipo",
        hint: "Grupos y supervisión",
        route: "/internal-settings",
        owner: true,
      },
      { label: "Bajas automáticas", hint: "STOP / BAJA", route: "/optout" },
    ],
  },
  {
    title: "IA conectada",
    items: [
      {
        label: "Mi IA",
        hint: "Conecta tu Claude o ChatGPT · simulado",
        route: "/my-ai",
      },
      {
        label: "Conector del equipo",
        hint: "Solo Propietario",
        route: "/ai-connector-settings",
        owner: true,
      },
    ],
  },
  {
    title: "Personal",
    items: [
      {
        label: "Mi número",
        hint: "WhatsApp personal · simulado",
        route: "/personal-settings",
      },
      {
        label: "Notificaciones",
        hint: "Sonido y avisos",
        route: "/notification-settings",
      },
      { label: "Apariencia", hint: "Tema, letra, chat", route: "/appearance" },
      {
        label: "Marca",
        hint: "Nombre, logo y color",
        route: "/brand",
        owner: true,
      },
      {
        label: "Navegación",
        hint: "Menú por rol",
        route: "/navigation-settings",
        owner: true,
      },
    ],
  },
];
export function settingsFor(role: Role, query = "") {
  if (role === "advisor") return [];
  const q = query
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return settingGroups
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (i) =>
          (!i.owner || role === "owner") &&
          `${i.label} ${i.hint}`
            .toLocaleLowerCase("es")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .includes(q),
      ),
    }))
    .filter((g) => g.items.length);
}
