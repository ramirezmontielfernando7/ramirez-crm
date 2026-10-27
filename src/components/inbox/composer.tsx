"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, m } from "framer-motion";
import {
  BookOpen,
  Clock3,
  FileText,
  MapPin,
  Paperclip,
  Send,
  Smile,
  UserRound,
  X,
  Zap,
} from "lucide-react";
import { SPRING } from "@/components/motion";
import { WINDOW_CLOSED_DIRECT_HINT } from "@/lib/direct-connection";
import type { ConversationDto, TemplateDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatBytes, formatRemaining, takePastedImage } from "./helpers";
import { WritingAssist } from "./writing-assist";
import {
  KnowledgePicker,
  type KnowledgePickAction,
} from "@/components/knowledge/knowledge-picker";
import type { KnowledgeEntryDto } from "@/lib/knowledge";
import { checkOutgoing, uploadHttpMessage } from "@/lib/upload-limits";
import { useViewer } from "@/components/viewer-context";
import { fillQuickReply, filterQuickReplies, slashQuery, type QuickReplyDto } from "@/lib/quick-replies";
import { QuickReplyPicker } from "./quick-reply-picker";

/**
 * 008 — Panel secundario del clip: formulario de ubicación o contacto.
 * 024 — `knowledge`: el buscador de Conocimientos (botón de libro).
 * `quick`: las respuestas rápidas (botón del rayo o `/atajo` en el editor).
 */
type AttachPanel = "location" | "contact" | "knowledge" | "quick" | null;

/** Qué menú flotante del compositor está abierto (uno a la vez). */
type Popover = "attach" | "emoji" | null;

// Enviar plantilla solo aparece con la ventana de 24 h cerrada: no se baja
// hasta que hace falta.
const TemplateSender = dynamic(
  () => import("./template-sender").then((mod) => mod.TemplateSender),
  { loading: () => <div className="h-10" aria-hidden /> }
);

// El selector de emojis (y sus datos) solo se descarga al abrirlo por primera
// vez: la Bandeja no paga ese peso si nadie lo usa.
const EmojiPickerPanel = dynamic(() => import("./emoji-picker"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[340px] w-[304px] items-center justify-center text-xs text-text-3">
      Cargando emojis…
    </div>
  ),
});

/** Cierra un menú flotante al hacer clic fuera de `ref` o con Escape. */
function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void
) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, ref]);
}

/** Extrae lat,long de "21.019, -101.257" o de un enlace de Google Maps. */
function parseCoords(raw: string): { latitude: number; longitude: number } | null {
  const m =
    raw.match(/(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/) ??
    raw.match(/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

export function Composer({
  conversation,
  onSend,
  onSent,
  freeTextOutsideWindow = false,
  directHint = true,
  numberChat = false,
}: {
  conversation: Pick<ConversationDto, "id" | "contact" | "windowOpen" | "windowRemainingMs">;
  onSend: (text: string) => Promise<string | null>;
  onSent: () => void;
  /**
   * Conexión directa: con la ventana cerrada se puede escribir igual porque
   * sale por el dispositivo (chat Directa/Automática, o empresa sin Meta).
   */
  freeTextOutsideWindow?: boolean;
  /** Avisar que sale por conexión directa (en una empresa sin Meta no hace falta). */
  directHint?: boolean;
  /**
   * 046 — Un chat de «Mi número»: sale por el teléfono de quien escribe (sin
   * ventana de 24 h ni plantillas) y el dispositivo solo manda texto y
   * archivos (ni ubicación ni tarjeta de contacto).
   */
  numberChat?: boolean;
}) {
  // 030 (PR 4): sin el módulo Conocimientos no se ofrece (la API ya da 404).
  const viewer = useViewer();
  const knowledgeOn = viewer.hasModule("knowledge");
  // Respuestas rápidas: `quickSlash` = abiertas por `/` (el editor maneja el teclado).
  const [quickReplies, setQuickReplies] = useState<QuickReplyDto[]>([]);
  const [quickSlash, setQuickSlash] = useState(false);
  const [quickActive, setQuickActive] = useState(0);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<TemplateDto[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [panel, setPanel] = useState<AttachPanel>(null);
  const [coordsRaw, setCoordsRaw] = useState("");
  const [placeName, setPlaceName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [popover, setPopover] = useState<Popover>(null);
  // 023 — Asistente de redacción: mientras reescribe, el editor se congela;
  // `undoText` guarda el borrador anterior para "Deshacer".
  const [rewriting, setRewriting] = useState(false);
  const [undoText, setUndoText] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLDivElement>(null);
  const attachTrigger = useRef<HTMLButtonElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

  useDismiss(popover === "attach", attachRef, () => setPopover(null));
  useDismiss(popover === "emoji", emojiRef, () => setPopover(null));

  useEffect(() => {
    let cancelled = false;
    fetch("/api/quick-replies")
      .then((r) => (r.ok ? r.json() : { replies: [] }))
      .then((d: { replies?: QuickReplyDto[] }) => {
        if (!cancelled) setQuickReplies(d.replies ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Las plantillas son de Meta: por un número no salen.
    if (numberChat) return;
    let cancelled = false;
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateDto[] }) => {
        if (!cancelled)
          setTemplates((d.templates ?? []).filter((t) => t.status === "approved" && t.sendable !== false));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [numberChat]);

  // La URL del preview de imagen se libera al reemplazar/limpiar el archivo.
  useEffect(() => {
    return () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    };
  }, [filePreview]);

  // 023 — Al reemplazar o deshacer con la IA, el campo se ajusta al texto
  // nuevo DESPUÉS de pintarlo (con setTimeout medía el alto viejo).
  useEffect(() => {
    autogrow();
  }, [undoText]);

  function autogrow() {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  function pickFile(f: File | null) {
    // 044: el mismo límite de WhatsApp que revisa el servidor, antes de subir.
    const check = f ? checkOutgoing(f.type || "application/octet-stream", f.size, f.name) : null;
    if (check && !check.ok) {
      if (fileRef.current) fileRef.current.value = "";
      setError(check.message);
      return;
    }
    if (filePreview) URL.revokeObjectURL(filePreview);
    setFile(f);
    setFilePreview(f && f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    setPanel(null);
    setError(null);
  }

  /** Inserta el emoji donde está el cursor (o reemplaza lo seleccionado). */
  function insertEmoji(emoji: string) {
    // 023: con la IA reescribiendo el editor está congelado; un emoji es una
    // edición, así que "Deshacer" ya no aplica.
    if (rewriting) return;
    setUndoText(null);
    const el = taRef.current;
    const value = el?.value ?? text;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setText(value.slice(0, start) + emoji + value.slice(end));
    const caret = start + emoji.length;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      autogrow();
    });
  }

  /** Ctrl+V con una imagen = adjuntarla (mecanismo en helpers, compartido). */
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const image = takePastedImage(e);
    if (image) pickFile(image);
  }

  /** Una opción del menú del clip: cierra el menú y hace lo de siempre. */
  function chooseAttach(option: "file" | "location" | "contact") {
    setPopover(null);
    if (option === "file") fileRef.current?.click();
    else setPanel(panel === option ? null : option);
  }

  async function apiSend(path: string, init: RequestInit): Promise<string | null> {
    const res = await fetch(path, init);
    if (res.ok) return null;
    // La API responde `{ error: { message } }`; antes se leía `message` y se
    // veía «Error 413» en vez del motivo.
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return data?.error?.message ?? uploadHttpMessage(res.status) ?? `Error ${res.status}`;
  }

  async function submit() {
    if (rewriting) return;
    setError(null);

    if (file) {
      // El adjunto sí espera: sube el archivo y no tiene sentido encolar otro
      // mientras tanto.
      if (sending) return;
      setSending(true);
      const form = new FormData();
      form.set("file", file);
      const caption = text.trim();
      if (caption) form.set("caption", caption);
      const err = await apiSend(
        numberChat
          ? `/api/my-number/chats/${conversation.id}/messages/media`
          : `/api/conversations/${conversation.id}/messages/media`,
        { method: "POST", body: form }
      );
      setSending(false);
      if (err) {
        setError(err);
        return;
      }
      pickFile(null);
      setText("");
      setUndoText(null);
      if (taRef.current) taRef.current.style.height = "auto";
      onSent();
      return;
    }

    const value = text.trim();
    if (!value) return;
    // Aquí NO se espera al servidor. Enviar tarda ~1.5 s (el viaje a Meta) y
    // durante ese rato el renglón siguiente se escribía encima del anterior y
    // salía todo como un solo mensaje. El campo se limpia ya; la burbuja
    // "enviando" del hilo es la que informa el estado real.
    setText("");
    setUndoText(null);
    if (taRef.current) taRef.current.style.height = "auto";
    const err = await onSend(value);
    if (err) {
      setError(err);
      // Lo que no salió vuelve al campo. Si ya empezaste a escribir otra cosa
      // se antepone en vez de pisarte: nada se pierde en silencio.
      setText((actual) => (actual ? `${value}\n${actual}` : value));
      taRef.current?.focus();
      setTimeout(autogrow, 0);
    }
  }

  async function submitLocation() {
    const coords = parseCoords(coordsRaw);
    if (!coords) {
      setError("Coordenadas inválidas — pega «lat, long» o un enlace de Google Maps");
      return;
    }
    setSending(true);
    setError(null);
    const err = await apiSend(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "location",
        location: { ...coords, ...(placeName.trim() ? { name: placeName.trim() } : {}) },
      }),
    });
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setPanel(null);
    setCoordsRaw("");
    setPlaceName("");
    onSent();
  }

  async function submitContact() {
    if (!contactName.trim() || contactPhone.trim().length < 5) {
      setError("El contacto necesita nombre y teléfono");
      return;
    }
    setSending(true);
    setError(null);
    const err = await apiSend(`/api/conversations/${conversation.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "contacts",
        contacts: [{ name: contactName.trim(), phone: contactPhone.trim() }],
      }),
    });
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setPanel(null);
    setContactName("");
    setContactPhone("");
    onSent();
  }

  /** 024 — Una entrada de Conocimientos: se envía tal cual o va al editor. */
  async function pickKnowledge(entry: KnowledgeEntryDto, action: KnowledgePickAction) {
    setError(null);
    if (action === "insert") {
      setText((actual) => (actual.trim() ? `${actual}\n${entry.body}` : entry.body));
      setUndoText(null);
      setPanel(null);
      taRef.current?.focus();
      setTimeout(autogrow, 0);
      return;
    }
    setSending(true);
    // Por un número sale el texto de la entrada (su adjunto no).
    const err = numberChat ? await onSend(entry.body) : await apiSend(`/api/conversations/${conversation.id}/messages/knowledge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryId: entry.id, mode: action }),
    });
    setSending(false);
    if (err) {
      setError(err);
      return;
    }
    setPanel(null);
    onSent();
  }

  /** Respuesta rápida al editor (con `{nombre}` ya cambiado), lista para revisar y enviar. */
  function insertQuick(reply: QuickReplyDto) {
    setText(fillQuickReply(reply.body, conversation.contact.name));
    setUndoText(null);
    setPanel(null);
    setQuickSlash(false);
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      autogrow();
    });
  }

  /** «Enviar» desde la lista: sale tal cual, sin pasar por el editor. */
  async function sendQuick(reply: QuickReplyDto) {
    setError(null);
    setPanel(null);
    setQuickSlash(false);
    // Si el editor tenía `/atajo`, ese texto no era un mensaje.
    if (slashQuery(text) !== null) setText("");
    setSending(true);
    const err = await onSend(fillQuickReply(reply.body, conversation.contact.name));
    setSending(false);
    if (err) setError(err);
    else onSent();
  }

  const slash = quickSlash && panel === "quick" ? slashQuery(text) : null;
  const slashMatches = slash !== null ? filterQuickReplies(quickReplies, slash) : [];

  if (!conversation.windowOpen && !freeTextOutsideWindow && !numberChat) {
    return (
      <div data-pm="composer" className="border-t bg-background px-[18px] py-3.5">
        <div className="mb-3 flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-sm text-warning-text">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.7} />
          <div>
            <p className="font-medium">La ventana de 24 horas está cerrada.</p>
            <p className="opacity-80">
              WhatsApp solo permite texto libre dentro de las 24 horas
              siguientes al último mensaje del cliente. Para retomar la
              conversación, envía una plantilla aprobada.
            </p>
          </div>
        </div>
        <TemplateSender conversationId={conversation.id} onSent={onSent} />
      </div>
    );
  }

  const canSubmit = !rewriting && (file !== null || text.trim().length > 0);

  return (
    <div data-pm="composer" className="border-t bg-background px-[18px] pb-3.5 pt-3">
      {!conversation.windowOpen && directHint && !numberChat && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-text-3" data-testid="composer-direct-hint">
          <Clock3 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
          {WINDOW_CLOSED_DIRECT_HINT}
        </p>
      )}
      {templates.length > 0 && !file && panel === null && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {templates.slice(0, 4).map((t) => (
            <button
              key={t.id}
              className="rounded-full border border-border-strong bg-background px-3 py-1 text-xs font-semibold text-text-2 transition-colors hover:border-brand hover:bg-brand-tint hover:text-brand-text"
              onClick={() => {
                const firstName = conversation.contact.name.split(" ")[0] ?? "";
                setText(t.body.replace(/\{\{\s*1\s*\}\}/g, firstName));
                taRef.current?.focus();
                setTimeout(autogrow, 0);
              }}
              title={t.body}
            >
              {t.name.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      )}

      {file && (
        <div className="mb-2.5 flex items-center gap-2.5 rounded-md border bg-subtle p-2.5">
          {filePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={filePreview}
              alt={file.name}
              className="h-14 w-14 rounded object-cover"
            />
          ) : (
            <FileText className="h-8 w-8 shrink-0 text-brand" strokeWidth={1.5} />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-text-3">
              {formatBytes(file.size)} · el texto de abajo va como pie del adjunto
            </p>
          </div>
          <button
            onClick={() => pickFile(null)}
            aria-label="Quitar adjunto"
            className="rounded p-1 text-text-3 hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      {panel === "knowledge" && (
        <KnowledgePicker
          busy={sending}
          onPick={(entry, action) => void pickKnowledge(entry, action)}
          onClose={() => {
            setPanel(null);
            taRef.current?.focus();
          }}
        />
      )}

      {panel === "quick" && (
        <QuickReplyPicker
          replies={quickReplies}
          query={quickSlash ? (slash ?? "") : undefined}
          active={quickActive}
          onActive={setQuickActive}
          busy={sending}
          onInsert={insertQuick}
          onSend={(r) => void sendQuick(r)}
          onClose={() => {
            setPanel(null);
            setQuickSlash(false);
            taRef.current?.focus();
          }}
          onKnowledge={
            knowledgeOn
              ? () => {
                  if (slashQuery(text) !== null) setText("");
                  setQuickSlash(false);
                  setPanel("knowledge");
                }
              : undefined
          }
          canManage={viewer.can("templates.manage")}
        />
      )}

      {panel === "location" && (
        <div className="mb-2.5 flex flex-wrap items-end gap-2 rounded-md border bg-subtle p-2.5">
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Coordenadas o enlace de Google Maps
            <input
              value={coordsRaw}
              onChange={(e) => setCoordsRaw(e.target.value)}
              placeholder="21.019, -101.257"
              className="mt-1 w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </label>
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Nombre del lugar (opcional)
            <input
              value={placeName}
              onChange={(e) => setPlaceName(e.target.value)}
              placeholder="Oficina AISHIA"
              className="mt-1 w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </label>
          <button
            onClick={() => void submitLocation()}
            disabled={sending}
            className="rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-brand-fg shadow-sm hover:bg-brand-hover disabled:opacity-40"
          >
            Enviar ubicación
          </button>
          <button
            onClick={() => setPanel(null)}
            aria-label="Cancelar"
            className="rounded p-1 text-text-3 hover:bg-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      {panel === "contact" && (
        <div className="mb-2.5 flex flex-wrap items-end gap-2 rounded-md border bg-subtle p-2.5">
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Nombre
            <input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="Xavier Pérez"
              className="mt-1 w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </label>
          <label className="min-w-0 flex-1 text-xs text-text-2">
            Teléfono
            <input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="+52 462 123 4567"
              className="mt-1 w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-sm outline-none transition-[border-color,box-shadow] focus:border-brand focus:ring-[3px] focus:ring-brand-soft"
            />
          </label>
          <button
            onClick={() => void submitContact()}
            disabled={sending}
            className="rounded-full bg-brand px-3.5 py-1.5 text-sm font-semibold text-brand-fg shadow-sm hover:bg-brand-hover disabled:opacity-40"
          >
            Enviar contacto
          </button>
          <button
            onClick={() => setPanel(null)}
            aria-label="Cancelar"
            className="rounded p-1 text-text-3 hover:bg-secondary"
          >
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      )}

      {/* La caja de escritura en píldora, como la del mockup de la landing */}
      <div className="flex items-end gap-2 rounded-[23px] border border-border-strong bg-background py-1.5 pl-2 pr-1.5 shadow-sm transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
        />
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Un solo clip: archivo, contacto y ubicación viven en su menú. */}
          <div ref={attachRef} className="relative">
            <button
              ref={attachTrigger}
              type="button"
              onClick={() => setPopover(popover === "attach" ? null : "attach")}
              aria-label="Adjuntar"
              aria-haspopup="menu"
              aria-expanded={popover === "attach"}
              title="Adjuntar archivo, contacto o ubicación"
              className={cn(
                "rounded p-1.5 text-text-3 transition-[color,background-color,transform] duration-150 hover:bg-secondary hover:text-foreground active:scale-90",
                (popover === "attach" || panel === "location" || panel === "contact") &&
                  "bg-secondary text-brand"
              )}
            >
              <m.span
                animate={{ rotate: popover === "attach" ? -45 : 0 }}
                transition={SPRING}
                className="flex"
              >
                <Paperclip className="h-[18px] w-[18px]" strokeWidth={1.7} />
              </m.span>
            </button>
            <AnimatePresence>
              {popover === "attach" && (
                <m.div
                  role="menu"
                  aria-label="Adjuntar"
                  initial={{ opacity: 0, y: 6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.1 } }}
                  transition={SPRING}
                  style={{ transformOrigin: "bottom left" }}
                  className="absolute bottom-full left-0 z-30 mb-2.5 w-60 rounded-md border bg-popover p-1.5 text-foreground shadow-pop"
                >
                  {(
                    [
                      {
                        id: "file",
                        label: "Archivo",
                        hint: "Foto, video, audio o PDF",
                        Icon: FileText,
                      },
                      {
                        id: "contact",
                        label: "Contacto",
                        hint: "Compartir una tarjeta",
                        Icon: UserRound,
                      },
                      {
                        id: "location",
                        label: "Ubicación",
                        hint: "Coordenadas o Google Maps",
                        Icon: MapPin,
                      },
                    ] as const
                  )
                    .filter(({ id }) => !numberChat || id === "file")
                    .map(({ id, label, hint, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      role="menuitem"
                      onClick={() => chooseAttach(id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none",
                        panel === id && "text-brand"
                      )}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text">
                        <Icon className="h-4 w-4" strokeWidth={1.7} />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{label}</span>
                        <span className="block truncate text-[11.5px] text-text-3">{hint}</span>
                      </span>
                    </button>
                  ))}
                </m.div>
              )}
            </AnimatePresence>
          </div>
          <WritingAssist
            text={text}
            busy={rewriting}
            onBusy={(b) => {
              setRewriting(b);
              if (b) setError(null);
            }}
            onResult={(next) => {
              setUndoText(text);
              setText(next);
            }}
            onError={(msg) => setError(msg)}
          />
          <div ref={emojiRef} className="relative">
            <button
              type="button"
              onClick={() => setPopover(popover === "emoji" ? null : "emoji")}
              aria-label="Emojis"
              aria-haspopup="dialog"
              aria-expanded={popover === "emoji"}
              title="Emojis"
              className={cn(
                "rounded p-1.5 text-text-3 transition-[color,background-color,transform] duration-150 hover:bg-secondary hover:text-foreground active:scale-90",
                popover === "emoji" && "bg-secondary text-brand"
              )}
            >
              <Smile className="h-[18px] w-[18px]" strokeWidth={1.7} />
            </button>
            <AnimatePresence>
              {popover === "emoji" && (
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
            onClick={() => {
              setPopover(null);
              setQuickSlash(false);
              setQuickActive(0);
              setPanel(panel === "quick" ? null : "quick");
            }}
            aria-label="Respuestas rápidas"
            title="Respuestas rápidas (o escribe / en el editor vacío)"
            data-testid="quick-reply-button"
            className={cn(
              "rounded p-1.5 text-text-3 transition-[color,background-color,transform] duration-150 hover:bg-secondary hover:text-foreground active:scale-90",
              panel === "quick" && "bg-secondary text-brand"
            )}
          >
            <Zap className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
          {knowledgeOn && (
          <button
            type="button"
            onClick={() => {
              setPopover(null);
              setPanel(panel === "knowledge" ? null : "knowledge");
            }}
            aria-label="Conocimientos"
            title="Enviar algo de Conocimientos"
            className={cn(
              "rounded p-1.5 text-text-3 transition-[color,background-color,transform] duration-150 hover:bg-secondary hover:text-foreground active:scale-90",
              panel === "knowledge" && "bg-secondary text-brand"
            )}
          >
            <BookOpen className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
          )}
        </div>
        <textarea
          ref={taRef}
          placeholder={file ? "Pie del adjunto (opcional)…" : "Escribe una respuesta…"}
          value={text}
          rows={1}
          readOnly={rewriting}
          aria-busy={rewriting}
          onChange={(e) => {
            const value = e.target.value;
            // 024 — Sin respuestas rápidas, `/` en el editor vacío abre
            // Conocimientos como siempre (el `/` no se escribe).
            if (knowledgeOn && quickReplies.length === 0 && value === "/" && text === "" && !file) {
              setPanel("knowledge");
              return;
            }
            setText(value);
            // `/atajo`: la lista de respuestas rápidas se filtra mientras escribes.
            if (!file && quickReplies.length > 0 && slashQuery(value) !== null) {
              if (!quickSlash || panel !== "quick") {
                setPopover(null);
                setPanel("quick");
                setQuickSlash(true);
              }
              setQuickActive(0);
            } else if (quickSlash) {
              setQuickSlash(false);
              if (panel === "quick") setPanel(null);
            }
            // Si el asesor retoca el resultado, "Deshacer" ya no aplica.
            setUndoText(null);
            autogrow();
          }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            // `/atajo`: ↑ ↓ eligen, Enter o Tab la ponen, Esc cierra.
            if (slash !== null) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const last = Math.max(slashMatches.length - 1, 0);
                setQuickActive((i) => (e.key === "ArrowDown" ? Math.min(i + 1, last) : Math.max(i - 1, 0)));
                return;
              }
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                const pick = slashMatches[quickActive];
                if (pick) {
                  e.preventDefault();
                  insertQuick(pick);
                  return;
                }
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setPanel(null);
                setQuickSlash(false);
                return;
              }
            }
            // 024 — Esc desde el editor también cierra Conocimientos.
            if (e.key === "Escape" && panel === "knowledge") {
              e.preventDefault();
              setPanel(null);
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          className={cn(
            "max-h-[120px] w-full resize-none self-center bg-transparent py-1 text-sm leading-relaxed outline-none placeholder:text-text-3 transition-opacity",
            rewriting && "animate-pulse opacity-50"
          )}
        />
        <button
          onClick={() => void submit()}
          disabled={sending || !canSubmit}
          aria-label="Enviar"
          className={cn(
            "flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg transition-[opacity,background-color] hover:bg-brand-hover",
            (sending || !canSubmit) && "opacity-40"
          )}
        >
          <Send className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        {error ? (
          <p role="alert" className="text-xs text-destructive">{error}</p>
        ) : rewriting ? (
          <p className="text-xs text-text-3">La IA está reescribiendo…</p>
        ) : undoText !== null ? (
          <p className="text-xs text-text-2">
            Texto reescrito con IA ·{" "}
            <button
              type="button"
              onClick={() => {
                setText(undoText);
                setUndoText(null);
                taRef.current?.focus();
              }}
              className="font-semibold text-brand-text underline-offset-2 hover:underline"
            >
              Deshacer
            </button>
          </p>
        ) : (
          <span />
        )}
        <p className="font-mono text-[10.5px] tracking-[0.04em] text-text-3">
          {numberChat
            ? "Sale por tu número"
            : `Ventana abierta · quedan ${formatRemaining(conversation.windowRemainingMs)}`}
        </p>
      </div>
    </div>
  );
}
