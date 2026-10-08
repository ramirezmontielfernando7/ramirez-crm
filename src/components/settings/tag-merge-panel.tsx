"use client";

import { useEffect, useState } from "react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import type { TagDto } from "@/lib/tags";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TagChip } from "@/components/tags/tag-chip";

type Impact = { source: TagDto; target: TagDto; moved: number; alreadyHad: number; audiences: number };

/**
 * Etiquetas limpias — Fusionar una etiqueta EN otra, con confirmación clara:
 * se elige el destino (solo etiquetas normales), se ve exactamente qué pasará
 * (contactos que pasan, los que ya la tenían, bases de Audiencias que cambian)
 * y recién entonces «Sí, fusionar». No se puede deshacer.
 */
export function TagMergePanel({
  source,
  targets,
  onDone,
  onCancel,
}: {
  source: TagDto;
  /** Solo etiquetas normales: una de sistema nunca es destino. */
  targets: TagDto[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [targetId, setTargetId] = useState("");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setImpact(null);
    setError(null);
    if (!targetId) return;
    let alive = true;
    setLoading(true);
    void fetchJson<{ impact: Impact }>(`/api/contact-tags/${source.id}/merge?targetId=${encodeURIComponent(targetId)}`).then(
      (res) => {
        if (!alive) return;
        setLoading(false);
        if (res.ok) setImpact(res.data.impact);
        else setError(res.error);
      }
    );
    return () => {
      alive = false;
    };
  }, [source.id, targetId]);

  async function merge() {
    setBusy(true);
    setError(null);
    const res = await fetchJson(`/api/contact-tags/${source.id}/merge`, jsonInit("POST", { targetId }));
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone();
  }

  return (
    <div className="mt-2 space-y-3 rounded-md border bg-muted/40 p-3" data-testid="tag-merge-panel">
      <div className="space-y-1.5">
        <Label htmlFor={`merge-${source.id}`}>
          Fusionar «{source.name}» en…
        </Label>
        <select
          id={`merge-${source.id}`}
          data-testid="tag-merge-target"
          value={targetId}
          disabled={busy}
          onChange={(e) => setTargetId(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
        >
          <option value="">Elige la etiqueta que se queda…</option>
          {targets
            .filter((t) => t.id !== source.id)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </div>
      {loading && <p className="text-sm text-muted-foreground">Calculando…</p>}
      {impact && (
        <div className="space-y-2 text-sm" data-testid="tag-merge-confirm">
          <p>
            {impact.moved > 0 ? (
              <>
                <b>{impact.moved}</b> contacto(s) pasarán a <TagChip tag={impact.target} className="align-middle" />
                {impact.alreadyHad > 0 ? ` (${impact.alreadyHad} ya la tenían y no se duplican)` : ""}.
              </>
            ) : (
              <>
                Ningún contacto cambia: los {impact.alreadyHad} que la llevan ya tienen{" "}
                <TagChip tag={impact.target} className="align-middle" />.
              </>
            )}
          </p>
          <p>
            «{impact.source.name}» <b>desaparecerá</b>
            {impact.audiences > 0
              ? `; ${impact.audiences} base(s) de Audiencias que la usaban pasarán a mostrar «${impact.target.name}»`
              : ""}
            . Los contactos no se borran. <b>No se puede deshacer.</b>
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" data-testid="tag-merge-submit" disabled={!impact || busy} onClick={() => void merge()}>
          {busy ? "Fusionando…" : "Sí, fusionar"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
