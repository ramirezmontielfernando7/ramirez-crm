"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, RefreshCw, Trash2 } from "lucide-react";
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

export function TemplatesClient() {
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [headerImageAvailable, setHeaderImageAvailable] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetchJson<{ templates: TemplateDto[]; headerImageAvailable?: boolean }>("/api/templates");
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    setLoadError(null);
    setTemplates(res.data.templates);
    setHeaderImageAvailable(Boolean(res.data.headerImageAvailable));
  }, []);

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

  async function acknowledge() {
    const res = await fetchJson<{ updated: number }>("/api/templates/category-seen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateIds: categoryChanges.map((t) => t.id) }),
    });
    if (res.ok) void refetch();
    else setSyncMsg(res.error);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Las plantillas permiten reabrir conversaciones con la ventana de 24 h
          cerrada y son las que usan las campañas. Meta las aprueba en horas o
          días y puede reclasificar la categoría (lo que cambia el costo).
          Esta pantalla consulta a Meta cada vez que la abres e importa las
          plantillas que ya existan en tu cuenta; Sincronizar fuerza la
          consulta sin recargar.
        </p>
        <Button variant="outline" size="sm" disabled={syncing} onClick={() => void sync()}>
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          Sincronizar
        </Button>
      </div>
      {syncMsg && <p className="text-xs text-muted-foreground">{syncMsg}</p>}
      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      {categoryChanges.length > 0 && (
        <div
          role="status"
          data-testid="template-category-changes"
          className="flex items-start gap-3 rounded-lg border border-warning-soft bg-warning-tint p-4 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">Meta cambió la categoría de {categoryChanges.length === 1 ? "una plantilla" : `${categoryChanges.length} plantillas`}</p>
            <ul className="list-inside list-disc text-muted-foreground">
              {categoryChanges.map((t) => (
                <li key={t.id}>
                  <span className="font-mono">{t.name}</span>: {t.categoryChange!.from} → {t.categoryChange!.to}
                  {t.categoryChange!.to === "MARKETING" && " (ahora se cobra como marketing y aplica el límite de marketing por usuario)"}
                </li>
              ))}
            </ul>
          </div>
          <Button size="sm" variant="outline" onClick={() => void acknowledge()}>
            Entendido
          </Button>
        </div>
      )}

      <CreateForm headerImageAvailable={headerImageAvailable} onCreated={() => void refetch()} />

      <div className="space-y-2" data-testid="template-list">
        {templates.map((t) => {
          const meta = t.metaStatus ? META_BADGE[t.metaStatus] : undefined;
          const header = headerOf(t.components);
          return (
            <div key={t.id} className="rounded-lg border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-sm font-medium">
                  {t.name}{" "}
                  <span className="text-muted-foreground">
                    ({t.language} · {t.category})
                  </span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {meta ? (
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  ) : (
                    <Badge variant={STATUS_BADGE[t.status].variant}>{STATUS_BADGE[t.status].label}</Badge>
                  )}
                  {t.qualityScore && t.qualityScore !== "UNKNOWN" && t.qualityScore !== "GREEN" && (
                    <Badge variant={t.qualityScore === "RED" ? "destructive" : "warning"}>
                      Calidad {t.qualityScore === "RED" ? "baja" : "media"}
                    </Badge>
                  )}
                </div>
              </div>
              {header?.format === "TEXT" && header.text && <p className="mt-2 text-sm font-semibold">{header.text}</p>}
              {header?.format === "IMAGE" && (
                <p className="mt-2 text-xs text-muted-foreground">[Imagen en el encabezado]</p>
              )}
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
              {t.status === "rejected" && t.rejectionReason && (
                <p className="mt-2 text-xs text-destructive">Razón del rechazo: {t.rejectionReason}</p>
              )}
              {t.status === "approved" && !t.sendable && t.unsendableReason && (
                <p className="mt-2 text-xs text-destructive">No se puede enviar: {t.unsendableReason}</p>
              )}
            </div>
          );
        })}
        {templates.length === 0 && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Sin plantillas todavía. Crea la primera arriba — por ejemplo un
            «seguimos disponibles, ¿retomamos tu cotización?» para
            conversaciones frías.
          </p>
        )}
      </div>
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
