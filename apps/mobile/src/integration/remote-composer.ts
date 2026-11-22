import { isRemoteId, crmRecord } from "./remote-crm-contract";
import type { WireConversation } from "./wire";

const variable = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
export const TEMPLATE_VALUE_MAX = 500;

export function templateVariables(body: string): string[] | null {
  const names = [
    ...new Set([...body.matchAll(variable)].map((match) => match[1]!)),
  ];
  if (names.length > 10) return null;
  if (names.every((name) => /^\d+$/.test(name))) {
    const ordered = names.map(Number).sort((a, b) => a - b);
    if (ordered.some((value, i) => value !== i + 1)) return null;
    return ordered.map(String);
  }
  return names;
}

export type RemoteTemplate = Readonly<{
  id: string;
  name: string;
  language: string;
  body: string;
  variables: readonly string[];
  header: string | null;
  image: boolean;
  footer: string | null;
  buttons: readonly string[];
}>;

export function templatesResponse(raw: unknown): RemoteTemplate[] {
  const rows = crmRecord(raw).templates;
  if (!Array.isArray(rows)) throw new Error("Invalid template catalog");
  return rows.flatMap((item) => {
    const row = crmRecord(item);
    if (
      row.status !== "approved" ||
      row.sendable !== true ||
      !isRemoteId(row.id) ||
      typeof row.name !== "string" ||
      typeof row.language !== "string" ||
      typeof row.body !== "string"
    )
      return [];
    const variables = templateVariables(row.body);
    if (!variables) return [];
    const components = Array.isArray(row.components)
      ? row.components.map(crmRecord)
      : [];
    const header = components.find(({ type }) => type === "HEADER");
    const footer = components.find(({ type }) => type === "FOOTER");
    const buttons = components.find(({ type }) => type === "BUTTONS")?.buttons;
    return [
      {
        id: row.id,
        name: row.name,
        language: row.language,
        body: row.body,
        variables,
        header: typeof header?.text === "string" ? header.text : null,
        image: header?.format === "IMAGE",
        footer: typeof footer?.text === "string" ? footer.text : null,
        buttons: Array.isArray(buttons)
          ? buttons
              .map(crmRecord)
              .flatMap(({ text }) => (typeof text === "string" ? [text] : []))
          : [],
      },
    ];
  });
}

export function reviewTemplate(
  template: RemoteTemplate,
  values: readonly string[],
) {
  const clean = values.map((value) => value.trim());
  if (
    clean.length !== template.variables.length ||
    clean.some((value) => !value || value.length > TEMPLATE_VALUE_MAX)
  )
    return null;
  const text = template.body.replace(
    variable,
    (_, name: string) => clean[template.variables.indexOf(name)] ?? "",
  );
  return { text, variables: clean };
}

export function canSendTemplates(chat: WireConversation) {
  return (
    chat.channel === "whatsapp" && !!chat.waNumberId && chat.isGroup === false
  );
}

export function quickRepliesResponse(raw: unknown) {
  const rows = crmRecord(raw).replies;
  if (!Array.isArray(rows)) throw new Error("Invalid reply catalog");
  return rows.map(crmRecord).flatMap((row) => {
    if (
      !isRemoteId(row.id) ||
      typeof row.shortcut !== "string" ||
      typeof row.body !== "string"
    )
      return [];
    return [{ id: row.id, shortcut: row.shortcut, body: row.body }];
  });
}

export function insertQuickReply(
  body: string,
  name: string,
  draft: string,
  max: number,
) {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const reply =
    first && !/\d{5,}/.test(first)
      ? body.replace(/\{\s*nombre\s*\}/gi, () => first)
      : body.replace(/ ?\{\s*nombre\s*\}/gi, "");
  const prefix = /^\/[^\s]*$/.test(draft.trim()) ? "" : draft.trimEnd();
  return (prefix ? `${prefix}\n${reply}` : reply).slice(0, max);
}
