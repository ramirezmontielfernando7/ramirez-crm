"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, BotMessageSquare, Database, Plus, Send, Trash2 } from "lucide-react";
import { NavRevealButton } from "@/components/nav-mode";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { UsageMeter } from "@/components/usage/usage-meter";
import {
  ASSISTANT_COST_NOTICE,
  ASSISTANT_NOTICE_TITLE,
  ASSISTANT_READ_ONLY_NOTICE,
  resetLabel,
  type AssistantStatus,
} from "@/lib/assistant";
import {
  ASSISTANT_FLAG_TEXT,
  MAX_QUESTION_CHARS,
  type AssistantMessageDto,
  type AssistantSource,
  type AssistantThreadDto,
} from "@/lib/assistant-engine";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { countMeter, formatTokens } from "@/lib/usage";
import { gaugeMeter } from "@/lib/usage-visibility";
import { cn } from "@/lib/utils";

/**
 * 038 — Pantalla del asistente interno.
 *
 * PR 1: el aviso FIJO de que cada pregunta consume bastante crédito de IA, la
 * confirmación antes del primer uso (una vez por persona) y el estado de su
 * crédito con un mensaje claro.
 *
 * PR 2: las preguntas. Cada respuesta dice de qué consultas salen sus datos
 * («Datos de: …») y deja ver lo que devolvió cada una, para verificar que no
 * inventó nada. Las conversaciones son de quien las abre.
 */
export function AssistantClient() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [threads, setThreads] = useState<AssistantThreadDto[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessageDto[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(async () => {
    const r = await fetchJson<{ status: AssistantStatus }>("/api/assistant/status");
    if (r.ok) setStatus(r.data.status);
    else setError(r.error);
  }, []);

  const loadThreads = useCallback(async () => {
    const r = await fetchJson<{ threads: AssistantThreadDto[] }>("/api/assistant/threads");
    if (r.ok) setThreads(r.data.threads);
  }, []);

  useEffect(() => {
    void loadStatus();
    void loadThreads();
  }, [loadStatus, loadThreads]);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [messages, asking]);

  async function openThread(id: string | null) {
    setAskError(null);
    setThreadId(id);
    if (!id) {
      setMessages([]);
      return;
    }
    const r = await fetchJson<{ messages: AssistantMessageDto[] }>(`/api/assistant/threads/${encodeURIComponent(id)}`);
    if (r.ok) setMessages(r.data.messages);
    else setAskError(r.error);
  }

  async function removeThread() {
    if (!threadId) return;
    if (!window.confirm("¿Borrar esta conversación del asistente? No se puede deshacer.")) return;
    const r = await fetchJson(`/api/assistant/threads/${encodeURIComponent(threadId)}`, { method: "DELETE" });
    if (!r.ok) {
      setAskError(r.error);
      return;
    }
    setThreadId(null);
    setMessages([]);
    void loadThreads();
  }

  async function accept() {
    setBusy(true);
    const r = await fetchJson<{ noticeAcceptedAt: string }>("/api/assistant/notice", jsonInit("POST", {}));
    setBusy(false);
    if (!r.ok) {
      setError(`No se guardó la confirmación: ${r.error}`);
      return;
    }
    setStatus((s) => (s ? { ...s, noticeAcceptedAt: r.data.noticeAcceptedAt } : s));
  }

  async function ask() {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setAskError(null);
    const r = await fetchJson<{ threadId: string; question: AssistantMessageDto; answer: AssistantMessageDto }>(
      "/api/assistant/ask",
      jsonInit("POST", { threadId, question: q })
    );
    setAsking(false);
    if (!r.ok) {
      setAskError(r.error);
      void loadStatus();
      return;
    }
    setQuestion("");
    setThreadId(r.data.threadId);
    setMessages((m) => [...m, r.data.question, r.data.answer]);
    void loadStatus();
    void loadThreads();
  }

  const meter = status?.gauge
    ? status.gauge.used !== undefined
      ? countMeter(status.gauge.used, status.gauge.limit ?? null, "tokens", formatTokens)
      : gaugeMeter(status.gauge)
    : null;
  const canAsk = !!status?.canAsk && !!status.noticeAcceptedAt;

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6 sm:py-4">
        <NavRevealButton />
        <h2 className="text-[17px] font-bold tracking-tight">Asistente interno</h2>
      </header>

      <div
        role="note"
        data-testid="assistant-cost-banner"
        className="flex shrink-0 items-start gap-2 border-b border-warning-soft bg-warning-tint px-4 py-2 text-sm text-warning-text sm:px-6"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p className="min-w-0">{ASSISTANT_COST_NOTICE}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {!status ? (
            <p className={cn("text-sm", error ? "text-destructive" : "text-text-2")}>{error ?? "Cargando el asistente…"}</p>
          ) : (
            <>
              <section className="rounded-md border bg-card p-4" data-testid="assistant-status" data-state={status.state}>
                <div className="flex items-center gap-2">
                  <BotMessageSquare className="h-4 w-4 shrink-0 text-text-2" aria-hidden />
                  <h3 className="text-sm font-semibold">Crédito del asistente</h3>
                </div>
                {meter && (
                  <div className="mt-3">
                    <UsageMeter meter={meter} label="Crédito del asistente" testId="assistant-credit" showLabel="never" />
                  </div>
                )}
                <p
                  className={cn("mt-3 text-sm", status.canAsk ? "text-text-2" : "text-danger-text")}
                  data-testid="assistant-status-message"
                  role={status.canAsk ? undefined : "alert"}
                >
                  {status.message}
                </p>
                {status.canAsk && (
                  <p className="mt-1 text-xs text-text-3">El crédito se renueva el {resetLabel(status.resetsOn)}.</p>
                )}
                <p className="mt-2 text-xs text-text-3">{ASSISTANT_READ_ONLY_NOTICE}</p>
              </section>

              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="assistant-thread-select">
                  Conversación
                </label>
                <select
                  id="assistant-thread-select"
                  data-testid="assistant-thread-select"
                  className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                  value={threadId ?? ""}
                  onChange={(e) => void openThread(e.target.value || null)}
                >
                  <option value="">Nueva conversación</option>
                  {threads.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
                <Button variant="outline" size="sm" onClick={() => void openThread(null)} data-testid="assistant-new-thread">
                  <Plus className="mr-1 h-4 w-4" aria-hidden />
                  Nueva
                </Button>
                {threadId && (
                  <Button variant="ghost" size="sm" onClick={() => void removeThread()} data-testid="assistant-delete-thread" aria-label="Borrar conversación">
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </div>

              <section className="space-y-3" data-testid="assistant-messages" aria-live="polite">
                {messages.length === 0 && !asking && (
                  <p className="text-sm text-text-3" data-testid="assistant-empty">
                    Pregúntale sobre el uso y el plan de tu organización (cuánto llevas de IA, tu almacenamiento, tus topes, tu equipo, tus etiquetas, tus chats recientes) o sobre tus conversaciones: por qué se pierden ventas, qué objeciones ponen tus clientes o cómo atiende cada asesor.
                  </p>
                )}
                {messages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end">
                      <p
                        className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-brand-tint px-3 py-2 text-sm"
                        data-testid="assistant-msg-user"
                      >
                        {m.content}
                      </p>
                    </div>
                  ) : (
                    <AnswerBubble key={m.id} message={m} />
                  )
                )}
                {asking && (
                  <p className="text-sm text-text-3" data-testid="assistant-thinking">
                    El asistente está revisando tus datos…
                  </p>
                )}
                <div ref={bottom} />
              </section>
              {status && error && <p className="text-sm text-destructive">{error}</p>}
            </>
          )}
        </div>
      </div>

      {status && (
        <form
          className="shrink-0 border-t bg-background px-4 py-3 sm:px-6"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <div className="mx-auto max-w-3xl">
            {askError && (
              <p className="mb-2 text-sm text-danger-text" role="alert" data-testid="assistant-ask-error">
                {askError}
              </p>
            )}
            <div className="flex items-end gap-2">
              <label className="sr-only" htmlFor="assistant-question">
                Tu pregunta
              </label>
              <Textarea
                id="assistant-question"
                data-testid="assistant-question"
                rows={2}
                maxLength={MAX_QUESTION_CHARS}
                placeholder={canAsk ? "Escribe tu pregunta…" : "El asistente no puede responder ahora."}
                value={question}
                disabled={!canAsk || asking}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask();
                  }
                }}
                className="min-w-0 flex-1 resize-none"
              />
              <Button type="submit" disabled={!canAsk || asking || !question.trim()} data-testid="assistant-ask">
                <Send className="mr-1 h-4 w-4" aria-hidden />
                {asking ? "Pensando…" : "Preguntar"}
              </Button>
            </div>
          </div>
        </form>
      )}

      {status && !status.noticeAcceptedAt && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="assistant-notice-title"
          data-testid="assistant-notice"
        >
          <div className="w-full max-w-md rounded-lg border bg-popover p-4 shadow-pop">
            <h3 id="assistant-notice-title" className="font-semibold">
              {ASSISTANT_NOTICE_TITLE}
            </h3>
            <p className="mt-2 text-sm text-text-2">{ASSISTANT_COST_NOTICE}</p>
            <p className="mt-2 text-sm text-text-2">{ASSISTANT_READ_ONLY_NOTICE}</p>
            <div className="mt-4 flex justify-end">
              <Button onClick={() => void accept()} disabled={busy} data-testid="assistant-notice-accept">
                {busy ? "Guardando…" : "Entendido, continuar"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Una respuesta con sus fuentes: qué consultas corrieron y lo que devolvió cada una. */
function AnswerBubble({ message }: { message: AssistantMessageDto }) {
  const meta = message.meta;
  const sources = meta?.sources ?? [];
  const cited = sources.filter((s) => s.cited);
  const shown = cited.length > 0 ? cited : sources;
  return (
    <div className="flex justify-start">
      <div className="max-w-[92%] min-w-0 rounded-lg border bg-card px-3 py-2" data-testid="assistant-msg-answer">
        <p className="whitespace-pre-wrap break-words text-sm" data-testid="assistant-answer-text">
          {message.content}
        </p>
        {meta?.coverage && (
          <p className="mt-2 text-xs text-text-2" data-testid="assistant-coverage" data-faltan={meta.coverage.faltan}>
            Conversaciones revisadas: {meta.coverage.revisadas + meta.coverage.sinInformacion} de {meta.coverage.total}
            {meta.coverage.sinInformacion > 0 ? ` (${meta.coverage.sinInformacion} sin información suficiente)` : ""}
            {meta.coverage.faltan > 0 ? `; faltan ${meta.coverage.faltan}.` : "."}
          </p>
        )}
        {meta?.flags.map((f) => (
          <p key={f} className="mt-2 flex items-start gap-1 text-xs text-warning-text" data-testid="assistant-flag" data-flag={f}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {ASSISTANT_FLAG_TEXT[f]}
          </p>
        ))}
        <div className="mt-2 border-t pt-2" data-testid="assistant-sources" data-count={meta?.queryCount ?? 0}>
          {shown.length === 0 ? (
            <p className="text-xs text-text-3" data-testid="assistant-no-sources">
              Esta respuesta no usó datos de tu organización.
            </p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-1 text-xs text-text-2">
                <Database className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>Datos de:</span>
                {shown.map((s) => (
                  <Badge key={s.id} variant="secondary" data-testid="assistant-source-chip" data-query={s.name}>
                    {s.label}
                  </Badge>
                ))}
              </p>
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-text-3" data-testid="assistant-sources-toggle">
                  Ver lo que devolvió cada consulta ({sources.length} {sources.length === 1 ? "consulta" : "consultas"})
                </summary>
                <ul className="mt-2 space-y-2">
                  {sources.map((s) => (
                    <SourceItem key={s.id} source={s} />
                  ))}
                </ul>
              </details>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SourceItem({ source }: { source: AssistantSource }) {
  const args = Object.keys(source.args).length > 0 ? JSON.stringify(source.args) : null;
  const result = typeof source.result === "string" ? source.result : JSON.stringify(source.result, null, 2);
  return (
    <li className="rounded border bg-background p-2" data-testid="assistant-source" data-query={source.name}>
      <p className="font-medium">
        {source.label} <span className="font-mono text-text-3">({source.name}{args ? ` ${args}` : ""})</span>
        {!source.cited && <span className="ml-1 text-text-3">· no citada en la respuesta</span>}
      </p>
      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-2" data-testid="assistant-source-result">
        {result}
        {source.truncated ? "\n(recortado)" : ""}
      </pre>
    </li>
  );
}
