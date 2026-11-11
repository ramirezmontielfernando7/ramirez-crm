"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { MessageBubble } from "@/components/inbox/message-bubble";
import { TypingDots } from "@/components/inbox/typing-dots";
import { Button } from "@/components/ui/button";
import { useNavMode } from "@/components/nav-mode";
import { AppearanceBrandCard } from "@/components/settings/appearance-brand-card";
import type { Branding } from "@/lib/branding";
import type { NavMode } from "@/lib/preferences";
import {
  applyThemeBarColor,
  normalizeThemePreference,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  type ThemePreference,
} from "@/lib/theme";
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
import { SettingsHeader } from "@/components/settings/settings-header";

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
  classic: "De fábrica",
  premium: "Degradados y brillo suave",
  depth: "Luz y color por etapa",
};

const UI_SHORT: Record<UiStyle, string> = { classic: "Clásico", premium: "Premium", depth: "Profundo" };

/** Control segmentado de la maqueta (Tema, Menú lateral): radios en una píldora gris. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-md bg-muted p-1 text-[13px]">
      {options.map(([k, text]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className={cn(
            "rounded-[6px] px-3 py-1 transition-colors",
            value === k ? "bg-surface font-medium text-foreground shadow-sm" : "text-text-2 hover:text-foreground"
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const NAV_OPTIONS = [
  ["expanded", "Abierto"],
  ["collapsed", "Colapsado"],
  ["hidden", "Se oculta"],
] as const satisfies readonly (readonly [NavMode, string])[];

const THEME_OPTIONS = [
  ["light", "Claro"],
  ["dark", "Oscuro"],
] as const satisfies readonly (readonly [ThemePreference, string])[];

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
  branding,
}: {
  /** Marca de la organización: la tarjeta «Marca de la empresa» (solo con `settings.manage`). */
  branding?: Branding | null;
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

  // Tema y menú lateral: personales, se aplican y guardan al momento (como el
  // botón de tema y el del menú junto al logo).
  const nav = useNavMode();
  const [theme, setTheme] = useState<ThemePreference>(() =>
    typeof document === "undefined"
      ? "light"
      : normalizeThemePreference(document.documentElement.getAttribute("data-theme"))
  );
  function changeTheme(next: ThemePreference) {
    setTheme(next);
    setTryTheme(null);
    document.documentElement.setAttribute("data-theme", next);
    applyThemeBarColor(next);
    document.cookie = `${THEME_COOKIE}=${next};path=/;max-age=${THEME_COOKIE_MAX_AGE};samesite=lax`;
  }

  return (
    <div className="space-y-6" data-testid="appearance-page">
      <SettingsHeader title="Apariencia" description="La marca la ve todo tu equipo; el tema es solo tuyo." />

      <div className={cn("grid items-start gap-4", canManageOrg && branding && "lg:grid-cols-2")}>
        {canManageOrg && branding && <AppearanceBrandCard branding={branding} />}

        <section aria-labelledby="ap-me" className="min-w-0 rounded-card border bg-surface" data-testid="appearance-me">
          <h3 id="ap-me" className="border-b px-4 py-3 text-[14px] font-semibold">
            Para ti
          </h3>
          <div className="space-y-5 p-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Estilo</p>
              <div role="radiogroup" aria-label="Estilo de interfaz" className="grid gap-3 sm:grid-cols-3">
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
                        "flex min-w-0 items-start gap-3 rounded-md border p-3 text-left transition-colors",
                        checked ? "border-brand ring-1 ring-brand" : "border-border hover:bg-accent"
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                          checked ? "border-brand" : "border-border-strong"
                        )}
                      >
                        {checked && <span className="h-2 w-2 rounded-full bg-brand" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold">{UI_SHORT[k]}</span>
                        <span className="block text-[12.5px] text-text-3">{UI_HINTS[k]}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {uiStyle !== base.uiStyle && (
                <p className="text-[12px] text-text-3">Ya lo ves en todo el CRM; guárdalo abajo para que se quede.</p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Tema</p>
              <Segmented label="Tema" value={theme} options={THEME_OPTIONS} onChange={changeTheme} />
            </div>

            {nav && (
              <div className="space-y-2 max-lg:hidden">
                <p className="text-sm font-medium">Menú lateral</p>
                <Segmented label="Menú lateral" value={nav.mode} options={NAV_OPTIONS} onChange={nav.setMode} />
                <p className="text-[12px] text-text-3">También con el botón junto a tu logo.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <section aria-labelledby="ap-more" className="min-w-0 space-y-6 rounded-card border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="ap-more" className="text-[14px] font-semibold">Letra y estilo del chat</h3>
          {canManageOrg && (
            <div role="tablist" aria-label="¿Para quién?" className="inline-flex rounded-full border p-0.5 text-[13px]">
              {(["me", "org"] as const).map((sc) => (
                <button
                  key={sc}
                  type="button"
                  role="tab"
                  aria-selected={scope === sc}
                  onClick={() => changeScope(sc)}
                  className={cn(
                    "rounded-full px-3 py-1 font-semibold transition-colors",
                    scope === sc ? "bg-brand-tint text-brand-text" : "text-text-2 hover:text-foreground"
                  )}
                >
                  {sc === "me" ? "Para mí" : "Toda la organización"}
                </button>
              ))}
            </div>
          )}
        </div>

        <section aria-labelledby="ap-font" className="max-w-sm space-y-2">
          <h4 id="ap-font" className="text-[13.5px] font-medium">Tipografía</h4>
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
            <h4 id="ap-chat" className="text-[13.5px] font-medium">Estilo del chat en la Bandeja</h4>
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

        <div className="space-y-2 border-t pt-4">
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
              ? "Guarda el estilo, la letra y el chat para todas las personas de la organización, salvo quien ya eligió los suyos."
              : "Guarda el estilo, la letra y el chat en este navegador; pisa la de la organización solo para ti."}
          </p>
        </div>
      </section>
    </div>
  );
}
