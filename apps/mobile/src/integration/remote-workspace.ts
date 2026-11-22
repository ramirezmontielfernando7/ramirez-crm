import { crmRecord, isRemoteId } from "./remote-crm-contract";

const id = "[A-Za-z0-9_-]{1,200}";
const boardPage = new RegExp(
  `^/api/pipeline/board\\?take=50&stageId=${id}&offset=(?:0|[1-9][0-9]{0,6})$`,
);
const leadPath = new RegExp(`^/api/pipeline/leads/${id}$`);

export function allowsWorkspaceRequest(
  method: string,
  path: string,
  writes: boolean,
) {
  if (method === "GET")
    return (
      path === "/api/writing-assist" ||
      path === "/api/lab/agents" ||
      path === "/api/pipeline/board?take=50" ||
      boardPage.test(path) ||
      path === "/api/pipeline/loss-reasons"
    );
  return (
    writes &&
    ((method === "PATCH" && leadPath.test(path)) ||
      (method === "POST" && path === "/api/writing-assist"))
  );
}

export function rows(raw: unknown, key: string) {
  const value = crmRecord(raw)[key];
  if (!Array.isArray(value)) throw new Error("Invalid list");
  return value.map(crmRecord);
}

export function pipelineResponse(raw: unknown) {
  const stages = rows(raw, "stages").flatMap(({ id, name, kind }) =>
    isRemoteId(id) && typeof name === "string" && typeof kind === "string"
      ? [{ id, name, kind }]
      : [],
  );
  const leads = rows(raw, "leads").flatMap((row) => {
    const { id, stageId, conversationId } = row;
    const contact = crmRecord(row.contact);
    if (
      !isRemoteId(id) ||
      !isRemoteId(stageId) ||
      !isRemoteId(contact.id) ||
      typeof contact.name !== "string"
    )
      return [];
    return [
      {
        id,
        stageId,
        contactId: contact.id,
        name: contact.name,
        phone: typeof contact.phone === "string" ? contact.phone : null,
        conversationId: isRemoteId(conversationId) ? conversationId : null,
        amount:
          typeof row.amountCents === "number" ? row.amountCents / 100 : null,
        currency: typeof row.currency === "string" ? row.currency : null,
        assignee: row.assignee ? crmRecord(row.assignee).name : null,
        tags: Array.isArray(row.tags)
          ? row.tags
              .map(crmRecord)
              .flatMap(({ name }) => (typeof name === "string" ? [name] : []))
          : [],
      },
    ];
  });
  const totals = crmRecord(crmRecord(raw).totals);
  return { stages, leads, totals, currency: crmRecord(raw).currency };
}

export function lossReasonsResponse(raw: unknown) {
  return rows(raw, "reasons").flatMap(({ key, label, active }) =>
    active === true && isRemoteId(key) && typeof label === "string"
      ? [{ key, label }]
      : [],
  );
}

export function agentsResponse(raw: unknown) {
  return rows(raw, "agents").flatMap((row) => {
    if (!isRemoteId(row.id) || typeof row.internalName !== "string") return [];
    return [
      {
        id: row.id,
        name: row.internalName,
        state:
          row.paused === true
            ? "En pausa"
            : row.hasPublished === true || typeof row.publishedAt === "string"
              ? "Publicado"
              : "Borrador",
      },
    ];
  });
}
