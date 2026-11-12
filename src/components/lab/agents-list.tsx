"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, Info, MoreHorizontal, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ArchiveExclusiveDocsChoice } from "@/components/lab/agent-doc-sources";
import { PAUSE_CHANGED_EVENT } from "@/components/lab/agent-pause-bar";
import { AiSwitchCard } from "@/components/lab/ai-switch-card";
import { LabActions } from "@/components/lab/lab-shell";
import { openUsageDialog } from "@/lib/usage-dialog";
import { useViewer } from "@/components/viewer-context";
import type { AgentStatsDto } from "@/server/agents/stats";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/lab/confirm-dialog";
import { call, type AgentSummary } from "@/components/lab/agents-api";

type StageView = { stageName: string; agent: { id: string } | null };

function servesLabel(a: AgentSummary, stages: StageView[]): string {
  if (a.isGeneral) return "Todos los chats sin etapa asignada";
  const mine = stages.filter((s) => s.agent?.id === a.id).map((s) => s.stageName);
  return mine.length ? mine.join(", ") : "Sin asignar";
}

type Listing = {
  agents: AgentSummary[];
  maxAgents: number;
  aiConfigured: boolean;
  orgPaused: boolean;
  /** Auditoría UX 2026-11 (B): el interruptor global y si hay WhatsApp. */
  aiEnabled: boolean;
  whatsappConnected: boolean;
};

/**
 * 031 (A2) — Pestaña «Agentes»: una sola columna. El agente general va fijo
 * arriba; cada fila abre el editor (/lab/agents/[id]).
 * El mapa de etapas (qué agente atiende cada etapa) vive en su pestaña: «Asignación por etapa».
 */
export function AgentsList() {
  const router = useRouter();
  const [data, setData] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stages, setStages] = useState<StageView[]>([]);
  const [stats, setStats] = useState<AgentStatsDto | null>(null);
  const [aiPercent, setAiPercent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toArchive, setToArchive] = useState<AgentSummary | null>(null);
  const [naming, setNaming] = useState(false);
  const viewer = useViewer();
  const canSeePlans = viewer.can("usage.read");
  // 037 (PR 3) — Al archivar: qué pasa con sus documentos exclusivos (por defecto, se borran).
  const [archiveDocs, setArchiveDocs] = useState<"delete" | "general">("delete");

  const load = useCallback(async () => {
    const r = await call<Listing>("/api/lab/agents");
    if (r.ok) {
      setData(r.data);
      setLoadError(null);
    } else setLoadError(r.message);
    const st = await call<{ stages: StageView[] }>("/api/lab/assignments");
    if (st.ok) setStages(st.data.stages);
    const sx = await call<AgentStatsDto>("/api/lab/agents/stats");
    if (sx.ok) setStats(sx.data);
    // Solo el Propietario ve «Uso y plan»; a los demás la tarjeta no aparece.
    const u = await call<{ usage: { ai: { total: { percent: number | null } } } }>("/api/usage");
    setAiPercent(u.ok ? u.data.usage.ai.total.percent : null);
  }, []);

  useEffect(() => {
    void load();
    // 042: la pausa general se mueve en la barra de arriba; la lista se pone al día.
    window.addEventListener(PAUSE_CHANGED_EVENT, load);
    return () => window.removeEventListener(PAUSE_CHANGED_EVENT, load);
  }, [load]);

  async function togglePaused(a: AgentSummary, paused: boolean) {
    setError(null);
    const r = await call(`/api/lab/agents/${a.id}/pause`, { method: "PUT", json: { paused } });
    if (!r.ok) setError(r.message);
    void load();
  }

  /** «Crear agente»: crea el borrador y abre directo el creador conversacional. */
  async function startCreator(opts: { idea?: string; form?: boolean; name?: string }) {
    setBusy(true);
    setError(null);
    // Plan de UN agente: el creador trabaja sobre el agente general, no crea otro.
    const general = data && data.maxAgents <= 1 ? data.agents.find((a) => a.isGeneral) : undefined;
    if (general) {
      setBusy(false);
      const q = opts.idea ? `?idea=${encodeURIComponent(opts.idea)}` : opts.form ? "?modo=formulario" : "";
      router.push(`/lab/agents/${general.id}${q}`);
      return;
    }
    const n = (data?.agents.length ?? 0) + 1;
    const r = await call<{ agent: { id: string } }>("/api/lab/agents", {
      method: "POST",
      json: { internalName: opts.name?.trim() || `Agente nuevo ${n}` },
    });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    const q = opts.idea ? `?idea=${encodeURIComponent(opts.idea)}` : opts.form ? "?modo=formulario" : "";
    router.push(`/lab/agents/${r.data.agent.id}${q}`);
  }

  async function duplicate(a: AgentSummary) {
    setError(null);
    const r = await call<{ agent: { id: string } }>("/api/lab/agents", {
      method: "POST",
      json: { internalName: `Copia de ${a.internalName}`.slice(0, 60), duplicateOf: a.id },
    });
    if (!r.ok) return setError(r.message);
    router.push(`/lab/agents/${r.data.agent.id}`);
  }

  async function archive() {
    if (!toArchive) return;
    setBusy(true);
    const r = await call(`/api/lab/agents/${toArchive.id}?documents=${archiveDocs}`, { method: "DELETE" });
    setBusy(false);
    setToArchive(null);
    setArchiveDocs("delete");
    if (!r.ok) setError(r.message);
    else setError(null);
    void load();
  }

  if (loadError) {
    return <p className="p-6 text-sm text-destructive">{loadError}</p>;
  }
  if (!data) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Cargando…</div>;
  }

  const atLimit = data.agents.length >= data.maxAgents;
  const single = data.maxAgents <= 1;
  // Portada: sin ningún agente propio todavía (solo el general sin publicar), el creador ES la pantalla.
  const first = data.agents.length === 1 && data.agents[0]!.isGeneral && data.agents[0]!.status !== "published";
  const published = data.agents.filter((a) => a.status !== "draft").length;
  const general = data.agents.find((a) => a.isGeneral);
  // La IA contesta de verdad solo encendida y sin la pausa general.
  const aiLive = data.aiEnabled && !data.orgPaused;

  if (first) {
    return (
      <div className="h-full overflow-y-auto">
        <CreatorLanding
          onStart={(text) => void startCreator({ idea: text })}
          onForm={() => void startCreator({ form: true })}
          busy={busy}
          error={error}
          aiConfigured={data.aiConfigured}
        />
      </div>
    );
  }

  const statFor = (a: AgentSummary) => {
    const own = stats?.perAgent[a.id] ?? { chats: 0, resolved: 0 };
    if (!a.isGeneral || !stats) return own;
    return { chats: own.chats + stats.unassigned.chats, resolved: own.resolved + stats.unassigned.resolved };
  };
  const trend =
    stats && stats.totals.previousChats > 0
      ? Math.round(((stats.totals.chats - stats.totals.previousChats) / stats.totals.previousChats) * 100)
      : null;
  const handedPct = stats && stats.totals.chats > 0 ? Math.round((stats.totals.handedOff / stats.totals.chats) * 100) : null;
  const cols = "md:grid-cols-[minmax(0,2fr)_150px_minmax(0,1.5fr)_90px_150px_auto]";

  return (
    <div className="h-full overflow-y-auto">
      <LabActions>
        {single ? (
          // Auditoría UX 2026-11 (B3): con UN agente en el plan, el botón no se
          // apaga sin explicación: lleva a configurar el que ya tienes.
          <>
            {canSeePlans && (
              <button
                type="button"
                onClick={() => openUsageDialog("planes")}
                className="hidden text-[12.5px] font-medium text-brand-ink hover:underline sm:inline"
              >
                ¿Más agentes? Plan Pro →
              </button>
            )}
            <Button size="sm" onClick={() => void startCreator({})} disabled={busy} data-testid="create-agent">
              <Sparkles className="h-4 w-4" /> Configurar mi agente
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => setNaming(true)}
            disabled={atLimit || busy}
            title={atLimit ? `Llegaste al máximo de ${data.maxAgents} agentes de tu plan` : undefined}
            data-testid="create-agent"
          >
            <Sparkles className="h-4 w-4" /> Crear agente
          </Button>
        )}
      </LabActions>
      {atLimit && !single && (
        <p className="px-5 pt-3 text-[12.5px] text-text-2 sm:px-6">
          Llegaste al máximo de {data.maxAgents} agentes de tu plan. Archiva uno para crear otro.
        </p>
      )}
      {naming && (
        <NameAgentDialog
          busy={busy}
          defaultName={`Agente nuevo ${data.agents.length + 1}`}
          onCancel={() => setNaming(false)}
          onCreate={(name) => {
            setNaming(false);
            void startCreator({ name });
          }}
        />
      )}
      <AiSwitchCard
        input={{
          aiEnabled: data.aiEnabled,
          orgPaused: data.orgPaused,
          agentReady: !!general && general.status !== "draft",
          agentName: general?.internalName ?? "Agente principal",
          agentHref: general ? `/lab/agents/${general.id}` : null,
          whatsappConnected: data.whatsappConnected,
          aiConfigured: data.aiConfigured,
        }}
        chats={stats?.totals.chats ?? 0}
        handedOff={stats?.totals.handedOff ?? 0}
        onChanged={() => void load()}
      />

      <div className="space-y-4 p-4 sm:p-6">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div role="table" aria-label="Agentes" className="overflow-hidden rounded-lg border bg-card">
          <div role="row" className={cn("hidden gap-4 border-b bg-subtle px-4 py-2 text-xs font-medium text-text-2 md:grid", cols)}>
            <span role="columnheader">Agente</span>
            <span role="columnheader">Estado</span>
            <span role="columnheader">Atiende</span>
            <span role="columnheader">Chats (7 días)</span>
            <span role="columnheader">Resueltos sin persona</span>
            <span role="columnheader" aria-label="Acciones" className="w-[150px]" />
          </div>
          {data.agents.map((a) => {
            const st = statFor(a);
            const pct = st.chats > 0 ? Math.round((st.resolved / st.chats) * 100) : null;
            return (
            <div
              key={a.id}
              role="row"
              className={cn("grid grid-cols-1 items-center gap-x-4 gap-y-2 border-b px-4 py-3 last:border-b-0", cols)}
            >
              <Link role="cell" href={`/lab/agents/${a.id}`} className="flex min-w-0 items-center gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand-text">
                  <Bot className="h-[18px] w-[18px]" strokeWidth={1.7} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold">{a.internalName}</span>
                  <span className="block truncate text-xs text-text-2">
                    {a.isGeneral ? "General" : `Etapa: ${servesLabel(a, stages)}`}
                  </span>
                </span>
              </Link>
              <span role="cell" className="flex flex-col items-start gap-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge variant={a.status === "draft" ? "secondary" : aiLive && !a.paused ? "success" : "secondary"}>
                    {a.status === "draft" ? "Borrador" : !aiLive ? "Listo · IA apagada" : a.paused ? "Publicado" : "Contestando"}
                  </Badge>
                  {a.paused && <Badge variant="destructive">Apagado</Badge>}
                </span>
                {a.status === "changes" && (
                  <span className="flex items-center gap-1 text-[11px] text-warning-text">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-warning" /> borrador con cambios
                  </span>
                )}
              </span>
              <span role="cell" className="truncate text-[13px] text-text-2">{servesLabel(a, stages)}</span>
              <span role="cell" className="text-[14px] font-semibold tabular-nums">{a.status === "draft" ? 0 : st.chats}</span>
              <span role="cell" className="flex items-center gap-2 text-[13px] tabular-nums">
                {pct === null || a.status === "draft" ? (
                  <span className="text-text-3">—</span>
                ) : (
                  <>
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                    </span>
                    {pct} %
                  </>
                )}
              </span>
              <span role="cell" className="flex flex-wrap items-center justify-end gap-1">
                <span
                  className="mr-1 flex items-center gap-1.5 text-xs text-text-2"
                  title={!aiLive ? "La IA está apagada: enciéndela arriba" : undefined}
                >
                  <Switch
                    size="sm"
                    checked={!a.paused}
                    disabled={!aiLive}
                    label={`Agente «${a.internalName}» activo`}
                    onCheckedChange={(on) => void togglePaused(a, !on)}
                  />
                </span>
                <Link href={`/lab/agents/${a.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  Abrir
                </Link>
                <AgentMenu
                  agent={a}
                  atLimit={atLimit}
                  onDuplicate={() => void duplicate(a)}
                  onArchive={() => setToArchive(a)}
                />
              </span>
            </div>
            );
          })}
        </div>

        {stats && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Chats atendidos por IA"
              value={stats.totals.chats.toLocaleString("es-MX")}
              hint={trend === null ? "Últimos 7 días" : `${trend >= 0 ? "+" : ""}${trend} % vs. semana pasada`}
            />
            <StatCard
              label="Pasados a una persona"
              value={stats.totals.handedOff.toLocaleString("es-MX")}
              hint={handedPct === null ? "Últimos 7 días" : `${handedPct} % de los chats de la semana`}
            />
            <StatCard
              label="Agentes publicados"
              value={String(published)}
              hint={`${data.agents.length} de ${data.maxAgents} ${data.maxAgents === 1 ? "agente" : "agentes"}`}
            />
            {aiPercent !== null && <StatCard label="IA usada este mes" value={`${aiPercent} %`} hint="De lo que incluye tu plan" />}
          </div>
        )}

        <p className="flex items-start gap-2 rounded-lg border border-brand-soft bg-brand-tint px-4 py-3 text-[13px] text-brand-ink">
          <Info className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span>
            Lo que cambies en un agente lo pruebas sin que salga a WhatsApp. Tus clientes solo lo ven cuando pulsas{" "}
            <b>Publicar</b>. Cada publicación guarda una versión a la que puedes regresar.
          </span>
        </p>
      </div>

      {toArchive && (
        <ConfirmDialog
          title={`¿Archivar «${toArchive.internalName}»?`}
          confirmLabel="Archivar"
          destructive
          busy={busy}
          onConfirm={() => void archive()}
          onCancel={() => {
            setToArchive(null);
            setArchiveDocs("delete");
          }}
        >
          <p>Deja de aparecer en la lista y ya no se puede evaluar. Si atendía alguna etapa, esa etapa vuelve al agente general (lo verás en «Asignación por etapa»).</p>
          <ArchiveExclusiveDocsChoice agentId={toArchive.id} value={archiveDocs} onChange={setArchiveDocs} />
        </ConfirmDialog>
      )}
    </div>
  );
}

const IDEAS = [
  { label: "Atención y ventas", text: "Quiero un agente que atienda a mis clientes, resuelva sus dudas y les ayude a comprar." },
  { label: "Agendar citas", text: "Quiero un agente que agende citas con mis clientes y les confirme día y hora." },
  { label: "Seguimiento de pagos", text: "Quiero un agente que dé seguimiento a pagos pendientes con amabilidad." },
];

/** Portada del Estudio sin agentes todavía: la portada ES el creador. */
function CreatorLanding({
  onStart,
  onForm,
  busy,
  error,
  aiConfigured,
}: {
  onStart: (text: string) => void;
  onForm: () => void;
  busy: boolean;
  error: string | null;
  aiConfigured: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <div className="mx-auto flex min-h-full max-w-[640px] flex-col items-center justify-center px-5 py-12 text-center" data-testid="creator-landing">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white">
        <Sparkles className="h-6 w-6" strokeWidth={1.7} />
      </span>
      <h2 className="mt-5 text-[26px] font-semibold tracking-tight">Crea tu agente platicando</h2>
      <p className="mt-2 text-[15px] text-text-2">
        Cuéntame de tu negocio con tus palabras. Yo armo al agente, tú lo pruebas sin que salga a WhatsApp y lo publicas cuando te guste.
      </p>
      <form
        className="mt-6 w-full rounded-xl border bg-card p-3 text-left shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onStart(text.trim());
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          maxLength={2000}
          aria-label="Describe tu negocio"
          placeholder="Ej.: «Somos una universidad en Puebla. Vendemos maestrías sabatinas y licenciaturas en línea. Queremos que la IA resuelva dudas de costos y agende visitas al campus.»"
          className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-text-3"
        />
        <div className="flex justify-end">
          <Button type="submit" size="icon" disabled={busy || !text.trim()} aria-label="Empezar">
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </form>
      {!aiConfigured && (
        <p className="mt-3 text-xs text-text-2">El servicio de IA de tu cuenta aún no está activo: el creador no podrá contestar hasta entonces.</p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm">
        <span className="text-text-2">Empezar con una idea:</span>
        {IDEAS.map((i) => (
          <button
            key={i.label}
            type="button"
            disabled={busy}
            onClick={() => onStart(i.text)}
            className="rounded-full border border-dashed px-3 py-1 hover:bg-accent disabled:opacity-50"
          >
            {i.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <p className="mt-8 text-sm text-text-2">
        ¿Prefieres llenar campos?{" "}
        <button type="button" onClick={onForm} className="font-semibold text-brand-ink hover:underline">
          Usar el formulario
        </button>
      </p>
    </div>
  );
}

/** El «⋯» de cada fila: Evaluar, Duplicar y Archivar. */
function AgentMenu({
  agent,
  atLimit,
  onDuplicate,
  onArchive,
}: {
  agent: AgentSummary;
  atLimit: boolean;
  onDuplicate: () => void;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const item = "block w-full rounded-sm px-2.5 py-1.5 text-left text-[13px] hover:bg-accent disabled:opacity-50";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Más acciones de ${agent.internalName}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded p-1.5 text-text-3 hover:bg-secondary hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 rounded-md border bg-popover p-1 shadow-pop">
          <Link href={`/lab/evaluaciones?agente=${agent.id}`} className={item} role="menuitem">
            Evaluar
          </Link>
          <button type="button" role="menuitem" className={item} disabled={atLimit} onClick={() => { setOpen(false); onDuplicate(); }}>
            Duplicar
          </button>
          {!agent.isGeneral && (
            <button type="button" role="menuitem" className={cn(item, "text-destructive")} onClick={() => { setOpen(false); onArchive(); }}>
              Archivar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-text-2">{label}</p>
      <p className="mt-1 text-[26px] font-semibold leading-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-text-3">{hint}</p>
    </div>
  );
}

/** Auditoría UX 2026-11 (punto 10): un agente nuevo nace con el nombre que le pones. */
function NameAgentDialog({
  busy,
  defaultName,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  defaultName: string;
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const clean = name.trim();
  return (
    <ConfirmDialog
      title="Nuevo agente"
      confirmLabel="Crear y configurar"
      busy={busy}
      onConfirm={() => onCreate(clean || defaultName)}
      onCancel={onCancel}
    >
      <label htmlFor="new-agent-name" className="block text-[13px] font-medium text-foreground">
        ¿Cómo lo llamas? Solo lo ve tu equipo.
      </label>
      <input
        id="new-agent-name"
        aria-describedby="new-agent-name-hint"
        autoFocus
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCreate(clean || defaultName);
          }
        }}
        placeholder="Ej.: Ventas, Citas, Cobranza"
        className="mt-1.5 h-9 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p id="new-agent-name-hint" className="mt-1 text-xs text-text-3">
        Si lo dejas vacío se llamará «{defaultName}». Lo puedes cambiar después.
      </p>
    </ConfirmDialog>
  );
}
