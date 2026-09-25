"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import dynamic from "next/dynamic";
import { AnimatePresence, m } from "motion/react";
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
} from "lucide-react";
import { SPRING } from "@/components/motion";
import type { ConversationDto, TemplateDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatBytes, formatRemaining } from "./helpers";
import { TemplateSender } from "./template-sender";
import { WritingAssist } from "./writing-assist";
import {
  KnowledgePicker,
  type KnowledgePickAction,
} from "@/components/knowledge/knowledge-picker";
import type { KnowledgeEntryDto } from "@/lib/knowledge";

/**
 * 008 — Panel secundario del clip: formulario de ubicación o contacto.
 * 024 — `knowledge`: el buscador de Conocimientos (botón de libro o `/`).
 */
type AttachPanel = "location" | "contact" | "knowledge" | null;

/** Qué menú flotante del compositor está abierto (uno a la vez). */
type Popover = "attach" | "emoji" | null;

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

/**
 * La imagen pegada con Ctrl+V llega como "image.png" (o sin nombre): se le da
 * uno con fecha para que el cliente no reciba diez "image.png" iguales.
 */
function namePasted(f: File): File {
  if (f.name && f.name !== "image.png") return f;
  const ext = f.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
  return new File([f], `imagen-${stamp}.${ext}`, { type: f.type });
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
}: {
  conversation: ConversationDto;
  onSend: (text: string) => Promise<string | null>;
  onSent: () => void;
}) {
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
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d: { templates?: TemplateDto[] }) => {
        if (!cancelled)
          setTemplates((d.templates ?? []).filter((t) => t.status === "approved"));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  /**
   * Ctrl+V con una imagen en el portapapeles = adjuntarla, igual que elegirla
   * del explorador. Si trae texto (aunque también traiga imagen, como al
   * copiar celdas de Excel) se pega el texto como siempre.
   */
  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (e.clipboardData.getData("text/plain")) return;
    const image = Array.from(e.clipboardData.items)
      .find((i) => i.kind === "file" && i.type.startsWith("image/"))
      ?.getAsFile();
    if (!image) return;
    e.preventDefault();
    pickFile(namePasted(image));
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
    const data = (await res.json().catch(() => null)) as { message?: string } | null;
    return data?.message ?? `Error ${res.status}`;
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
        `/api/conversations/${conversation.id}/messages/media`,
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
    const err = await apiSend(`/api/conversations/${conversation.id}/messages/knowledge`, {
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

  if (!conversation.windowOpen) {
    return (
      <div className="border-t bg-background px-[18px] py-3.5">
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
    <div className="border-t bg-background px-[18px] pb-3.5 pt-3">
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
                (popover === "attach" || (panel !== null && panel !== "knowledge")) &&
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
                  ).map(({ id, label, hint, Icon }) => (
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
              setPanel(panel === "knowledge" ? null : "knowledge");
            }}
            aria-label="Conocimientos"
            title="Enviar algo de Conocimientos (o escribe / en el editor vacío)"
            className={cn(
              "rounded p-1.5 text-text-3 transition-[color,background-color,transform] duration-150 hover:bg-secondary hover:text-foreground active:scale-90",
              panel === "knowledge" && "bg-secondary text-brand"
            )}
          >
            <BookOpen className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </button>
        </div>
        <textarea
          ref={taRef}
          placeholder={file ? "Pie del adjunto (opcional)…" : "Escribe una respuesta…"}
          value={text}
          rows={1}
          readOnly={rewriting}
          aria-busy={rewriting}
          onChange={(e) => {
            // 024 — `/` en el editor vacío abre Conocimientos (el `/` no se escribe).
            if (e.target.value === "/" && text === "" && !file) {
              setPanel("knowledge");
              return;
            }
            setText(e.target.value);
            // Si el asesor retoca el resultado, "Deshacer" ya no aplica.
            setUndoText(null);
            autogrow();
          }}
          onPaste={onPaste}
          onKeyDown={(e) => {
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
          Ventana abierta · quedan {formatRemaining(conversation.windowRemainingMs)}
        </p>
      </div>
    </div>
  );
}
