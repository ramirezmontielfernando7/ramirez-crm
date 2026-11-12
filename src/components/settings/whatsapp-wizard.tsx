"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronRight,
  MessageCircle,
  Plus,
  SlidersHorizontal,
  Smartphone,
  Copy,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { RefreshCw } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { messagingLimitLabel, QUALITY_LABEL } from "@/lib/phone-health";
import type { HealthSummaryDto } from "@/components/number-health";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { WebhookSettingsDto } from "@/lib/webhook-settings";
import { Label } from "@/components/ui/label";
import { CONNECTION_STATUS_LABEL, type ConnectionMode } from "@/lib/direct-connection";
import { phoneCompact } from "@/lib/utils";
import { EmbeddedSignupCard, type EmbeddedSignupConfig } from "@/components/settings/embedded-signup-card";

type Connection = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
  /** 0080: el nombre que la empresa le puso al número («Ventas»). */
  label?: string | null;
};

/** 0080: un número de la lista (el principal va primero). */
type NumberRow = Connection & { isPrimary: boolean; tokenLast4: string | null };

type WebhookInfo = WebhookSettingsDto;
type PlatformWebhookInfo = Extract<WebhookSettingsDto, { managedByPlatform: false }>;

export function WhatsappWizard({
  direct = null,
  templatesHref = null,
}: {
  /** Teléfono vinculado (complemento + permiso de vincular); `canMode` = puede elegir por dónde salen los chats nuevos. */
  direct?: { canMode: boolean } | null;
  /** A dónde lleva el renglón «Plantillas» (Marketing o Ajustes); `null` = sin renglón. */
  templatesHref?: string | null;
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [numbers, setNumbers] = useState<NumberRow[]>([]);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [embeddedSignup, setEmbeddedSignup] = useState<EmbeddedSignupConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedRef = useRef<HTMLDivElement>(null);

  const refetch = useCallback(async () => {
    const [c, w] = await Promise.all([
      fetch("/api/settings/whatsapp").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/settings/webhook").then((r) => (r.ok ? r.json() : null)),
    ]).catch((err: unknown) => {
      // Sin datos la pantalla sigue (vacía); el error queda en la consola.
      console.error("[ajustes/whatsapp] no se pudo cargar la conexión o el webhook:", err);
      return [null, null];
    });
    if (c) {
      setConnection(c.connection);
      setNumbers(c.numbers ?? []);
      setEmbeddedSignup(c.embeddedSignup ?? null);
    }
    if (w) setWebhook(w);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  const connected = connection?.status === "connected";
  // Plegado salvo que algo pida atención: sin número, token vencido o firma del webhook sin configurar.
  const needsAttention =
    !connected || (webhook !== null && (!webhook.signatureLayer || (webhook.managedByPlatform && webhook.platformConfigMissing)));
  const showAdvanced = advancedOpen || needsAttention;
  const advanced = (
    <>
      <ConnectForm
        existing={numbers.find((n) => n.status === "reconnect_required") ?? (numbers.length > 1 ? null : connection)}
        onSaved={() => void refetch()}
      />
      {webhook &&
        (webhook.managedByPlatform ? <ManagedWebhookCard webhook={webhook} /> : <WebhookCard webhook={webhook} />)}
    </>
  );
  function openAdvanced() {
    setAdvancedOpen(true);
    requestAnimationFrame(() => advancedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[min(100%,16rem)] flex-1 space-y-1">
          <h2 className="text-[22px] font-semibold tracking-tight max-lg:hidden">Canales y conexiones</h2>
          <p className="text-[13.5px] leading-relaxed text-text-2">
            {connected ? "Tus números y por dónde salen los mensajes." : "Conecta tu WhatsApp para recibir y contestar chats desde Dashfort."}
          </p>
        </div>
        {connected && (
          <Button variant="outline" onClick={openAdvanced} data-testid="conectar-otro-numero">
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            Conectar otro número
          </Button>
        )}
      </div>

      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">
              El token de WhatsApp expiró o fue revocado.
            </p>
            <p className="text-danger-text opacity-80">
              Los envíos están pausados. Pega un token nuevo abajo y prueba la
              conexión para reconectar.
            </p>
          </div>
        </div>
      )}

      {((connection && connected) || direct) && (
        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          {numbers.length > 0
            ? numbers
                .filter((n) => n.status === "connected")
                .map((n) => (
                  <OfficialNumberCard
                    key={n.phoneNumberId}
                    connection={n}
                    many={numbers.length > 1}
                    onChanged={() => void refetch()}
                  />
                ))
            : connection && connected && <OfficialNumberCard connection={connection} many={false} onChanged={() => void refetch()} />}
          {direct && <LinkedPhoneCard />}
        </div>
      )}

      {direct?.canMode && connected && <NewChatsModeCard />}

      {embeddedSignup && !connected && (
        <EmbeddedSignupCard config={embeddedSignup} connected={connected} onConnected={() => void refetch()} />
      )}

      {connected && (
        <div className="grid gap-4 lg:grid-cols-2">
          {templatesHref ? (
            <Link
              href={templatesHref}
              className="flex min-w-0 items-center gap-3 rounded-card border bg-surface px-4 py-3.5 hover:bg-subtle"
              data-testid="canales-plantillas"
            >
              <MessageCircle className="h-[18px] w-[18px] shrink-0 text-text-2" strokeWidth={1.8} />
              <span className="text-[14px] font-semibold">Plantillas</span>
              <TemplatesSummary />
              <ChevronRight className="h-4 w-4 shrink-0 text-text-3" />
            </Link>
          ) : (
            <span className="max-lg:hidden" />
          )}
          <button
            type="button"
            onClick={() => (showAdvanced && !needsAttention ? setAdvancedOpen(false) : openAdvanced())}
            aria-expanded={showAdvanced}
            className="flex min-w-0 items-center gap-3 rounded-card border bg-surface px-4 py-3.5 text-left hover:bg-subtle"
            data-testid="conexion-manual"
          >
            <SlidersHorizontal className="h-[18px] w-[18px] shrink-0 text-text-2" strokeWidth={1.8} />
            <span className="text-[14px] font-semibold">Opciones avanzadas</span>
            <span className="ml-auto truncate text-[13px] text-text-2">Webhook, token y PIN</span>
            <ChevronRight className={`h-4 w-4 shrink-0 text-text-3 transition-transform ${showAdvanced ? "rotate-90" : ""}`} />
          </button>
        </div>
      )}

      {connected && embeddedSignup && showAdvanced && (
        <EmbeddedSignupCard config={embeddedSignup} connected={connected} onConnected={() => void refetch()} />
      )}

      {(showAdvanced || !connected) && (
        <div ref={advancedRef} className="space-y-4" data-testid="opciones-avanzadas">
          {embeddedSignup && !connected ? (
            <details className="group rounded-lg border bg-card">
              <summary className="cursor-pointer select-none px-5 py-4 text-sm font-medium">
                Conexión manual
                <span className="ml-2 font-normal text-muted-foreground">
                  Token de Meta, webhook y PIN · solo si tu técnico te lo pide
                </span>
              </summary>
              <div className="space-y-4 border-t p-4">{advanced}</div>
            </details>
          ) : (
            advanced
          )}
        </div>
      )}
    </div>
  );
}

/** «12 aprobadas · se administran en Marketing»: cuántas plantillas aprobadas hay. */
function TemplatesSummary() {
  const [approved, setApproved] = useState<number | null>(null);
  useEffect(() => {
    void fetchJson<{ templates: { status: string }[] }>("/api/templates").then((r) => {
      if (r.ok) setApproved(r.data.templates.filter((t) => t.status === "approved").length);
    });
  }, []);
  return (
    <span className="ml-auto truncate text-[13px] text-text-2">
      {approved === null ? "" : `${approved.toLocaleString("es-MX")} ${approved === 1 ? "aprobada" : "aprobadas"} · `}se administran en Marketing
    </span>
  );
}

type LinkedStatus = { status: string; phoneNumber: string | null; connectedAt: string | null; pausedUntil: string | null };

/** «Teléfono vinculado»: el dispositivo de la conexión directa, su estado y el acceso a sus límites. */
function LinkedPhoneCard() {
  const [st, setSt] = useState<LinkedStatus | null>(null);
  useEffect(() => {
    void fetchJson<{ connection: LinkedStatus }>("/api/settings/direct-connection").then((r) => {
      if (r.ok) setSt(r.data.connection);
    });
  }, []);
  const label = st ? (CONNECTION_STATUS_LABEL as Record<string, string>)[st.status] ?? st.status : "…";
  const ok = st?.status === "connected";
  return (
    <section className="min-w-0 rounded-card border bg-surface" data-testid="linked-phone-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Smartphone className="h-[18px] w-[18px] text-brand" strokeWidth={1.8} />
        <h3 className="text-[14px] font-semibold">Teléfono vinculado</h3>
        {st && <Badge variant={ok ? "success" : "secondary"}>{label}</Badge>}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xl font-semibold">{st?.phoneNumber ? phoneCompact(st.phoneNumber) : ok ? "Conectado" : "Sin vincular"}</p>
          <p className="text-sm text-text-2">
            {st?.pausedUntil
              ? "Envíos en pausa de seguridad"
              : st?.connectedAt
                ? `Vinculado el ${new Date(st.connectedAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}`
                : "Vincúlalo con código QR"}
          </p>
        </div>
        <Link href="/settings/direct-connection" className={buttonVariants({ size: "sm", variant: "outline" })}>
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} />
          {ok ? "Límites" : "Vincular"}
        </Link>
      </div>
    </section>
  );
}

const MODE_CHOICES: { mode: ConnectionMode; label: string; hint: string; dot: string }[] = [
  { mode: "meta", label: "Oficial", hint: "Entra y sale por WhatsApp oficial (Meta). Lo más seguro.", dot: "bg-success" },
  { mode: "directa", label: "Directa", hint: "Entra y sale por el teléfono vinculado.", dot: "bg-[#1f5fd1]" },
  { mode: "mixta", label: "Híbrida", hint: "Entra por oficial y sale por el teléfono.", dot: "bg-[#6d3fc0]" },
];

/**
 * «¿Por dónde salen los chats nuevos?»: el modo por defecto de la conexión
 * directa (el mismo de su página de Ajustes), guardado al elegir. Los demás
 * ajustes de esa página viajan tal cual en el mismo PUT.
 */
function NewChatsModeCard() {
  const [adv, setAdv] = useState<Record<string, unknown> & { defaultMode: ConnectionMode } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetchJson<{ advanced: Record<string, unknown> & { defaultMode: ConnectionMode }; metaless: boolean }>(
      "/api/settings/direct-connection/advanced"
    ).then((r) => {
      if (!r.ok) return setHidden(true);
      if (r.data.metaless) return setHidden(true);
      setAdv(r.data.advanced);
    });
  }, []);
  if (hidden || !adv) return null;
  async function pick(mode: ConnectionMode) {
    if (!adv || mode === adv.defaultMode) return;
    const before = adv;
    setAdv({ ...adv, defaultMode: mode });
    setBusy(true);
    setError(null);
    const r = await fetchJson<{ advanced: typeof before }>("/api/settings/direct-connection/advanced", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...before, defaultMode: mode }),
    });
    setBusy(false);
    if (r.ok) setAdv(r.data.advanced);
    else {
      setAdv(before);
      setError("No se pudo guardar. Inténtalo de nuevo.");
    }
  }
  return (
    <section className="rounded-card border bg-surface" data-testid="new-chats-mode">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b px-4 py-3">
        <h3 className="text-[14px] font-semibold">¿Por dónde salen los chats nuevos?</h3>
        <p className="text-[12.5px] text-text-2">Cada chat se puede cambiar después desde su encabezado</p>
      </div>
      <div role="radiogroup" aria-label="¿Por dónde salen los chats nuevos?" className="grid gap-3 p-4 md:grid-cols-3">
        {MODE_CHOICES.map((c) => {
          const on = adv.defaultMode === c.mode;
          return (
            <button
              key={c.mode}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy}
              onClick={() => void pick(c.mode)}
              className={`flex min-w-0 items-start gap-3 rounded-md border p-3 text-left transition-colors ${on ? "border-brand ring-1 ring-brand" : "hover:bg-accent"}`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? "border-brand" : "border-border-strong"}`}
              >
                {on && <span className="h-2 w-2 rounded-full bg-brand" />}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[14px] font-semibold">
                  <span className={`h-2 w-2 rounded-full ${c.dot}`} aria-hidden />
                  {c.label}
                </span>
                <span className="mt-0.5 block text-[12.5px] text-text-2">{c.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="px-4 pb-3 text-[13px] text-destructive">{error}</p>}
    </section>
  );
}

/** «WhatsApp oficial · Conectado»: el número y su salud (lo que Meta reportó hoy, de la base propia). */
function OfficialNumberCard({
  connection,
  many,
  onChanged,
}: {
  connection: Connection;
  /** 0080: hay más de un número (aparece el nombre editable y «Quitar»). */
  many: boolean;
  onChanged: () => void;
}) {
  const [summary, setSummary] = useState<HealthSummaryDto | null>(null);
  const [busy, setBusy] = useState(false);
  const healthUrl = `/api/number-health?number=${encodeURIComponent(connection.phoneNumberId)}`;
  const load = useCallback(async () => {
    const res = await fetchJson<HealthSummaryDto>(healthUrl);
    if (res.ok) setSummary(res.data);
  }, [healthUrl]);
  useEffect(() => {
    void load();
  }, [load]);
  async function refresh() {
    setBusy(true);
    const res = await fetchJson<HealthSummaryDto>(healthUrl, { method: "POST" });
    setBusy(false);
    if (res.ok) setSummary(res.data);
  }
  // 0080: nombre del número y quitarlo.
  const [name, setName] = useState(connection.label ?? "");
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const numberUrl = `/api/settings/whatsapp/numbers/${encodeURIComponent(connection.phoneNumberId)}`;
  async function saveName() {
    if (name.trim() === (connection.label ?? "")) return;
    const res = await fetchJson<{ ok: true }>(numberUrl, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: name.trim() === "" ? null : name.trim() }),
    });
    setNameMsg(res.ok ? "Nombre guardado" : "No se pudo guardar el nombre");
    if (res.ok) onChanged();
  }
  async function remove() {
    if (!window.confirm("¿Quitar este número? Sus chats seguirán en la bandeja y se contestarán desde tu número principal.")) return;
    const res = await fetchJson<{ ok: true }>(numberUrl, { method: "DELETE" });
    if (res.ok) onChanged();
    else setNameMsg("No se pudo quitar el número");
  }
  const today = summary?.today ?? null;
  const limit = today?.messagingLimitValue ?? null;
  const tile = "rounded-lg bg-subtle px-3 py-2.5";
  return (
    <Card className="min-w-0" data-testid="phone-health-card">
      <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-border py-3">
        <CardTitle className="flex items-center gap-2 text-[14px]">
          <MessageCircle className="h-[18px] w-[18px] text-success" strokeWidth={1.8} />
          {connection.label || "WhatsApp oficial"}
          <Badge variant="success">Conectado</Badge>
        </CardTitle>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => void refresh()}
          aria-label="Actualizar la lectura de Meta"
          title="Actualizar la lectura de Meta"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div>
          <p className="text-xl font-semibold">{connection.displayPhoneNumber ?? connection.phoneNumberId}</p>
          <p className="text-sm text-muted-foreground">
            {connection.verifiedName ? `${connection.verifiedName} · ` : ""}token …{connection.tokenLast4}
          </p>
        </div>
        <div className="space-y-1.5" data-testid="numero-nombre">
          <Label htmlFor={`num-label-${connection.phoneNumberId}`}>Nombre del número</Label>
          <div className="flex gap-2">
            <Input
              id={`num-label-${connection.phoneNumberId}`}
              placeholder="Ej. Ventas Cancún"
              maxLength={40}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setNameMsg(null);
              }}
              onBlur={() => void saveName()}
            />
            {many && (
              <Button size="sm" variant="outline" onClick={() => void remove()} data-testid="numero-quitar">
                Quitar
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {nameMsg ?? "Este nombre sale en cada chat de la bandeja y sirve para filtrar por número."}
          </p>
        </div>
        {today ? (
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div className={tile}>
              <dt className="text-xs text-muted-foreground">Calidad</dt>
              <dd className="font-medium" data-testid="health-quality">
                {QUALITY_LABEL[today.qualityRating ?? ""] ?? today.qualityRating ?? "Sin dato"}
              </dd>
            </div>
            <div className={tile}>
              <dt className="text-xs text-muted-foreground">Límite diario</dt>
              <dd className="font-medium" data-testid="health-limit">
                {messagingLimitLabel(today.messagingLimit)}
              </dd>
            </div>
            <div className={tile}>
              <dt className="text-xs text-muted-foreground">Usados (24 h)</dt>
              <dd className="font-medium" data-testid="health-usage">
                {summary!.usage.toLocaleString("es-MX")}
                {limit ? ` de ${limit.toLocaleString("es-MX")}` : ""}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Todavía no hay lectura de hoy. Pulsa «Actualizar».</p>
        )}
        {summary?.alerts.map((a) => (
          <p key={a.code} className={a.level === "danger" ? "text-sm text-danger-text" : "text-sm text-warning-text"}>
            {a.message}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

function ConnectForm({
  existing,
  onSaved,
}: {
  existing: Connection | null;
  onSaved: () => void;
}) {
  const [wabaId, setWabaId] = useState(existing?.wabaId ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState(
    existing?.phoneNumberId ?? ""
  );
  const [token, setToken] = useState("");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [testResult, setTestResult] = useState<
    | { ok: true; display: string }
    | { ok: false; message: string }
    | null
  >(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // DF-14: el número quedó guardado pero Meta no confirmó los avisos de mensajes.
  const [webhookWarning, setWebhookWarning] = useState(false);

  const canTest = wabaId.trim() && phoneNumberId.trim() && token.trim();

  async function test() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/settings/whatsapp/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumberId, token }),
    }).catch(() => null);
    setTesting(false);
    if (!res) {
      setTestResult({ ok: false, message: "Sin conexión con el servidor" });
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      displayPhoneNumber?: string;
      error?: { message?: string };
    } | null;
    if (res.ok && data?.displayPhoneNumber) {
      setTestResult({ ok: true, display: data.displayPhoneNumber });
    } else {
      setTestResult({
        ok: false,
        message: data?.error?.message ?? "La validación falló",
      });
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setWebhookWarning(false);
    const res = await fetch("/api/settings/whatsapp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wabaId, phoneNumberId, token, ...(label.trim() ? { label: label.trim() } : {}) }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setSaveError(data?.error?.message ?? "No se pudo guardar la conexión");
      return;
    }
    const saved = (await res.json().catch(() => null)) as { webhook?: string } | null;
    setWebhookWarning(saved?.webhook === "failed");
    setToken("");
    setTestResult(null);
    onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {existing ? "Reconectar / actualizar el número" : "Conectar un número de WhatsApp"}
        </CardTitle>
        <CardDescription>
          Pega las credenciales de WhatsApp Cloud API. El token se valida
          contra Meta ANTES de guardarse y se almacena cifrado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-md border bg-background p-4 text-sm">
          <p className="font-medium">¿De dónde sale el token?</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="mb-1 font-medium text-primary">Modo directo</p>
              <p className="text-muted-foreground">
                El negocio tiene su propia app en{" "}
                <span className="text-foreground">developers.facebook.com</span>:
                usa un token de <span className="text-foreground">usuario del sistema</span>{" "}
                (no expira) con permisos de WhatsApp. En este modo conviene
                configurar también el App Secret para la firma del webhook.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="mb-1 font-medium text-primary">Modo agencia (Tech Provider)</p>
              <p className="text-muted-foreground">
                Tu agencia hace el Embedded Signup en SU plataforma y su
                backend obtiene el token del cliente; te lo entrega para
                pegarlo aquí. El webhook se conecta con el{" "}
                <span className="text-foreground">override por WABA</span>{" "}
                (checklist de 5 pasos en el README).
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="waba-id">WABA ID</Label>
            <Input
              id="waba-id"
              placeholder="ID de la cuenta de WhatsApp Business"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone-number-id">Phone Number ID</Label>
            <Input
              id="phone-number-id"
              placeholder="ID del número de teléfono"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="num-label-new">Nombre del número (opcional)</Label>
          <Input
            id="num-label-new"
            placeholder="Ej. Ventas Mérida"
            maxLength={40}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="token">Token de acceso</Label>
          <Input
            id="token"
            type="password"
            placeholder={existing ? `Guardado (…${existing.tokenLast4}) — pega uno nuevo para cambiarlo` : "EAAG…"}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTestResult(null);
            }}
          />
        </div>

        {testResult && (
          <p
            className={`text-sm ${testResult.ok ? "text-success" : "text-destructive"}`}
          >
            {testResult.ok
              ? `✓ Token válido para ${testResult.display}. Ya puedes guardar.`
              : testResult.message}
          </p>
        )}
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
        {webhookWarning && (
          <p role="alert" className="text-sm text-warning-text" data-testid="conexion-sin-avisos">
            El número quedó guardado, pero Meta no confirmó que nos avise de los mensajes nuevos: puede que no te lleguen.
            Vuelve a guardar en unos minutos o revisa la suscripción de la app en WhatsApp Manager.
          </p>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!canTest || testing}
            onClick={() => void test()}
          >
            {testing ? "Probando…" : "Probar conexión"}
          </Button>
          <Button
            disabled={!testResult?.ok || saving}
            onClick={() => void save()}
          >
            {saving ? "Guardando…" : "Guardar conexión"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * H7 — Para toda organización que no es la de la plataforma: el webhook es
 * uno solo para todos los negocios y lo configura la plataforma. Aquí no hay
 * URL ni token que copiar (son un secreto de la plataforma), solo el estado.
 */
function ManagedWebhookCard({
  webhook,
}: {
  webhook: Extract<WebhookSettingsDto, { managedByPlatform: true }>;
}) {
  return (
    <Card data-testid="webhook-administrado">
      <CardHeader>
        <CardTitle>Webhook de WhatsApp</CardTitle>
        <CardDescription>
          Webhook administrado por la plataforma: los mensajes de tu número
          llegan por el webhook común de la plataforma y se enrutan a tu
          negocio por tu Phone Number ID. No tienes que configurar nada en Meta.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {webhook.platformConfigMissing && (
          <div
            role="status"
            data-testid="webhook-falta-platform-org"
            className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Falta configurar PLATFORM_ORG_ID</p>
              <p>
                La instancia no sabe cuál es la organización de la plataforma,
                así que nadie puede ver la URL ni el token del webhook. Quien
                administra la plataforma debe definir PLATFORM_ORG_ID (el id
                org_… de su organización) en las variables de la instancia y
                reiniciar.
              </p>
            </div>
          </div>
        )}
        {webhook.signatureLayer ? (
          <p className="flex items-center gap-2 text-xs text-success">
            <ShieldCheck className="h-4 w-4" /> Verificación de firma activa:
            cada evento se valida con x-hub-signature-256.
          </p>
        ) : (
          <p
            role="status"
            data-testid="webhook-firma-no-verificada"
            className="flex items-start gap-2 text-xs text-warning-text"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            Firma no verificada: la plataforma todavía no tiene configurada la firma del webhook
            (META_APP_SECRET): no entra ningún mensaje hasta que la configure.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function WebhookCard({ webhook }: { webhook: PlatformWebhookInfo }) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, which: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook de WhatsApp</CardTitle>
        <CardDescription>
          Pega estos valores en el panel de Meta (modo directo) o úsalos en el
          override de tu backend de agencia (a nivel WABA).{" "}
          <strong className="text-foreground">
            Guarda la conexión ANTES de configurar el webhook:
          </strong>{" "}
          la verificación (handshake) funciona sin guardar, pero los mensajes
          solo se reciben si la conexión está guardada — se enrutan por tu
          Phone Number ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!webhook.isHttps && (
          <p className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            La URL configurada no es https: Meta exige https para los webhooks.
            Ajusta APP_BASE_URL con tu dominio público.
          </p>
        )}
        <div className="space-y-1.5">
          <Label>URL del webhook (callback URL)</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 text-xs">
              {webhook.url}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar URL"
              onClick={() => copy(webhook.url, "url")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "url" && (
              <span className="text-xs text-primary">Copiada ✓</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            La URL contiene el token secreto en la ruta: trátala como una
            contraseña.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Verify token</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 text-xs">
              {webhook.verifyToken}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar verify token"
              onClick={() => copy(webhook.verifyToken, "vt")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "vt" && (
              <span className="text-xs text-primary">Copiado ✓</span>
            )}
          </div>
        </div>
        {webhook.signatureLayer ? (
          <p className="flex items-center gap-2 text-xs text-success">
            <ShieldCheck className="h-4 w-4" /> Verificación de firma activa
            (META_APP_SECRET configurado): cada evento se valida con
            x-hub-signature-256.
          </p>
        ) : (
          <div
            role="status"
            data-testid="webhook-firma-no-verificada"
            className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text"
          >
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Firma no verificada</p>
              <p>
                META_APP_SECRET no está definido en la instancia. Es
                obligatorio en producción: sin él, el webhook de WhatsApp
                rechaza todos los eventos de Meta y no entra ningún mensaje.
                Agrega META_APP_SECRET (App Secret de tu app de Meta) en las
                variables de la instancia y reinicia.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
