"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AssignmentMode } from "@/lib/assignment-mode";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";

const OPTIONS: { value: AssignmentMode; label: string; hint: string }[] = [
  { value: "manual", label: "A mano", hint: "Los chats nuevos llegan sin asignar; el equipo los toma o un coordinador los reparte." },
  { value: "round_robin", label: "Por turnos (round robin)", hint: "Cada lead nuevo se asigna solo al siguiente asesor de la lista, uno tras otro." },
];

/** Reparto de leads nuevos: a mano o por turnos entre los asesores. Se guarda al elegir. */
export function AssignmentModeCard() {
  const [mode, setMode] = useState<AssignmentMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetchJson<{ mode: AssignmentMode }>("/api/settings/assignment-mode");
      if (!res.ok) setError(res.error);
      else setMode(res.data.mode);
    })();
  }, []);

  if (mode === null) return error ? <p className="text-sm text-danger-text">{error}</p> : null;

  async function choose(next: AssignmentMode) {
    const prev = mode;
    setMode(next);
    setError(null);
    setSaved(false);
    const res = await fetchJson<{ mode: AssignmentMode }>("/api/settings/assignment-mode", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: next }),
    });
    if (!res.ok) {
      setMode(prev);
      setError(res.error);
    } else setSaved(true);
  }

  return (
    <Card data-testid="assignment-mode-card">
      <CardHeader>
        <CardTitle>Cómo se reparten los chats nuevos</CardTitle>
        <CardDescription>Aplica a los clientes que escriben por primera vez.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div role="radiogroup" aria-label="Reparto de chats nuevos" className="space-y-2">
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                mode === o.value ? "border-brand bg-brand-tint" : "border-border"
              )}
            >
              <input type="radio" name="assignment-mode" checked={mode === o.value} onChange={() => void choose(o.value)} className="mt-1" />
              <span>
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {error && <p className="text-sm text-danger-text">{error}</p>}
        {saved && <p className="text-sm text-success-text">Guardado.</p>}
      </CardContent>
    </Card>
  );
}
