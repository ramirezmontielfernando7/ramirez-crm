"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AssistantProposal } from "@/lib/assistant-engine";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";

/**
 * Los cambios que el asistente PROPONE en una respuesta: una tarjeta con la
 * lista y los botones «Aplicar» / «Cancelar». Nada corre hasta que la persona
 * aprueba; entonces cada cambio queda «Hecho» o «No se pudo» con su motivo.
 */
export function ProposalsCard({
  threadId,
  messageId,
  proposals,
  onChange,
}: {
  threadId: string;
  messageId: string;
  proposals: AssistantProposal[];
  onChange: (next: AssistantProposal[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = proposals.filter((p) => p.status === "pending");

  async function act(action: "apply" | "cancel") {
    setBusy(true);
    setError(null);
    const r = await fetchJson<{ proposals: AssistantProposal[] }>(
      "/api/assistant/actions",
      jsonInit("POST", { threadId, messageId, action })
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    onChange(r.data.proposals);
  }

  return (
    <div
      className={cn("mt-3 rounded-lg border p-3", pending.length > 0 ? "border-warning-soft bg-warning-tint" : "bg-subtle")}
      data-testid="assistant-proposals"
      data-pending={pending.length}
    >
      <p className={cn("text-sm font-semibold", pending.length > 0 ? "text-warning-text" : "text-text-2")}>
        {pending.length > 0 ? `Confirmar ${pending.length} ${pending.length === 1 ? "cambio" : "cambios"}` : "Cambios"}
      </p>
      <ul className="mt-2 space-y-1.5">
        {proposals.map((p) => (
          <li key={p.id} className="flex items-start gap-2 text-sm" data-testid="assistant-proposal" data-status={p.status}>
            <span
              aria-hidden
              className={cn(
                "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px]",
                p.status === "applied" && "bg-primary text-primary-foreground",
                p.status === "failed" && "bg-destructive text-destructive-foreground",
                p.status === "cancelled" && "bg-secondary text-text-3",
                p.status === "pending" && "border border-border-strong"
              )}
            >
              {p.status === "applied" ? <Check className="h-3 w-3" /> : p.status === "failed" || p.status === "cancelled" ? <X className="h-3 w-3" /> : null}
            </span>
            <span className="min-w-0">
              <span className={cn("block break-words", p.status === "cancelled" && "text-text-3 line-through")}>{p.label}</span>
              {p.status === "applied" && <span className="block text-xs text-text-3">Hecho</span>}
              {p.status === "failed" && <span className="block text-xs text-danger-text">No se pudo: {p.result}</span>}
            </span>
          </li>
        ))}
      </ul>
      {pending.length > 0 && (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void act("apply")} data-testid="assistant-proposals-apply">
            {busy ? "Aplicando…" : "Aplicar"}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void act("cancel")} data-testid="assistant-proposals-cancel">
            Cancelar
          </Button>
        </div>
      )}
      {error && (
        <p className="mt-2 text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
