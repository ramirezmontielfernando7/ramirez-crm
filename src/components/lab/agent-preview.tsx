"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FlaskConical, RotateCcw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageBubble } from "@/components/inbox/message-bubble";
import { call, type AgentConfig } from "@/components/lab/agents-api";
import type { MessageDto } from "@/lib/types";

type Chip = { kind: string; label: string };
type Debug = {
  action: string;
  model: string | null;
  tokens: { prompt: number; completion: number } | null;
  ms: number;
  kbEntryIds: string[];
  /** 037 — Documentos consultados y de dónde vienen. */
  docs?: { title: string; from: string }[];
};
type PreviewOk = { ok: true; reply: string | null; chips: Chip[]; escalated: boolean; debug: Debug };

type Turn =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string | null; chips: Chip[]; debug: Debug };

const MAX_HISTORY = 20;

/** Un mensaje de la vista previa, vestido como los de la Bandeja (misma burbuja). */
function asDto(id: string, direction: "in" | "out", text: string): MessageDto {
  return {
    id,
    conversationId: "preview",
    direction,
    type: "text",
    text,
    status: "read",
    error: null,
    aiGenerated: false,
    origin: direction === "out" ? "ai" : "operator",
    media: null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * 031 (A2) — Vista previa tipo chat. SIN estado en el servidor: el historial
 * vive aquí y se manda completo (≤ 20) en cada mensaje, junto con lo que hay
 * HOY en el formulario aunque no esté guardado. No ejecuta nada: lo que el
 * agente haría sale como chips. Solo gasta cuota de IA.
 */
export function AgentPreview({ agentId, config }: { agentId: string; config: AgentConfig }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, sending]);

  async function send() {
    const message = text.trim();
    if (!message || sending) return;
    const history = turns
      .filter((t) => t.text)
      .map((t) => ({ role: t.role, text: t.text as string }))
      .slice(-MAX_HISTORY);
    setTurns((t) => [...t, { id: `u${Date.now()}`, role: "user", text: message }]);
    setText("");
    setError(null);
    setSending(true);
    const r = await call<PreviewOk>("/api/lab/preview", { method: "POST", json: { agentId, config, history, message } });
    setSending(false);
    if (!r.ok) {
      setError(
        r.code === "quota_exceeded"
          ? "Se agotó la cuota mensual de IA de tu negocio."
          : r.code === "ai_not_configured"
            ? "Falta configurar tu proveedor de IA para probar al agente."
            : r.code === "preview_rate_limited"
              ? r.message
              : r.status === 413
                ? "La conversación de prueba ya es muy larga. Pulsa «Reiniciar»."
                : r.message
      );
      return;
    }
    const res = r.data;
    setTurns((t) => [...t, { id: `a${Date.now()}`, role: "assistant", text: res.reply, chips: res.chips, debug: res.debug }]);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <Badge variant="secondary" className="gap-1">
          <FlaskConical className="h-3 w-3" /> Sandbox · no se envía a WhatsApp
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setTurns([]);
            setError(null);
          }}
          disabled={turns.length === 0 && !error}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reiniciar
        </Button>
      </div>

      <div className="thread-bg flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto px-3 py-4" role="log" aria-live="polite" aria-label="Conversación de prueba">
        {turns.length === 0 && !sending && (
          <p className="m-auto max-w-xs text-center text-sm text-muted-foreground">
            Escribe como si fueras un cliente. Aquí ves cómo responde con lo que tienes en el formulario, aunque no lo hayas guardado.
          </p>
        )}
        {turns.map((t, i) => {
          const prev = turns[i - 1];
          const grouped = prev !== undefined && prev.role === t.role;
          const out = t.role === "assistant";
          return (
            <div key={t.id} className={grouped ? "mt-[3px]" : "mt-2.5"}>
              {t.text && (
                <div className={out ? "flex justify-end" : "flex justify-start"}>
                  <MessageBubble m={asDto(t.id, out ? "out" : "in", t.text)} grouped={grouped} wide />
                </div>
              )}
              {t.role === "assistant" && (
                <div className="mt-1.5 flex flex-col items-end gap-1.5">
                  {t.chips.length > 0 && (
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {t.chips.map((c, j) => (
                        <Badge key={j} variant={c.kind === "degraded" ? "warning" : "secondary"} className="font-normal">
                          {c.label}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <Why debug={t.debug} />
                </div>
              )}
            </div>
          );
        })}
        {sending && <p className="mt-2.5 text-xs italic text-muted-foreground">escribiendo…</p>}
        <div ref={endRef} />
      </div>

      {error && (
        <p role="alert" className="border-t px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label htmlFor="preview-input" className="sr-only">
          Mensaje de prueba
        </label>
        <textarea
          id="preview-input"
          rows={1}
          maxLength={2000}
          value={text}
          placeholder="Escribe un mensaje de prueba…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          className="max-h-32 min-h-9 flex-1 resize-none rounded-2xl border border-border-strong bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="icon" aria-label="Enviar mensaje de prueba" disabled={sending || !text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

/** «Por qué respondió así»: plegado; es para quien quiere afinar. */
function Why({ debug }: { debug: Debug }) {
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1 hover:text-foreground">
        Por qué respondió así
        <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
      </summary>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-md border bg-card px-3 py-2">
        <dt>Decisión</dt>
        <dd className="text-foreground">{debug.action}</dd>
        <dt>Modelo</dt>
        <dd className="text-foreground">{debug.model ?? "—"}</dd>
        <dt>Tokens</dt>
        <dd className="text-foreground">{debug.tokens ? `${debug.tokens.prompt} + ${debug.tokens.completion}` : "—"}</dd>
        <dt>Tiempo</dt>
        <dd className="text-foreground">{debug.ms} ms</dd>
        <dt>Conocimiento usado</dt>
        <dd className="text-foreground">{debug.kbEntryIds.length} entradas</dd>
        {debug.docs && debug.docs.length > 0 && (
          <>
            <dt>Documentos</dt>
            <dd className="text-foreground" data-testid="preview-docs">
              <ul className="space-y-0.5">
                {debug.docs.map((d, i) => (
                  <li key={i} className="break-words">
                    {d.title} <span className="text-muted-foreground">· {d.from}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </details>
  );
}
