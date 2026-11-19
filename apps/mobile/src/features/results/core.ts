import type { Actor } from "../inbox/model";
import { addDays, dateParts } from "../agenda/core";
export const resultsTeam = [
  "demo-owner",
  "demo-coordinator",
  "demo-advisor",
] as const;
export type Period = "7" | "30" | "month" | "custom";
export type ResultsQuery = Readonly<{
  from: string;
  to: string;
  assignee: string | null;
}>;
export type ResultFact = Readonly<{
  id: string;
  assignee: string;
  day: string;
  kind:
    | "prospect"
    | "conversation"
    | "interest"
    | "won"
    | "lost"
    | "open"
    | "missingAmount"
    | "unanswered"
    | "ai"
    | "handoff"
    | "response"
    | "appointment";
  cents: number;
  seconds: number;
  attended: boolean;
  cancelled: boolean;
  ad: "Promo nov · Facebook Ads" | "Mayoreo · Instagram" | null;
}>;
export type ResultsSummary = Readonly<{
  prospects: number;
  conversations: number;
  interested: number;
  won: number;
  lost: number;
  money: number;
  openMoney: number;
  missingAmount: number;
  unanswered: number;
  closeRate: number;
  averageTicket: number;
  ai: number;
  handoffs: number;
  responseSeconds: number | null;
  appointments: number;
  cancellations: number;
  attendance: number | null;
  ads: number;
  organic: number;
  campaigns: readonly Readonly<{
    name: string;
    chats: number;
    sales: number;
  }>[];
}>;
export type ResultsState = Readonly<{
  tab: "sales" | "care" | "origin";
  period: Period;
  query: ResultsQuery;
  status: "normal" | "loading" | "empty" | "offline" | "error";
}>;
// Calendar dates are explicitly in America/Cancun (business demo timezone).
// No conversion through device UTC midnight or inferred production timestamps.
export const businessDay = (now: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Cancun",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
export function resultsRange(period: Exclude<Period, "custom">, today: string) {
  dateParts(today);
  return {
    from:
      period === "month"
        ? today.slice(0, 8) + "01"
        : addDays(today, period === "7" ? -6 : -29),
    to: today,
  };
}
export function validateResultsQuery(q: ResultsQuery) {
  const a = dateParts(q.from),
    b = dateParts(q.to);
  if (a.value.getTime() > b.value.getTime())
    throw Error("Desde debe ser anterior o igual a Hasta.");
  if (b.value.getTime() - a.value.getTime() > 366 * 86400000)
    throw Error("Elige un periodo de hasta 366 días.");
  if (
    q.assignee !== null &&
    !(resultsTeam as readonly string[]).includes(q.assignee)
  )
    throw Error("Elige una persona activa del equipo.");
}
export function summarizeResults(
  facts: readonly ResultFact[],
  q: ResultsQuery,
): ResultsSummary {
  validateResultsQuery(q);
  const rows = facts.filter(
    (f) =>
      f.day >= q.from &&
      f.day <= q.to &&
      (!q.assignee || q.assignee === f.assignee),
  );
  const count = (kind: ResultFact["kind"]) =>
    rows.filter((f) => f.kind === kind).length;
  const sum = (kind: ResultFact["kind"], key: "cents" | "seconds") =>
    rows.filter((f) => f.kind === kind).reduce((n, f) => n + f[key], 0);
  const won = count("won"),
    prospects = count("prospect"),
    money = sum("won", "cents"),
    responses = count("response");
  const appointments = rows.filter((f) => f.kind === "appointment"),
    realized = appointments.filter((f) => !f.cancelled);
  return Object.freeze({
    prospects,
    conversations: count("conversation"),
    interested: count("interest"),
    won,
    lost: count("lost"),
    money,
    openMoney: sum("open", "cents"),
    missingAmount: count("missingAmount"),
    unanswered: count("unanswered"),
    closeRate: prospects ? Math.round((won / prospects) * 100) : 0,
    averageTicket: won ? Math.round(money / won) : 0,
    ai: count("ai"),
    handoffs: count("handoff"),
    responseSeconds: responses
      ? Math.round(sum("response", "seconds") / responses)
      : null,
    appointments: realized.length,
    cancellations: appointments.filter((f) => f.cancelled).length,
    attendance: appointments.length
      ? Math.round(
          (realized.filter((f) => f.attended).length / appointments.length) *
            100,
        )
      : null,
    ads: rows.filter((f) => f.kind === "prospect" && f.ad).length,
    organic: rows.filter((f) => f.kind === "prospect" && !f.ad).length,
    campaigns: Object.freeze(
      (["Promo nov · Facebook Ads", "Mayoreo · Instagram"] as const).map(
        (name) =>
          Object.freeze({
            name,
            chats: rows.filter((f) => f.kind === "prospect" && f.ad === name)
              .length,
            sales: rows.filter((f) => f.kind === "won" && f.ad === name).length,
          }),
      ),
    ),
  });
}
export function resultsFixtures(today: string): readonly ResultFact[] {
  const facts: ResultFact[] = [];
  const batch = (
    kind: ResultFact["kind"],
    count: number,
    extra: (i: number) => Partial<ResultFact> = () => ({}),
  ) => {
    for (let i = 0; i < count; i++)
      facts.push(
        Object.freeze({
          id: `demo-result-${kind}-${i}`,
          assignee: resultsTeam[i % 3]!,
          day: addDays(today, -(i % 19)),
          kind,
          cents: 0,
          seconds: 0,
          attended: false,
          cancelled: false,
          ad: null,
          ...extra(i),
        }),
      );
  };
  batch("prospect", 38, (i) => ({
    ad:
      i < 12
        ? "Promo nov · Facebook Ads"
        : i < 21
          ? "Mayoreo · Instagram"
          : null,
  }));
  batch("conversation", 28);
  batch("interest", 17);
  batch("won", 9, (i) => ({
    cents: i === 8 ? 300000 : 290000,
    ad:
      i < 3
        ? "Promo nov · Facebook Ads"
        : i === 3
          ? "Mayoreo · Instagram"
          : null,
  }));
  batch("lost", 5);
  batch("open", 24, (i) => ({ cents: i === 23 ? 410000 : 260000 }));
  batch("missingAmount", 7);
  batch("unanswered", 4);
  batch("ai", 174);
  batch("handoff", 38);
  batch("response", 24, () => ({ seconds: 120 }));
  batch("appointment", 22, (i) => ({ cancelled: i >= 19, attended: i < 19 }));
  return Object.freeze(facts);
}
export class ResultsStore {
  readonly actor: Readonly<Actor>;
  readonly today: string;
  readonly facts: readonly ResultFact[];
  private state: ResultsState;
  private listeners = new Set<() => void>();
  private scroll = new Map<string, number>();
  constructor(actor: Actor, now = Date.now()) {
    if (
      !/^demo-[\w-]{1,80}$/.test(actor.id) ||
      !["owner", "coordinator", "advisor"].includes(actor.role)
    )
      throw Error("Perfil ficticio no válido.");
    this.actor = Object.freeze({ ...actor });
    this.today = businessDay(now);
    this.facts = resultsFixtures(this.today);
    this.state = Object.freeze({
      tab: "sales",
      period: "30",
      query: Object.freeze({
        ...resultsRange("30", this.today),
        assignee: null,
      }),
      status: "normal",
    });
  }
  get canRead() {
    return this.actor.role === "owner" || this.actor.role === "coordinator";
  }
  private allowed() {
    if (!this.canRead) throw Error("Tu perfil no tiene acceso a Resultados.");
  }
  snapshot = () => this.state;
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  private patch(p: Partial<ResultsState>) {
    this.state = Object.freeze({ ...this.state, ...p });
    this.listeners.forEach((f) => {
      try {
        f();
      } catch {
        /* Isolate observers. */
      }
    });
  }
  tab(tab: ResultsState["tab"]) {
    this.allowed();
    if (!["sales", "care", "origin"].includes(tab))
      throw Error("Sección no válida.");
    if (tab !== this.state.tab) this.patch({ tab });
  }
  period(period: Exclude<Period, "custom">) {
    this.allowed();
    if (!["7", "30", "month"].includes(period))
      throw Error("Periodo no válido.");
    this.patch({
      period,
      query: Object.freeze({
        ...resultsRange(period, this.today),
        assignee: this.state.query.assignee,
      }),
    });
  }
  apply(q: ResultsQuery) {
    this.allowed();
    validateResultsQuery(q);
    this.patch({ period: "custom", query: Object.freeze({ ...q }) });
  }
  status(status: ResultsState["status"]) {
    this.allowed();
    if (!["normal", "loading", "empty", "offline", "error"].includes(status))
      throw Error("Estado no válido.");
    this.patch({ status });
  }
  summary() {
    this.allowed();
    return summarizeResults(
      this.state.status === "empty" ? [] : this.facts,
      this.state.query,
    );
  }
  comparison() {
    this.allowed();
    const q = this.state.query,
      days =
        (dateParts(q.to).value.getTime() - dateParts(q.from).value.getTime()) /
          86400000 +
        1;
    try {
      return summarizeResults(this.facts, {
        ...q,
        from: addDays(q.from, -days),
        to: addDays(q.from, -1),
      });
    } catch {
      return summarizeResults([], q);
    }
  }
  offset() {
    return this.scroll.get(this.state.tab) ?? 0;
  }
  rememberOffset(offset: number) {
    if (Number.isFinite(offset) && offset >= 0)
      this.scroll.set(this.state.tab, offset);
  }
}
