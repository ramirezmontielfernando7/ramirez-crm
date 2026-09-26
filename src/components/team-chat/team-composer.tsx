"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, m } from "motion/react";
import { BookOpen, Eye, FileText, Megaphone, Paperclip, SendHorizontal, Smile, X } from "lucide-react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { attachmentRejection, TEAM_MESSAGE_MAX, type TeamMessageDto, type TeamThreadKind } from "@/lib/team-chat";
import type { KnowledgeEntryDto } from "@/lib/knowledge";
import { cn } from "@/lib/utils";
import { SPRING } from "@/components/motion";
import { KnowledgePicker, type KnowledgePickAction } from "@/components/knowledge/knowledge-picker";
import { formatBytes } from "@/components/inbox/helpers";

// El selector de emojis (frimousse, datos servidos por la propia instancia)
// solo se descarga al abrirlo.
const EmojiPickerPanel = dynamic(() => import("@/components/inbox/emoji-picker"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[340px] w-[304px] items-center justify-center text-xs text-text-3">
      Cargando emojis…
    </div>
  ),
});

/** Cierra un popover al hacer clic fuera o con Escape. */
function useDismiss(open: boolean, ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, ref, onClose]);
}

/**
 * 025 — Editor del chat de equipo: texto, emojis (frimousse), un adjunto y
 * Conocimientos. Nunca falla en silencio: cualquier error queda escrito
 * sobre el editor y el borrador se conserva.
 */
export function TeamComposer({
  threadId,
  kind,
  canPost,
  relation,
  onSent,
}: {
  threadId: string;
  kind: TeamThreadKind;
  canPost: boolean;
  relation: "member" | "oversight";
  onSent: (message: TeamMessageDto | null) => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const closeEmoji = useRef(() => setEmojiOpen(false)).current;
  useDismiss(emojiOpen, emojiRef, closeEmoji);

  // Otro hilo = otro borrador.
  useEffect(() => {
    setText("");
    setFile(null);
    setError(null);
    setKnowledgeOpen(false);
  }, [threadId]);

  function autogrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  function insertEmoji(emoji: string) {
    const el = taRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
      autogrow();
    });
  }

  function pickFile(f: File | null) {
    setError(null);
    if (f) {
      const rejection = attachmentRejection(f.type || "application/octet-stream", f.name, f.size);
      if (rejection) {
        setError(rejection);
        return;
      }
    }
    setFile(f);
  }

  async function send() {
    if (sending) return;
    const body = text.trim();
    if (!body && !file) return;
    if (body.length > TEAM_MESSAGE_MAX) {
      setError(`El mensaje pasa de ${TEAM_MESSAGE_MAX} caracteres`);
      return;
    }
    setSending(true);
    setError(null);
    let init: RequestInit;
    if (file) {
      const form = new FormData();
      form.set("body", body);
      form.set("file", file);
      init = { method: "POST", body: form };
    } else {
      init = jsonInit("POST", { body });
    }
    const res = await fetchJson<{ message: TeamMessageDto }>(
      `/api/team-chat/threads/${threadId}/messages`,
      init
    );
    setSending(false);
    if (!res.ok) {
      setError(`No se envió: ${res.error}`);
      return;
    }
    setText("");
    setFile(null);
    requestAnimationFrame(autogrow);
    onSent(res.data.message);
    taRef.current?.focus();
  }

  async function pickKnowledge(entry: KnowledgeEntryDto, action: KnowledgePickAction) {
    if (action === "insert") {
      setText((t) => (t ? `${t}\n${entry.body}` : entry.body));
      setKnowledgeOpen(false);
      requestAnimationFrame(autogrow);
      return;
    }
    setSending(true);
    setError(null);
    const res = await fetchJson<{ messageId: string }>(
      `/api/team-chat/threads/${threadId}/messages/knowledge`,
      jsonInit("POST", { entryId: entry.id, mode: action })
    );
    setSending(false);
    if (!res.ok) {
      setError(`No se compartió: ${res.error}`);
      return;
    }
    setKnowledgeOpen(false);
    onSent(null);
  }

  if (!canPost) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-t bg-subtle px-4 py-3 text-[12.5px] text-text-2">
        {relation === "oversight" ? (
          <>
            <Eye className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.8} />
            Estás viendo esta conversación como supervisor: es de solo lectura.
          </>
        ) : (
          <>
            <Megaphone className="h-4 w-4 shrink-0 text-brand" strokeWidth={1.8} />
            {kind === "announcements"
              ? "En Avisos publican el Propietario y los Coordinadores. Puedes reaccionar a los mensajes."
              : "No puedes escribir en esta conversación."}
          </>
        )}
      </div>
    );
  }

  const over = text.length > TEAM_MESSAGE_MAX;

  return (
    <div className="shrink-0 border-t bg-background px-3 pb-3 pt-2.5 sm:px-4">
      {error && (
        <p role="alert" className="mb-2 rounded-md border border-danger-soft bg-danger-tint px-2.5 py-1.5 text-[12px] text-danger-text">
          {error}
        </p>
      )}
      {file && (
        <div className="mb-2 flex items-center gap-2.5 rounded-md border bg-subtle p-2">
          <FileText className="h-7 w-7 shrink-0 text-brand" strokeWidth={1.5} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-text-3">{formatBytes(file.size)} · el texto va junto al archivo</p>
          </div>
          <button
            type="button"
            onClick={() => pickFile(null)}
            aria-label="Quitar adjunto"
            className="rounded p-1 text-text-3 hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}
      {knowledgeOpen && (
        <KnowledgePicker
          busy={sending}
          onPick={(entry, action) => void pickKnowledge(entry, action)}
          onClose={() => {
            setKnowledgeOpen(false);
            taRef.current?.focus();
          }}
        />
      )}
      <div className="flex items-end gap-1.5 rounded-md border border-border-strong bg-background px-2 py-1.5 transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          aria-label="Mensaje para el equipo"
          placeholder="Escribe al equipo…"
          onChange={(e) => {
            setText(e.target.value);
            autogrow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="max-h-[140px] min-h-[36px] flex-1 resize-none bg-transparent px-1 py-1.5 text-[14px] leading-[1.45] outline-none placeholder:text-text-3 max-sm:text-base"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || over || (!text.trim() && !file)}
          aria-label="Enviar"
          title="Enviar (Enter)"
          className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand text-brand-fg transition-[opacity,transform] duration-150 active:scale-95 disabled:opacity-40"
        >
          <SendHorizontal className="h-4 w-4" strokeWidth={1.9} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-0.5">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            pickFile(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Adjuntar archivo"
          title="Adjuntar archivo (máx. 16 MB; no SVG ni HTML)"
          className="rounded p-1.5 text-text-3 transition-[color,background-color,transform] duration-150 hover:bg-secondary hover:text-foreground active:scale-90"
        >
          <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </button>
        <div ref={emojiRef} className="relative">
          <button
            type="button"
            onClick={() => setEmojiOpen((v) => !v)}
            aria-label="Emojis"
            aria-haspopup="dialog"
            aria-expanded={emojiOpen}
            title="Emojis"
            className={cn(
              "rounded p-1.5 text-text-3 transition-[color,background-color,transform] duration-150 hover:bg-secondary hover:text-foreground active:scale-90",
              emojiOpen && "bg-secondary text-brand"
            )}
          >
            <Smile className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
          <AnimatePresence>
            {emojiOpen && (
              <m.div
                role="dialog"
                aria-label="Elegir emoji"
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.1 } }}
                transition={SPRING}
                style={{ transformOrigin: "bottom left" }}
                className="absolute bottom-full left-0 z-30 mb-2.5 overflow-hidden rounded-md border bg-popover text-foreground shadow-pop"
              >
                <EmojiPickerPanel onPick={insertEmoji} />
              </m.div>
            )}
          </AnimatePresence>
        </div>
        <button
          type="button"
          onClick={() => setKnowledgeOpen((v) => !v)}
          aria-label="Conocimientos"
          title="Compartir algo de Conocimientos"
          className={cn(
            "rounded p-1.5 text-text-3 transition-[color,background-color,transform] duration-150 hover:bg-secondary hover:text-foreground active:scale-90",
            knowledgeOpen && "bg-secondary text-brand"
          )}
        >
          <BookOpen className="h-[18px] w-[18px]" strokeWidth={1.7} />
        </button>
        <span className={cn("ml-auto text-[11px] tabular-nums", over ? "text-danger-text" : "text-text-3")}>
          {text.length > TEAM_MESSAGE_MAX * 0.8 ? `${text.length}/${TEAM_MESSAGE_MAX}` : "Enter envía · Shift+Enter salto"}
        </span>
      </div>
    </div>
  );
}
