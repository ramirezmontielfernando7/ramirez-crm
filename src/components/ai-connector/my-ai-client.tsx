"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Pencil, Plug, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ASSISTANT_NAME_MAX, DEFAULT_ASSISTANT_NAME } from "@/lib/ai-connector";
import { fetchJson, jsonInit } from "@/lib/fetch-json";

type Connection = {
  id: string;
  kind: "oauth" | "key";
  name: string;
  assistantName: string | null;
  scopes: ("read" | "write")[];
  tokenPrefix: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};
type Data = { allowed: boolean; connectorUrl: string; connections: Connection[] };

const fmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

/**
 * 047 PR 3 — Ajustes → IA conectada → Mi IA: cómo conectar Claude o ChatGPT
 * a TU cuenta, tus conexiones con «Desconectar» y la llave personal para
 * herramientas como n8n. Cada quien ve solo lo suyo.
 */
export function MyAiClient() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [assistantName, setAssistantName] = useState("");
  const [write, setWrite] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetchJson<Data>("/api/ai-connector/connections");
    if (!res.ok) return setError(res.error);
    setError(null);
    setData(res.data);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  async function createKey() {
    const res = await fetchJson<{ key: string }>("/api/ai-connector/connections", jsonInit("POST", { name, write, assistantName: assistantName.trim() || null }));
    if (!res.ok) return setError(res.error);
    setNewKey(res.data.key);
    setName("");
    setAssistantName("");
    setWrite(false);
    void refetch();
  }

  async function rename(c: Connection, next: string) {
    const res = await fetchJson(
      `/api/ai-connector/connections/${c.id}`,
      jsonInit("PATCH", { assistantName: next.trim() || null })
    );
    if (!res.ok) return setError(res.error);
    void refetch();
  }

  async function disconnect(c: Connection) {
    if (!window.confirm(`¿Desconectar «${c.name}»? Dejará de entrar a Dashfort al instante.`)) return;
    const res = await fetchJson(`/api/ai-connector/connections/${c.id}`, { method: "DELETE" });
    if (!res.ok) return setError(res.error);
    void refetch();
  }

  if (!data) {
    return <p className="text-sm text-muted-foreground">{error ?? "Cargando…"}</p>;
  }
  if (!data.allowed) {
    return (
      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Todavía no puedes conectar tu IA</CardTitle>
          <CardDescription>
            El Propietario decide si tu rol puede usar una IA propia (Claude, ChatGPT…) en Dashfort. Pídeselo: se
            enciende en Ajustes → IA conectada → Ajustes del conector.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Conecta tu propia IA para que haga tareas por ti: revisar tus chats, contestar, etiquetar o crear tareas. Tu
        IA entra con tu cuenta y solo ve y hace lo que tú puedes en Dashfort. La IA la pagas tú en tu plan de Claude
        o ChatGPT.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-brand-text" aria-hidden />
            Conectar Claude o ChatGPT
          </CardTitle>
          <CardDescription>Copia esta dirección y pégala en tu IA como conector personalizado.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input readOnly value={data.connectorUrl} aria-label="Dirección del conector" className="font-mono text-[13px]" />
            <Button variant="outline" onClick={() => void copy(data.connectorUrl, "url")}>
              <Copy className="mr-1.5 h-4 w-4" aria-hidden />
              {copied === "url" ? "Copiada" : "Copiar"}
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Steps
              title="Claude"
              steps={[
                "Abre Configuración → Conectores.",
                "Toca «Agregar conector personalizado» y pega la dirección.",
                "Entra con tu cuenta de Dashfort y toca «Aceptar».",
              ]}
            />
            <Steps
              title="ChatGPT (Plus o superior)"
              steps={[
                "Abre Configuración → Apps y conectores → Avanzado y enciende el modo desarrollador.",
                "Toca «Crear», pega la dirección y elige OAuth.",
                "Entra con tu cuenta de Dashfort y toca «Aceptar».",
              ]}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tus IAs conectadas</CardTitle>
          <CardDescription>Desconéctala cuando quieras: deja de entrar al instante.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no conectas ninguna IA.</p>
          ) : (
            <ul className="divide-y" data-testid="ai-connections">
              {data.connections.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-text-3">
                      {c.scopes.includes("write") ? "Lee y actúa" : "Solo lee"}
                      {c.kind === "key" && c.tokenPrefix ? ` · llave ${c.tokenPrefix}…` : ""}
                      {" · "}
                      {c.lastUsedAt ? `usada ${fmt.format(new Date(c.lastUsedAt))}` : "sin usar todavía"}
                    </p>
                    <AssistantNameRow connection={c} onSave={(next) => rename(c, next)} />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => void disconnect(c)}>
                    <Trash2 className="mr-1.5 h-4 w-4" aria-hidden />
                    Desconectar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-brand-text" aria-hidden />
            Llave personal
          </CardTitle>
          <CardDescription>
            Para herramientas que no tienen «Iniciar sesión», como n8n, Make o Cursor. Trátala como una contraseña.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {newKey ? (
            <div className="space-y-2 rounded-md border border-border bg-subtle p-3">
              <p className="text-sm font-medium">Cópiala ahora: no se vuelve a mostrar.</p>
              <div className="flex gap-2">
                <Input readOnly value={newKey} aria-label="Llave personal" className="font-mono text-[13px]" />
                <Button variant="outline" onClick={() => void copy(newKey, "key")}>
                  {copied === "key" ? "Copiada" : "Copiar"}
                </Button>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setNewKey(null)}>
                Listo
              </Button>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="ai-key-name">Nombre</Label>
                <Input id="ai-key-name" placeholder="Ej.: n8n de seguimiento" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-key-assistant">Nombre de tu IA en la Bandeja (opcional)</Label>
                <Input
                  id="ai-key-assistant"
                  placeholder={`Ej.: Joe · sin nombre dirá «${DEFAULT_ASSISTANT_NAME}»`}
                  value={assistantName}
                  maxLength={ASSISTANT_NAME_MAX}
                  onChange={(e) => setAssistantName(e.target.value)}
                />
              </div>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>Permitir que también actúe (enviar, etiquetar, crear tareas)</span>
                <Switch checked={write} onCheckedChange={setWrite} label="Permitir que también actúe" size="sm" />
              </label>
              <Button disabled={name.trim().length === 0} onClick={() => void createKey()}>
                Crear llave
              </Button>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Cómo firma esta IA lo que envía («Joe» con estrellitas azules en la
 * burbuja). Opcional: sin nombre, «Asistente».
 */
function AssistantNameRow({ connection: c, onSave }: { connection: Connection; onSave: (next: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.assistantName ?? "");
  if (!editing) {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-xs">
        <span className="inline-flex items-center gap-0.5 font-medium text-info-text">
          <Sparkles className="h-3 w-3" strokeWidth={1.7} aria-hidden />
          {c.assistantName ?? DEFAULT_ASSISTANT_NAME}
        </span>
        <span className="text-text-3">· así firma en la Bandeja</span>
        <button
          type="button"
          className="inline-flex items-center gap-0.5 text-brand-text hover:underline"
          onClick={() => {
            setDraft(c.assistantName ?? "");
            setEditing(true);
          }}
        >
          <Pencil className="h-3 w-3" aria-hidden />
          {c.assistantName ? "Cambiar nombre" : "Ponerle nombre"}
        </button>
      </p>
    );
  }
  return (
    <form
      className="mt-1.5 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(draft).then(() => setEditing(false));
      }}
    >
      <Input
        autoFocus
        aria-label="Nombre de tu IA"
        placeholder={`Ej.: Joe · vacío = «${DEFAULT_ASSISTANT_NAME}»`}
        value={draft}
        maxLength={ASSISTANT_NAME_MAX}
        onChange={(e) => setDraft(e.target.value)}
        className="h-8 max-w-[14rem] text-sm"
      />
      <Button type="submit" size="sm">
        Guardar
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
        Cancelar
      </Button>
    </form>
  );
}

function Steps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <ol className="list-decimal space-y-1 pl-4 text-sm text-text-2">
        {steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
