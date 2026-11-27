"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CHAT_VIEW_OPTIONS, type ChatView } from "@/lib/chat-visibility";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";

/**
 * «Qué chats ven los asesores»: solo los suyos, los suyos y los sin asignar
 * (con «Tomar este chat»), o todos. El servidor lo exige en cada consulta;
 * esto solo lo elige quien administra los ajustes. Propietario y
 * Coordinador siempre ven todo.
 */
export function ChatVisibilityCard() {
  const [view, setView] = useState<ChatView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetchJson<{ view: ChatView }>("/api/settings/chat-visibility");
      if (!res.ok) setError(res.error);
      else setView(res.data.view);
    })();
  }, []);

  if (view === null) return error ? <p className="text-sm text-danger-text">{error}</p> : null;

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await fetchJson<{ view: ChatView }>("/api/settings/chat-visibility", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ view }),
    });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else setSaved(true);
  }

  return (
    <Card data-testid="chat-visibility-card">
      <CardHeader>
        <CardTitle>Qué chats ven los asesores</CardTitle>
        <CardDescription>
          Propietario y coordinadores siempre ven todos los chats. Aquí eliges qué ven los asesores.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="radiogroup" aria-label="Qué chats ven los asesores" className="space-y-2">
          {CHAT_VIEW_OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3",
                view === o.value ? "border-brand bg-brand-tint" : "border-border"
              )}
            >
              <input
                type="radio"
                name="chat-visibility"
                value={o.value}
                checked={view === o.value}
                onChange={() => {
                  setView(o.value);
                  setSaved(false);
                }}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">{o.label}</span>
                <span className="block text-xs text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {error && <p className="text-sm text-danger-text">{error}</p>}
        {saved && <p className="text-sm text-success-text">Guardado.</p>}
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </Button>
      </CardContent>
    </Card>
  );
}
