"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Pencil } from "lucide-react";
import type { CreatorField } from "@/lib/agent-creator";
import { AgentDocSources, AgentExclusiveDocs, ArchiveExclusiveDocsChoice } from "@/components/lab/agent-doc-sources";
import { AgentCreator } from "@/components/lab/agent-creator";
import { AgentKbPanel } from "@/components/lab/agent-kb-panel";
import { AgentPauseBar } from "@/components/lab/agent-pause-bar";
import { AgentPreview } from "@/components/lab/agent-preview";
import { ConfirmDialog } from "@/components/lab/confirm-dialog";
import {
  call,
  formatDate,
  STATUS_LABEL,
  type AgentConfig,
  type AgentDetail,
  type AgentSummary,
  type AgentVersion,
} from "@/components/lab/agents-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/ui/page-shell";
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
  // La portada del Estudio manda aquí la idea escrita (?idea=) o pide el formulario (?modo=formulario).
  const params = useSearchParams();
  const idea = params.get("idea")?.slice(0, 2000) || undefined;
  const [mode, setMode] = useState<"creator" | "form" | "versions">(params.get("modo") === "formulario" ? "form" : "creator");
  const [section, setSection] = useState("identidad");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [restoring, setRestoring] = useState<AgentVersion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  // 037 (PR 3) — Al archivar: qué pasa con sus documentos exclusivos.
  const [archiveDocs, setArchiveDocs] = useState<"delete" | "general">("delete");

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
    // Las versiones alimentan la pestaña «Versiones».
    void loadVersions();
  }, [load, loadVersions]);

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
    setNote(agent?.isGeneral ? "Publicado. Tu agente principal ya usa estos cambios." : "Publicado. Asígnalo a una etapa para que atienda.");
    void loadVersions();
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
    const r = await call(`/api/lab/agents/${id}?documents=${archiveDocs}`, { method: "DELETE" });
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

  /** El creador y «Revisar este chat» escriben en el borrador del formulario (nada se guarda solo). */
  function setField(field: CreatorField, value: string | null) {
    setCfg((c) => (c ? { ...c, [field]: value } : c));
  }

  const kbKey = String(cfg.useSharedKb);
  const status = dirty ? "Cambios sin guardar" : STATUS_LABEL[agent.status];
  const sections = [
    { id: "identidad", label: "Identidad" },
    { id: "tono", label: "Tono" },
    { id: "instrucciones", label: "Instrucciones" },
    { id: "persona", label: "Cuándo pasa a persona" },
    { id: "conocimiento", label: "Conocimiento" },
    ...(documents ? [{ id: "documentos", label: "Documentos" }] : []),
    { id: "opciones", label: "Más opciones" },
  ];
  const goTo = (sid: string) => {
    setSection(sid);
    document.getElementById(`sec-${sid}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const title = renaming ? (
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
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-text">
        <Bot className="h-4 w-4" strokeWidth={1.7} />
      </span>
      <span className="truncate">{agent.internalName}</span>
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
    </span>
  );

  const badges = renaming ? null : (
    <span className="hidden shrink-0 items-center gap-1.5 md:flex">
      {agent.isGeneral && <Badge variant="default">General</Badge>}
      {agent.status !== "draft" ? (
        <Badge variant="success">Publicado</Badge>
      ) : (
        <Badge variant="secondary">Borrador</Badge>
      )}
      {(agent.status === "changes" || dirty) && agent.status !== "draft" && (
        <span className="flex items-center gap-1 rounded-full bg-warning-tint px-2 py-0.5 text-[11px] font-medium text-warning-text">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" /> Borrador con cambios
        </span>
      )}
    </span>
  );

  const modeTabs = (
    <div role="group" aria-label="Cómo configurar" className="inline-flex rounded-lg border bg-subtle p-0.5">
      {(
        [
          ["creator", "Creador"],
          ["form", "Formulario"],
          ["versions", "Versiones"],
        ] as const
      ).map(([m, label]) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => {
            setMode(m);
            setTab("config");
          }}
          className={cn(
            "rounded-md px-3 py-1 text-[13px] font-medium",
            mode === m ? "bg-card text-foreground shadow-sm" : "text-text-2 hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const actions = (
    <>
      <span className="hidden text-xs text-text-3 lg:inline" title={status}>
        {dirty ? "Cambios sin guardar" : `Guardado ${timeAgo(agent.updatedAt)}`}
      </span>
      <Button variant="outline" size="sm" onClick={() => void saveDraft()} disabled={busy || !dirty}>
        Guardar borrador
      </Button>
      <Button size="sm" onClick={() => setDialog("publish")} disabled={busy || !pending}>
        {draftOnly ? "Publicar" : "Publicar cambios"}
      </Button>
    </>
  );

  return (
    <PageShell pillar={false} variant="fluid" back={{ href: "/lab", label: "Volver a los agentes" }} title={title} icon={null} badge={badges} tabsSlot={modeTabs} actions={actions}>
      <AgentPauseBar />
      {(error || note) && (
        <p className="border-b px-4 py-2 text-sm sm:px-6" role="status">
          {error ? <span className="text-destructive">{error}</span> : <span className="text-text-2">{note}</span>}
        </p>
      )}

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

      <div className={cn("grid min-h-0 flex-1", mode === "creator" ? "lg:grid-cols-[45fr_55fr]" : "lg:grid-cols-[190px_minmax(0,1fr)_minmax(0,1fr)]")}>
        {/* Índice de secciones (solo formulario) */}
        {mode !== "creator" && (
          <nav aria-label="Secciones" className="hidden min-h-0 overflow-y-auto border-r px-3 py-4 lg:block">
            {mode === "form" ? (
              <>
                <p className="kicker mb-2 px-2">Secciones</p>
                <ul className="space-y-0.5">
                  {sections.map((x) => (
                    <li key={x.id}>
                      <button
                        type="button"
                        onClick={() => goTo(x.id)}
                        className={cn(
                          "w-full rounded-md px-2 py-1.5 text-left text-[13px]",
                          section === x.id ? "bg-brand-tint font-medium text-brand-ink" : "text-text-2 hover:bg-accent hover:text-foreground"
                        )}
                      >
                        {x.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="px-2 text-xs text-text-2">Cada vez que publicas se guarda una versión. Puedes cargar cualquiera al borrador y volver a publicarla.</p>
            )}
          </nav>
        )}

        {/* Centro: creador, formulario o versiones */}
        <div className={cn("flex min-h-0 flex-col", tab === "probar" && "hidden lg:flex")}>
          {mode === "creator" && (
            <div className="min-h-0 flex-1">
              <AgentCreator config={cfg} onField={setField} initialMessage={idea} />
            </div>
          )}
          {mode === "versions" && (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <h4 className="kicker mb-3">Versiones publicadas</h4>
              {versions === null ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no hay versiones publicadas.</p>
              ) : (
                <ul className="divide-y rounded-lg border bg-card">
                  {versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
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
            </div>
          )}
          <div className={cn("min-h-0 flex-1 overflow-y-auto", mode !== "form" && "hidden")}>
            <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
              {agent.isGeneral && (
                <p className="rounded-md bg-brand-tint px-3 py-2 text-sm">
                  Este es tu agente <b>general</b>: es el que atiende a tus clientes. Solo cambia cuando pulsas «Publicar».
                </p>
              )}

              <FormSection id="identidad" title="Identidad">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="agent-display-name">Nombre de presentación (opcional)</Label>
                    <Input
                      id="agent-display-name"
                      maxLength={60}
                      placeholder="Habla como el equipo"
                      value={cfg.displayName ?? ""}
                      onChange={(e) => setCfg({ ...cfg, displayName: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">Con nombre, se presenta con él. Sin nombre, habla como el equipo del negocio.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="lab-agent-greeting">Saludo</Label>
                    <Input
                      id="lab-agent-greeting"
                      placeholder="Saludo para conversaciones nuevas"
                      value={cfg.greeting ?? ""}
                      onChange={(e) => setCfg({ ...cfg, greeting: e.target.value })}
                    />
                  </div>
                </div>
              </FormSection>

              <FormSection id="tono" title="Tono">
                <Label htmlFor="lab-agent-tone" className="sr-only">
                  Tono
                </Label>
                <Input
                  id="lab-agent-tone"
                  placeholder="p. ej. cercano y directo, con usted"
                  value={cfg.tone ?? ""}
                  onChange={(e) => setCfg({ ...cfg, tone: e.target.value })}
                />
              </FormSection>

              <FormSection id="instrucciones" title="Instrucciones">
                <Label htmlFor="lab-agent-instructions" className="sr-only">
                  Instrucciones
                </Label>
                <Textarea
                  id="lab-agent-instructions"
                  rows={6}
                  placeholder="Qué hace tu negocio, qué debe lograr el agente y qué no debe hacer…"
                  value={cfg.instructions ?? ""}
                  onChange={(e) => setCfg({ ...cfg, instructions: e.target.value })}
                />
              </FormSection>

              <FormSection id="persona" title="Cuándo pasa a persona">
                <Label htmlFor="lab-agent-escalation" className="sr-only">
                  Reglas de escalado
                </Label>
                <Textarea
                  id="lab-agent-escalation"
                  rows={3}
                  placeholder="Cuándo pasar la conversación a un humano…"
                  value={cfg.escalationRules ?? ""}
                  onChange={(e) => setCfg({ ...cfg, escalationRules: e.target.value })}
                />
              </FormSection>

              <FormSection id="conocimiento" title="Conocimiento">
                <div className="space-y-4">
                  {agent.isGeneral ? (
                    <p className="text-sm text-muted-foreground">El agente general siempre lee el conocimiento compartido.</p>
                  ) : (
                    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                      <div>
                        <p className="text-sm font-medium">Usar el conocimiento compartido</p>
                        <p className="text-xs text-muted-foreground">Lo mismo que lee el agente general, además del propio.</p>
                      </div>
                      <Switch checked={cfg.useSharedKb} label="Usar el conocimiento compartido" onCheckedChange={(v) => setCfg({ ...cfg, useSharedKb: v })} />
                    </div>
                  )}
                  {!agent.isGeneral && <AgentKbPanel agentId={id} refreshKey={kbKey} />}
                </div>
              </FormSection>

              {documents && (
                <FormSection id="documentos" title="Documentos">
                  <div className="space-y-4">
                    <AgentDocSources value={cfg.docSources} onChange={(docSources) => setCfg({ ...cfg, docSources })} />
                    <AgentExclusiveDocs agentId={id} />
                  </div>
                </FormSection>
              )}

              <FormSection id="opciones" title="Más opciones">
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
              </FormSection>
            </div>
          </div>
        </div>

        {/* Derecha: vista previa */}
        <div className={cn("min-h-0 border-l", tab === "config" && "hidden lg:block")}>
          <AgentPreview agentId={id} config={cfg} onApplyField={setField} />
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
            <p>Este es tu agente principal: cuando tu IA esté encendida, contestará a tus clientes con estos cambios.</p>
          ) : (
            <p>Este agente todavía no contesta a nadie. Para que atienda, asígnalo a una etapa en «Asignación por etapa».</p>
          )}
          {!summary?.lastRun && <p>Todavía no has evaluado a este agente. Puedes probarlo antes en la pestaña «Pruebas».</p>}
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
          {documents && <ArchiveExclusiveDocsChoice agentId={id} value={archiveDocs} onChange={setArchiveDocs} />}
        </ConfirmDialog>
      )}
      {restoring && (
        <ConfirmDialog title="¿Cargar esta versión al borrador?" confirmLabel="Cargar al borrador" busy={busy} onConfirm={() => void restore(restoring)} onCancel={() => setRestoring(null)}>
          <p>Reemplaza lo que tienes en el borrador con esta versión del {formatDate(restoring.at)}.</p>
          <p>No cambia lo que atiende a tus clientes hasta que pulses «Publicar».</p>
        </ConfirmDialog>
      )}
    </PageShell>
  );
}

/** Una sección del formulario (el índice de la izquierda salta a ella). */
function FormSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={`sec-${id}`} aria-labelledby={`sec-${id}-t`} className="scroll-mt-4 space-y-3">
      <h4 id={`sec-${id}-t`} className="kicker">
        {title}
      </h4>
      {children}
    </section>
  );
}

/** «hace 5 s», «hace 3 min»… (para «Guardado hace …»). */
function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.round(s / 3600)} h`;
  return formatDate(iso);
}
