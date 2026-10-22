"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import type { ConversationDto } from "@/lib/types";
import {
  CONNECTION_MODE_COLOR,
  DIRECT_TEXT,
  effectiveMode,
  MODE_PICKER_TEXT,
  modeDotLabel,
  modeFromDirectToggle,
  receivesViaMeta,
  type ConnectionMode,
  type InboxDirectContext,
} from "@/lib/direct-connection";
import { cn } from "@/lib/utils";

/** Verde / azul / morado del punto. El morado no tiene token propio. */
const DOT_CLASS = {
  green: "bg-success",
  blue: "bg-info",
  purple: "bg-[#8b5cf6]",
} as const;

export function modeDotClass(mode: ConnectionMode): string {
  return DOT_CLASS[CONNECTION_MODE_COLOR[mode]];
}

/**
 * Conexión directa (PR 5) — El punto de color en la esquina del avatar del
 * chat: Oficial (verde), Directa (azul) o Directa con «Recibir por Meta»
 * (morado). Con permiso, al pulsarlo se abre el selector. Solo existe si el
 * complemento está encendido (la Bandeja no pasa `ctx` si no).
 */
export function ChatModeDot({
  conversation,
  ctx,
  onChanged,
  children,
}: {
  conversation: Pick<ConversationDto, "id" | "channel" | "connectionMode">;
  ctx: InboxDirectContext;
  onChanged: (id: string, mode: ConnectionMode) => void;
  /** El avatar. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLSpanElement>(null);
  const mode = effectiveMode(conversation.connectionMode, ctx.defaultMode);
  const interactive = ctx.canChangeMode && conversation.channel === "whatsapp";

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (conversation.channel !== "whatsapp") return <>{children}</>;

  async function choose(next: ConnectionMode) {
    if (next === mode) return;
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/conversations/${conversation.id}/mode`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: next }),
    }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Sin conexión. Intenta de nuevo.");
    if (!r.ok) {
      const body = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
      return setError(body?.error?.message ?? "No se pudo cambiar.");
    }
    onChanged(conversation.id, next);
    if (next === "meta") setOpen(false);
  }

  const directOn = mode !== "meta";
  const blocked = !ctx.deviceReady;
  const dot = (
    <span
      className={cn("block h-[9px] w-[9px] rounded-full border-2 border-background", modeDotClass(mode))}
      data-testid="chat-mode-dot"
      data-mode={mode}
    />
  );
  return (
    <span ref={box} className="relative shrink-0">
      {children}
      {interactive ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${MODE_PICKER_TEXT.title}: ${modeDotLabel(mode)}`}
          title={modeDotLabel(mode)}
          onClick={() => setOpen((v) => !v)}
          className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {dot}
        </button>
      ) : (
        <span className="absolute -bottom-px -right-px" title={modeDotLabel(mode)} aria-label={modeDotLabel(mode)}>
          {dot}
        </span>
      )}
      {open && interactive && (
        <div
          role="dialog"
          aria-label={MODE_PICKER_TEXT.title}
          className="absolute left-0 top-full z-30 mt-2 w-72 space-y-2 rounded-lg border bg-popover p-3 text-sm shadow-lg"
          data-testid="chat-mode-picker"
        >
          <p className="text-xs font-medium text-text-3">{MODE_PICKER_TEXT.title}</p>
          <ModeOption
            active={mode === "meta"}
            color={modeDotClass("meta")}
            label={MODE_PICKER_TEXT.meta.label}
            hint={MODE_PICKER_TEXT.meta.hint}
            disabled={busy}
            onPick={() => void choose("meta")}
            testId="mode-option-meta"
          />
          <ModeOption
            active={directOn}
            color={modeDotClass("directa")}
            label={MODE_PICKER_TEXT.directa.label}
            hint={MODE_PICKER_TEXT.directa.hint}
            disabled={busy || blocked}
            onPick={() => void choose("directa")}
            testId="mode-option-directa"
          />
          {directOn && (
            <div className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{DIRECT_TEXT.receiveViaMeta}</p>
                <p className="text-xs text-text-3">{MODE_PICKER_TEXT.receiveViaMetaHint}</p>
              </div>
              <Switch
                size="sm"
                label={DIRECT_TEXT.receiveViaMeta}
                checked={receivesViaMeta(mode)}
                disabled={busy}
                onCheckedChange={(on) => void choose(modeFromDirectToggle(on))}
              />
            </div>
          )}
          {blocked && (
            <p className="text-xs text-text-3" data-testid="mode-needs-device">
              {ctx.paused ? MODE_PICKER_TEXT.paused : MODE_PICKER_TEXT.needsDevice}
            </p>
          )}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </span>
  );
}

function ModeOption({
  active,
  color,
  label,
  hint,
  disabled,
  onPick,
  testId,
}: {
  active: boolean;
  color: string;
  label: string;
  hint: string;
  disabled: boolean;
  onPick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={active}
      data-testid={testId}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors disabled:opacity-50",
        active ? "border-foreground/40 bg-accent" : "hover:bg-accent"
      )}
    >
      <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", color)} />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium">{label}</span>
        <span className="block text-xs text-text-3">{hint}</span>
      </span>
    </button>
  );
}
