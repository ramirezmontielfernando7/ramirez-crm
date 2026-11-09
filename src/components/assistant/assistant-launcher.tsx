"use client";

import { SpeedPicker, useAssistantSpeed } from "./speed-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUp, Clock, Maximize2, Sparkles, X } from "lucide-react";
import { RichText } from "@/components/assistant/rich-text";
import { ProposalsCard } from "@/components/assistant/proposals-card";
import { useViewer } from "@/components/viewer-context";
import type { AssistantStatus } from "@/lib/assistant";
import type { AssistantMessageDto, AssistantProposal, AssistantThreadDto } from "@/lib/assistant-engine";
import { MAX_QUESTION_CHARS } from "@/lib/assistant-engine";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";

/**
 * Acceso rápido al asistente desde cualquier pantalla: Ctrl/⌘+K siempre abre
 * un panel chico (el Chat general o el hilo que se elija con el relojito) y un
 * botón discreto en la esquina, que cada persona puede ocultar. Solo íconos:
 * ⤢ abre la pantalla completa y ✕ cierra. Si falta aceptar el aviso de
 * consumo, lleva a la pantalla completa para aceptarlo allí.
 */

const HIDE_KEY = "assistant-launcher-hidden";

export function AssistantLauncher() {
  const viewer = useViewer();
  const pathname = usePathname();
  const router = useRouter();
  const allowed = viewer.hasModule("asistente") && viewer.can("assistant.use");
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [threads, setThreads] = useState<AssistantThreadDto[]>([]);
  const [general, setGeneral] = useState<AssistantThreadDto | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessageDto[]>([]);
  const [question, setQuestion] = useState("");
  const [speed, setSpeed] = useAssistantSpeed();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const onFullPage = pathname === "/asistente";

  useEffect(() => {
    try {
      if (localStorage.getItem(HIDE_KEY) === "1") setHidden(true);
    } catch {}
  }, []);

  const openThread = useCallback(async (id: string) => {
    setThreadId(id);
    setHistory(false);
    const r = await fetchJson<{ messages: AssistantMessageDto[] }>(`/api/assistant/threads/${encodeURIComponent(id)}`);
    if (r.ok) setMessages(r.data.messages);
  }, []);

  const load = useCallback(async () => {
    const [s, t] = await Promise.all([
      fetchJson<{ status: AssistantStatus }>("/api/assistant/status"),
      fetchJson<{ general: AssistantThreadDto; threads: AssistantThreadDto[] }>("/api/assistant/threads"),
    ]);
    if (s.ok) setStatus(s.data.status);
    if (t.ok) {
      setGeneral(t.data.general);
      setThreads(t.data.threads);
      return t.data.general;
    }
    return null;
  }, []);

  const show = useCallback(async () => {
    setOpen(true);
    setError(null);
    const g = await load();
    if (g && !threadId) await openThread(g.id);
    setTimeout(() => input.current?.focus(), 50);
  }, [load, openThread, threadId]);

  useEffect(() => {
    if (!allowed) return;
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (onFullPage) return;
        setOpen((o) => {
          if (o) return false;
          void show();
          return true;
        });
      } else if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allowed, onFullPage, show]);

  useEffect(() => setOpen(false), [pathname]);

  if (!allowed || onFullPage) return null;

  const ready = !!status?.canAsk && !!status.noticeAcceptedAt;
  const last = [...messages].reverse().find((m) => m.role === "assistant");

  async function ask() {
    const q = question.trim();
    if (!q || asking || !ready) return;
    setAsking(true);
    setPending(q);
    setError(null);
    setQuestion("");
    const r = await fetchJson<{ threadId: string; question: AssistantMessageDto; answer: AssistantMessageDto }>(
      "/api/assistant/ask",
      jsonInit("POST", { threadId: threadId ?? general?.id ?? null, question: q, speed })
    );
    setAsking(false);
    setPending(null);
    if (!r.ok) {
      setQuestion(q);
      setError(r.error);
      return;
    }
    setThreadId(r.data.threadId);
    setMessages((m) => [...m, r.data.question, r.data.answer]);
  }

  function setProposals(next: AssistantProposal[]) {
    if (!last) return;
    setMessages((all) => all.map((x) => (x.id === last.id && x.meta ? { ...x, meta: { ...x.meta, proposals: next } } : x)));
  }

  function hideButton() {
    setHidden(true);
    try {
      localStorage.setItem(HIDE_KEY, "1");
    } catch {}
  }

  return (
    <>
      {!open && !hidden && (
        <button
          type="button"
          onClick={() => void show()}
          aria-label="Abrir el asistente (Ctrl+K)"
          title="Asistente · Ctrl+K"
          data-testid="assistant-launcher"
          className="fixed bottom-4 right-4 z-40 hidden h-10 w-10 items-center justify-center rounded-full bg-surface text-brand-text opacity-60 shadow-card transition-opacity hover:opacity-100 lg:flex focus-visible:opacity-100"
          onContextMenu={(e) => {
            e.preventDefault();
            hideButton();
          }}
        >
          <Sparkles className="h-4 w-4" aria-hidden />
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Asistente"
          data-testid="assistant-quick"
          className="fixed bottom-4 right-4 z-50 flex max-h-[min(560px,calc(100dvh-2rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-surface shadow-card ring-1 ring-border"
        >
          <div className="flex items-center gap-1 border-b px-3 py-2">
            <Sparkles className="h-4 w-4 text-brand-text" aria-hidden />
            <span className="flex-1 text-sm font-semibold">Asistente</span>
            <button type="button" aria-label="Conversaciones recientes" data-testid="assistant-quick-history" onClick={() => setHistory((h) => !h)} className="rounded p-1.5 text-text-3 hover:bg-subtle">
              <Clock className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" aria-label="Abrir completo" data-testid="assistant-quick-expand" onClick={() => router.push("/asistente")} className="rounded p-1.5 text-text-3 hover:bg-subtle">
              <Maximize2 className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" aria-label="Cerrar" data-testid="assistant-quick-close" onClick={() => setOpen(false)} className="rounded p-1.5 text-text-3 hover:bg-subtle">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {history && (
            <ul className="max-h-48 overflow-y-auto border-b p-1 text-sm" data-testid="assistant-quick-threads">
              {general && (
                <li>
                  <button type="button" onClick={() => void openThread(general.id)} className="w-full truncate rounded px-2 py-1.5 text-left hover:bg-subtle">
                    Asistente (chat general)
                  </button>
                </li>
              )}
              {threads.slice(0, 8).map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => void openThread(t.id)} className="w-full truncate rounded px-2 py-1.5 text-left hover:bg-subtle">
                    {t.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="min-h-[80px] flex-1 overflow-y-auto px-3 py-3 text-sm">
            {status && !status.noticeAcceptedAt ? (
              <p className="text-text-2">
                Antes de usarlo, confirma el aviso de consumo en la{" "}
                <button type="button" className="font-medium text-brand-text underline" onClick={() => router.push("/asistente")}>
                  pantalla completa
                </button>
                .
              </p>
            ) : status && !status.canAsk ? (
              <p className="text-text-2">{status.message}</p>
            ) : last ? (
              <div data-testid="assistant-quick-answer">
                <RichText text={last.content} />
                {threadId && last.meta?.proposals && last.meta.proposals.length > 0 && (
                  <ProposalsCard threadId={threadId} messageId={last.id} proposals={last.meta.proposals} onChange={setProposals} />
                )}
              </div>
            ) : (
              <p className="text-text-3">Pregunta lo que quieras sobre tu CRM.</p>
            )}
            {asking && pending && (
              <div className="mt-2 flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-[18px] bg-secondary px-3 py-2" data-testid="assistant-quick-pending">{pending}</p>
              </div>
            )}
            {asking && <p className="mt-2 text-text-3 motion-safe:animate-pulse">El asistente está revisando tus datos…</p>}
            {error && (
              <p className="mt-2 text-danger-text" role="alert">
                {error}
              </p>
            )}
          </div>
          <div className="border-t p-2">
            <div className="relative">
              <textarea
                ref={input}
                rows={1}
                value={question}
                maxLength={MAX_QUESTION_CHARS}
                disabled={!ready}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void ask();
                  }
                }}
                placeholder="Pregunta algo…"
                data-testid="assistant-quick-input"
                className={cn("w-full resize-none rounded-[18px] border bg-surface py-2 pl-3 text-sm outline-none focus:border-border-strong", question.trim() ? "pr-11" : "pr-3")}
              />
              {question.trim() && (
                <button
                  type="button"
                  onClick={() => void ask()}
                  disabled={asking}
                  aria-label="Enviar"
                  data-testid="assistant-quick-send"
                  className="absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground"
                >
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
            <div className="mt-1.5 flex justify-center">
              <SpeedPicker value={speed} onChange={setSpeed} />
            </div>
            {!hidden && (
              <button type="button" onClick={hideButton} className="mt-1 text-[11px] text-text-4 hover:text-text-3" data-testid="assistant-quick-hide">
                Ocultar el botón (Ctrl+K sigue funcionando)
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
