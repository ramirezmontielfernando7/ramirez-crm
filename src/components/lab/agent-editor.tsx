"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Pencil } from "lucide-react";
import { AgentConfigForm } from "@/components/agent/agent-config-form";
import { AgentDocSources } from "@/components/lab/agent-doc-sources";
import { AgentKbPanel } from "@/components/lab/agent-kb-panel";
import { AgentPreview } from "@/components/lab/agent-preview";
import { ConfirmDialog } from "@/components/lab/confirm-dialog";
import {
  call,
  formatDate,
  NO_NAME_LABEL,
  STATUS_LABEL,
  type AgentConfig,
  type AgentDetail,
  type AgentSummary,
  type AgentVersion,
} from "@/components/lab/agents-api";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const FIELD_LABEL: Record<string, string> = {
  displayName: "nombre de presentación",
  tone: "tono",
  greeting: "saludo",
  instructions: "instrucciones",
  escalationRules: "reglas de escalado",
  useSharedKb: "uso del conocimiento compartido",
  docSources: "documentos que consulta",
};
const ACTION_LABEL: Record<AgentVersion["action"], string> = {
  publish: "Publicada",
  restore: "Restaurada al borrador",
  legacy_put: "Editada desde «Agente»",
  make_general: "Hecha general",
};

function norm(c: AgentConfig): AgentConfig {
  return { ...c, displayName: c.displayName?.trim() || null };
}
function changedFields(a: AgentConfig, b: AgentConfig | null): string[] {
  if (!b) return Object.keys(FIELD_LABEL).map((k) => FIELD_LABEL[k]!);
  return (Object.keys(FIELD_LABEL) as (keyof AgentConfig)[])
    .filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null))
    .map((k) => FIELD_LABEL[k]!);
}

type Dialog = "publish" | "general" | "archive" | null;

/**
 * 031 (A2) — Editor de un agente: formulario a la izquierda, vista previa tipo
 * chat a la derecha (en el teléfono, pestañas Configurar / Probar). Guardar
 * borrador nunca cambia producción; solo «Publicar» lo hace.
 * 037 (PR 2): `documents` (KB_DOCS encendido) muestra «Documentos»: de qué
 * documentos lee el agente.
 */
export function AgentEditor({ id, documents = false }: { id: string; documents?: boolean }) {
  const router = useRouter();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [cfg, setCfg] = useState<AgentConfig | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AgentSummary | null>(null);
  const [versions, setVersions] = useState<AgentVersion[] | null>(null);
  const [tab, setTab] = useState<"config" | "probar">("config");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [restoring, setRestoring] = useState<AgentVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const load = useCallback(async () => {
    const [a, list] = await Promise.all([call<{ agent: AgentDetail }>(`/api/lab/agents/${id}`), call<{ agents: AgentSummary[] }>("/api/lab/agents")]);
    if (!a.ok) {
      if (a.status === 404) setNotFound(true);
      else setLoadError(a.message);
      return;
    }
    setAgent(a.data.agent);
    // Solo la primera carga llena el formulario: una recarga tardía (p. ej. la
    // segunda del modo estricto de React en desarrollo) no debe borrar lo que
    // la persona ya escribió.
    setCfg((cur) => cur ?? a.data.agent.draft);
    if (list.ok) setSummary(list.data.agents.find((x) => x.id === id) ?? null);
  }, [id]);

  const loadVersions = useCallback(async () => {
    const r = await call<{ versions: AgentVersion[] }>(`/api/lab/agents/${id}/versions`);
    if (r.ok) setVersions(r.data.versions);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => !!agent && !!cfg && JSON.stringify(norm(cfg)) !== JSON.stringify(norm(agent.draft)), [agent, cfg]);

  // Avisa antes de cerrar la pestaña con cambios sin guardar.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  if (notFound) {
    return (
      <div className="p-6 text-sm">
        <p className="mb-2">No encontramos este agente (puede que ya esté archivado).</p>
        <Link href="/lab" className="font-medium text-brand-ink hover:underline">
          ← Volver a los agentes
        </Link>
      </div>
    );
  }
  if (loadError) return <p className="p-6 text-sm text-destructive">{loadError}</p>;
  if (!agent || !cfg) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Cargando…</div>;
  }

  const draftOnly = agent.status === "draft";
  const pending = agent.status === "changes" || dirty || draftOnly;

  async function saveDraft(): Promise<boolean> {
    if (!cfg) return false;
    setBusy(true);
    setError(null);
    const r = await call<{ agent: AgentDetail }>(`/api/lab/agents/${id}/draft`, { method: "PUT", json: norm(cfg) });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return false;
    }
    setAgent(r.data.agent);
    setCfg(r.data.agent.draft);
    setNote("Borrador guardado. Tus clientes no notan ningún cambio.");
    return true;
  }

  async function publish() {
    if (dirty && !(await saveDraft())) return setDialog(null);
    setBusy(true);
    const r = await call<{ agent: AgentDetail }>(`/api/lab/agents/${id}/publish`, { method: "POST" });
    setBusy(false);
    setDialog(null);
    if (!r.ok) return setError(r.message);
    setAgent(r.data.agent);
    setCfg(r.data.agent.draft);
    setNote(agent?.isGeneral ? "Publicado. Ya atiende a tus clientes." : "Publicado.");
    setVersions(null);
    void load();
  }

  async function makeGeneral() {
    setBusy(true);
    const r = await call(`/api/lab/agents/${id}/make-general`, { method: "POST" });
    setBusy(false);
    setDialog(null);
    if (!r.ok) return setError(r.code === "not_published" ? "Primero publica este agente para poder hacerlo general." : r.message);
    setNote("Listo: este agente ahora es el general.");
    void load();
  }

  async function archive() {
    setBusy(true);
    const r = await call(`/api/lab/agents/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) {
      setDialog(null);
      return setError(r.message);
    }
    router.push("/lab");
  }

  async function restore(v: AgentVersion) {
    setBusy(true);
    const r = await call<{ agent: AgentDetail }>(`/api/lab/agents/${id}/versions/${v.id}/restore`, { method: "POST" });
    setBusy(false);
    setRestoring(null);
    if (!r.ok) return setError(r.message);
    setAgent(r.data.agent);
    setCfg(r.data.agent.draft);
    setNote("Versión cargada en el borrador. Revísala y pulsa «Publicar» cuando quieras que atienda.");
    void loadVersions();
  }

  async function rename() {
    const name = nameDraft.trim();
    if (!name) return;
    const r = await call<{ agent: AgentDetail }>(`/api/lab/agents/${id}`, { method: "PATCH", json: { internalName: name } });
    if (!r.ok) return setError(r.message);
    setAgent((a) => (a ? { ...a, internalName: r.data.agent.internalName } : a));
    setRenaming(false);
  }

  const kbKey = String(cfg.useSharedKb);
  const status = dirty ? "Cambios sin guardar" : STATUS_LABEL[agent.status];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Encabezado del agente */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 sm:px-6">
        <Link href="/lab" aria-label="Volver a los agentes" className={buttonVariants({ variant: "ghost", size: "icon" })}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {renaming ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void rename();
            }}
          >
            <label htmlFor="agent-internal-name" className="sr-only">
              Nombre interno
            </label>
            <Input id="agent-internal-name" autoFocus maxLength={60} className="h-8 w-56" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
            <Button size="sm" type="submit" disabled={!nameDraft.trim()}>
              Guardar
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setRenaming(false)}>
              Cancelar
            </Button>
          </form>
        ) : (
          <>
            <span className="text-base font-semibold text-foreground">{agent.internalName}</span>
            <button
              type="button"
              aria-label="Renombrar"
              title="Cambiar el nombre interno"
              className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                setNameDraft(agent.internalName);
                setRenaming(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {agent.isGeneral && <Badge variant="default">General</Badge>}
        <Badge variant={dirty ? "warning" : agent.status === "published" ? "success" : agent.status === "changes" ? "warning" : "secondary"}>{status}</Badge>
      </div>

      {/* Pestañas solo en pantallas chicas */}
      <div role="tablist" aria-label="Editor y vista previa" className="flex border-b lg:hidden">
        {(["config", "probar"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn("flex-1 border-b-2 py-2 text-sm", tab === t ? "border-brand font-medium" : "border-transparent text-muted-foreground")}
          >
            {t === "config" ? "Configurar" : "Probar"}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[45fr_55fr]">
        {/* Izquierda: formulario */}
        <div className={cn("min-h-0 overflow-y-auto", tab === "probar" && "hidden lg:block")}>
          <div className="mx-auto max-w-xl space-y-5 p-4 sm:p-6">
            {agent.isGeneral && (
              <p className="rounded-md bg-brand-tint px-3 py-2 text-sm">
                Este es tu agente <b>general</b>: es el que atiende a tus clientes. Solo cambia cuando pulsas «Publicar».
              </p>
            )}

            <section className="space-y-3">
              <h4 className="kicker">Identidad</h4>
              <div className="space-y-1.5">
                <Label htmlFor="agent-display-name">Nombre de presentación (opcional)</Label>
                <Input
                  id="agent-display-name"
                  maxLength={60}
                  placeholder={NO_NAME_LABEL}
                  value={cfg.displayName ?? ""}
                  onChange={(e) => setCfg({ ...cfg, displayName: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Con nombre, el agente se presenta con él. Sin nombre, habla como el equipo del negocio.</p>
              </div>
            </section>

            <section className="space-y-3">
              <h4 className="kicker">Comportamiento</h4>
              <AgentConfigForm
                idPrefix="lab-agent"
                showName={false}
                value={{ name: cfg.displayName ?? "", tone: cfg.tone, instructions: cfg.instructions, escalationRules: cfg.escalationRules, greeting: cfg.greeting }}
                onChange={(n) => setCfg({ ...cfg, tone: n.tone, instructions: n.instructions, escalationRules: n.escalationRules, greeting: n.greeting })}
              />
            </section>

            <Collapsible title="Conocimiento">
              <div className="space-y-4">
                {agent.isGeneral ? (
                  <p className="text-sm text-muted-foreground">El agente general siempre lee el conocimiento compartido (se edita en «Agente»).</p>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Usar el conocimiento compartido</p>
                      <p className="text-xs text-muted-foreground">Lo mismo que lee el agente general, además del propio.</p>
                    </div>
                    <Switch checked={cfg.useSharedKb} label="Usar el conocimiento compartido" onCheckedChange={(v) => setCfg({ ...cfg, useSharedKb: v })} />
                  </div>
                )}
                {!agent.isGeneral && <AgentKbPanel agentId={id} refreshKey={kbKey} />}
              </div>
            </Collapsible>

            {documents && (
              <Collapsible title="Documentos">
                <AgentDocSources value={cfg.docSources} onChange={(docSources) => setCfg({ ...cfg, docSources })} />
              </Collapsible>
            )}

            <Collapsible title="Historial de versiones" onOpen={() => versions === null && void loadVersions()}>
              {versions === null ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no hay versiones publicadas.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span>
                        {ACTION_LABEL[v.action]}
                        <span className="block text-xs text-muted-foreground">
                          {formatDate(v.at)}
                          {v.actorName ? ` · ${v.actorName}` : ""}
                        </span>
                      </span>
                      <Button size="sm" variant="outline" onClick={() => setRestoring(v)}>
                        Cargar al borrador
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Collapsible>

            <Collapsible title="Más opciones">
              <div className="flex flex-wrap gap-2">
                {!agent.isGeneral && (
                  <Button variant="outline" size="sm" disabled={draftOnly} title={draftOnly ? "Primero publica este agente" : undefined} onClick={() => setDialog("general")}>
                    Hacer general
                  </Button>
                )}
                {!agent.isGeneral && (
                  <Button variant="outline" size="sm" onClick={() => setDialog("archive")}>
                    Archivar agente
                  </Button>
                )}
                {agent.isGeneral && <p className="text-sm text-muted-foreground">El agente general no se archiva.</p>}
              </div>
            </Collapsible>
          </div>
        </div>

        {/* Derecha: vista previa */}
        <div className={cn("min-h-0 border-l", tab === "config" && "hidden lg:block")}>
          <AgentPreview agentId={id} config={cfg} />
        </div>
      </div>

      {/* Pie fijo */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-background px-4 py-2.5 sm:px-6">
        <p className="text-sm" role="status">
          {error ? <span className="text-destructive">{error}</span> : <span className="text-muted-foreground">{note ?? status}</span>}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void saveDraft()} disabled={busy || !dirty}>
            Guardar borrador
          </Button>
          <Button onClick={() => setDialog("publish")} disabled={busy || !pending}>
            Publicar
          </Button>
        </div>
      </div>

      {dialog === "publish" && (
        <ConfirmDialog title="¿Publicar este agente?" confirmLabel="Publicar" busy={busy} onConfirm={() => void publish()} onCancel={() => setDialog(null)}>
          <p>
            {draftOnly
              ? "Es la primera vez que se publica."
              : `Cambia: ${changedFields(norm(cfg), agent.published).join(", ") || "nada (solo se vuelve a registrar)"}.`}
          </p>
          {agent.isGeneral ? (
            <p>Este es el agente general: desde ahora atenderá a tus clientes con estos cambios.</p>
          ) : (
            <p>Los agentes que no son el general no atienden clientes todavía; puedes evaluarlos en el Laboratorio.</p>
          )}
          {!summary?.lastRun && <p>Todavía no has evaluado a este agente. Puedes hacerlo antes en la pestaña «Evaluaciones».</p>}
        </ConfirmDialog>
      )}
      {dialog === "general" && (
        <ConfirmDialog title="¿Hacer general a este agente?" confirmLabel="Sí, hacerlo general" busy={busy} onConfirm={() => void makeGeneral()} onCancel={() => setDialog(null)}>
          <p>Desde ahora este agente será el que atienda a tus clientes, en lugar del general actual.</p>
          <p className="font-medium text-foreground">
            Ojo: esto también cambia el comportamiento y el conocimiento que recibe tu cerebro externo (tu propio bot conectado por la API, en «/api/bot/profile»). Si tienes uno,
            empezará a recibir lo de este agente.
          </p>
          <p>Se usa la versión publicada, no el borrador.</p>
        </ConfirmDialog>
      )}
      {dialog === "archive" && (
        <ConfirmDialog title={`¿Archivar «${agent.internalName}»?`} confirmLabel="Archivar" destructive busy={busy} onConfirm={() => void archive()} onCancel={() => setDialog(null)}>
          <p>Deja de aparecer en la lista y ya no se puede evaluar. Tus clientes no notan ningún cambio.</p>
        </ConfirmDialog>
      )}
      {restoring && (
        <ConfirmDialog title="¿Cargar esta versión al borrador?" confirmLabel="Cargar al borrador" busy={busy} onConfirm={() => void restore(restoring)} onCancel={() => setRestoring(null)}>
          <p>Reemplaza lo que tienes en el borrador con esta versión del {formatDate(restoring.at)}.</p>
          <p>No cambia lo que atiende a tus clientes hasta que pulses «Publicar».</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** Sección plegable (opciones avanzadas fuera de la vista principal). */
function Collapsible({ title, children, onOpen }: { title: string; children: React.ReactNode; onOpen?: () => void }) {
  return (
    <details
      className="group rounded-lg border"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) onOpen?.();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium">
        {title}
        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t px-4 py-3">{children}</div>
    </details>
  );
}
