"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";

/**
 * El visor de una foto del chat: se abre encima de la Bandeja, en la misma
 * pestaña (antes abría una pestaña nueva). Se cierra con Esc, con la X o
 * tocando fuera de la foto.
 */
export function ImageLightbox({
  src,
  alt,
  fileName,
  onClose,
}: {
  src: string;
  alt: string;
  fileName?: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Que la página de atrás no se desplace mientras se ve la foto.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const btn =
    "flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ver foto"
      data-testid="image-lightbox"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4 md:p-10"
      onClick={onClose}
    >
      <div className="absolute right-3 top-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <a href={src} download={fileName ?? true} aria-label="Descargar" title="Descargar" className={btn}>
          <Download className="h-4 w-4" strokeWidth={2} />
        </a>
        <button type="button" autoFocus onClick={onClose} aria-label="Cerrar" title="Cerrar (Esc)" className={btn}>
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-md object-contain shadow-pop"
      />
    </div>,
    document.body
  );
}
