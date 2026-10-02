"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, Check, FileSpreadsheet, Send, ShieldCheck, Smartphone, Tag, Users } from "lucide-react";
import {
  EXCLUSION_LABEL,
  resolveVariables,
  type CampaignAudience,
  type CampaignDto,
  type CampaignPreview,
  type CampaignVariable,
  type ExclusionReason,
} from "@/lib/campaigns";
import type { AudienceDto } from "@/lib/audiences";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import type { TagDto } from "@/lib/tags";
import { countVariables, headerOf, renderBody } from "@/lib/templates";
import type { TemplateDto } from "@/lib/types";
import { SOURCE_LABELS } from "@/server/contact-source";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagChip } from "@/components/tags/tag-chip";
import { NavRevealButton } from "@/components/nav-mode";
import { UploadFlow } from "./audiences-client";
import { cn } from "@/lib/utils";

const SOURCES = ["anuncio", "organico", "referido", "conocido", "otro", "desconocida"] as const;
const STEPS = ["Audiencia", "Mensaje", "Revisar y enviar"] as const;
type Mode = "base" | "tags" | "file";

/**
 * Campañas v2 — Nueva campaña en 3 pasos:
 *   1. Audiencia: una base guardada, etiquetas, o un archivo nuevo.
 *   2. Mensaje: solo plantillas aprobadas y activas, variables (texto, nombre
 *      o columna de la base) y vista previa tipo burbuja de WhatsApp.
 *   3. Revisar y enviar: cuántos recibirán y por qué se excluye al resto,
 *      costo ESTIMADO, margen frente al límite del número, prueba a un número
 *      propio, y enviar ya o programar (zona horaria del negocio).
 * El público es SIEMPRE "acepta mensajes" (opt-in): no hay control para
 * cambiarlo y el servidor lo impone igual.
 */
export function NewCampaign({ initialAudienceId }: { initialAudienceId: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<TemplateDto[] | null>(null);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [audiences, setAudiences] = useState<AudienceDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("base");
  const [importId, setImportId] = useState<string>(initialAudienceId ?? "");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [source, setSource] = useState("");

  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [variables, setVariables] = useState<CampaignVariable[]>([]);

  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [when, setWhen] = useState<"now" | "later">("now");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [testPhone, setTestPhone] = useState("");
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** El borrador creado para la prueba o el envío: reintentar no crea otro. */
  const [draftId, setDraftId] = useState<string | null>(null);

  async function loadAudiences() {
    const a = await fetchJson<{ audiences: AudienceDto[] }>("/api/campaigns/audiences");
    if (!a.ok) setLoadError(`No se pudieron cargar las audiencias: ${a.error}`);
    else {
      setAudiences(a.data.audiences);
      if (a.data.audiences.length === 0 && !initialAudienceId) setMode("tags");
    }
  }

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
      await loadAudiences();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Solo aprobadas Y activas: una pendiente, rechazada o pausada no se elige.
  const approved = useMemo(() => (templates ?? []).filter((t) => t.status === "approved" && t.sendable !== false), [templates]);
  const notApproved = (templates ?? []).length - approved.length;
  const template = approved.find((t) => t.id === templateId) ?? null;
  const varCount = template ? countVariables(template.body) : 0;
  const base = (audiences ?? []).find((a) => a.id === importId) ?? null;
  const columns = useMemo(() => (mode === "base" || mode === "file" ? (base?.columns ?? []) : []), [mode, base]);

  useEffect(() => {
    setVariables(Array.from({ length: varCount }, () => ({ kind: "fixed", value: "" }) as CampaignVariable));
  }, [templateId, varCount]);

  const audience: CampaignAudience = useMemo(() => {
    if (mode === "tags") return { ...(tagIds.length ? { tagIds } : {}), ...(source ? { source } : {}) };
    return importId ? { importId } : {};
  }, [mode, importId, tagIds, source]);
  const audienceReady = mode === "tags" || !!importId;

  // Cualquier cambio invalida el borrador creado antes (lo que se envía cambió).
  useEffect(() => {
    if (!draftId) return;
    const id = draftId;
    setDraftId(null);
    void fetchJson(`/api/campaigns/${id}`, { method: "DELETE" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, templateId, variables, name]);

  useEffect(() => {
    if (!audienceReady) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      void (async () => {
        const res = await fetchJson<{ preview: CampaignPreview }>(
          "/api/campaigns/preview",
          jsonInit("POST", { audience, ...(templateId ? { templateId } : {}), variables })
        );
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
  }, [audience, audienceReady, templateId, variables]);

  const missingVar = variables.findIndex((v) => (v.kind === "fixed" && !v.value.trim()) || (v.kind === "column" && !v.column));
  const step1Ok = audienceReady && (preview?.eligible ?? 0) > 0;
  const step2Ok = !!name.trim() && !!template && missingVar === -1;
  const scheduleOk = when === "now" || (!!date && /^\d{2}:\d{2}$/.test(time));

  const sampleFields = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of columns) out[c] = `[${c}]`;
    return out;
  }, [columns]);
  const sampleValues = resolveVariables(variables, "Ana López", sampleFields).map((v, i) => v || `{{${i + 1}}}`);

  async function ensureDraft(): Promise<string | null> {
    if (draftId) return draftId;
    const created = await fetchJson<{ campaign: CampaignDto }>(
      "/api/campaigns",
      jsonInit("POST", { name, templateId, variables, audience })
    );
    if (!created.ok) {
      setSendError(`No se creó la campaña: ${created.error}`);
      return null;
    }
    setDraftId(created.data.campaign.id);
    return created.data.campaign.id;
  }

  async function sendTest() {
    setBusy(true);
    setTestMsg(null);
    setSendError(null);
    const id = await ensureDraft();
    if (!id) {
      setBusy(false);
      return;
    }
    const res = await fetchJson<{ test: { to: string } }>(`/api/campaigns/${id}/test`, jsonInit("POST", { phone: testPhone }));
    setBusy(false);
    setTestMsg(res.ok ? { ok: true, text: `Prueba enviada a +${res.data.test.to}. Revísala en tu WhatsApp.` } : { ok: false, text: res.error });
  }

  async function launch() {
    setBusy(true);
    setSendError(null);
    const id = await ensureDraft();
    if (!id) {
      setBusy(false);
      return;
    }
    const sent = await fetchJson<{ campaign: CampaignDto }>(
      `/api/campaigns/${id}/send`,
      jsonInit("POST", when === "later" ? { scheduledLocal: { date, time } } : {})
    );
    setBusy(false);
    if (!sent.ok) {
      setSendError(`No se inició el envío: ${sent.error}. La campaña quedó como borrador.`);
      return;
    }
    router.push(`/campaigns/${id}`);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3 sm:px-6 sm:py-4">
        <NavRevealButton />
        <Link href="/campaigns" aria-label="Volver a Campañas">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h2 className="text-[17px] font-bold tracking-tight">Nueva campaña</h2>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-3xl space-y-5">
          <ol className="flex flex-wrap gap-2" aria-label="Pasos" data-testid="wizard-steps">
            {STEPS.map((label, i) => (
              <li key={label}>
                <button
                  type="button"
                  disabled={i > step}
                  onClick={() => setStep(i)}
                  aria-current={i === step ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs",
                    i === step ? "border-brand bg-brand-tint font-medium" : i < step ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  <span className="flex h-4 w-4 items-center justify-center rounded-full border text-[10px]">
                    {i < step ? <Check className="h-3 w-3" /> : i + 1}
                  </span>
                  {label}
                </button>
              </li>
            ))}
          </ol>

          {loadError && (
            <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {loadError}
            </p>
          )}

          {step === 0 && (
            <Card data-testid="wizard-step-audience">
              <CardHeader>
                <CardTitle>1 · ¿A quién?</CardTitle>
                <CardDescription className="flex items-start gap-1.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-text" />
                  <span>
                    Solo contactos que <b>aceptaron recibir mensajes</b> (opt-in). Los demás nunca reciben una
                    campaña.
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tipo de público">
                  {(
                    [
                      ["base", "Base guardada", Users],
                      ["tags", "Etiquetas", Tag],
                      ["file", "Archivo nuevo", FileSpreadsheet],
                    ] as const
                  ).map(([m, label, Icon]) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={mode === m}
                      data-testid={`audience-mode-${m}`}
                      onClick={() => {
                        setMode(m);
                        if (m === "file") setImportId("");
                      }}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm",
                        mode === m ? "border-brand bg-brand-tint font-medium" : "hover:bg-accent"
                      )}
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.6} />
                      {label}
                    </button>
                  ))}
                </div>

                {mode === "base" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="cmp-base">Base</Label>
                    {audiences !== null && audiences.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Aún no hay bases guardadas. Elige «Archivo nuevo» o súbela en{" "}
                        <Link href="/campaigns/audiences" className="font-medium text-brand-text underline underline-offset-2">
                          Audiencias
                        </Link>
                        .
                      </p>
                    ) : (
                      <select
                        id="cmp-base"
                        data-testid="audience-base"
                        value={importId}
                        onChange={(e) => setImportId(e.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                      >
                        <option value="">{audiences === null ? "Cargando…" : "Elige una base"}</option>
                        {(audiences ?? []).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.consent.optIn} con consentimiento)
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {mode === "tags" && (
                  <>
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
                  </>
                )}

                {mode === "file" && !importId && (
                  <UploadFlow
                    compact
                    onCancel={() => setMode(audiences && audiences.length > 0 ? "base" : "tags")}
                    onImported={(a) => {
                      void loadAudiences();
                      setImportId(a.id);
                    }}
                  />
                )}
                {mode === "file" && importId && base && (
                  <p className="rounded-md border bg-subtle p-3 text-sm">
                    Base importada: <b>{base.name}</b>.
                  </p>
                )}

                <AudienceSummary preview={preview} error={previewError} ready={audienceReady} />

                <div className="flex justify-end">
                  <Button disabled={!step1Ok} onClick={() => setStep(1)} data-testid="wizard-next-1">
                    Siguiente: mensaje
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {step === 1 && (
            <Card data-testid="wizard-step-message">
              <CardHeader>
                <CardTitle>2 · Mensaje</CardTitle>
                <CardDescription>
                  Solo aparecen las plantillas <b>aprobadas y activas en Meta</b>.
                  {notApproved > 0 && ` ${notApproved} pendiente(s), rechazada(s) o pausada(s) no se pueden usar.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-[1fr_minmax(0,280px)]">
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="cmp-name">Nombre interno</Label>
                      <Input
                        id="cmp-name"
                        value={name}
                        maxLength={120}
                        placeholder="Ej.: Promo 2x1 marzo — clientes VIP"
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cmp-template">Plantilla</Label>
                      {templates !== null && approved.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No hay plantillas aprobadas.{" "}
                          <Link href="/campaigns/templates" className="font-medium text-brand-text underline underline-offset-2">
                            Crear o sincronizar en Plantillas →
                          </Link>
                        </p>
                      ) : (
                        <select
                          id="cmp-template"
                          value={templateId}
                          disabled={templates === null}
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
                    </div>
                    {variables.map((v, i) => (
                      <div key={i} className="space-y-1.5">
                        <Label>{`Variable {{${i + 1}}}`}</Label>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={v.kind}
                            aria-label={`Tipo de {{${i + 1}}}`}
                            onChange={(e) => {
                              const next = [...variables];
                              const k = e.target.value;
                              next[i] =
                                k === "contact_name"
                                  ? { kind: "contact_name" }
                                  : k === "column"
                                    ? { kind: "column", column: columns[0] ?? "" }
                                    : { kind: "fixed", value: "" };
                              setVariables(next);
                            }}
                            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                          >
                            <option value="fixed">Texto fijo</option>
                            <option value="contact_name">Nombre del contacto</option>
                            {columns.length > 0 && <option value="column">Columna de la base</option>}
                          </select>
                          {v.kind === "fixed" && (
                            <Input
                              value={v.value}
                              maxLength={500}
                              aria-label={`Valor de {{${i + 1}}}`}
                              className="min-w-[10rem] flex-1"
                              onChange={(e) => {
                                const next = [...variables];
                                next[i] = { kind: "fixed", value: e.target.value };
                                setVariables(next);
                              }}
                            />
                          )}
                          {v.kind === "column" && (
                            <select
                              value={v.column}
                              aria-label={`Columna de {{${i + 1}}}`}
                              onChange={(e) => {
                                const next = [...variables];
                                next[i] = { kind: "column", column: e.target.value };
                                setVariables(next);
                              }}
                              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                            >
                              {columns.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <WhatsAppBubble template={template} values={sampleValues} />
                </div>
                <div className="flex justify-between">
                  <Button variant="ghost" onClick={() => setStep(0)}>
                    Atrás
                  </Button>
                  <Button disabled={!step2Ok} onClick={() => setStep(2)} data-testid="wizard-next-2">
                    Siguiente: revisar
                  </Button>
                </div>
                {!step2Ok && (
                  <p className="text-right text-xs text-muted-foreground">
                    {!name.trim()
                      ? "Falta el nombre de la campaña."
                      : !template
                        ? "Falta elegir la plantilla."
                        : `Falta el valor de {{${missingVar + 1}}}.`}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {step === 2 && (
            <Card data-testid="wizard-step-review">
              <CardHeader>
                <CardTitle>3 · Revisar y enviar</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <ReviewSummary preview={preview} error={previewError} />

                <div className="space-y-2 rounded-md border p-3">
                  <p className="flex items-center gap-1.5 font-medium">
                    <Smartphone className="h-4 w-4" /> Envío de prueba
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Mándala a tu propio número antes de enviarla a todos. No cuenta en la campaña.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      aria-label="Número para la prueba"
                      data-testid="test-phone"
                      placeholder="52 1 55 1234 5678"
                      className="w-56"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                    />
                    <Button variant="outline" disabled={busy || testPhone.trim().length < 7} onClick={() => void sendTest()} data-testid="test-send">
                      Enviar prueba
                    </Button>
                  </div>
                  {testMsg && (
                    <p role="status" className={testMsg.ok ? "text-success-text" : "text-danger-text"} data-testid="test-result">
                      {testMsg.text}
                    </p>
                  )}
                </div>

                <div className="space-y-2 rounded-md border p-3">
                  <p className="flex items-center gap-1.5 font-medium">
                    <CalendarClock className="h-4 w-4" /> ¿Cuándo?
                  </p>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} /> Enviar ya
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" name="when" checked={when === "later"} onChange={() => setWhen("later")} data-testid="when-later" />
                      Programar
                    </label>
                  </div>
                  {when === "later" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Input type="date" aria-label="Fecha" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} data-testid="schedule-date" />
                      <Input type="time" aria-label="Hora" className="w-32" value={time} onChange={(e) => setTime(e.target.value)} data-testid="schedule-time" />
                      <span className="text-xs text-muted-foreground">Hora de {preview?.timezone ?? "tu negocio"}</span>
                    </div>
                  )}
                </div>

                {sendError && (
                  <p role="alert" className="text-danger-text">
                    {sendError}
                  </p>
                )}

                {!confirming ? (
                  <div className="flex justify-between">
                    <Button variant="ghost" onClick={() => setStep(1)}>
                      Atrás
                    </Button>
                    <Button
                      disabled={!step1Ok || !step2Ok || !scheduleOk}
                      onClick={() => setConfirming(true)}
                      data-testid="wizard-confirm"
                    >
                      {when === "later" ? "Programar" : "Enviar"} a {preview?.eligible ?? 0}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3 rounded-md border border-warning-soft bg-warning-tint p-3">
                    <p className="text-warning-text">
                      {when === "later" ? `Vas a programar para el ${date} a las ${time}` : "Vas a enviar"}{" "}
                      <b>{template?.name}</b> a <b>{preview?.eligible}</b> contacto(s) con consentimiento. El envío corre
                      en segundo plano; puedes pausarlo o cancelarlo desde el detalle. Cada mensaje de plantilla lo cobra Meta.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={busy} onClick={() => void launch()} data-testid="wizard-launch">
                        <Send className="mr-1.5 h-4 w-4" />
                        {busy ? "Iniciando…" : "Confirmar"}
                      </Button>
                      <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                        Volver
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function AudienceSummary({ preview, error, ready }: { preview: CampaignPreview | null; error: string | null; ready: boolean }) {
  return (
    <div className="rounded-md border bg-subtle p-3 text-sm" data-testid="audience-preview">
      {!ready ? (
        <span className="text-muted-foreground">Elige el público para ver a cuántos les llegará.</span>
      ) : error ? (
        <span className="text-danger-text">{error}</span>
      ) : preview === null ? (
        "Calculando…"
      ) : (
        <>
          <p>
            Le llegará a <b className="text-base">{preview.eligible.toLocaleString("es-MX")}</b> contacto(s).
          </p>
          <Exclusions excluded={preview.excluded} />
        </>
      )}
    </div>
  );
}

function Exclusions({ excluded }: { excluded: Record<ExclusionReason, number> }) {
  const rows = (Object.entries(excluded) as [ExclusionReason, number][]).filter(([, n]) => n > 0);
  if (rows.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground" data-testid="exclusions">
      {rows.map(([reason, n]) => (
        <li key={reason}>
          {n.toLocaleString("es-MX")} · {EXCLUSION_LABEL[reason]}
        </li>
      ))}
    </ul>
  );
}

function ReviewSummary({ preview, error }: { preview: CampaignPreview | null; error: string | null }) {
  if (error) return <p className="text-danger-text">{error}</p>;
  if (!preview) return <p className="text-muted-foreground">Calculando…</p>;
  const overLimit = preview.margin !== null && preview.eligible > preview.margin;
  return (
    <div className="grid gap-3 sm:grid-cols-3" data-testid="review-summary">
      <div className="rounded-md border bg-subtle p-3">
        <p className="text-xs text-muted-foreground">Recibirán</p>
        <p className="text-xl font-semibold">{preview.eligible.toLocaleString("es-MX")}</p>
        <Exclusions excluded={preview.excluded} />
      </div>
      <div className="rounded-md border bg-subtle p-3" data-testid="review-cost">
        <p className="text-xs text-muted-foreground">
          Costo <span className="rounded bg-warning-tint px-1 text-warning-text">Estimado</span>
        </p>
        {preview.estimate ? (
          <p className="text-xl font-semibold">
            {preview.estimate.amount.toLocaleString("es-MX", { maximumFractionDigits: 2 })} {preview.estimate.currency ?? ""}
          </p>
        ) : (
          <p className="text-xs">
            Sin tarifa para {preview.category?.toLowerCase() ?? "esta categoría"}.{" "}
            <Link href="/campaigns/settings" className="font-medium text-brand-text underline underline-offset-2">
              Captúrala
            </Link>
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">Lo reportado por Meta está en la pestaña Métricas.</p>
      </div>
      <div className={cn("rounded-md border p-3", overLimit ? "border-warning-soft bg-warning-tint" : "bg-subtle")} data-testid="review-limit">
        <p className="text-xs text-muted-foreground">Margen del límite de 24 h</p>
        {preview.margin === null ? (
          <p className="text-xs">Sin límite conocido (Meta no lo ha reportado o es ilimitado).</p>
        ) : (
          <>
            <p className="text-xl font-semibold">{preview.margin.toLocaleString("es-MX")}</p>
            <p className="text-[11px] text-muted-foreground">
              de {preview.limit?.toLocaleString("es-MX")}; hoy van {preview.usage.toLocaleString("es-MX")}
            </p>
            {overLimit && (
              <p className="mt-1 text-[11px] text-warning-text">
                No cabe hoy completa: la pausa de seguridad la detendrá al llegar al límite y seguirá sola después.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Vista previa tipo burbuja de WhatsApp: encabezado, cuerpo, pie y botones. */
function WhatsAppBubble({ template, values }: { template: TemplateDto | null; values: string[] }) {
  if (!template) {
    return (
      <div className="flex min-h-[10rem] items-center justify-center rounded-xl bg-[#e5ddd5] p-4 text-center text-xs text-[#54656f] dark:bg-[#0b141a] dark:text-[#8696a0]">
        Elige una plantilla para ver cómo se verá.
      </div>
    );
  }
  const header = headerOf(template.components);
  const footer = template.components?.find((c) => c.type?.toUpperCase() === "FOOTER")?.text ?? null;
  const buttons = template.components?.find((c) => c.type?.toUpperCase() === "BUTTONS")?.buttons ?? [];
  return (
    <div className="rounded-xl bg-[#e5ddd5] p-3 dark:bg-[#0b141a]" data-testid="whatsapp-bubble">
      <div className="max-w-full rounded-lg rounded-tl-none bg-white p-2 text-[13px] text-[#111b21] shadow-sm dark:bg-[#202c33] dark:text-[#e9edef]">
        {header?.format?.toUpperCase() === "IMAGE" && (
          <div className="mb-1.5 flex h-24 items-center justify-center rounded bg-[#d1d7db] text-[11px] text-[#54656f] dark:bg-[#2a3942] dark:text-[#8696a0]">
            Imagen del encabezado
          </div>
        )}
        {header?.format?.toUpperCase() === "TEXT" && header.text && <p className="mb-1 font-semibold">{header.text}</p>}
        <p className="whitespace-pre-wrap break-words">{renderBody(template.body, values)}</p>
        {footer && <p className="mt-1 text-[11px] text-[#667781] dark:text-[#8696a0]">{footer}</p>}
        <p className="mt-0.5 text-right text-[10px] text-[#667781] dark:text-[#8696a0]">10:30</p>
      </div>
      {buttons.length > 0 && (
        <div className="mt-1 space-y-1">
          {buttons.map((b, i) => (
            <div key={i} className="rounded-lg bg-white py-1.5 text-center text-[13px] text-[#027eb5] shadow-sm dark:bg-[#202c33] dark:text-[#53bdeb]">
              {b.text ?? b.type}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
