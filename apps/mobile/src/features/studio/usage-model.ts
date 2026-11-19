import { businessDay } from "../results/core";
import { dateParts } from "../agenda/core";
export const demoPlans = Object.freeze([
  Object.freeze({
    id: "essential",
    name: "Esencial",
    monthlyCents: 49900,
    features: "Bandeja, CRM, Biblioteca, Resultados",
  }),
  Object.freeze({
    id: "pro",
    name: "Pro",
    monthlyCents: 89900,
    features: "+ Agentes IA, Agenda, Atribución",
  }),
  Object.freeze({
    id: "ultra",
    name: "Ultra",
    monthlyCents: 179900,
    features: "+ Campañas masivas y Asistente interno",
  }),
] as const);
export type PlanId = (typeof demoPlans)[number]["id"];
export type UsageScenario =
  | "normal"
  | "warning"
  | "assistant-blocked"
  | "organization-blocked"
  | "no-assistant-limit";
export type PlanRequest = Readonly<{
  id: string;
  plan: PlanId;
  at: number;
  status: "pending-local";
}>;
export type UsageData = Readonly<{
  period: string;
  plan: PlanId;
  limit: number;
  assistantLimit: number;
  used: Readonly<{ agents: number; creator: number; assistant: number }>;
  lastPromptAt: number;
  snoozeUntil: number;
  requests: readonly PlanRequest[];
}>;
export function usageFixture(
  now: number,
  scenario: UsageScenario = "normal",
): UsageData {
  let used = { agents: 280, creator: 60, assistant: 80 },
    assistantLimit = 235;
  if (scenario === "warning") {
    used = { agents: 520, creator: 80, assistant: 200 };
    assistantLimit = 588;
  }
  if (scenario === "assistant-blocked")
    used = { agents: 280, creator: 60, assistant: 235 };
  if (scenario === "organization-blocked") {
    used = { agents: 650, creator: 100, assistant: 250 };
    assistantLimit = 500;
  }
  if (scenario === "no-assistant-limit") assistantLimit = 0;
  return freezeUsage({
    period: businessDay(now).slice(0, 7),
    plan: "pro",
    limit: 1000,
    assistantLimit,
    used,
    lastPromptAt: 0,
    snoozeUntil: 0,
    requests: [],
  });
}
export const percentage = (used: number, limit: number) =>
  limit > 0 ? Math.round((used / limit) * 100) : 0;
export function usageSummary(data: UsageData, now: number) {
  const day = businessDay(now),
    { year, month, date } = dateParts(day),
    days = new Date(Date.UTC(year, month, 0)).getUTCDate(),
    used = data.used.agents + data.used.creator + data.used.assistant;
  const projectedDay = used > 0 ? Math.ceil((data.limit * date) / used) : null;
  return Object.freeze({
    day,
    date,
    days,
    used,
    aiPercent: percentage(used, data.limit),
    assistantPercent: percentage(data.used.assistant, data.assistantLimit),
    organizationBlocked: used >= data.limit,
    assistantBlocked:
      data.assistantLimit <= 0 ||
      data.used.assistant >= data.assistantLimit ||
      used >= data.limit,
    projectedDay,
    early: projectedDay !== null && projectedDay > date && projectedDay <= days,
  });
}
export function shouldUsagePrompt(data: UsageData, now: number) {
  const s = usageSummary(data, now);
  if (!s.early || now < data.snoozeUntil) return false;
  return (
    !data.lastPromptAt ||
    now - data.lastPromptAt >= 7 * 86400000 ||
    (data.snoozeUntil > data.lastPromptAt && now >= data.snoozeUntil)
  );
}
export const freezeUsage = (d: UsageData): UsageData =>
  Object.freeze({
    ...d,
    used: Object.freeze({ ...d.used }),
    requests: Object.freeze(d.requests.map((r) => Object.freeze({ ...r }))),
  });
export function validateUsage(d: UsageData) {
  const nonNegative = (n: unknown) =>
    Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 1_000_000_000;
  if (
    !d ||
    typeof d.period !== "string" ||
    !/^20\d{2}-(0[1-9]|1[012])$/.test(d.period) ||
    !demoPlans.some((p) => p.id === d.plan) ||
    !nonNegative(d.limit) ||
    d.limit === 0 ||
    !nonNegative(d.assistantLimit) ||
    !d.used ||
    ![d.used.agents, d.used.creator, d.used.assistant].every(nonNegative) ||
    ![d.lastPromptAt, d.snoozeUntil].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) ||
    !Array.isArray(d.requests) ||
    d.requests.length > 64 ||
    new Set(d.requests.map((r) => r.id)).size !== d.requests.length
  )
    throw Error("Los datos locales de Uso y plan no son válidos.");
  for (const r of d.requests)
    if (
      !r ||
      !/^demo-plan-request-\d+$/.test(r.id) ||
      !demoPlans.some((p) => p.id === r.plan) ||
      !Number.isFinite(r.at) ||
      r.at < 0 ||
      r.status !== "pending-local"
    )
      throw Error("La solicitud ficticia de plan no es válida.");
}
