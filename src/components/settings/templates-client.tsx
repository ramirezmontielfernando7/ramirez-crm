"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ImagePlus, MoreHorizontal, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import type { CampaignDto } from "@/lib/campaigns";
import { cn } from "@/lib/utils";
import { CampaignsShell } from "@/components/campaigns/campaigns-tabs";
import type { TemplateDto } from "@/lib/types";
import {
  countVariables,
  headerOf,
  renderBody,
  validateBodyVariables,
  validateTemplateDraft,
  type TemplateButtonDraft,
  type TemplateDraft,
} from "@/lib/templates";
import { fetchJson } from "@/lib/fetch-json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useViewer } from "@/components/viewer-context";
import { SettingsHeader } from "@/components/settings/settings-header";

const STATUS_BADGE: Record<
  TemplateDto["status"],
  { label: string; variant: "secondary" | "warning" | "success" | "destructive" }
> = {
  draft: { label: "Borrador", variant: "secondary" },
  pending: { label: "Pendiente de Meta", variant: "warning" },
  approved: { label: "Aprobada", variant: "success" },
  rejected: { label: "Rechazada", variant: "destructive" },
};

/** Campañas v2: estados de Meta que no caben en los cuatro locales. */
const META_BADGE: Record<string, { label: string; variant: "warning" | "destructive" }> = {
  PAUSED: { label: "Pausada por Meta", variant: "warning" },
  DISABLED: { label: "Desactivada por Meta", variant: "destructive" },
  IN_APPEAL: { label: "En apelación", variant: "warning" },
};

const SELECT_CLASS = "flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm";

type CategoryFilter = "all" | "MARKETING" | "UTILITY" | "paused";
const CATEGORY_FILTERS: { key: CategoryFilter; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "MARKETING", label: "Marketing" },
  { key: "UTILITY", label: "Utilidad" },
  { key: "paused", label: "Pausadas" },
];

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidad",
  AUTHENTICATION: "Autenticación",
};

const QUALITY_CHIP: Record<string, { label: string; variant: "success" | "warning" | "destructive" }> = {
  GREEN: { label: "Alta", variant: "success" },
  YELLOW: { label: "Media", variant: "warning" },
  RED: { label: "Baja", variant: "destructive" },
};

const isPausedByMeta = (t: TemplateDto) => t.metaStatus === "PAUSED" || t.metaStatus === "DISABLED";

function languageLabel(code: string): string {
  if (/^es/i.test(code)) return "Español";
  if (/^en/i.test(code)) return "Inglés";
  if (/^pt/i.test(code)) return "Portugués";
  return code;
}

/**
 * Plantillas de WhatsApp. Ronda 3: tabla primero (nombre, categoría, estado de
 * Meta, idioma, calidad y en cuántas campañas se usa), búsqueda y chips,
 * «Importar de Meta» y «+ Crear plantilla» (el formulario se abre en una
 * ventana). Con `shell` pinta el cascarón de Marketing y pone los botones en
 * su encabezado (y cuenta las campañas); sin él (Ajustes → Plantillas, sin el
 * módulo Campañas) los botones van en la propia pantalla.
 */
export function TemplatesClient({ shell = false }: { shell?: boolean }) {
  const canManage = useViewer().can("templates.manage");
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [headerImageAvailable, setHeaderImageAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Solo con Campañas: cuántas campañas usan cada plantilla.
  const [usage, setUsage] = useState<Record<string, number> | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetchJson<{ templates: TemplateDto[]; headerImageAvailable?: boolean }>("/api/templates");
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setLoadError(null);
    setTemplates(res.data.templates);
    setLoaded(true);
    setHeaderImageAvailable(Boolean(res.data.headerImageAvailable));
  }, []);

  useEffect(() => {
    if (!shell) return;
    void fetchJson<{ campaigns: CampaignDto[] }>("/api/campaigns").then((res) => {
      if (!res.ok) return;
      const counts: Record<string, number> = {};
      for (const c of res.data.campaigns) if (c.template) counts[c.template.id] = (counts[c.template.id] ?? 0) + 1;
      setUsage(counts);
    });
  }, [shell]);

  /**
   * `silent`: sincronización automática al abrir la pantalla. Meta entrega
   * `message_template_status_update` al callback A NIVEL APP, que en modo
   * agencia no es el de esta instancia — sin este pull la plantilla se queda
   * "Pendiente de Meta" para siempre aunque ya esté aprobada. Campañas v2:
   * además importa las que existen en la WABA y no en el CRM.
   */
  const sync = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setSyncing(true);
        setSyncMsg(null);
      }
      const res = await fetchJson<{ updated: number }>("/api/templates/sync", { method: "POST" });
      if (!silent) setSyncing(false);
      if (res.ok) {
        if (!silent) {
          setSyncMsg(res.data.updated > 0 ? `${res.data.updated} plantilla(s) importada(s) o actualizada(s)` : "Todo al día");
        }
        if (!silent || res.data.updated > 0) void refetch();
      } else if (!silent) {
        // El auto-sync falla en silencio: la lista local ya se pintó.
        setSyncMsg(res.error);
      }
    },
    [refetch]
  );

  useEffect(() => {
    void refetch().then(() => sync({ silent: true }));
  }, [refetch, sync]);

  const categoryChanges = templates.filter((t) => t.categoryChange);
  const upcomingChanges = templates.filter((t) => t.upcomingCategory);
  const noticed = [...categoryChanges, ...upcomingChanges];
  const pausedByMeta = templates.filter(isPausedByMeta);

  async function acknowledge() {
    const res = await fetchJson<{ updated: number }>("/api/templates/category-seen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateIds: [...new Set(noticed.map((t) => t.id))] }),
    });
    if (res.ok) void refetch();
    else setSyncMsg(res.error);
  }

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return templates.filter((t) => {
      if (filter === "paused" ? !isPausedByMeta(t) : filter !== "all" && t.category !== filter) return false;
      return !needle || t.name.toLowerCase().includes(needle);
    });
  }, [templates, filter, q]);

  const actions = (
    <>
      <Button variant="outline" size="sm" disabled={syncing} onClick={() => void sync()}>
        <RefreshCw className={`mr-1.5 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
        Importar de Meta
      </Button>
      {canManage && (
        <Button size="sm" data-testid="template-create-open" onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Crear plantilla
        </Button>
      )}
    </>
  );

  const body = (
    <div className="space-y-4">
      {!shell && (
        <SettingsHeader
          title="Plantillas"
          description="Mensajes aprobados por Meta para escribirle a quien no te ha escrito en 24 horas."
          actions={actions}
        />
      )}
      {syncMsg && <p className="text-xs text-muted-foreground">{syncMsg}</p>}
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block w-full max-w-[260px]">
          <span className="sr-only">Buscar plantilla</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-3" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar plantilla"
            className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-3 text-sm placeholder:text-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar plantillas">
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === f.key ? "border-brand bg-brand-tint text-brand-text" : "text-text-2 hover:bg-accent hover:text-foreground"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card" data-testid="template-list">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-subtle text-left text-xs text-text-3">
            <tr>
              <th className="px-4 py-2.5 font-medium">Nombre</th>
              <th className="px-3 py-2.5 font-medium">Categoría</th>
              <th className="px-3 py-2.5 font-medium">Estado</th>
              <th className="px-3 py-2.5 font-medium">Idioma</th>
              <th className="px-3 py-2.5 font-medium">Calidad</th>
              {usage && <th className="px-3 py-2.5 font-medium">Usada en</th>}
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          {visible.map((t) => {
            const meta = t.metaStatus ? META_BADGE[t.metaStatus] : undefined;
            const header = headerOf(t.components);
            const quality = t.qualityScore ? QUALITY_CHIP[t.qualityScore] : undefined;
            const needsImage = canManage && header?.format === "IMAGE" && !t.hasHeaderImage;
            const alerts = (t.status === "rejected" && t.rejectionReason) || (t.status === "approved" && !t.sendable && t.unsendableReason);
            const expanded = open[t.id] === true || needsImage || Boolean(alerts);
            const n = usage?.[t.id] ?? 0;
            return (
              <tbody key={t.id} data-testid="template-row">
                <tr className="border-t align-middle transition-colors hover:bg-accent/50">
                  <td className="px-4 py-3 font-mono text-[13px] font-semibold">{t.name}</td>
                  <td className="px-3 py-3">
                    <Badge variant={t.category === "MARKETING" ? "default" : "secondary"} className={t.category === "MARKETING" ? "bg-brand-tint text-brand-text border-brand-soft" : undefined}>
                      {CATEGORY_LABEL[t.category] ?? t.category}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    {meta ? (
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    ) : (
                      <Badge variant={STATUS_BADGE[t.status].variant}>{STATUS_BADGE[t.status].label}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-3 text-text-2" title={t.language}>
                    {languageLabel(t.language)}
                  </td>
                  <td className="px-3 py-3">
                    {quality ? <Badge variant={quality.variant}>{quality.label}</Badge> : <span className="text-text-3">—</span>}
                  </td>
                  {usage && <td className="px-3 py-3 text-text-2">{n === 1 ? "1 campaña" : `${n} campañas`}</td>}
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      aria-label={`Ver detalle de ${t.name}`}
                      aria-expanded={expanded}
                      onClick={() => setOpen((o) => ({ ...o, [t.id]: !expanded }))}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-3 hover:bg-accent hover:text-foreground"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-subtle/60">
                    <td colSpan={usage ? 7 : 6} className="px-4 py-3">
                      {header?.format === "TEXT" && header.text && <p className="text-sm font-semibold">{header.text}</p>}
                      {header?.format === "IMAGE" && <p className="text-xs text-muted-foreground">[Imagen en el encabezado]</p>}
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
                      {t.status === "rejected" && t.rejectionReason && (
                        <p className="mt-2 text-xs text-destructive">Razón del rechazo: {t.rejectionReason}</p>
                      )}
                      {t.status === "approved" && !t.sendable && t.unsendableReason && (
                        <p className="mt-2 text-xs text-destructive">No se puede enviar: {t.unsendableReason}</p>
                      )}
                      {needsImage && <AttachHeaderImage templateId={t.id} onAttached={() => void refetch()} />}
                    </td>
                  </tr>
                )}
              </tbody>
            );
          })}
          {visible.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={usage ? 7 : 6} className="px-4 py-8 text-center text-sm text-text-3">
                  {loaded && templates.length === 0
                    ? "Sin plantillas todavía. Crea la primera con «Crear plantilla» — por ejemplo un «seguimos disponibles, ¿retomamos tu cotización?» para conversaciones frías."
                    : loaded
                      ? "Ninguna plantilla coincide con la búsqueda."
                      : "Cargando…"}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>

      {pausedByMeta.length > 0 && (
        <div
          role="status"
          data-testid="template-paused-banner"
          className="flex items-start gap-3 rounded-lg border border-warning-soft bg-warning-tint px-4 py-3 text-sm text-warning-text"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 space-y-1">
            {pausedByMeta.map((t) => (
              <p key={t.id}>
                <span className="font-mono font-semibold">{t.name}</span>{" "}
                {t.metaStatus === "DISABLED" ? "está desactivada por Meta" : "está pausada por Meta"}
                {t.pausedReason ? ` (${t.pausedReason})` : ""}. Las campañas que la usan se pausaron solas. Te sugerimos
                editar el texto y volver a enviarla a revisión.
              </p>
            ))}
          </div>
        </div>
      )}

      {noticed.length > 0 && (
        <div
          role="status"
          data-testid="template-category-changes"
          className="flex items-start gap-3 rounded-lg border border-warning-soft bg-warning-tint p-4 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            {categoryChanges.length > 0 && (
              <>
                <p className="font-medium">Meta cambió la categoría de {categoryChanges.length === 1 ? "una plantilla" : `${categoryChanges.length} plantillas`}</p>
                <ul className="list-inside list-disc text-muted-foreground">
                  {categoryChanges.map((t) => (
                    <li key={t.id}>
                      <span className="font-mono">{t.name}</span>: {t.categoryChange!.from} → {t.categoryChange!.to}
                      {t.categoryChange!.to === "MARKETING" && " (ahora se cobra como marketing y aplica el límite de marketing por usuario)"}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {upcomingChanges.length > 0 && (
              <>
                <p className="font-medium" data-testid="template-upcoming-changes">
                  Meta avisó que va a cambiar la categoría de {upcomingChanges.length === 1 ? "una plantilla" : `${upcomingChanges.length} plantillas`}
                </p>
                <ul className="list-inside list-disc text-muted-foreground">
                  {upcomingChanges.map((t) => (
                    <li key={t.id}>
                      <span className="font-mono">{t.name}</span>: {t.upcomingCategory!.from} → {t.upcomingCategory!.to}
                      {t.upcomingCategory!.at &&
                        ` a partir del ${new Date(t.upcomingCategory!.at).toLocaleDateString("es-MX", { dateStyle: "medium" })}`}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={() => void acknowledge()}>
            Entendido
          </Button>
        </div>
      )}

      {creating && (
        <CreateDialog onClose={() => setCreating(false)}>
          <CreateForm
            headerImageAvailable={headerImageAvailable}
            onCreated={() => {
              setCreating(false);
              void refetch();
            }}
          />
        </CreateDialog>
      )}
    </div>
  );

  if (!shell) return body;
  return (
    <CampaignsShell actions={actions}>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">{body}</div>
    </CampaignsShell>
  );
}

/** Ventana del formulario «Nueva plantilla»: Escape o clic fuera la cierran. */
function CreateDialog({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay p-4 sm:py-10" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Nueva plantilla"
        className="relative w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Cerrar"
          onClick={onClose}
          className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-text-3 hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

/**
 * Plantilla con imagen en el encabezado creada fuera del CRM: guarda la
 * imagen aquí para poder enviarla. No toca la plantilla en Meta.
 */
function AttachHeaderImage({ templateId, onAttached }: { templateId: string; onAttached: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (!/^image\/(jpeg|png)$/.test(file.type)) return setError("La imagen debe ser JPG o PNG");
    if (file.size > 5 * 1024 * 1024) return setError("La imagen excede 5 MB");
    setSaving(true);
    const form = new FormData();
    form.set("image", file);
    const res = await fetchJson<{ template: TemplateDto }>(`/api/templates/${encodeURIComponent(templateId)}/header-image`, {
      method: "POST",
      body: form,
    });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    onAttached();
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        className="sr-only"
        data-testid="template-attach-image-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <Button size="sm" variant="outline" disabled={saving} onClick={() => inputRef.current?.click()} data-testid="template-attach-image">
        <ImagePlus className="h-4 w-4" />
        {saving ? "Guardando…" : "Adjuntar imagen"}
      </Button>
      <span className="text-xs text-muted-foreground">JPG o PNG, máx. 5 MB. Solo se guarda en el CRM; la plantilla en Meta no cambia.</span>
      {error && <p className="w-full text-xs text-destructive">{error}</p>}
    </div>
  );
}

function CreateForm({
  headerImageAvailable,
  onCreated,
}: {
  headerImageAvailable: boolean;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("es_MX");
  const [category, setCategory] = useState<"UTILITY" | "MARKETING">("UTILITY");
  const [body, setBody] = useState("");
  const [examples, setExamples] = useState<string[]>([]);
  const [headerFormat, setHeaderFormat] = useState<"NONE" | "TEXT" | "IMAGE">("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerImage, setHeaderImage] = useState<File | null>(null);
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<TemplateButtonDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const variableCount = countVariables(body);
  const bodyError = body.trim() ? validateBodyVariables(body) : null;

  const draft: TemplateDraft = useMemo(
    () => ({
      name,
      language,
      category,
      body,
      bodyExamples: Array.from({ length: variableCount }, (_, i) => examples[i] ?? ""),
      header:
        headerFormat === "TEXT"
          ? { format: "TEXT", text: headerText }
          : headerFormat === "IMAGE"
            ? { format: "IMAGE" }
            : { format: "NONE" },
      footer: footer.trim() || null,
      buttons,
    }),
    [name, language, category, body, variableCount, examples, headerFormat, headerText, footer, buttons]
  );
  // Misma validación que el servidor: avisa antes de gastar una llamada a Meta.
  const draftError = body.trim() ? validateTemplateDraft(draft) : null;
  const imageMissing = headerFormat === "IMAGE" && !headerImage;

  function setButton(i: number, patch: Partial<TemplateButtonDraft>) {
    setButtons((bs) => bs.map((b, j) => (j === i ? ({ ...b, ...patch } as TemplateButtonDraft) : b)));
  }

  async function create() {
    setSaving(true);
    setError(null);
    let init: RequestInit;
    if (headerFormat === "IMAGE" && headerImage) {
      const form = new FormData();
      form.set("draft", JSON.stringify(draft));
      form.set("headerImage", headerImage);
      init = { method: "POST", body: form };
    } else {
      init = { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) };
    }
    const res = await fetchJson<{ template: TemplateDto }>("/api/templates", init);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setName("");
    setBody("");
    setExamples([]);
    setHeaderFormat("NONE");
    setHeaderText("");
    setHeaderImage(null);
    setFooter("");
    setButtons([]);
    onCreated();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva plantilla</CardTitle>
        <CardDescription>
          Cuerpo con las variables que necesites: numéralas{" "}
          <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code>, <code>{"{{3}}"}</code>
          … en orden y sin saltos, con un ejemplo para cada una. Se envía a
          aprobación de Meta al crearla.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">Nombre</Label>
            <Input
              id="tpl-name"
              placeholder="seguimiento_cotizacion"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-lang">Idioma</Label>
            <select id="tpl-lang" value={language} onChange={(e) => setLanguage(e.target.value)} className={SELECT_CLASS}>
              <option value="es_MX">es_MX</option>
              <option value="es">es</option>
              <option value="es_AR">es_AR</option>
              <option value="en_US">en_US</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tpl-cat">Categoría</Label>
            <select
              id="tpl-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value as "UTILITY" | "MARKETING")}
              className={SELECT_CLASS}
            >
              <option value="UTILITY">UTILITY (seguimiento)</option>
              <option value="MARKETING">MARKETING</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="tpl-header">Encabezado</Label>
            <select
              id="tpl-header"
              value={headerFormat}
              onChange={(e) => setHeaderFormat(e.target.value as "NONE" | "TEXT" | "IMAGE")}
              className={SELECT_CLASS}
            >
              <option value="NONE">Sin encabezado</option>
              <option value="TEXT">Texto</option>
              <option value="IMAGE" disabled={!headerImageAvailable}>
                Imagen{headerImageAvailable ? "" : " (no disponible)"}
              </option>
            </select>
          </div>
          <div className="space-y-1.5 md:col-span-2">
            {headerFormat === "TEXT" && (
              <>
                <Label htmlFor="tpl-header-text">Texto del encabezado</Label>
                <Input
                  id="tpl-header-text"
                  maxLength={60}
                  placeholder="Tu cotización"
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                />
              </>
            )}
            {headerFormat === "IMAGE" && (
              <>
                <Label htmlFor="tpl-header-image">Imagen (JPG o PNG, máx. 5 MB)</Label>
                <Input
                  id="tpl-header-image"
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(e) => setHeaderImage(e.target.files?.[0] ?? null)}
                />
              </>
            )}
            {!headerImageAvailable && (
              <p className="text-xs text-muted-foreground">
                La imagen en el encabezado necesita que el administrador del servidor configure{" "}
                <code>META_APP_ID</code> (el App ID de tu app de Meta).
              </p>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tpl-body">Cuerpo</Label>
          <Textarea
            id="tpl-body"
            rows={3}
            placeholder="Hola {{1}}, te confirmo tu sesión el {{2}} a las {{3}}."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          {bodyError && <p className="text-xs text-destructive">{bodyError}</p>}
        </div>

        {!bodyError && variableCount > 0 && (
          <div className="grid gap-3 md:grid-cols-3">
            {Array.from({ length: variableCount }, (_, i) => (
              <div key={i} className="space-y-1.5">
                <Label htmlFor={`tpl-ex-${i + 1}`}>Ejemplo de {`{{${i + 1}}}`}</Label>
                <Input
                  id={`tpl-ex-${i + 1}`}
                  placeholder={i === 0 ? "Ana" : `ejemplo ${i + 1}`}
                  value={examples[i] ?? ""}
                  onChange={(e) =>
                    setExamples((xs) => {
                      const next = [...xs];
                      next[i] = e.target.value;
                      return next;
                    })
                  }
                />
              </div>
            ))}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="tpl-footer">Pie (opcional)</Label>
          <Input
            id="tpl-footer"
            maxLength={60}
            placeholder="Responde BAJA para no recibir más mensajes"
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label>Botones (opcional)</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setButtons((bs) => [...bs, { type: "QUICK_REPLY", text: "" }])}
            >
              <Plus className="h-4 w-4" /> Respuesta rápida
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setButtons((bs) => [...bs, { type: "URL", text: "", url: "https://" }])}
            >
              <Plus className="h-4 w-4" /> Enlace
            </Button>
          </div>
          {buttons.map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2" data-testid="tpl-button">
              <span className="w-28 text-xs text-muted-foreground">
                {b.type === "URL" ? "Enlace" : "Respuesta rápida"}
              </span>
              <Input
                aria-label={`Texto del botón ${i + 1}`}
                className="w-48"
                maxLength={25}
                placeholder="Texto del botón"
                value={b.text}
                onChange={(e) => setButton(i, { text: e.target.value })}
              />
              {b.type === "URL" && (
                <Input
                  aria-label={`URL del botón ${i + 1}`}
                  className="min-w-0 flex-1"
                  value={b.url}
                  onChange={(e) => setButton(i, { url: e.target.value })}
                />
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Quitar botón ${i + 1}`}
                onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        {body.trim() && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Vista previa</p>
            <div className="max-w-sm rounded-[14px] border border-bubble-in-border bg-bubble-in px-3 py-2 text-[13.5px] shadow-sm">
              {headerFormat === "TEXT" && headerText && <p className="font-semibold">{headerText}</p>}
              {headerFormat === "IMAGE" && (
                <p className="mb-1 rounded bg-subtle py-6 text-center text-xs text-muted-foreground">
                  {headerImage ? headerImage.name : "Imagen"}
                </p>
              )}
              <p className="whitespace-pre-wrap">{renderBody(body, draft.bodyExamples.map((e, i) => e || `{{${i + 1}}}`))}</p>
              {footer.trim() && <p className="mt-1 text-xs text-muted-foreground">{footer}</p>}
              {buttons.length > 0 && (
                <div className="mt-2 space-y-1 border-t pt-1">
                  {buttons.map((b, i) => (
                    <p key={i} className="text-center text-xs font-medium text-brand-ink">
                      {b.text || "Botón"}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {draftError && !bodyError && <p className="text-xs text-destructive">{draftError}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          disabled={saving || !name.trim() || !body.trim() || draftError !== null || imageMissing}
          onClick={() => void create()}
        >
          {saving ? "Enviando a Meta…" : "Crear y enviar a aprobación"}
        </Button>
      </CardContent>
    </Card>
  );
}
