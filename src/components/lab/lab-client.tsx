"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Play, RotateCw, ShieldCheck, Sparkles } from "lucide-react";
import { useEvents } from "@/components/use-events";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { AgentReview, type ReviewSuggestionDto } from "@/components/lab/agent-review";
import { LabActions } from "@/components/lab/lab-shell";
import { cn } from "@/lib/utils";

/**
 * 0070 — Estudio de IA → «Clientes simulados» (antes «Evaluaciones» con 6
 * personas fijas y un juez). Se inventan clientes con lo que sabe el agente,
 * conversan con él (nada sale a WhatsApp) y una revisión dice Bien / Revisar
 * / Falló. «Proponer arreglo» reusa la revisión del editor y deja el cambio
 * en el BORRADOR; «Abrir en el asistente» lleva la conversación al asistente.
 */

type Run = {
  id: string;
  status: "running" | "done" | "failed";
  score: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  agentId?: string | null;
  agentName?: string | null;
  source?: "draft" | "published" | null;
  clients?: number;
};

type AgentOption = { id: string; internalName: string; isGeneral: boolean; status: "published" | "draft" | "changes" };

type Review = { notas: string[]; arreglo: string | null };
type LegacyHallazgo = { evidencia?: string };

type Case = {
  id: string;
  persona: string;
  personaLabel: string;
  summary: string | null;
  status: string;
  veredicto: "verde" | "amarillo" | "rojo" | null;
  hallazgos: Review | LegacyHallazgo[];
  transcript: { role: "cliente" | "agente"; text: string }[];
};

type Detail = { run: Run; cases: Case[] };

const COUNTS = [3, 5, 8] as const;

const VERDICT: Record<"verde" | "amarillo" | "rojo", { label: string; variant: "success" | "warning" | "destructive" }> = {
  verde: { label: "Bien", variant: "success" },
  amarillo: { label: "Revisar", variant: "warning" },
  rojo: { label: "Falló", variant: "destructive" },
};

/** Las corridas de antes de 0070 guardaban una lista de hallazgos del juez. */
function reviewOf(c: Case): Review {
  if (Array.isArray(c.hallazgos)) return { notas: c.hallazgos.map((h) => h.evidencia ?? "").filter(Boolean), arreglo: null };
  return { notas: c.hallazgos?.notas ?? [], arreglo: c.hallazgos?.arreglo ?? null };
}

const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

export function LabClient() {
  const params = useSearchParams();
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState<string | null>(params.get("agente"));
  const [source, setSource] = useState<"draft" | "published">("published");
  const [count, setCount] = useState<(typeof COUNTS)[number]>(5);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/lab/agents")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { agents: AgentOption[] } | null) => {
        if (!d) return;
        setAgents(d.agents);
        setAgentId((cur) => (cur && d.agents.some((a) => a.id === cur) ? cur : (d.agents.find((a) => a.isGeneral)?.id ?? d.agents[0]?.id ?? null)));
      })
      .catch(() => null);
  }, []);

  const chosen = agents.find((a) => a.id === agentId) ?? null;
  const effectiveSource: "draft" | "published" = chosen?.status === "draft" ? "draft" : source;
  const agentRuns = useMemo(() => runs.filter((r) => !agentId || r.agentId === agentId), [runs, agentId]);
  const running = runs.some((r) => r.status === "running");

  const refetchRuns = useCallback(async () => {
    const res = await fetch("/api/lab/runs").catch(() => null);
    setLoaded(true);
    if (!res?.ok) return;
    const data = (await res.json()) as { runs: Run[]; aiConfigured: boolean };
    setRuns(data.runs);
    setAiConfigured(data.aiConfigured);
  }, []);

  const refetchDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/lab/runs/${id}`).catch(() => null);
    if (!res?.ok) return;
    const d = (await res.json()) as Detail;
    setDetail(d);
    setCaseId((cur) => (cur && d.cases.some((c) => c.id === cur) ? cur : (d.cases.find((c) => c.veredicto && c.veredicto !== "verde")?.id ?? d.cases[0]?.id ?? null)));
  }, []);

  useEffect(() => {
    void refetchRuns();
  }, [refetchRuns]);

  // Al cambiar de agente, su prueba más reciente.
  useEffect(() => {
    if (!loaded) return;
    setRunId((cur) => (cur && agentRuns.some((r) => r.id === cur) ? cur : (agentRuns[0]?.id ?? null)));
  }, [agentRuns, loaded]);

  useEffect(() => {
    if (runId) void refetchDetail(runId);
    else setDetail(null);
  }, [runId, refetchDetail]);

  useEvents({
    onLabRun: (data) => {
      setProgress(data.status === "running" ? data.progress : null);
      void refetchRuns();
      if (runId === data.runId) void refetchDetail(data.runId);
    },
  });

  async function launch(repeat?: { runId: string; caseId: string }) {
    setLaunching(true);
    setError(null);
    const res = await fetch("/api/lab/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(agentId ? { agentId, source: effectiveSource } : {}), ...(repeat ? { repeat } : { clients: count }) }),
    }).catch(() => null);
    setLaunching(false);
    if (!res) return;
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo empezar la prueba");
      return;
    }
    const data = (await res.json()) as { runId: string };
    setRunId(data.runId);
    setCaseId(null);
    setProgress({ done: 0, total: repeat ? 1 : count });
    void refetchRuns();
  }

  const selectedRun = detail?.run ?? null;
  const cases = detail?.cases ?? [];
  const current = cases.find((c) => c.id === caseId) ?? null;
  const good = cases.filter((c) => c.veredicto === "verde").length;
  const reviewed = cases.filter((c) => c.veredicto).length;
  const isRunning = selectedRun?.status === "running";

  const bad = cases.filter((c) => c.veredicto === "rojo").length;
  const warn = cases.filter((c) => c.veredicto === "amarillo").length;
  const DOT: Record<"verde" | "amarillo" | "rojo", string> = { verde: "bg-success", amarillo: "bg-warning", rojo: "bg-destructive" };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="lab-sim">
      <LabActions>
        <label htmlFor="lab-sim-agent" className="sr-only">
          Agente que se prueba
        </label>
        <select
          id="lab-sim-agent"
          data-testid="lab-agent-select"
          className="h-8 max-w-[14rem] rounded-md border border-input bg-background px-2 text-[13px]"
          value={agentId ?? ""}
          onChange={(e) => setAgentId(e.target.value || null)}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.internalName}
              {a.isGeneral ? " (general)" : ""}
              {a.status === "draft" ? " · borrador" : ""}
            </option>
          ))}
        </select>
        {chosen?.status === "changes" && (
          <div className="hidden rounded-md border bg-subtle p-0.5 text-xs xl:inline-flex" role="radiogroup" aria-label="Qué versión se prueba">
            {(["published", "draft"] as const).map((src) => (
              <button
                key={src}
                type="button"
                role="radio"
                aria-checked={source === src}
                onClick={() => setSource(src)}
                className={cn("rounded px-2 py-1", source === src ? "bg-card font-medium shadow-sm" : "text-text-2")}
                data-testid={`lab-source-${src}`}
              >
                {src === "published" ? "Lo publicado" : "El borrador"}
              </button>
            ))}
          </div>
        )}
        <div role="radiogroup" aria-label="Cuántos clientes" className="inline-flex rounded-md border bg-subtle p-0.5" data-testid="lab-sim-count">
          {COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={count === n}
              onClick={() => setCount(n)}
              className={cn("min-w-7 rounded px-2 py-0.5 text-[13px]", count === n ? "bg-card font-medium shadow-sm" : "text-text-2")}
            >
              {n}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => void launch()} disabled={!aiConfigured || running || launching || !agentId} data-testid="lab-run">
          <Play className="h-4 w-4" aria-hidden /> {running ? "Probando…" : `Probar con ${count} clientes`}
        </Button>
      </LabActions>

      <p className="flex items-center gap-2 border-b border-warning-soft bg-warning-tint px-4 py-2 text-[13px] text-warning-text sm:px-6">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden /> Modo prueba: estos clientes son simulados; nada se envía ni se agenda de verdad.
        {running && progress && progress.total > 0 && (
          <span className="ml-auto text-xs" data-testid="lab-sim-progress">
            {progress.done} de {progress.total}
          </span>
        )}
      </p>
      {error && <p className="border-b px-4 py-2 text-sm text-destructive sm:px-6">{error}</p>}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)_minmax(0,20rem)]">
        {/* Izquierda: la prueba y sus clientes. */}
        <div className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
          {!aiConfigured ? (
            <p className="m-4 rounded-lg border border-dashed p-4 text-sm text-text-2">Configura el proveedor de IA de la instancia para probar a tus agentes.</p>
          ) : !loaded ? (
            <p className="p-4 text-sm text-text-3">Cargando…</p>
          ) : !selectedRun ? (
            <p className="m-4 rounded-lg border border-dashed p-6 text-center text-sm text-text-2" data-testid="lab-sim-empty">
              Todavía no pruebas a este agente. Inventamos clientes con lo que sabe tu agente (instrucciones, conocimiento y documentos): elige
              cuántos y pulsa «Probar».
            </p>
          ) : (
            <>
              <div className="space-y-2 border-b px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 className="mr-auto text-sm font-semibold">Prueba del {fecha(selectedRun.startedAt)}</h2>
                  {reviewed > 0 && (
                    <span className="flex flex-wrap gap-1" data-testid="lab-sim-score">
                      <Badge variant="success">{good} bien</Badge>
                      {warn > 0 && <Badge variant="warning">{warn} revisar</Badge>}
                      {bad > 0 && <Badge variant="destructive">{bad} falló</Badge>}
                    </span>
                  )}
                </div>
                {agentRuns.length > 1 && (
                  <select
                    aria-label="Pruebas anteriores"
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-text-2"
                    value={runId ?? ""}
                    onChange={(e) => {
                      setRunId(e.target.value);
                      setCaseId(null);
                    }}
                    data-testid="lab-sim-history"
                  >
                    {agentRuns.map((r) => (
                      <option key={r.id} value={r.id}>
                        {fecha(r.startedAt)} · {r.status === "running" ? "en curso" : r.status === "failed" ? "falló" : r.score === null ? "sin revisar" : `${r.score} %`}
                        {r.source === "draft" ? " · borrador" : ""}
                      </option>
                    ))}
                  </select>
                )}
                {selectedRun.status === "failed" && <p className="text-sm text-destructive">La prueba no terminó: {selectedRun.error}</p>}
                {isRunning && cases.length === 0 && (
                  <p className="flex items-center gap-2 text-sm text-text-2" data-testid="lab-sim-generating">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Inventando clientes con lo que sabe tu agente…
                  </p>
                )}
              </div>
              <ul className="min-h-0 flex-1 divide-y overflow-y-auto" data-testid="lab-sim-cases">
                {cases.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setCaseId(c.id)}
                      aria-current={c.id === caseId ? "true" : undefined}
                      className={cn(
                        "flex w-full items-start gap-2.5 border-l-2 border-transparent px-4 py-2.5 text-left hover:bg-accent",
                        c.id === caseId && "border-l-brand bg-brand-tint hover:bg-brand-tint"
                      )}
                      data-testid="lab-sim-case"
                    >
                      <span
                        aria-hidden
                        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", c.veredicto ? DOT[c.veredicto] : "bg-text-4")}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{c.personaLabel}</span>
                        {c.summary && <span className="line-clamp-1 text-xs text-text-3">{c.summary}</span>}
                      </span>
                      {c.veredicto ? (
                        <Badge variant={VERDICT[c.veredicto].variant}>{VERDICT[c.veredicto].label}</Badge>
                      ) : c.status === "judge_failed" ? (
                        <Badge variant="secondary">Sin revisar</Badge>
                      ) : c.status === "running" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-text-3" aria-label="Conversando" />
                      ) : (
                        <span className="text-xs text-text-4">En espera</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* Centro y derecha: la conversación y su revisión. */}
        {current ? (
          <CaseView
            key={current.id}
            c={current}
            run={selectedRun!}
            agentId={selectedRun?.agentId ?? agentId}
            onRepeat={() => void launch({ runId: selectedRun!.id, caseId: current.id })}
            repeatDisabled={running || launching}
          />
        ) : (
          <div className="flex min-h-[12rem] items-center justify-center p-8 text-center text-sm text-text-3 lg:col-span-2">
            {selectedRun ? "Elige un cliente para ver su conversación." : "Aquí verás cada conversación y lo que encontró la revisión."}
          </div>
        )}
      </div>
    </div>
  );
}

function CaseView({
  c,
  run,
  agentId,
  onRepeat,
  repeatDisabled,
}: {
  c: Case;
  run: Run;
  agentId: string | null | undefined;
  onRepeat: () => void;
  repeatDisabled: boolean;
}) {
  const review = reviewOf(c);
  const verdict = c.veredicto ? VERDICT[c.veredicto] : null;
  const [fix, setFix] = useState<{ summary: string; suggestions: ReviewSuggestionDto[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const clientMsgs = c.transcript.filter((m) => m.role === "cliente").length;

  async function proposeFix() {
    if (!agentId) return;
    setBusy(true);
    setMsg(null);
    const a = await fetch(`/api/lab/agents/${agentId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!a?.agent) {
      setBusy(false);
      return setMsg("No encontré al agente.");
    }
    const transcript = c.transcript.slice(0, 40).map((m) => ({ role: m.role === "cliente" ? "user" : "assistant", text: m.text.slice(0, 2000) }));
    const res = await fetch("/api/lab/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config: a.agent.draft, transcript }),
    }).catch(() => null);
    setBusy(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res?.ok || !data) return setMsg(data?.error?.message ?? "No se pudo proponer un arreglo.");
    setFix({ summary: data.summary ?? "", suggestions: data.suggestions ?? [] });
  }

  async function applyFix(s: ReviewSuggestionDto) {
    if (!agentId) return;
    const a = await fetch(`/api/lab/agents/${agentId}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!a?.agent) return;
    const res = await fetch(`/api/lab/agents/${agentId}/draft`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...a.agent.draft, [s.field]: s.value }),
    }).catch(() => null);
    setMsg(res?.ok ? "Listo: quedó en el borrador del agente. Pruébalo y publica cuando quieras." : "No se pudo guardar el cambio.");
  }

  const question = `Revisa esta conversación de prueba de mi agente con «${c.personaLabel}» y dime qué cambiarías en sus instrucciones:\n\n${c.transcript
    .map((m) => `${m.role === "cliente" ? "Cliente" : "Agente"}: ${m.text}`)
    .join("\n")}`.slice(0, 990);

  return (
    <>
      <div className="min-h-0 overflow-y-auto border-b bg-muted/30 lg:border-b-0 lg:border-r" data-testid="lab-sim-case-view">
        <p className="border-b bg-card px-5 py-2.5 text-sm">
          <strong>{c.personaLabel}</strong>
          <span className="text-text-3"> · {clientMsgs} {clientMsgs === 1 ? "mensaje" : "mensajes"} del cliente</span>
        </p>
        <div className="space-y-3 p-5">
          {c.transcript.length === 0 && <p className="text-sm text-text-3">{c.status === "pending" ? "En espera…" : "Conversando…"}</p>}
          {c.transcript.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "agente" && "justify-end")}>
              <p
                className={cn(
                  "max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm",
                  m.role === "cliente" ? "border bg-card" : "bg-[hsl(var(--bubble-ai,262_83%_96%))] bg-brand-tint"
                )}
                data-testid={m.role === "cliente" ? "lab-sim-msg-client" : "lab-sim-msg-agent"}
              >
                {m.text}
                <span className="mt-1 block text-right text-[10px] text-text-3">{m.role === "cliente" ? "simulado" : "agente"}</span>
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-0 space-y-4 overflow-y-auto p-4">
        {verdict || c.status === "judge_failed" ? (
          <section data-testid="lab-sim-review" className="space-y-2">
            <div className="flex items-center gap-2">
              {verdict ? <Badge variant={verdict.variant}>{verdict.label}</Badge> : <Badge variant="secondary">Sin revisar</Badge>}
              <h3 className="text-sm font-semibold">Qué pasó</h3>
            </div>
            {review.notas.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-[13px] text-text-2">
                {review.notas.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-text-2">
                {c.status === "judge_failed" ? "La IA no pudo revisar esta conversación." : "Atendió bien a este cliente."}
              </p>
            )}
          </section>
        ) : (
          <p className="text-sm text-text-3">La revisión aparece cuando termina la conversación.</p>
        )}
        {review.arreglo && (
          <section className="space-y-1.5">
            <h4 className="kicker">Arreglo sugerido</h4>
            <p className="rounded-lg border bg-card px-3 py-2.5 text-[13px]">{review.arreglo}</p>
          </section>
        )}
        <div className="flex flex-col gap-2">
          {c.veredicto && c.veredicto !== "verde" && (
            <Button size="sm" onClick={() => void proposeFix()} disabled={busy || !agentId} data-testid="lab-sim-fix">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />} Proponer arreglo en el borrador
            </Button>
          )}
          {run.status !== "running" && c.summary !== null && (
            <Button size="sm" variant="outline" onClick={onRepeat} disabled={repeatDisabled} data-testid="lab-sim-repeat">
              <RotateCw className="h-4 w-4" aria-hidden /> Repetir con este cliente
            </Button>
          )}
          {c.veredicto && c.veredicto !== "verde" && (
            <Link href={`/asistente?q=${encodeURIComponent(question)}`} className={buttonVariants({ size: "sm", variant: "outline" })} data-testid="lab-sim-assistant">
              <Sparkles className="h-4 w-4" aria-hidden /> Abrir en el Asistente
            </Link>
          )}
        </div>
        {msg && <p className="text-sm text-text-2" data-testid="lab-sim-fix-msg">{msg}</p>}
        {fix && <AgentReview summary={fix.summary} suggestions={fix.suggestions} onApply={(x) => void applyFix(x)} onClose={() => setFix(null)} />}
      </div>
    </>
  );
}
