"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { MessageBubble } from "@/components/inbox/message-bubble";
import { TypingDots } from "@/components/inbox/typing-dots";
import { Button } from "@/components/ui/button";
import {
  CHAT_STYLE_COOKIE,
  chatStyleLabel,
  CHAT_STYLES,
  FONT_COOKIE,
  UI_STYLE_COOKIE,
  UI_STYLE_LABELS,
  UI_STYLES,
  FONT_KEYS,
  FONT_LABELS,
  resolveAppearance,
  writeAppearanceCookie,
  type ChatStyle,
  type FontKey,
  type OrgAppearance,
  type PersonalAppearance,
  type UiStyle,
} from "@/lib/appearance";
import type { MessageDto } from "@/lib/types";
import { cn } from "@/lib/utils";

type Scope = "me" | "org";

/**
 * Pinta la letra en <html>: lo mismo que hace el layout en el servidor.
 * El estilo del chat NO se pinta aquí: en esta pantalla las burbujas solo
 * viven en las tarjetas, y cada una lleva su propio `data-chat`; si <html>
 * tuviera otro, sus reglas se colarían en las demás tarjetas. Al salir,
 * `restore` devuelve el estilo guardado.
 */
function paint(look: OrgAppearance) {
  document.documentElement.setAttribute("data-font", look.font);
  document.documentElement.setAttribute("data-chat", "classic");
  document.documentElement.setAttribute("data-ui", look.uiStyle);
}
function restore(look: OrgAppearance) {
  document.documentElement.setAttribute("data-font", look.font);
  document.documentElement.setAttribute("data-chat", look.chatStyle);
  document.documentElement.setAttribute("data-ui", look.uiStyle);
}

function sample(id: string, direction: "in" | "out", text: string, minutesAgo: number): MessageDto {
  return {
    id,
    conversationId: "preview",
    direction,
    type: "text",
    text,
    status: "read",
    error: null,
    aiGenerated: false,
    origin: "operator",
    media: null,
    createdAt: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  };
}

const SAMPLES: { m: MessageDto; grouped: boolean }[] = [
  { m: sample("a", "in", "Hola, ¿tienen lugar para el viernes?", 6), grouped: false },
  { m: sample("b", "out", "¡Hola! Sí, a las 11:00 o a las 16:00.", 5), grouped: false },
  { m: sample("c", "out", "¿Cuál te acomoda más?", 5), grouped: true },
  { m: sample("d", "in", "A las 11, gracias 🙌", 2), grouped: false },
];

const STYLE_HINTS: Record<ChatStyle, string> = {
  classic: "El estilo de siempre.",
  whatsapp: "Burbujas con cola, hora dentro y fondo beige u oscuro, como en el celular.",
  premium: "Esquinas muy redondeadas, tonos de tu marca y movimiento suave.",
};

const UI_HINTS: Record<UiStyle, string> = {
  classic: "El aspecto de siempre.",
  premium: "Azul marino, burbujas suaves y esquinas amplias, como en la web de Demfort.",
};

/**
 * Maqueta de pantalla (menú, tarjeta y dos burbujas) de un estilo de
 * interfaz. `data-ui` va en el propio contenedor: se ve en SU estilo sin
 * cambiar el del resto de la pantalla.
 */
function UiPreview({ style, testId }: { style: UiStyle; testId?: string }) {
  return (
    <div data-ui={style} data-testid={testId} aria-hidden className="flex h-32 overflow-hidden rounded-md border bg-canvas">
      <div className="w-10 shrink-0" style={{ background: style === "premium" ? "#0f1d3a" : undefined }} />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2.5">
        <div className="h-2 w-16 rounded-full bg-border-strong" />
        <div className="flex flex-1 flex-col justify-center gap-1.5 rounded-card border bg-surface p-2 shadow-sm">
          <div className="max-w-[70%] self-start rounded-lg border px-2 py-1 text-[10.5px]" style={{ background: "var(--bubble-in)", borderColor: "var(--border)" }}>
            Hola, ¿hay lugar?
          </div>
          <div className="max-w-[70%] self-end rounded-lg border px-2 py-1 text-[10.5px]" style={{ background: "var(--bubble-out)", borderColor: "var(--border-strong)" }}>
            ¡Claro!
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Mensajes de ejemplo de un estilo. `data-chat` va en el propio contenedor,
 * así cada tarjeta se ve en SU estilo sin cambiar el de toda la pantalla.
 * `live` = animar la entrada (solo la tarjeta elegida, al cambiar).
 */
function StylePreview({
  style,
  testId,
  live,
}: {
  style: ChatStyle;
  testId?: string;
  live?: boolean;
}) {
  return (
    <div data-chat={style}>
      <div
        data-testid={testId}
        className="thread-bg flex flex-col gap-[3px] rounded-md border p-3"
      >
        <div className="my-1 flex justify-center">
          <span className="day-pill kicker rounded-full border border-border-strong bg-background px-3 py-1 text-text-2 shadow-sm">
            Hoy
          </span>
        </div>
        {SAMPLES.map(({ m, grouped }, i) => (
          <div
            key={m.id}
            className={cn(
              live && "bubble-enter",
              "flex",
              m.direction === "out" ? "justify-end" : "justify-start",
              grouped ? "msg-grouped" : "msg-first",
              i > 0 && !grouped && "mt-2.5"
            )}
          >
            <MessageBubble m={m} grouped={grouped} wide />
          </div>
        ))}
        {style === "premium" && (
          <div className="msg-first mt-2.5 flex">
            <TypingDots />
          </div>
        )}
      </div>
    </div>
  );
}

function Option({
  checked,
  onSelect,
  children,
  style,
}: {
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      style={style}
      className={cn(
        "flex w-full items-center justify-between rounded-sm border px-3 py-2.5 text-left text-[14px] transition-colors",
        checked
          ? "border-brand bg-brand-tint text-brand-text"
          : "border-border hover:bg-accent"
      )}
    >
      <span>{children}</span>
      {checked && <Check className="h-4 w-4" strokeWidth={2} />}
    </button>
  );
}

/**
 * Fase D — Personalización → Apariencia. Una columna de opciones y, al lado,
 * la vista previa. La letra y el estilo se prueban EN el propio CRM (se
 * escriben en <html> mientras eliges); si sales sin guardar, vuelve lo de antes.
 *
 * Dos niveles: «Para mí» (cookie de este navegador) y, para quien administra,
 * «Para toda la organización» (se guarda en la organización).
 */
export function AppearanceClient({
  org,
  personal,
  canManageOrg,
  brandName,
}: {
  org: OrgAppearance;
  personal: PersonalAppearance;
  canManageOrg: boolean;
  /** Nombre de marca de la organización: «Premium» se muestra como «<marca> Premium». */
  brandName?: string | null;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("me");
  // Lo guardado hoy, por nivel: «yo» ve lo que se pinta (su cookie o la de la org).
  const [savedOrg, setSavedOrg] = useState(org);
  const [savedPersonal, setSavedPersonal] = useState(personal);
  const effective = resolveAppearance(savedOrg, savedPersonal);
  const base = scope === "org" ? savedOrg : effective;

  const [font, setFont] = useState<FontKey>(base.font);
  const [chatStyle, setChatStyle] = useState<ChatStyle>(base.chatStyle);
  const [uiStyle, setUiStyle] = useState<UiStyle>(base.uiStyle);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Lo que debe quedar pintado al salir: lo guardado, no el borrador.
  const committed = useRef(effective);
  committed.current = effective;
  useEffect(() => () => restore(committed.current), []);
  // Vista previa en vivo: el borrador se pinta en todo el CRM.
  useLayoutEffect(() => paint({ font, chatStyle, uiStyle }), [font, chatStyle, uiStyle]);

  // Probar en claro u oscuro SIN guardar: solo cambia el atributo del <html>
  // mientras estás aquí; al salir vuelve el tema que tenías.
  const [tryTheme, setTryTheme] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    if (tryTheme === null) return;
    const root = document.documentElement;
    const before = root.getAttribute("data-theme");
    root.setAttribute("data-theme", tryTheme);
    return () => {
      if (before) root.setAttribute("data-theme", before);
    };
  }, [tryTheme]);

  const dirty = font !== base.font || chatStyle !== base.chatStyle || uiStyle !== base.uiStyle;

  function changeScope(next: Scope) {
    const b = next === "org" ? savedOrg : resolveAppearance(savedOrg, savedPersonal);
    setScope(next);
    setFont(b.font);
    setChatStyle(b.chatStyle);
    setUiStyle(b.uiStyle);
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      if (scope === "me") {
        writeAppearanceCookie(FONT_COOKIE, font);
        writeAppearanceCookie(CHAT_STYLE_COOKIE, chatStyle);
        writeAppearanceCookie(UI_STYLE_COOKIE, uiStyle);
        setSavedPersonal({ font, chatStyle, uiStyle });
        setMsg({ ok: true, text: "Listo. Se guardó solo en este navegador." });
      } else {
        const res = await fetch("/api/settings/appearance", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ font, chatStyle, uiStyle }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSavedOrg({ font, chatStyle, uiStyle });
        setMsg({ ok: true, text: "Listo. Toda la organización lo verá así." });
        router.refresh();
      }
    } catch {
      setMsg({ ok: false, text: "No se pudo guardar. Inténtalo de nuevo." });
    } finally {
      setBusy(false);
    }
  }

  function followOrg() {
    writeAppearanceCookie(FONT_COOKIE, null);
    writeAppearanceCookie(CHAT_STYLE_COOKIE, null);
    writeAppearanceCookie(UI_STYLE_COOKIE, null);
    const none = { font: null, chatStyle: null, uiStyle: null };
    setSavedPersonal(none);
    setFont(savedOrg.font);
    setChatStyle(savedOrg.chatStyle);
    setUiStyle(savedOrg.uiStyle);
    setMsg({ ok: true, text: "Ahora ves lo que eligió la organización." });
  }

  const hasPersonal =
    savedPersonal.font !== null || savedPersonal.chatStyle !== null || savedPersonal.uiStyle !== null;

  return (
    <div>
      <div className="space-y-8">
        {canManageOrg && (
          <div role="tablist" aria-label="¿Para quién?" className="inline-flex rounded-full border p-0.5 text-[13px]">
            {(["me", "org"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={scope === s}
                onClick={() => changeScope(s)}
                className={cn(
                  "rounded-full px-3 py-1 font-semibold transition-colors",
                  scope === s ? "bg-brand-tint text-brand-text" : "text-text-2 hover:text-foreground"
                )}
              >
                {s === "me" ? "Para mí" : "Toda la organización"}
              </button>
            ))}
          </div>
        )}

        <section aria-labelledby="ap-ui" className="min-w-0 space-y-3">
          <h3 id="ap-ui" className="text-[14px] font-semibold">Estilo de interfaz</h3>
          <p className="text-[12.5px] text-text-3">
            Cambia el aspecto de todo el CRM mientras eliges. Si sales sin guardar, todo vuelve como estaba.
          </p>
          <div role="radiogroup" aria-labelledby="ap-ui" className="grid gap-3 md:grid-cols-2">
            {UI_STYLES.map((k) => {
              const checked = uiStyle === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={UI_STYLE_LABELS[k]}
                  onClick={() => setUiStyle(k)}
                  className={cn(
                    "flex min-w-0 flex-col gap-2 rounded-md border p-2.5 text-left transition-colors",
                    checked ? "border-brand bg-brand-tint" : "border-border hover:bg-accent"
                  )}
                >
                  <span className="flex items-center justify-between text-[14px] font-semibold">
                    {UI_STYLE_LABELS[k]}
                    {checked && <Check className="h-4 w-4 text-brand-text" strokeWidth={2} />}
                  </span>
                  <span className="text-[12px] font-normal text-text-3">{UI_HINTS[k]}</span>
                  <UiPreview style={k} testId={checked ? "ui-preview" : undefined} />
                </button>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="ap-font" className="max-w-sm space-y-2">
          <h3 id="ap-font" className="text-[14px] font-semibold">Tipografía</h3>
          <div role="radiogroup" aria-labelledby="ap-font" className="space-y-1.5">
            {FONT_KEYS.map((k) => (
              <Option
                key={k}
                checked={font === k}
                onSelect={() => setFont(k)}
                // Cada opción se muestra en su propia letra.
                style={{ fontFamily: `var(--font-sample-${k})` }}
              >
                {FONT_LABELS[k]}
              </Option>
            ))}
          </div>
        </section>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="ap-chat" className="text-[14px] font-semibold">Estilo del chat en la Bandeja</h3>
            <div role="group" aria-label="Probar en" className="inline-flex rounded-full border p-0.5 text-[12.5px]">
              {([["light", "Claro"], ["dark", "Oscuro"]] as const).map(([t, label]) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tryTheme === t}
                  onClick={() => setTryTheme(tryTheme === t ? null : t)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 font-semibold transition-colors",
                    tryTheme === t ? "bg-brand-tint text-brand-text" : "text-text-2 hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[12.5px] text-text-3">
            La letra ya cambió en toda la pantalla mientras eliges; cada tarjeta muestra su estilo. Si sales sin guardar, todo vuelve como estaba.
          </p>
          <div role="radiogroup" aria-labelledby="ap-chat" className="grid gap-3 md:grid-cols-3">
            {CHAT_STYLES.map((k) => {
              const checked = chatStyle === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={chatStyleLabel(k, brandName)}
                  onClick={() => setChatStyle(k)}
                  className={cn(
                    "flex min-w-0 flex-col gap-2 rounded-md border p-2.5 text-left transition-colors",
                    checked ? "border-brand bg-brand-tint" : "border-border hover:bg-accent"
                  )}
                >
                  <span className="flex items-center justify-between text-[14px] font-semibold">
                    {chatStyleLabel(k, brandName)}
                    {checked && <Check className="h-4 w-4 text-brand-text" strokeWidth={2} />}
                  </span>
                  <span className="text-[12px] font-normal text-text-3">{STYLE_HINTS[k]}</span>
                  {/* `key`: al cambiar de estilo las burbujas de la elegida vuelven a entrar. */}
                  <StylePreview
                    key={checked ? `on-${k}` : k}
                    style={k}
                    live={checked}
                    testId={checked ? "chat-preview" : undefined}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={busy || !dirty}>
              {busy ? "Guardando…" : scope === "org" ? "Guardar para todos" : "Guardar para mí"}
            </Button>
            {scope === "me" && hasPersonal && (
              <Button variant="ghost" onClick={followOrg}>Usar la de la organización</Button>
            )}
          </div>
          {msg && (
            <p role="status" className={cn("text-[13px]", msg.ok ? "text-text-2" : "text-destructive")}>
              {msg.text}
            </p>
          )}
          <p className="text-[12.5px] text-text-3">
            {scope === "org"
              ? "Lo verán todas las personas de la organización, salvo quien ya eligió una propia."
              : "Tu elección se guarda solo en este navegador por ahora, y pisa la de la organización solo para ti."}
          </p>
        </div>
      </div>

    </div>
  );
}
