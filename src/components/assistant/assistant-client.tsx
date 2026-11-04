"use client";

import { SpeedPicker, useAssistantSpeed } from "./speed-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowUp,
  BotMessageSquare,
  ChevronLeft,
  ChevronRight,
  Database,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RichText } from "@/components/assistant/rich-text";
import { ProposalsCard } from "@/components/assistant/proposals-card";
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
  type AssistantProposal,
  type AssistantMessageDto,
  type AssistantThreadDto,
} from "@/lib/assistant-engine";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { countMeter, formatTokens } from "@/lib/usage";
import { gaugeMeter } from "@/lib/usage-visibility";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/ui/page-shell";
import { useViewer } from "@/components/viewer-context";
import Link from "next/link";

/**
 * 038 — Pantalla del asistente interno, en tarjetas flotantes:
 *
 * - Izquierda: la cápsula «Asistente» (el Chat general fijo, con la flechita
 *   que pliega la columna) y la tarjeta de «Hilos» (nuevo, seleccionar varios
 *   para archivar o borrar de golpe, y «Archivados»).
 * - Centro: el chat, con el botón de enviar DENTRO del cuadro de texto.
 * - Derecha: «Avance» (de qué consultas salió la última respuesta) y el
 *   crédito del asistente. También se pliega.
 *
 * El aviso fijo de consumo, la confirmación antes del primer uso y las
 * fuentes de cada respuesta (038 PR 1 y 2) se conservan.
 */

const COLLAPSE_KEY = "dashfort-asistente-paneles";

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 7) return d.toLocaleDateString("es-MX", { weekday: "short" }).replace(".", "");
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");
}

/** 0070 — Atajos de la pantalla vacía: preguntas que el asistente sabe contestar con su catálogo. */
const ASSISTANT_SUGGESTIONS = [
  { label: "Audita mis agentes de IA", question: "Audita mis agentes de IA: qué hacen bien, dónde fallan y qué cambiarías en sus instrucciones, con ejemplos de chats reales." },
  { label: "Revisa los chats que contestó la IA", question: "Revisa los chats que contestó la IA esta semana: ¿hubo respuestas equivocadas o chats que debió pasar antes a una persona?" },
] as const;

export function AssistantClient() {
  const viewer = useViewer();
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [general, setGeneral] = useState<AssistantThreadDto | null>(null);
  const [threads, setThreads] = useState<AssistantThreadDto[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessageDto[]>([]);
  const [question, setQuestion] = useState("");
  // 0070: «Abrir en el asistente» (Clientes simulados) llega con la pregunta lista en `?q=`.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) setQuestion(q.slice(0, MAX_QUESTION_CHARS));
  }, []);
  const [speed, setSpeed] = useAssistantSpeed();
  const [asking, setAsking] = useState(false);
  /** Tu pregunta se ve al instante, mientras el asistente piensa. */
  const [pending, setPending] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [bannerHidden, setBannerHidden] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("assistant-banner-hidden") === "1") setBannerHidden(true);
    } catch {}
  }, []);
  function hideBanner() {
    setBannerHidden(true);
    try {
      localStorage.setItem("assistant-banner-hidden", "1");
    } catch {}
  }
  const bottom = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);

  // Los paneles plegados se recuerdan en este navegador (si no se puede, se abren).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as { left?: boolean; right?: boolean };
        if (v.left === false) setLeftOpen(false);
        if (v.right === false) setRightOpen(false);
      }
    } catch {
      /* sin almacenamiento: paneles abiertos */
    }
  }, []);
  function setPanels(left: boolean, right: boolean) {
    setLeftOpen(left);
    setRightOpen(right);
    try {
      window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify({ left, right }));
    } catch {
      /* ignorar */
    }
  }

  const loadStatus = useCallback(async () => {
    const r = await fetchJson<{ status: AssistantStatus }>("/api/assistant/status");
    if (r.ok) setStatus(r.data.status);
    else setError(r.error);
  }, []);

  const loadThreads = useCallback(async () => {
    const r = await fetchJson<{ general: AssistantThreadDto; threads: AssistantThreadDto[] }>("/api/assistant/threads");
    if (r.ok) {
      setGeneral(r.data.general);
      setThreads(r.data.threads);
      return r.data.general;
    }
    return null;
  }, []);

  const openThread = useCallback(async (id: string | null) => {
    setAskError(null);
    setThreadId(id);
    if (!id) {
      setMessages([]);
      return;
    }
    const r = await fetchJson<{ messages: AssistantMessageDto[] }>(`/api/assistant/threads/${encodeURIComponent(id)}`);
    if (r.ok) setMessages(r.data.messages);
    else setAskError(r.error);
  }, []);

  useEffect(() => {
    void loadStatus();
    void (async () => {
      const g = await loadThreads();
      // Al entrar se abre el Chat general (una sola vez: no pisa lo que la persona ya eligió).
      if (g && !started.current) {
        started.current = true;
        await openThread(g.id);
      }
    })();
  }, [loadStatus, loadThreads, openThread]);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ block: "end" });
  }, [messages, asking]);

  // El cuadro de texto crece con lo que se escribe (hasta unas 6 líneas).
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [question]);

  const visible = threads.filter((t) => t.archived === showArchived);
  const archivedCount = threads.filter((t) => t.archived).length;
  const current = threadId === null ? null : threadId === general?.id ? general : (threads.find((t) => t.id === threadId) ?? null);

  async function bulk(action: "archive" | "unarchive" | "delete", ids: string[]) {
    if (ids.length === 0) return;
    if (action === "delete") {
      const msg = ids.length === 1 ? "¿Borrar este hilo del asistente? No se puede deshacer." : `¿Borrar ${ids.length} hilos del asistente? No se puede deshacer.`;
      if (!window.confirm(msg)) return;
    }
    const r = await fetchJson("/api/assistant/threads/bulk", jsonInit("POST", { action, ids }));
    if (!r.ok) {
      setAskError(r.error);
      return;
    }
    if (threadId && ids.includes(threadId) && action !== "unarchive") {
      if (action === "delete") await openThread(general?.id ?? null);
    }
    setPicked([]);
    setSelecting(false);
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

  async function ask(preset?: string) {
    const q = (preset ?? question).trim();
    if (!q || asking) return;
    setAsking(true);
    setPending(q);
    setAskError(null);
    setQuestion("");
    const r = await fetchJson<{ threadId: string; question: AssistantMessageDto; answer: AssistantMessageDto }>(
      "/api/assistant/ask",
      jsonInit("POST", { threadId, question: q, speed })
    );
    setAsking(false);
    setPending(null);
    if (!r.ok) {
      setQuestion(q);
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
  const lastAnswer = [...messages].reverse().find((m) => m.role === "assistant");
  const progress = lastAnswer?.meta?.sources ?? [];
  const title = threadId === null ? "Hilo nuevo" : (current?.title ?? "Asistente");

  return (
    <PageShell pillar="asistente" tabs={[]} hideHeader variant="fluid">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-canvas p-3 lg:flex-row lg:overflow-hidden">
        {/* ── Izquierda: cápsula del Asistente + Hilos ───────────────────── */}
        {leftOpen && (
          <aside className="flex shrink-0 flex-col gap-3 lg:w-[280px] lg:min-h-0" aria-label="Conversaciones del asistente">
            <div className="rounded-lg bg-surface p-2.5 shadow-card">
              <div
                className={cn(
                  "flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-subtle"
                )}
              >
                <button
                  type="button"
                  data-testid="assistant-general"
                  onClick={() => general && void openThread(general.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Sparkles className="ml-1 h-6 w-6 shrink-0 text-brand-text" strokeWidth={1.8} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">Asistente</span>
                    <span className="block truncate text-xs text-text-3">Pregunta lo que quieras</span>
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="assistant-collapse-left"
                  aria-label="Ocultar las conversaciones"
                  onClick={() => setPanels(false, rightOpen)}
                  className="hidden rounded p-1 text-text-3 hover:text-foreground lg:block"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>

            <div className="hidden min-h-0 flex-1 flex-col rounded-lg bg-surface p-4 shadow-card lg:flex">
              <div className="mb-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-text-3">
                <span>{showArchived ? "Archivados" : "Hilos"}</span>
                <button
                  type="button"
                  data-testid="assistant-select-mode"
                  onClick={() => {
                    setSelecting((s) => !s);
                    setPicked([]);
                  }}
                  className="text-[12px] font-medium normal-case tracking-normal text-brand-ink"
                >
                  {selecting ? "Listo" : "Seleccionar"}
                </button>
              </div>

              <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" data-testid="assistant-thread-list">
                {!showArchived && (
                  <button
                    type="button"
                    data-testid="assistant-new-thread"
                    onClick={() => void openThread(null)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-brand-ink hover:bg-subtle",
                      threadId === null && "bg-brand-tint"
                    )}
                  >
                    <Plus className="h-4 w-4" aria-hidden /> Nuevo hilo
                  </button>
                )}
                {visible.length === 0 && (
                  <p className="px-2 py-2 text-xs text-text-3" data-testid="assistant-no-threads">
                    {showArchived ? "No hay hilos archivados." : "Aún no hay hilos. Escribe en «Asistente» o abre uno nuevo."}
                  </p>
                )}
                {visible.map((t) => {
                  const on = picked.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      data-testid="assistant-thread-item"
                      data-thread-id={t.id}
                      aria-current={t.id === threadId ? "true" : undefined}
                      onClick={() => (selecting ? setPicked((p) => (on ? p.filter((x) => x !== t.id) : [...p, t.id])) : void openThread(t.id))}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-subtle",
                        t.id === threadId && !selecting && "bg-brand-tint"
                      )}
                    >
                      {selecting ? (
                        <span
                          aria-hidden
                          className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong bg-background")}
                        >
                          {on && <span className="text-[10px] leading-none">✓</span>}
                        </span>
                      ) : (
                        <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", t.id === threadId ? "bg-primary" : "bg-border-strong")} />
                      )}
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className="shrink-0 text-xs text-text-3">{dayLabel(t.updatedAt)}</span>
                    </button>
                  );
                })}
              </div>

              {selecting && (
                <div className="mt-3 flex items-center gap-2 border-t pt-3" data-testid="assistant-bulk-bar">
                  <span className="mr-auto text-xs text-text-3">{picked.length} seleccionad{picked.length === 1 ? "o" : "os"}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={picked.length === 0}
                    data-testid="assistant-bulk-archive"
                    onClick={() => void bulk(showArchived ? "unarchive" : "archive", picked)}
                  >
                    {showArchived ? <ArchiveRestore className="mr-1 h-3.5 w-3.5" aria-hidden /> : <Archive className="mr-1 h-3.5 w-3.5" aria-hidden />}
                    {showArchived ? "Desarchivar" : "Archivar"}
                  </Button>
                  <Button variant="outline" size="sm" disabled={picked.length === 0} data-testid="assistant-bulk-delete" onClick={() => void bulk("delete", picked)}>
                    <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Borrar
                  </Button>
                </div>
              )}

              <button
                type="button"
                data-testid="assistant-archived-toggle"
                onClick={() => {
                  setShowArchived((s) => !s);
                  setSelecting(false);
                  setPicked([]);
                }}
                className="mt-3 flex items-center justify-between border-t pt-3 text-[11px] font-semibold uppercase tracking-wider text-text-3 hover:text-foreground"
              >
                <span>{showArchived ? "Volver a hilos" : "Archivados"}</span>
                <span className="flex items-center gap-1 normal-case tracking-normal">
                  {!showArchived && archivedCount}
                  <ChevronRight className={cn("h-3.5 w-3.5", showArchived && "rotate-180")} aria-hidden />
                </span>
              </button>
            </div>
          </aside>
        )}

        {/* ── Centro: el chat ─────────────────────────────────────────────── */}
        <section className="flex min-h-[70dvh] min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface shadow-card lg:min-h-0" aria-label="Chat del asistente">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            {!leftOpen && (
              <button type="button" aria-label="Mostrar las conversaciones" data-testid="assistant-open-left" onClick={() => setPanels(true, rightOpen)} className="hidden rounded p-1 text-text-3 hover:text-foreground lg:block">
                <PanelLeftOpen className="h-4 w-4" aria-hidden />
              </button>
            )}
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" data-testid="assistant-title">{title}</h2>
            {current && current.kind === "thread" && (
              <Button
                variant="ghost"
                size="sm"
                data-testid="assistant-archive-current"
                onClick={() => void bulk(current.archived ? "unarchive" : "archive", [current.id])}
              >
                {current.archived ? <ArchiveRestore className="mr-1 h-3.5 w-3.5" aria-hidden /> : <Archive className="mr-1 h-3.5 w-3.5" aria-hidden />}
                {current.archived ? "Desarchivar" : "Archivar"}
              </Button>
            )}
            {!rightOpen && (
              <button type="button" aria-label="Mostrar el avance" data-testid="assistant-open-right" onClick={() => setPanels(leftOpen, true)} className="hidden rounded p-1 text-text-3 hover:text-foreground xl:block">
                <PanelRightOpen className="h-4 w-4" aria-hidden />
              </button>
            )}
          </header>

          {/* Celular: sin columna de hilos, un selector. */}
          <div className="shrink-0 border-b p-2 lg:hidden">
            <label className="sr-only" htmlFor="assistant-thread-select">Conversación</label>
            <select
              id="assistant-thread-select"
              data-testid="assistant-thread-select"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={threadId ?? ""}
              onChange={(e) => void openThread(e.target.value || null)}
            >
              <option value="">Hilo nuevo</option>
              {general && <option value={general.id}>Asistente</option>}
              {threads.filter((t) => !t.archived).map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-6">
            <div className="mx-auto w-full max-w-[680px] space-y-4">
              {!status ? (
                <p className={cn("text-sm", error ? "text-destructive" : "text-text-2")}>{error ?? "Cargando el asistente…"}</p>
              ) : (
                <section className="space-y-4" data-testid="assistant-messages" aria-live="polite">
                  {messages.length === 0 && !asking && (
                    <div className="py-10 text-center" data-testid="assistant-empty">
                      <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                        <Sparkles className="h-5 w-5" aria-hidden />
                      </span>
                      <p className="text-base font-semibold">¿En qué te ayudo?</p>
                      <p className="mx-auto mt-2 max-w-md text-sm text-text-3">
                        Pregúntame por el uso y el plan de tu organización, tus etiquetas, tu equipo o tus chats recientes; por tus conversaciones (por qué se pierden ventas, qué objeciones ponen tus clientes, cómo atiende cada asesor) o por cómo trabajan tus agentes de IA.
                      </p>
                    </div>
                  )}
                  {messages.map((m) =>
                    m.role === "user" ? (
                      <div key={m.id} className="flex justify-end">
                        <p className="max-w-[80%] whitespace-pre-wrap break-words rounded-[18px] bg-secondary px-4 py-2.5 text-sm" data-testid="assistant-msg-user">
                          {m.content}
                        </p>
                      </div>
                    ) : (
                      <AnswerBubble
                        key={m.id}
                        message={m}
                        threadId={threadId}
                        onProposals={(next) =>
                          setMessages((all) =>
                            all.map((x) => (x.id === m.id && x.meta ? { ...x, meta: { ...x.meta, proposals: next } } : x))
                          )
                        }
                      />
                    )
                  )}
                  {asking && pending && (
                    <div className="flex justify-end">
                      <p className="max-w-[80%] whitespace-pre-wrap break-words rounded-[18px] bg-secondary px-4 py-2.5 text-sm" data-testid="assistant-msg-pending">
                        {pending}
                      </p>
                    </div>
                  )}
                  {asking && (
                    <p className="text-sm text-text-3 motion-safe:animate-pulse" data-testid="assistant-thinking">
                      El asistente está revisando tus datos…
                    </p>
                  )}
                  <div ref={bottom} />
                </section>
              )}
              {status && error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>

          {status && (
            <form
              className="shrink-0 px-4 pb-3 pt-1"
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <div className="mx-auto w-full max-w-[680px]">
                {askError && (
                  <p className="mb-2 text-sm text-danger-text" role="alert" data-testid="assistant-ask-error">
                    {askError}
                  </p>
                )}
                {!asking && (
                  <div className="mb-2 flex flex-wrap gap-2" data-testid="assistant-suggestions">
                    {ASSISTANT_SUGGESTIONS.map((s, i) => (
                      <button
                        key={s.label}
                        type="button"
                        disabled={!canAsk}
                        onClick={() => void ask(s.question)}
                        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm text-text-2 hover:border-primary hover:text-foreground disabled:opacity-50"
                        data-testid="assistant-suggestion"
                      >
                        {i === 0 && <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />}
                        {s.label}
                      </button>
                    ))}
                    {viewer.hasModule("lab") && (
                      <Link
                        href="/lab/evaluaciones"
                        className="rounded-full border bg-card px-3 py-1.5 text-sm text-text-2 hover:border-primary hover:text-foreground"
                        data-testid="assistant-suggestion-simulados"
                      >
                        Prueba mi agente con clientes simulados
                      </Link>
                    )}
                  </div>
                )}
                <div className="flex items-end gap-2 rounded-[26px] border bg-background py-2 pl-5 pr-2 shadow-sm focus-within:border-primary">
                  <label className="sr-only" htmlFor="assistant-question">Tu pregunta</label>
                  <textarea
                    ref={areaRef}
                    id="assistant-question"
                    data-testid="assistant-question"
                    rows={1}
                    maxLength={MAX_QUESTION_CHARS}
                    placeholder={canAsk ? "Pregunta algo…" : "El asistente no puede responder ahora."}
                    value={question}
                    disabled={!canAsk || asking}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void ask();
                      }
                    }}
                    className="min-h-[34px] min-w-0 flex-1 resize-none self-center bg-transparent py-1.5 text-sm outline-none placeholder:text-text-4"
                  />
                  {question.trim() && (
                    <button
                      type="submit"
                      data-testid="assistant-ask"
                      disabled={!canAsk || asking}
                      aria-label="Enviar"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-50"
                    >
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
                <div className="mt-2 flex justify-center">
                  <SpeedPicker value={speed} onChange={setSpeed} />
                </div>
                <p className="mt-2 text-center text-xs text-text-4">{ASSISTANT_READ_ONLY_NOTICE}</p>
              </div>
            </form>
          )}
        </section>

        {/* ── Derecha: avance y crédito ───────────────────────────────────── */}
        {rightOpen && (
          <aside className="flex shrink-0 flex-col gap-3 lg:w-[300px] lg:overflow-y-auto" aria-label="Avance y crédito">
            <div className="rounded-lg bg-surface p-4 shadow-card" data-testid="assistant-progress">
              <div className="mb-4 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-text-3">
                <span>Avance</span>
                <button type="button" aria-label="Ocultar el avance" data-testid="assistant-collapse-right" onClick={() => setPanels(leftOpen, false)} className="hidden rounded p-0.5 hover:text-foreground xl:block">
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
              {asking ? (
                <Step state="now" label="Revisando tus datos…" />
              ) : progress.length === 0 ? (
                <p className="text-sm text-text-3">Aquí verás de qué consultas sale cada respuesta.</p>
              ) : (
                <ol className="relative">
                  <span aria-hidden className="absolute bottom-3 left-[10px] top-3 w-0.5 bg-border" />
                  {progress.map((s) => (
                    <Step key={s.id} state="done" label={s.label} hint={s.cited ? "usada en la respuesta" : "consultada"} />
                  ))}
                  <Step state="done" label="Respuesta lista" />
                </ol>
              )}
            </div>

            {status && (
              <section className="rounded-lg bg-surface p-4 shadow-card" data-testid="assistant-status" data-state={status.state}>
                <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-text-3">
                  <BotMessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <h3>Crédito del asistente</h3>
                </div>
                {meter && <UsageMeter meter={meter} label="Crédito del asistente" testId="assistant-credit" showLabel="never" />}
                <p
                  className={cn("mt-3 text-sm", status.canAsk ? "text-text-2" : "text-danger-text")}
                  data-testid="assistant-status-message"
                  role={status.canAsk ? undefined : "alert"}
                >
                  {status.message}
                </p>
                {status.canAsk && <p className="mt-1 text-xs text-text-3">Se renueva el {resetLabel(status.resetsOn)}.</p>}
              </section>
            )}
            {!bannerHidden && (
              <div
                role="note"
                data-testid="assistant-cost-banner"
                className="flex items-start gap-2 rounded-lg border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <p className="min-w-0 flex-1">{ASSISTANT_COST_NOTICE}</p>
                <button
                  type="button"
                  onClick={hideBanner}
                  aria-label="Quitar aviso"
                  data-testid="assistant-cost-banner-close"
                  className="shrink-0 rounded p-0.5 hover:bg-warning-soft"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            )}
          </aside>
        )}
      </div>

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
    </PageShell>
  );
}

/** Un paso de la línea de tiempo de «Avance». */
function Step({ state, label, hint }: { state: "done" | "now"; label: string; hint?: string }) {
  return (
    <li className="relative mb-4 flex gap-3 text-sm last:mb-0">
      <span
        aria-hidden
        className={cn(
          "z-10 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-2 text-[11px]",
          state === "done" ? "border-primary bg-primary text-primary-foreground" : "border-primary bg-surface motion-safe:animate-pulse"
        )}
      >
        {state === "done" ? "✓" : ""}
      </span>
      <span className="min-w-0">
        <span className="block break-words">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-text-3">{hint}</span>}
      </span>
    </li>
  );
}

/** Una respuesta con sus fuentes: qué consultas corrieron y lo que devolvió cada una. */
function AnswerBubble({
  message,
  threadId,
  onProposals,
}: {
  message: AssistantMessageDto;
  threadId: string | null;
  onProposals: (next: AssistantProposal[]) => void;
}) {
  const meta = message.meta;
  const sources = meta?.sources ?? [];
  const cited = sources.filter((s) => s.cited);
  const shown = cited.length > 0 ? cited : sources;
  return (
    <div className="flex justify-start">
      <div className="min-w-0 max-w-full" data-testid="assistant-msg-answer">
        <RichText text={message.content} testId="assistant-answer-text" />
        {threadId && meta?.proposals && meta.proposals.length > 0 && (
          <ProposalsCard threadId={threadId} messageId={message.id} proposals={meta.proposals} onChange={onProposals} />
        )}
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
        <div className="mt-2" data-testid="assistant-sources" data-count={meta?.queryCount ?? 0}>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
