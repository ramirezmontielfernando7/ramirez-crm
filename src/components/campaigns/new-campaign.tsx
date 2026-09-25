"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Send, ShieldCheck } from "lucide-react";
import { resolveVariables, type CampaignDto, type CampaignVariable } from "@/lib/campaigns";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import type { TagDto } from "@/lib/tags";
import { countVariables, renderBody } from "@/lib/templates";
import type { TemplateDto } from "@/lib/types";
import { SOURCE_LABELS } from "@/server/contact-source";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagChip } from "@/components/tags/tag-chip";

type Preview = { eligible: number; withoutConsent: number; optedOut: number };

const SOURCES = ["anuncio", "organico", "referido", "conocido", "otro", "desconocida"] as const;

/**
 * 021 — Nueva campaña: plantilla aprobada → público → variables → revisar y
 * confirmar. El público es SIEMPRE "acepta mensajes" (opt_in): no hay control
 * para cambiarlo, y el servidor lo impone igual.
 */
export function NewCampaign() {
  const router = useRouter();
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [variables, setVariables] = useState<CampaignVariable[]>([]);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** Si el borrador se creó pero el envío falló, reintentar no crea otro. */
  const [draftId, setDraftId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [t, g] = await Promise.all([
        fetchJson<{ templates: TemplateDto[] }>("/api/templates"),
        fetchJson<{ tags: TagDto[] }>("/api/contact-tags"),
      ]);
      if (!t.ok) setLoadError(`No se pudieron cargar las plantillas: ${t.error}`);
      else setTemplates(t.data.templates);
      if (!g.ok) setLoadError(`No se pudieron cargar las etiquetas: ${g.error}`);
      else setTags(g.data.tags);
    })();
  }, []);

  // Solo aprobadas por Meta: una pendiente o rechazada no se puede elegir.
  const approved = useMemo(() => (templates ?? []).filter((t) => t.status === "approved"), [templates]);
  const notApproved = (templates ?? []).length - approved.length;
  const template = approved.find((t) => t.id === templateId) ?? null;
  const varCount = template ? countVariables(template.body) : 0;

  useEffect(() => {
    setVariables(Array.from({ length: varCount }, () => ({ kind: "fixed", value: "" }) as CampaignVariable));
  }, [templateId, varCount]);

  const audience = useMemo(
    () => ({ ...(tagIds.length ? { tagIds } : {}), ...(source ? { source } : {}) }),
    [tagIds, source]
  );

  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        const res = await fetchJson<{ preview: Preview }>("/api/campaigns/preview", jsonInit("POST", { audience }));
        if (!res.ok) {
          setPreview(null);
          setPreviewError(`No se pudo calcular el público: ${res.error}`);
          return;
        }
        setPreviewError(null);
        setPreview(res.data.preview);
      })();
    }, 250);
    return () => clearTimeout(t);
  }, [audience]);

  const missingVar = variables.findIndex((v) => v.kind === "fixed" && !v.value.trim());
  const canReview =
    !!name.trim() && !!template && missingVar === -1 && (preview?.eligible ?? 0) > 0;

  const sampleText = template
    ? renderBody(template.body, resolveVariables(variables, "Ana López").map((v, i) => v || `{{${i + 1}}}`))
    : "";

  async function send() {
    setSending(true);
    setSendError(null);
    let id = draftId;
    if (!id) {
      const created = await fetchJson<{ campaign: CampaignDto }>(
        "/api/campaigns",
        jsonInit("POST", { name, templateId, variables, audience })
      );
      if (!created.ok) {
        setSending(false);
        setSendError(`No se creó la campaña: ${created.error}`);
        return;
      }
      id = created.data.campaign.id;
      setDraftId(id);
    }
    const sent = await fetchJson<{ campaign: CampaignDto }>(`/api/campaigns/${id}/send`, { method: "POST" });
    setSending(false);
    if (!sent.ok) {
      setSendError(`No se inició el envío: ${sent.error}. La campaña quedó como borrador.`);
      return;
    }
    router.push(`/campaigns/${id}`);
  }

  /** Volver a editar invalida el borrador creado en un intento fallido. */
  async function backToEdit() {
    if (draftId) {
      const res = await fetchJson(`/api/campaigns/${draftId}`, { method: "DELETE" });
      if (!res.ok) {
        setSendError(`No se pudo descartar el borrador anterior: ${res.error}`);
        return;
      }
      setDraftId(null);
    }
    setSendError(null);
    setReviewing(false);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <Link href="/campaigns" aria-label="Volver a Campañas">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h2 className="text-[17px] font-bold tracking-tight">Nueva campaña</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-3xl space-y-6">
          {loadError && (
            <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {loadError}
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle>1 · Nombre y plantilla</CardTitle>
              <CardDescription>
                Solo aparecen las plantillas <b>aprobadas por Meta</b>.
                {notApproved > 0 && ` ${notApproved} pendiente(s) o rechazada(s) no se pueden usar todavía.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cmp-name">Nombre interno</Label>
                <Input
                  id="cmp-name"
                  value={name}
                  maxLength={120}
                  disabled={reviewing}
                  placeholder="Ej.: Promo 2x1 marzo — clientes VIP"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cmp-template">Plantilla</Label>
                {templates !== null && approved.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No hay plantillas aprobadas.{" "}
                    <Link href="/settings/templates" className="font-medium text-brand-text underline underline-offset-2">
                      Crear o sincronizar en Configuración →
                    </Link>
                  </p>
                ) : (
                  <select
                    id="cmp-template"
                    value={templateId}
                    disabled={reviewing || templates === null}
                    onChange={(e) => setTemplateId(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                  >
                    <option value="">{templates === null ? "Cargando…" : "Elige una plantilla"}</option>
                    {approved.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.language}, {t.category})
                      </option>
                    ))}
                  </select>
                )}
                {template && (
                  <p className="whitespace-pre-wrap rounded-md border bg-subtle p-3 text-sm">{template.body}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2 · Público</CardTitle>
              <CardDescription className="flex items-start gap-1.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-text" />
                <span>
                  Solo contactos que <b>aceptaron recibir mensajes</b> (opt-in). Los demás nunca
                  reciben una campaña, aunque tengan la etiqueta.
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Etiquetas (cualquiera de las elegidas)</Label>
                {tags.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sin etiquetas: se tomará toda la base con opt-in.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map((t) => {
                      const on = tagIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          disabled={reviewing}
                          aria-pressed={on}
                          onClick={() => setTagIds(on ? tagIds.filter((x) => x !== t.id) : [...tagIds, t.id])}
                          className={on ? "rounded-full ring-2 ring-ring ring-offset-1 ring-offset-background" : "rounded-full opacity-70 hover:opacity-100"}
                        >
                          <TagChip tag={t} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cmp-source">Fuente</Label>
                <select
                  id="cmp-source"
                  value={source}
                  disabled={reviewing}
                  onChange={(e) => setSource(e.target.value)}
                  className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                >
                  <option value="">Toda fuente</option>
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {SOURCE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-md border bg-subtle p-3 text-sm" data-testid="audience-preview">
                {previewError ? (
                  <span className="text-danger-text">{previewError}</span>
                ) : preview === null ? (
                  "Calculando…"
                ) : (
                  <>
                    <p>
                      Le llegará a <b className="text-base">{preview.eligible}</b> contacto(s).
                    </p>
                    {preview.withoutConsent > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {preview.withoutConsent} más cumplen el filtro pero no tienen consentimiento
                        {preview.optedOut > 0 ? ` (${preview.optedOut} pidieron no recibir mensajes)` : ""}: no
                        recibirán nada.
                      </p>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {varCount > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>3 · Variables</CardTitle>
                <CardDescription>Qué va en cada {"{{n}}"} de la plantilla.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {variables.map((v, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <span className="w-10 font-mono text-sm">{`{{${i + 1}}}`}</span>
                    <select
                      value={v.kind}
                      disabled={reviewing}
                      aria-label={`Tipo de {{${i + 1}}}`}
                      onChange={(e) => {
                        const next = [...variables];
                        next[i] = e.target.value === "contact_name" ? { kind: "contact_name" } : { kind: "fixed", value: "" };
                        setVariables(next);
                      }}
                      className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                    >
                      <option value="fixed">Texto fijo</option>
                      <option value="contact_name">Nombre del contacto</option>
                    </select>
                    {v.kind === "fixed" && (
                      <Input
                        value={v.value}
                        disabled={reviewing}
                        maxLength={500}
                        aria-label={`Valor de {{${i + 1}}}`}
                        className="min-w-[12rem] flex-1"
                        onChange={(e) => {
                          const next = [...variables];
                          next[i] = { kind: "fixed", value: e.target.value };
                          setVariables(next);
                        }}
                      />
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{varCount > 0 ? "4" : "3"} · Revisar y enviar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {template && (
                <div>
                  <p className="mb-1 text-xs text-muted-foreground">Así lo verá, por ejemplo, «Ana López»:</p>
                  <p className="whitespace-pre-wrap rounded-md border bg-card p-3 text-sm">{sampleText}</p>
                </div>
              )}
              {!reviewing ? (
                <>
                  {!canReview && (
                    <p className="text-xs text-muted-foreground">
                      {!name.trim()
                        ? "Falta el nombre de la campaña."
                        : !template
                          ? "Falta elegir la plantilla."
                          : missingVar !== -1
                            ? `Falta el valor de {{${missingVar + 1}}}.`
                            : "El público no tiene ningún contacto con consentimiento."}
                    </p>
                  )}
                  <Button disabled={!canReview} onClick={() => setReviewing(true)}>
                    Revisar envío
                  </Button>
                </>
              ) : (
                <div className="space-y-3 rounded-md border border-warning-soft bg-warning-tint p-3">
                  <p className="text-sm text-warning-text">
                    Vas a enviar <b>{template?.name}</b> a <b>{preview?.eligible}</b> contacto(s) con
                    consentimiento. El envío corre en segundo plano y no se puede deshacer; cada mensaje
                    de plantilla lo cobra Meta.
                  </p>
                  {sendError && (
                    <p role="alert" className="text-sm text-danger-text">
                      {sendError}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={sending} onClick={() => void send()}>
                      <Send className="mr-1.5 h-4 w-4" />
                      {sending ? "Iniciando…" : `Confirmar y enviar a ${preview?.eligible ?? 0}`}
                    </Button>
                    <Button variant="ghost" disabled={sending} onClick={() => void backToEdit()}>
                      Volver a editar
                    </Button>
                    {draftId && (
                      <Link href={`/campaigns/${draftId}`}>
                        <Button variant="outline" type="button">
                          Ver borrador
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
