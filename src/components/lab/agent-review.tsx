"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CREATOR_FIELD_LABEL, wordDiff, type CreatorField } from "@/lib/agent-creator";

export type ReviewSuggestionDto = { field: CreatorField; title: string; reason: string; value: string; before: string | null };

/**
 * Resultado de «Revisar este chat»: sugerencias de ajuste al prompt con la
 * diferencia a la vista (rojo = se quita, verde = se agrega). «Aplicar» lo
 * pone en el borrador del formulario (el sandbox lo usa al instante).
 */
export function AgentReview({
  summary,
  suggestions,
  onApply,
  onClose,
}: {
  summary: string;
  suggestions: ReviewSuggestionDto[];
  onApply: (s: ReviewSuggestionDto) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<Record<number, "applied" | "ignored">>({});
  return (
    <section aria-label="Revisión de este chat" className="mx-3 mb-2 max-h-[60vh] overflow-y-auto rounded-2xl border bg-background p-4 shadow-md">
      <div className="flex items-center gap-2">
        <b className="text-sm">✦ Revisión de este chat</b>
        <span className="text-xs text-muted-foreground">{suggestions.length === 1 ? "1 sugerencia" : `${suggestions.length} sugerencias`}</span>
        <button type="button" aria-label="Cerrar revisión" className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      {summary && <p className="mt-2 text-sm text-muted-foreground">{summary}</p>}
      {suggestions.length === 0 && <p className="mt-2 text-sm">No encontré nada que ajustar en esta conversación.</p>}
      {suggestions.map((s, i) => (
        <div key={i} className="mt-3 border-t pt-3 text-sm">
          <b>{s.title}</b>
          {s.reason && <p className="text-xs text-muted-foreground">{s.reason}</p>}
          <p className="mt-1.5 text-xs font-medium text-muted-foreground">Cambio sugerido en {CREATOR_FIELD_LABEL[s.field]}:</p>
          <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted/30 p-2 leading-relaxed">
            {wordDiff(s.before ?? "", s.value).map((p, j) =>
              p.kind === "del" ? (
                <del key={j} className="rounded bg-red-100 px-0.5 text-red-900 no-underline line-through dark:bg-red-950 dark:text-red-200">{p.text} </del>
              ) : p.kind === "ins" ? (
                <ins key={j} className="rounded bg-green-100 px-0.5 text-green-900 no-underline dark:bg-green-950 dark:text-green-200">{p.text} </ins>
              ) : (
                <span key={j}>{p.text} </span>
              )
            )}
          </p>
          <div className="sticky bottom-0 -mx-1 mt-2 flex gap-2 bg-background px-1 py-1.5">
            {state[i] === "applied" ? (
              <span className="text-xs font-medium text-brand-ink">✓ Aplicado al borrador</span>
            ) : state[i] === "ignored" ? (
              <span className="text-xs text-muted-foreground">Ignorada</span>
            ) : (
              <>
                <Button size="sm" onClick={() => { onApply(s); setState((st) => ({ ...st, [i]: "applied" })); }}>
                  Aplicar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setState((st) => ({ ...st, [i]: "ignored" }))}>
                  Ignorar
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
      <p className="mt-3 text-xs text-muted-foreground">Al aplicar, el sandbox usa el cambio de inmediato. Nada llega a tus clientes hasta «Publicar».</p>
    </section>
  );
}
