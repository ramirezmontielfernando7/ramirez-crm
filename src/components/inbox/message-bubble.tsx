"use client";

import {
  AlertTriangle,
  Bot,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  MapPin,
  Paperclip,
  Smartphone,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { DEFAULT_ASSISTANT_NAME } from "@/lib/ai-connector";
import type { MessageDto, MessageMediaDto } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatBytes, mediaLabel } from "./helpers";
import { ImageLightbox } from "./image-lightbox";

/**
 * El color vive en el contenedor (`tick-<estado>`) y el icono lo hereda: así el
 * estilo «Premium» puede animar el paso a «leído» sin tocar el icono. Solo
 * pinta los estados que el sistema guarda de verdad.
 */
function StatusTicks({ status }: { status: MessageDto["status"] }) {
  const cls = "h-[13px] w-[13px]";
  const Icon =
    status === "pending"
      ? Clock3
      : status === "sent"
        ? Check
        : status === "delivered" || status === "read"
          ? CheckCheck
          : AlertTriangle;
  const color =
    status === "read"
      ? "text-[#53bdeb]"
      : status === "failed"
        ? "text-destructive"
        : "";
  return (
    <span className={cn("tick inline-flex", `tick-${status}`, color)}>
      <Icon className={cls} strokeWidth={1.7} />
    </span>
  );
}

type LocationPayload = {
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
};

type ContactPayload = {
  name?: { formatted_name?: string; first_name?: string } | string;
  phones?: { phone?: string }[];
  phone?: string;
};

/** 008 — Previsualización del adjunto de un mensaje, por tipo. */
function MediaBlock({ media }: { media: MessageMediaDto }) {
  const [viewing, setViewing] = useState(false);
  const src = `/api/media/${media.assetId}`;

  if (media.kind === "location") {
    const loc = (media.payload ?? {}) as LocationPayload;
    const coords =
      typeof loc.latitude === "number" && typeof loc.longitude === "number"
        ? `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`
        : null;
    return (
      <span className="flex items-start gap-1.5">
        <MapPin
          className="mt-0.5 h-4 w-4 shrink-0 text-brand"
          strokeWidth={1.7}
        />
        <span className="min-w-0">
          <span className="block font-medium">{loc.name ?? "Ubicación"}</span>
          {loc.address && (
            <span className="block text-[12.5px] text-text-3">
              {loc.address}
            </span>
          )}
          {coords && (
            <a
              className="text-[12.5px] text-brand-ink underline-offset-2 hover:underline"
              href={`https://maps.google.com/?q=${loc.latitude},${loc.longitude}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {coords} — abrir mapa
            </a>
          )}
        </span>
      </span>
    );
  }

  if (media.kind === "contacts") {
    const list = Array.isArray(media.payload)
      ? (media.payload as ContactPayload[])
      : [];
    return (
      <span className="flex flex-col gap-1">
        {list.length ? (
          list.map((c, i) => {
            const name =
              typeof c.name === "string"
                ? c.name
                : (c.name?.formatted_name ?? c.name?.first_name ?? "Contacto");
            const phone = c.phones?.[0]?.phone ?? c.phone ?? null;
            return (
              <span key={i} className="flex items-center gap-1.5">
                <UserRound
                  className="h-4 w-4 shrink-0 text-brand"
                  strokeWidth={1.7}
                />
                <span>
                  <span className="block font-medium">{name}</span>
                  {phone && (
                    <span className="block text-[12.5px] text-text-3">
                      {phone}
                    </span>
                  )}
                </span>
              </span>
            );
          })
        ) : (
          <span className="text-text-3">Contacto compartido</span>
        )}
      </span>
    );
  }

  if (media.fetchStatus !== "available") {
    return (
      <span className="inline-flex items-center gap-1.5 text-text-3">
        <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
        {mediaLabel(media.kind)}
        {media.fetchStatus === "failed"
          ? " — contenido no disponible"
          : " — descargando…"}
      </span>
    );
  }

  if (media.kind === "image" || media.kind === "sticker") {
    return (
      <>
        <a
          href={src}
          title="Ver completa"
          onClick={(e) => {
            // Ctrl/Cmd+clic sigue abriendo otra pestaña, como cualquier enlace.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            setViewing(true);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={media.caption ?? mediaLabel(media.kind)}
            className="max-h-72 max-w-full rounded-md object-contain"
            loading="lazy"
            // Premium: la foto reserva su caja (con brillo de carga) hasta que
            // llega, así la burbuja nunca queda como un recuadro vacío.
            onLoad={(e) => (e.currentTarget.dataset.loaded = "1")}
            onError={(e) => (e.currentTarget.dataset.failed = "1")}
          />
        </a>
        {viewing && (
          <ImageLightbox
            src={src}
            alt={media.caption ?? mediaLabel(media.kind)}
            fileName={media.fileName}
            onClose={() => setViewing(false)}
          />
        )}
      </>
    );
  }
  if (media.kind === "video") {
    return (
      <video
        controls
        preload="metadata"
        className="max-h-72 max-w-full rounded-md"
      >
        <source src={src} type={media.mimeType ?? undefined} />
      </video>
    );
  }
  if (media.kind === "audio") {
    return (
      <audio controls preload="metadata" src={src} className="max-w-full" />
    );
  }
  // document
  return (
    <a
      className="flex items-center gap-2 rounded-md border border-border-strong bg-background px-2.5 py-2 hover:bg-subtle"
      href={src}
      download={media.fileName ?? undefined}
      target="_blank"
      rel="noreferrer noopener"
    >
      <FileText className="h-6 w-6 shrink-0 text-brand" strokeWidth={1.5} />
      <span className="min-w-0">
        <span className="block truncate font-medium">
          {media.fileName ?? "Documento"}
        </span>
        {media.fileSize != null && (
          <span className="block text-[12px] text-text-3">
            {formatBytes(media.fileSize)}
          </span>
        )}
      </span>
    </a>
  );
}

export function bubbleTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * 031 (A2) — La burbuja del chat, extraída tal cual de `MessageThread` para
 * que la Bandeja y la vista previa del Laboratorio dibujen lo mismo.
 * `grouped` = mismo remitente que el mensaje anterior (esquina sin cola).
 */
export function MessageBubble({
  m,
  grouped,
  wide = false,
}: {
  m: MessageDto;
  grouped: boolean;
  /** Para columnas angostas (vista previa): más ancho útil. Por defecto, igual que la Bandeja. */
  wide?: boolean;
}) {
  const out = m.direction === "out";
  // Ronda 3: la IA del negocio contesta en lila con «IA» arriba; la IA
  // conectada de una persona, con su nombre en azul.
  const ai = out && m.aiGenerated;
  return (
    <div
      data-media={m.media ? (m.media.caption ? "caption" : "bare") : undefined}
      className={cn(
        // `bubble*`: ganchos de estilo para Personalización → Apariencia
        // («WhatsApp» y «Premium» los pisan en globals.css).
        "bubble max-w-[85%] px-3 py-2 text-[14px] leading-5",
        out ? "bubble-out rounded-[12px_4px_12px_12px]" : "bubble-in rounded-[4px_12px_12px_12px] border",
        ai && "bubble-ai",
        !grouped && "bubble-first",
        !wide && "sm:max-w-[64%]",
        out
          ? ai
            ? "bg-[var(--bubble-ai)] text-[var(--bubble-ai-text)]"
            : "bg-bubble-out text-bubble-out-text"
          : "border-bubble-in-border bg-bubble-in",
      )}
    >
      {m.groupSender && <span className="bubble-who mb-0.5 block text-[11px] font-semibold text-brand-text">{m.groupSender}</span>}
      {ai && (
        <span className="bubble-who mb-0.5 flex items-center gap-1 text-[11px] font-semibold leading-4 text-[var(--bubble-ai-who)]" title="Respuesta generada por IA">
          <Bot className="h-[11px] w-[11px]" strokeWidth={2} aria-hidden /> IA
        </span>
      )}
      {m.viaAiConnector && (
        // 047 — la IA conectada de una persona: su nombre («Joe») en azul,
        // para no confundirla con el agente interno. Solo la ve el equipo.
        <span
          className="bubble-who mb-0.5 flex max-w-[16rem] items-center gap-1 text-[11px] font-semibold leading-4 text-info-text"
          title={`Enviado por ${m.aiSenderName ?? DEFAULT_ASSISTANT_NAME}, la IA conectada de una persona del equipo. El cliente no ve esta marca.`}
        >
          <Sparkles className="h-[11px] w-[11px] shrink-0" strokeWidth={2} aria-hidden />
          <span className="truncate">{m.aiSenderName ?? DEFAULT_ASSISTANT_NAME}</span>
        </span>
      )}
      {m.media ? (
        <span className="block">
          <MediaBlock media={m.media} />
          {m.media.caption && (
            <span className="mt-1 block whitespace-pre-wrap break-words">
              {m.media.caption}
            </span>
          )}
        </span>
      ) : m.type === "text" || m.type === "template" ? (
        <span className="whitespace-pre-wrap break-words">{m.text}</span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-text-3">
          <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
          {mediaLabel(m.type)}
          {m.text ? ` — ${m.text}` : ""}
        </span>
      )}
      <span
        className={cn(
          "bubble-meta mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-[14px]",
          out ? (ai ? "text-[var(--bubble-ai-meta)]" : "text-[var(--bubble-out-meta)]") : "text-text-3"
        )}
      >
        {m.origin === "manual" && (
          <span className="inline-flex items-center gap-0.5" title="Enviado a mano desde la app de WhatsApp Business">
            <Smartphone className="h-3 w-3" strokeWidth={1.75} /> Celular ·
          </span>
        )}
        {/* La hora sale en la zona de quien mira: el servidor (UTC) la pinta
            distinta (Personalización la pinta en el servidor; auditoría UX
            2026-11, punto 20). */}
        <span className="bubble-time tabular-nums" suppressHydrationWarning>
          {bubbleTime(m.createdAt)}
        </span>
        {out && <StatusTicks status={m.status} />}
      </span>
      {out && m.status === "failed" && (
        // El triángulo solo decía "algo falló". El motivo lo manda
        // Meta y lo guardábamos sin enseñarlo nunca.
        <p className="mt-1.5 flex items-start gap-1.5 rounded-md border border-danger-soft bg-danger-tint px-2 py-1.5 text-[11.5px] leading-snug text-danger-text">
          <AlertTriangle
            className="mt-[1px] h-3.5 w-3.5 shrink-0"
            strokeWidth={1.8}
          />
          <span>
            <span className="font-semibold">No se entregó.</span>{" "}
            {m.error ?? "Meta no informó el motivo."}
          </span>
        </p>
      )}
    </div>
  );
}
