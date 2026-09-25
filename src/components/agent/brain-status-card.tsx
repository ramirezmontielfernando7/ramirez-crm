"use client";

import { AlertTriangle, Cable, Info, Sparkles, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  externalBrainName,
  haceCuanto,
  type BrainHealthDto,
  type BrainRelayDto,
  type BrainStatusDto,
} from "@/lib/brain-status";
import { cn } from "@/lib/utils";

/**
 * «Quién responde a tus clientes»: arriba de la pantalla del Agente, porque
 * el interruptor de esta página solo gobierna al agente incluido. Un cerebro
 * externo (Nea) contesta por su cuenta, y con los dos activos el cliente
 * recibe dos respuestas distintas.
 */

type Tone = "ok" | "warn" | "off";
type RowView = { tone: Tone; headline: string; detail: string | null };

const DOT: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  off: "bg-border-strong",
};

export function BrainStatusCard({
  status,
  now = Date.now(),
}: {
  status: BrainStatusDto;
  now?: number;
}) {
  const name = externalBrainName(status);
  const lastSeenAt = status.external.lastSeenAt;

  return (
    <Card data-brain-card data-warning={status.warning ?? "ninguno"}>
      <CardHeader className="pb-4">
        <CardTitle>Quién responde a tus clientes</CardTitle>
        <CardDescription>
          Lo que contesta los WhatsApp de esta instancia. Tiene que ser uno solo:
          si contestan dos, tu cliente recibe dos respuestas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status.warning === "doble_respuesta" && (
          <Callout tone="danger" icon={AlertTriangle} title="Tus clientes pueden recibir dos respuestas">
            El agente incluido y {name ? `tu cerebro externo (${name})` : "tu cerebro externo"}{" "}
            contestan los mismos mensajes: apaga el agente incluido con el interruptor
            de arriba o quita <Env>OPENROUTER_API_TOKEN</Env> del CRM.
          </Callout>
        )}
        {status.warning === "sin_cerebro" && (
          <Callout tone="warning" icon={Info} title="Nadie contesta en automático">
            Tus clientes solo reciben lo que respondas desde la bandeja: enciende el
            agente incluido (necesita <Env>OPENROUTER_API_TOKEN</Env>) o conecta tu
            cerebro externo con <Env>BOT_API_KEY</Env>.
          </Callout>
        )}

        <dl className="divide-y rounded-md border">
          <BrainRow
            id="embedded"
            icon={Sparkles}
            label="Agente incluido"
            hint="El integrado, con el comportamiento de esta página."
            view={embeddedView(status)}
          />
          <BrainRow
            id="external"
            icon={Cable}
            label="Cerebro externo"
            hint="Tu propio bot (Nea u otro) por la API del CRM."
            view={externalView(status, now)}
          />
        </dl>

        {lastSeenAt && (
          <p className="text-[11px] text-text-3">
            La última llamada del cerebro externo se cuenta desde el último arranque
            del CRM.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function embeddedView(s: BrainStatusDto): RowView {
  const { configured, enabled, answering } = s.embedded;
  const headline = `${enabled ? "Encendido" : "Apagado"} · ${
    configured ? "token de IA: sí" : "sin token de IA"
  }`;
  if (enabled && !configured) {
    return { tone: "warn", headline, detail: "No contesta: a la instancia le falta OPENROUTER_API_TOKEN." };
  }
  if (answering) {
    return {
      tone: "ok",
      headline,
      detail:
        s.warning === "doble_respuesta"
          ? null
          : "Contesta en las conversaciones con la IA activada.",
    };
  }
  if (s.external.active) {
    return { tone: "off", headline, detail: "Así debe quedarse mientras conteste tu cerebro externo." };
  }
  return {
    tone: "off",
    headline,
    detail: configured
      ? "Enciéndelo con el interruptor de arriba para que conteste."
      : "Para usarlo, agrega OPENROUTER_API_TOKEN a la instancia y reiníciala.",
  };
}

function externalView(s: BrainStatusDto, now: number): RowView {
  const { keyConfigured, lastSeenAt, active, health } = s.external;
  const llamada = lastSeenAt
    ? `última llamada ${haceCuanto(lastSeenAt, now)}`
    : "sin llamadas desde el último arranque";

  if (health?.reachable) {
    const name = externalBrainName(s);
    const parts = [
      name,
      "en línea",
      health.version && versionLabel(health.version),
      health.mode && `modo ${health.mode}`,
      health.relay && relayLabel(health.relay),
    ].filter(Boolean);
    return keyConfigured
      ? { tone: "ok", headline: capitalize(parts.join(" · ")), detail: `${capitalize(llamada)}.` }
      : {
          tone: "warn",
          headline: capitalize(parts.join(" · ")),
          detail: "Al CRM le falta BOT_API_KEY: no puede contestar por la API.",
        };
  }
  if (health?.problem === "config") {
    return {
      tone: "warn",
      headline: "No se puede consultar su estado",
      detail: `BRAIN_HEALTH_URL no es una URL http:// o https:// válida (p. ej. http://nea:8000/health): corrígela y vuelve a desplegar el CRM.${
        keyConfigured ? ` ${capitalize(llamada)}.` : ""
      }`,
    };
  }
  if (health) {
    const name = externalBrainName(s);
    return {
      tone: "warn",
      headline: capitalize(`${name ? `${name} · ` : ""}no está en línea`),
      detail: `${health.host} ${problemLabel(health)}.${
        keyConfigured ? ` ${capitalize(llamada)}.` : ""
      }`,
    };
  }
  if (keyConfigured) {
    return { tone: active ? "ok" : "off", headline: `Llave configurada · ${llamada}`, detail: null };
  }
  return { tone: "off", headline: "Sin cerebro externo", detail: null };
}

function versionLabel(v: string): string {
  return /^v/i.test(v) ? v : `v${v}`;
}

function relayLabel(r: BrainRelayDto): string | null {
  if (r.pendientes === null) return null;
  const base = r.pendientes === 1 ? "1 mensaje por relevar" : `${r.pendientes} mensajes por relevar`;
  if (r.pendientes > 0 && r.masViejoSegundos !== null && r.masViejoSegundos >= 60) {
    return `${base} (el más viejo, de hace ${Math.floor(r.masViejoSegundos / 60)} min)`;
  }
  return base;
}

function problemLabel(h: BrainHealthDto): string {
  switch (h.problem) {
    case "timeout":
      return "no contestó en 2 s";
    case "status":
      return `respondió ${h.httpStatus ?? "con error"}`;
    case "redirect":
      return "respondió con una redirección (no se sigue)";
    case "invalid":
      return "respondió, pero no con su estado";
    default:
      return "no acepta la conexión";
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function BrainRow({
  id,
  icon: Icon,
  label,
  hint,
  view,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  hint: string;
  view: RowView;
}) {
  return (
    <div
      data-brain-row={id}
      data-tone={view.tone}
      className="grid gap-1.5 p-3 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:gap-4 sm:p-4"
    >
      <dt className="flex items-start gap-2.5">
        <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-text-3" strokeWidth={1.7} />
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
      </dt>
      <dd className="flex min-w-0 items-start gap-2 pl-[26px] sm:pl-0">
        <span aria-hidden className={cn("mt-[7px] h-2 w-2 shrink-0 rounded-full", DOT[view.tone])} />
        <div className="min-w-0">
          <p className="break-words text-sm">{view.headline}</p>
          {view.detail && (
            <p className="mt-0.5 break-words text-xs text-muted-foreground">{view.detail}</p>
          )}
        </div>
      </dd>
    </div>
  );
}

function Callout({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: "danger" | "warning";
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2.5 rounded-md border p-3",
        tone === "danger"
          ? "border-danger-soft bg-danger-tint text-danger-text"
          : "border-warning-soft bg-warning-tint text-warning-text"
      )}
    >
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.8} />
      <div className="min-w-0 text-sm">
        <p className="font-semibold">{title}</p>
        <p className="mt-0.5 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

/** El nombre de una variable, entero: partido a media palabra en el móvil no
 *  se puede copiar ni reconocer. */
function Env({ children }: { children: React.ReactNode }) {
  return <code className="whitespace-nowrap font-mono text-[0.92em]">{children}</code>;
}
