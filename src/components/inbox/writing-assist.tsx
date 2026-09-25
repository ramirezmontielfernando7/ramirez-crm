"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { ChevronDown, WandSparkles } from "lucide-react";
import { SPRING } from "@/components/motion";
import { cn } from "@/lib/utils";

/**
 * 023 — La varita del editor: asistente de redacción del ASESOR.
 *
 * No tiene nada que ver con el agente que contesta a los clientes: solo
 * reescribe el borrador y lo devuelve al editor. Quien lo usa decide si lo
 * envía. Todos los roles.
 */

type Action = "improve" | "tone" | "summarize" | "shorten" | "lengthen";
type Tone = "formal" | "casual" | "empatico";

/** Las que van debajo de "Cambiar tono". */
const OPCIONES: { action: Exclude<Action, "tone" | "improve">; label: string }[] = [
  { action: "summarize", label: "Resumir" },
  { action: "shorten", label: "Hacer más corto" },
  { action: "lengthen", label: "Hacer más largo" },
];

const TONOS: { tone: Tone; label: string }[] = [
  { tone: "formal", label: "Formal" },
  { tone: "casual", label: "Casual" },
  { tone: "empatico", label: "Empático" },
];

export function WritingAssist({
  text,
  busy,
  onBusy,
  onResult,
  onError,
}: {
  text: string;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  /** El texto nuevo; quien llama guarda el original para "Deshacer". */
  onResult: (next: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tones, setTones] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/writing-assist")
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d: { available?: boolean }) => {
        if (!cancelled) setAvailable(Boolean(d.available));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const empty = text.trim().length === 0;
  const disabled = busy || empty || available === false;
  const title = available === false
    ? "IA no configurada"
    : empty
      ? "Escribe algo primero"
      : "Asistente de redacción con IA";

  async function run(action: Action, tone?: Tone) {
    setOpen(false);
    setTones(false);
    onBusy(true);
    try {
      const res = await fetch("/api/writing-assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, tone, text }),
      });
      const data = (await res.json().catch(() => null)) as
        | { text?: string; error?: { message?: string } }
        | null;
      if (!res.ok || typeof data?.text !== "string") {
        onError(data?.error?.message ?? `La IA no respondió (error ${res.status})`);
        return;
      }
      onResult(data.text);
    } catch {
      onError("No se pudo contactar a la IA. Revisa tu conexión.");
    } finally {
      onBusy(false);
    }
  }

  const item =
    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12.5px] text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => {
          setTones(false);
          setOpen((v) => !v);
        }}
        disabled={disabled}
        aria-label="Asistente de redacción con IA"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={busy}
        title={title}
        className={cn(
          "rounded p-1.5 text-text-3 transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none",
          disabled && !busy && "opacity-40",
          (open || busy) && "bg-secondary text-brand"
        )}
      >
        {busy ? (
          <span
            className="block h-[18px] w-[18px] animate-spin rounded-full border-2 border-border-strong border-t-brand"
            aria-label="La IA está escribiendo"
          />
        ) : (
          <WandSparkles className="h-[18px] w-[18px]" strokeWidth={1.7} />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <m.div
            role="menu"
            aria-label="Asistente de redacción"
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 2, transition: { duration: 0.1 } }}
            transition={SPRING}
            style={{ transformOrigin: "bottom left" }}
            className="absolute bottom-full left-0 z-30 mb-2 w-56 rounded-md border bg-popover p-1.5 text-foreground shadow-pop"
          >
            <p className="kicker px-2 pb-1 pt-1">Asistente de redacción</p>
            <button role="menuitem" type="button" className={item} onClick={() => void run("improve")}>
              Mejorar redacción
            </button>
            <button
              role="menuitem"
              type="button"
              aria-haspopup="menu"
              aria-expanded={tones}
              className={cn(item, tones && "bg-accent")}
              onClick={() => setTones((v) => !v)}
            >
              <span className="flex-1">Cambiar tono</span>
              <ChevronDown
                className={cn("h-3.5 w-3.5 text-text-3 transition-transform", tones && "rotate-180")}
                strokeWidth={2}
              />
            </button>
            {tones && (
              <div role="menu" aria-label="Tono" className="mb-1 ml-3 border-l pl-1.5">
                {TONOS.map((t) => (
                  <button
                    key={t.tone}
                    role="menuitem"
                    type="button"
                    className={item}
                    onClick={() => void run("tone", t.tone)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            {OPCIONES.map((o) => (
              <button
                key={o.action}
                role="menuitem"
                type="button"
                className={item}
                onClick={() => void run(o.action)}
              >
                {o.label}
              </button>
            ))}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
