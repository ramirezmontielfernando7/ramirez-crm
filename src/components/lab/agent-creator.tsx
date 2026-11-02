"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { call, type AgentConfig } from "@/components/lab/agents-api";
import { CREATOR_FIELD_LABEL, type CreatorField, type FieldUpdate } from "@/lib/agent-creator";

type Applied = { field: CreatorField; before: string | null; after: string; undone: boolean };
type Turn =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; applied: Applied[]; quick: string[] };

type CreatorOk = { reply: string; updates: FieldUpdate[]; quickReplies: string[] };

const MAX_HISTORY = 30;
const WELCOME =
  "¡Hola! Cuéntame de tu negocio con tus palabras y yo armo al agente. Te haré preguntas cortas y puedes pedirme ajustes cuando quieras. Para empezar: ¿a qué se dedica tu negocio y a quién le vende?";

function preview(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 140 ? `${t.slice(0, 140)}…` : t;
}

/**
 * Creador conversacional: chat limpio a la izquierda del editor. Cada cambio
 * que propone el modelo se pone en el BORRADOR del formulario (`onField`), así
 * el sandbox de la derecha lo usa al instante; se guarda con «Guardar
 * borrador» y solo «Publicar» llega a los clientes. «Deshacer» devuelve el
 * campo a como estaba.
 */
export function AgentCreator({ config, onField }: { config: AgentConfig; onField: (field: CreatorField, value: string | null) => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns.length, sending]);

  async function send(message: string) {
    const msg = message.trim();
    if (!msg || sending) return;
    const history = turns.map((t) => ({ role: t.role, text: t.text })).slice(-MAX_HISTORY);
    setTurns((t) => [...t, { id: `u${Date.now()}`, role: "user", text: msg }]);
    setText("");
    setError(null);
    setSending(true);
    const r = await call<CreatorOk>("/api/lab/creator", { method: "POST", json: { config, history, message: msg } });
    setSending(false);
    if (!r.ok) {
      setError(
        r.code === "quota_exceeded"
          ? "Se agotó la cuota mensual de IA de tu negocio."
          : r.code === "ai_not_configured"
            ? "Falta configurar tu proveedor de IA para usar el creador."
            : r.status === 413
              ? "La conversación ya es muy larga. Pulsa «Nueva conversación»."
              : r.message
      );
      return;
    }
    const applied: Applied[] = r.data.updates.map((u) => ({ field: u.field, before: config[u.field] ?? null, after: u.value, undone: false }));
    for (const u of r.data.updates) onField(u.field, u.value);
    setTurns((t) => [...t, { id: `a${Date.now()}`, role: "assistant", text: r.data.reply, applied, quick: r.data.quickReplies }]);
  }

  function undo(turnId: string, i: number) {
    const turn = turns.find((t) => t.id === turnId);
    const a = turn && turn.role === "assistant" ? turn.applied[i] : undefined;
    if (!a || a.undone) return;
    onField(a.field, a.before);
    setTurns((ts) => ts.map((t) => (t.id === turnId && t.role === "assistant" ? { ...t, applied: t.applied.map((x, j) => (j === i ? { ...x, undone: true } : x)) } : t)));
  }

  const last = turns[turns.length - 1];
  const quick = last && last.role === "assistant" ? last.quick : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-brand-ink" /> Creador del agente
        </span>
        <Button size="sm" variant="ghost" disabled={turns.length === 0 && !error} onClick={() => { setTurns([]); setError(null); }}>
          Nueva conversación
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-6" role="log" aria-live="polite" aria-label="Conversación con el creador">
        <p className="max-w-[92%] text-sm leading-relaxed">{WELCOME}</p>
        {turns.map((t) =>
          t.role === "user" ? (
            <div key={t.id} className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-secondary px-3.5 py-2.5 text-sm">
              {t.text}
            </div>
          ) : (
            <div key={t.id} className="max-w-[92%] text-sm leading-relaxed">
              <p className="whitespace-pre-wrap">{t.text}</p>
              {t.applied.map((a, i) => (
                <div key={i} className="mt-2 flex items-start gap-2.5 rounded-xl border bg-brand-tint px-3 py-2 text-[13px]">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-ink" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <b className="block text-brand-ink">{a.undone ? "Deshecho" : "Actualicé"}: {CREATOR_FIELD_LABEL[a.field]}</b>
                    <span className="block break-words text-muted-foreground">{preview(a.after)}</span>
                  </div>
                  {!a.undone && (
                    <button type="button" className="shrink-0 font-semibold text-brand-ink hover:underline" onClick={() => undo(t.id, i)}>
                      Deshacer
                    </button>
                  )}
                </div>
              ))}
            </div>
          )
        )}
        {sending && <p className="text-xs italic text-muted-foreground">pensando…</p>}
        {quick.length > 0 && !sending && (
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <button key={q} type="button" onClick={() => void send(q)} className="rounded-full border border-border-strong bg-background px-3 py-1.5 text-[13px] hover:border-foreground">
                {q}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <p role="alert" className="border-t px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <form
        className="m-3 flex items-end gap-2 rounded-2xl border border-border-strong bg-background p-2 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <label htmlFor="creator-input" className="sr-only">
          Mensaje para el creador
        </label>
        <textarea
          id="creator-input"
          rows={1}
          maxLength={2000}
          value={text}
          placeholder="Cuéntame de tu negocio o pide un ajuste…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
          className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
        />
        <Button type="submit" size="icon" aria-label="Enviar" disabled={sending || !text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
