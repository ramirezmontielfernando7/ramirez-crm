"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { fetchJson, jsonInit } from "@/lib/fetch-json";

/**
 * 047 PR 3 — Aceptar (o no) que una app de IA actúe como tú en Dashfort.
 * Leer va siempre; actuar (enviar, etiquetar…) solo si la app lo pidió y la
 * persona lo deja encendido.
 */
export function ConsentCard({
  params,
  clientName,
  clientHost,
  canWrite,
}: {
  params: Record<string, string | undefined>;
  clientName: string;
  clientHost: string;
  canWrite: boolean;
}) {
  const [write, setWrite] = useState(canWrite);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(decision: "approve" | "deny") {
    setBusy(decision);
    setError(null);
    const res = await fetchJson<{ redirect: string }>(
      "/api/oauth/authorize",
      jsonInit("POST", { params, decision, scopes: write ? ["read", "write"] : ["read"] })
    );
    if (!res.ok) {
      setBusy(null);
      setError(res.error);
      return;
    }
    window.location.assign(res.data.redirect);
  }

  return (
    <Card className="shadow-md" data-testid="ai-consent">
      <CardHeader>
        <CardTitle>{clientName} quiere actuar como tú</CardTitle>
        <CardDescription>
          {clientHost ? <>La app de <span className="font-medium text-foreground">{clientHost}</span> pide entrar a Dashfort con tu cuenta.</> : "Una app de IA pide entrar a Dashfort con tu cuenta."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2 text-sm text-text-2">
          <Item ok>Ver tus chats, contactos, etapas y tareas, igual que tú en la Bandeja</Item>
          <Item ok={write}>Enviar mensajes, poner etiquetas, mover etapas y crear tareas por ti</Item>
          <Item ok={false}>Exportar contactos, mandar campañas, borrar o cambiar ajustes</Item>
        </ul>
        {canWrite && (
          <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-subtle px-3 py-2.5 text-sm">
            <span>Permitir que también actúe por mí</span>
            <Switch checked={write} onCheckedChange={setWrite} label="Permitir que también actúe por mí" size="sm" />
          </label>
        )}
        <p className="text-xs text-text-3">
          Todo lo que haga queda anotado en «Qué hizo tu IA». La puedes desconectar cuando quieras en Ajustes → IA conectada.
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button className="flex-1" disabled={busy !== null} onClick={() => void answer("approve")} data-testid="ai-consent-approve">
            {busy === "approve" ? "Conectando…" : "Aceptar"}
          </Button>
          <Button variant="outline" className="flex-1" disabled={busy !== null} onClick={() => void answer("deny")}>
            Cancelar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Item({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-text" aria-label="Sí" />
      ) : (
        <X className="mt-0.5 h-4 w-4 shrink-0 text-text-3" aria-label="No" />
      )}
      <span className={ok ? "" : "text-text-3"}>{children}</span>
    </li>
  );
}
