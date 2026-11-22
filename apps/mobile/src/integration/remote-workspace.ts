import { crmRecord, isRemoteId, validDate } from "./remote-crm-contract";

const id = "[A-Za-z0-9_-]{1,200}";
const boardPage = new RegExp(
  `^/api/pipeline/board\\?take=50&stageId=${id}&offset=(?:0|[1-9][0-9]{0,6})$`,
);
const leadPath = new RegExp(`^/api/pipeline/leads/${id}$`);

export type AnalyticsBlock = "sales" | "bot" | "ads" | "hygiene" | "team";
export type ReportRange = { from: string; to: string };
const analyticsPath =
  /^\/api\/analytics\/(sales|bot|ads|team)(?:\?from=(\d{4}-\d{2}-\d{2})&to=(\d{4}-\d{2}-\d{2}))?$/;

export function validReportRange({ from, to }: ReportRange) {
  return (
    validDate(from) &&
    validDate(to) &&
    from <= to &&
    Date.parse(to) - Date.parse(from) <= 365 * 86_400_000
  );
}

export function reportQuery(range?: ReportRange) {
  return range ? `?from=${range.from}&to=${range.to}` : "";
}

function allowsAnalytics(path: string) {
  if (path === "/api/analytics/hygiene") return true;
  const match = analyticsPath.exec(path);
  return (
    !!match &&
    (!match[2] || validReportRange({ from: match[2], to: match[3] ?? "" }))
  );
}

const campaignMetricsPath =
  /^\/api\/campaigns\/metrics(?:\?from=(\d{4}-\d{2}-\d{2})&to=(\d{4}-\d{2}-\d{2}))?$/;
function allowsCampaigns(path: string) {
  if (path === "/api/campaigns") return true;
  const match = campaignMetricsPath.exec(path);
  return (
    !!match &&
    (!match[1] || validReportRange({ from: match[1], to: match[2] ?? "" }))
  );
}

export function allowsWorkspaceRequest(
  method: string,
  path: string,
  writes: boolean,
) {
  if (method === "GET")
    return (
      allowsAnalytics(path) ||
      allowsCampaigns(path) ||
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

export type DisplayMetric = { label: string; value: string };
export function readRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? crmRecord(raw)
    : {};
}

export function displayMetric(label: string, value: unknown): DisplayMetric {
  return {
    label,
    value:
      typeof value === "number" && Number.isFinite(value)
        ? value.toLocaleString("es-MX")
        : "—",
  };
}

function money(label: string, cents: unknown) {
  return displayMetric(label, typeof cents === "number" ? cents / 100 : cents);
}

function ratio(label: string, raw: unknown): DisplayMetric {
  const v = readRecord(raw);
  return {
    label,
    value:
      typeof v.value === "number"
        ? `${v.value} % · n=${v.sample ?? 0}${v.reliable === false ? " · Muestra pequeña" : ""}`
        : "—",
  };
}

export function reportPeriod(raw: unknown) {
  const period = readRecord(raw);
  return typeof period.from === "string" && typeof period.to === "string"
    ? `${period.from} a ${period.to}${typeof period.timezone === "string" ? " · " + period.timezone : ""}`
    : "";
}

type ReportGroup = { title: string; values: DisplayMetric[] };
export function analyticsResponse(block: AnalyticsBlock, raw: unknown) {
  const data = crmRecord(raw);
  let metrics: DisplayMetric[] = [];
  const groups: ReportGroup[] = [];
  const { period, empty } = data;
  function entries(
    key: string,
    add: (row: Record<string, unknown>) => ReportGroup,
  ) {
    if (Array.isArray(data[key])) groups.push(...rows(data, key).map(add));
  }
  if (block === "sales") {
    const kpis = readRecord(data.kpis);
    const funnel = readRecord(data.pipeline);
    metrics = [
      displayMetric("Prospectos", readRecord(kpis.newLeads).current),
      displayMetric("Ganados", readRecord(kpis.won).current),
      displayMetric("Perdidos", readRecord(kpis.lost).current),
      money("Ventas ganadas", readRecord(kpis.wonCents).current),
      money("Importe abierto del Pipeline", funnel.openCents),
      ratio("Tasa de cierre", kpis.winRate),
      money("Ticket medio", kpis.avgTicketCents),
      displayMetric("Días hasta cierre", data.timeToWinDays),
    ];
    entries("funnel", (r) => ({
      title: String(r.name),
      values: [
        displayMetric("Alcanzaron esta etapa", r.reached),
        ratio("Avance", r.advanceRate),
      ],
    }));
    entries("lossReasons", (r) => ({
      title: String(r.label),
      values: [displayMetric("Pérdidas", r.count)],
    }));
  } else if (block === "bot") {
    const team = readRecord(data.team);
    metrics = [
      displayMetric("Conversaciones", data.conversations),
      ratio("Respondidas por IA", data.aiReplyRate),
      displayMetric(
        "Mediana de primera respuesta (s)",
        data.firstResponseSeconds,
      ),
      ratio("Traspaso a una persona", data.handoffRate),
      displayMetric("Respondidas por el equipo", team.answeredByPerson),
      displayMetric("Sin respuesta", team.unanswered),
    ];
    if (data.sessions) {
      const sessions = readRecord(data.sessions);
      groups.push({
        title: "Citas",
        values: [
          displayMetric("Agendadas", sessions.booked),
          displayMetric("Realizadas", sessions.done),
          displayMetric("Canceladas", sessions.cancelled),
          displayMetric("Ausencias", sessions.noShow),
          ratio("Asistencia", sessions.showRate),
        ],
      });
    }
    entries("handoffs", (r) => ({
      title: String(r.label),
      values: [displayMetric("Traspasos", r.count)],
    }));
  } else if (block === "ads") {
    metrics = [
      displayMetric("Conversaciones", readRecord(data.conversations).current),
      ratio("Origen anuncio", data.adShare),
    ];
    const source = (r: Record<string, unknown>, title: string) => ({
      title,
      values: [
        displayMetric("Conversaciones", r.conversations),
        displayMetric("Prospectos", r.leads),
        displayMetric("Ganados", r.won),
      ],
    });
    entries("sources", (r) => source(r, String(r.label)));
    entries("ads", (r) =>
      source(r, typeof r.headline === "string" ? r.headline : "Anuncio"),
    );
  } else if (block === "team") {
    metrics = [
      displayMetric("Sin asignar", data.unassignedNow),
      displayMetric("Límite de respuesta (min)", data.limitMinutes),
    ];
    entries("rows", (r) => ({
      title: String(r.name),
      values: [
        displayMetric("Chats", r.chats),
        displayMetric("Contestados", r.answered),
        displayMetric("Contestados tarde", r.answeredLate),
        displayMetric("En espera fuera de plazo", r.waitingLate),
      ],
    }));
  } else {
    metrics = [
      displayMetric("Prospectos sin actividad", data.silentCount),
      displayMetric("Chats en espera", data.waitingCount),
    ];
    entries("silent", (r) => ({
      title: String(r.name),
      values: [displayMetric("Días sin actividad", r.days)],
    }));
    entries("waiting", (r) => ({
      title: String(r.name),
      values: [displayMetric("Horas en espera", r.hoursWaiting)],
    }));
  }
  return {
    period: reportPeriod(period),
    empty: empty === true,
    metrics,
    groups,
  };
}

const campaignStatuses: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  sending: "Enviando",
  paused: "En pausa",
  completed: "Completada",
  cancelled: "Cancelada",
  failed: "Fallida",
};
export function campaignsResponse(raw: unknown) {
  return rows(raw, "campaigns").flatMap((row) => {
    if (!isRemoteId(row.id) || typeof row.name !== "string") return [];
    const counts = readRecord(row.counts);
    const delivery = readRecord(row.delivery);
    return [
      {
        id: row.id,
        name: row.name,
        state:
          typeof row.status === "string"
            ? (campaignStatuses[row.status] ?? "Estado desconocido")
            : "Estado desconocido",
        values: [
          displayMetric("Destinatarios", row.total),
          displayMetric("Enviados", counts.sent),
          displayMetric("Entregados", delivery.delivered),
          displayMetric("Leídos", delivery.read),
          displayMetric("Fallidos", counts.failed),
        ],
      },
    ];
  });
}

export function campaignMetricsResponse(raw: unknown) {
  const body = crmRecord(raw);
  const totals = readRecord(body.totals);
  const values = (row: Record<string, unknown>) => [
    displayMetric("Enviados", row.sent),
    displayMetric("Entregados", row.delivered),
    displayMetric("Leídos", row.read),
    displayMetric("Respondieron", row.replied),
    displayMetric("Fallidos", row.failed),
    displayMetric("Bajas", row.optOuts),
  ];
  return {
    period: reportPeriod(body.period),
    totals: values(totals),
    campaigns: rows(body, "campaigns").flatMap((r) =>
      isRemoteId(r.id) && typeof r.name === "string"
        ? [{ id: r.id, name: r.name, values: values(r) }]
        : [],
    ),
  };
}
