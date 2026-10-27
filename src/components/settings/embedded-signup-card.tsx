"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Smartphone, SquarePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Tech Provider, PR 2 — «Conectar con Facebook» (Embedded Signup v4).
 *
 * Abre el flujo de Meta con el SDK de JavaScript. Meta devuelve por dos vías
 * distintas lo que necesitamos: el CÓDIGO llega al callback de `FB.login` y
 * la WABA y el número por un `postMessage` (`WA_EMBEDDED_SIGNUP`). Cuando
 * están los dos se manda todo al servidor de inmediato: el código vence a
 * los 30 s.
 */

export type EmbeddedSignupConfig = { appId: string; configId: string; graphApiVersion: string };

type Flow = "business_app" | "new_number";

type SignupData = { wabaId: string; phoneNumberId: string; flow: Flow };

type FbLoginResponse = { authResponse?: { code?: string } | null };

type FbSdk = {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }): void;
  login(cb: (res: FbLoginResponse) => void, opts: Record<string, unknown>): void;
};

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_URL = "https://connect.facebook.net/es_LA/sdk.js";

let sdkPromise: Promise<FbSdk> | null = null;

function loadSdk(config: EmbeddedSignupConfig): Promise<FbSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    window.fbAsyncInit = () => {
      if (!window.FB) return reject(new Error("sdk"));
      window.FB.init({ appId: config.appId, autoLogAppEvents: true, xfbml: false, version: config.graphApiVersion });
      resolve(window.FB);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdkPromise = null;
      reject(new Error("sdk"));
    };
    document.body.appendChild(script);
  });
  return sdkPromise;
}

/** Lee el `postMessage` del flujo de Meta. Null si no es suyo o no trae lo que se usa. */
function readSignupMessage(event: MessageEvent): { kind: "finish"; data: SignupData } | { kind: "cancel"; step: string | null } | null {
  if (typeof event.origin !== "string" || !event.origin.endsWith("facebook.com")) return null;
  let payload: unknown = event.data;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      return null;
    }
  }
  const msg = payload as { type?: string; event?: string; data?: Record<string, unknown> } | null;
  if (!msg || msg.type !== "WA_EMBEDDED_SIGNUP") return null;
  const data = msg.data ?? {};
  if (msg.event === "CANCEL" || msg.event === "ERROR") {
    return { kind: "cancel", step: typeof data.current_step === "string" ? data.current_step : null };
  }
  if (typeof msg.event === "string" && msg.event.startsWith("FINISH")) {
    const wabaId = typeof data.waba_id === "string" ? data.waba_id : "";
    const phoneNumberId = typeof data.phone_number_id === "string" ? data.phone_number_id : "";
    if (!wabaId || !phoneNumberId) return null;
    const flow: Flow = msg.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" ? "business_app" : "new_number";
    return { kind: "finish", data: { wabaId, phoneNumberId, flow } };
  }
  return null;
}

export function EmbeddedSignupCard({
  config,
  connected,
  onConnected,
}: {
  config: EmbeddedSignupConfig;
  connected: boolean;
  onConnected: () => void;
}) {
  const [flow, setFlow] = useState<Flow>("business_app");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Lo que va llegando de Meta en esta vuelta; se envía cuando estén los dos.
  const pending = useRef<{ code: string | null; data: SignupData | null }>({ code: null, data: null });
  const sent = useRef(false);

  const pinOk = /^\d{6}$/.test(pin);
  const canStart = !busy && (flow === "business_app" || pinOk);

  async function finish() {
    const { code, data } = pending.current;
    if (!code || !data || sent.current) return;
    sent.current = true;
    const res = await fetch("/api/settings/whatsapp/embedded-signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, ...data, ...(data.flow === "new_number" ? { pin } : {}) }),
    }).catch(() => null);
    setBusy(false);
    const json = (await res?.json().catch(() => null)) as { displayPhoneNumber?: string; error?: { code?: string; message?: string } } | null;
    if (!res?.ok) {
      setError(
        json?.error?.code === "pin_required"
          ? "Meta conectó un número nuevo: elige «Quiero un número nuevo», escribe un PIN y vuelve a conectar."
          : (json?.error?.message ?? "No se pudo terminar la conexión. Intenta de nuevo.")
      );
      return;
    }
    setDone(json?.displayPhoneNumber ?? data.phoneNumberId);
    onConnected();
  }

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = readSignupMessage(event);
      if (!msg) return;
      if (msg.kind === "cancel") {
        setBusy(false);
        setError("Cerraste la ventana de Facebook antes de terminar. Cuando quieras, vuelve a dar clic en «Conectar con Facebook».");
        return;
      }
      pending.current.data = msg.data;
      void finish();
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // finish lee de refs y del PIN actual; se vuelve a registrar si cambia el PIN.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  async function start() {
    setError(null);
    setDone(null);
    setBusy(true);
    pending.current = { code: null, data: null };
    sent.current = false;
    let fb: FbSdk;
    try {
      fb = await loadSdk(config);
    } catch {
      setBusy(false);
      setError("No se pudo abrir Facebook. Revisa que tu navegador no bloquee ventanas emergentes y vuelve a intentar.");
      return;
    }
    fb.login(
      (res) => {
        const code = res.authResponse?.code;
        if (!code) {
          setBusy(false);
          setError((prev) => prev ?? "No se completó el permiso en Facebook. Vuelve a intentar.");
          return;
        }
        pending.current.code = code;
        void finish();
      },
      {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          sessionInfoVersion: "3",
          ...(flow === "business_app" ? { featureType: "whatsapp_business_app_onboarding" } : {}),
        },
      }
    );
  }

  return (
    <Card data-testid="conectar-facebook">
      <CardHeader>
        <CardTitle>{connected ? "Conectar otro número con Facebook" : "Conecta tu WhatsApp en 2 minutos"}</CardTitle>
        <CardDescription>
          Entra con tu cuenta de Facebook, elige tu negocio y listo: no tienes que copiar IDs ni tokens.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Tipo de número">
          <FlowOption
            selected={flow === "business_app"}
            onSelect={() => setFlow("business_app")}
            icon={<Smartphone className="h-5 w-5" />}
            title="Ya uso WhatsApp Business en mi celular"
            badge="Recomendado"
          >
            Sigues contestando desde tu celular y además desde Dashfort, con el mismo número. Se traen tus contactos y
            los chats de los últimos 6 meses.
          </FlowOption>
          <FlowOption
            selected={flow === "new_number"}
            onSelect={() => setFlow("new_number")}
            icon={<SquarePlus className="h-5 w-5" />}
            title="Quiero un número nuevo"
          >
            Un número que no esté en ninguna app de WhatsApp. Meta te manda un código por SMS o llamada para verificarlo.
          </FlowOption>
        </div>

        {flow === "business_app" ? (
          <div className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Ten tu celular a la mano</p>
              <p>
                Facebook te va a pedir escanear un código desde la app de WhatsApp Business (versión 2.24.17 o más nueva).
                Al conectar se cierran las sesiones de WhatsApp Web y de otros dispositivos vinculados; después las puedes
                volver a vincular. Las listas de difusión dejan de funcionar en el celular.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-xs space-y-1.5">
            <Label htmlFor="es-pin">PIN de seguridad (6 dígitos)</Label>
            <Input
              id="es-pin"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />
            <p className="text-xs text-muted-foreground">
              Protege tu número (verificación en dos pasos). Guárdalo: Meta te lo pide si mueves el número.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {done && <p className="text-sm text-success">✓ Listo: {done} quedó conectado.</p>}

        <Button disabled={!canStart} onClick={() => void start()} data-testid="boton-conectar-facebook">
          {busy ? "Esperando a Facebook…" : "Conectar con Facebook"}
        </Button>
      </CardContent>
    </Card>
  );
}

function FlowOption({
  selected,
  onSelect,
  icon,
  title,
  badge,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex gap-3 rounded-lg border p-4 text-left transition-colors ${
        selected ? "border-primary bg-brand-soft/40 ring-1 ring-primary" : "hover:bg-muted/50"
      }`}
    >
      <span className={`mt-0.5 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`}>{icon}</span>
      <span className="space-y-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {title}
          {badge && <Badge variant="success">{badge}</Badge>}
        </span>
        <span className="block text-sm text-muted-foreground">{children}</span>
      </span>
    </button>
  );
}
