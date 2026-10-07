"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { MessageBubble } from "@/components/inbox/message-bubble";
import { Button } from "@/components/ui/button";
import {
  CHAT_STYLE_COOKIE,
  CHAT_STYLE_LABELS,
  CHAT_STYLES,
  FONT_COOKIE,
  FONT_KEYS,
  FONT_LABELS,
  resolveAppearance,
  writeAppearanceCookie,
  type ChatStyle,
  type FontKey,
  type OrgAppearance,
  type PersonalAppearance,
} from "@/lib/appearance";
import type { MessageDto } from "@/lib/types";
import { cn } from "@/lib/utils";

type Scope = "me" | "org";

/** Pinta la apariencia en <html>: lo mismo que hace el layout en el servidor. */
function paint(look: OrgAppearance) {
  document.documentElement.setAttribute("data-font", look.font);
  document.documentElement.setAttribute("data-chat", look.chatStyle);
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
}: {
  org: OrgAppearance;
  personal: PersonalAppearance;
  canManageOrg: boolean;
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
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Lo que debe quedar pintado al salir: lo guardado, no el borrador.
  const committed = useRef(effective);
  committed.current = effective;
  useEffect(() => () => paint(committed.current), []);
  // Vista previa en vivo: el borrador se pinta en todo el CRM.
  useEffect(() => paint({ font, chatStyle }), [font, chatStyle]);

  const dirty = font !== base.font || chatStyle !== base.chatStyle;

  function changeScope(next: Scope) {
    const b = next === "org" ? savedOrg : resolveAppearance(savedOrg, savedPersonal);
    setScope(next);
    setFont(b.font);
    setChatStyle(b.chatStyle);
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      if (scope === "me") {
        writeAppearanceCookie(FONT_COOKIE, font);
        writeAppearanceCookie(CHAT_STYLE_COOKIE, chatStyle);
        setSavedPersonal({ font, chatStyle });
        setMsg({ ok: true, text: "Listo. Se guardó solo en este navegador." });
      } else {
        const res = await fetch("/api/settings/appearance", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ font, chatStyle }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSavedOrg({ font, chatStyle });
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
    const none = { font: null, chatStyle: null };
    setSavedPersonal(none);
    setFont(savedOrg.font);
    setChatStyle(savedOrg.chatStyle);
    setMsg({ ok: true, text: "Ahora ves lo que eligió la organización." });
  }

  const hasPersonal = savedPersonal.font !== null || savedPersonal.chatStyle !== null;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="space-y-6">
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

        <section aria-labelledby="ap-font" className="space-y-2">
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

        <section aria-labelledby="ap-chat" className="space-y-2">
          <h3 id="ap-chat" className="text-[14px] font-semibold">Estilo del chat en la Bandeja</h3>
          <div role="radiogroup" aria-labelledby="ap-chat" className="space-y-1.5">
            {CHAT_STYLES.map((k) => (
              <Option key={k} checked={chatStyle === k} onSelect={() => setChatStyle(k)}>
                {CHAT_STYLE_LABELS[k]}
                <span className="block text-[12px] font-normal text-text-3">
                  {k === "whatsapp"
                    ? "Burbujas con cola, fondo verde y gris, entrada suave."
                    : "El estilo de siempre."}
                </span>
              </Option>
            ))}
          </div>
        </section>

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

      <div className="min-w-0 space-y-2">
        <h3 className="text-[14px] font-semibold">Vista previa</h3>
        <p className="text-[12.5px] text-text-3">
          Mira la pantalla entera: la letra ya cambió mientras eliges. Si sales sin guardar, todo vuelve como estaba.
        </p>
        {/* `key`: al cambiar de estilo las burbujas vuelven a entrar. */}
        <div key={chatStyle} className="thread-bg flex flex-col gap-[3px] rounded-md border p-4" data-testid="chat-preview">
          {SAMPLES.map(({ m, grouped }, i) => (
            <div
              key={m.id}
              className={cn(
                "bubble-enter flex",
                m.direction === "out" ? "justify-end" : "justify-start",
                i > 0 && !grouped && "mt-2.5"
              )}
            >
              <MessageBubble m={m} grouped={grouped} wide />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
