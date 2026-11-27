"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { contactWhatsAppUrl } from "@/lib/plan-catalog";

const MESSAGE = "Hola, quiero un plan a la medida para mi empresa.";

/**
 * «¿Necesitas algo distinto? Escríbenos…» (auditoría UX 2026-11, 12). Con el
 * WhatsApp que el administrador dejó en Plataforma → Planes y precios, «Escríbenos
 * por WhatsApp» abre el chat con un mensaje listo; sin número, solo el texto.
 * `phone` sin pasar = lo pide a `/api/usage/plans` (solo el Propietario lo ve).
 */
export function ContactUs({ phone, className = "" }: { phone?: string | null; className?: string }) {
  const [fetched, setFetched] = useState<string | null>(null);
  useEffect(() => {
    if (phone !== undefined) return;
    let vivo = true;
    void fetchJson<{ contactWhatsapp?: string | null }>("/api/usage/plans").then((r) => {
      if (vivo && r.ok) setFetched(r.data.contactWhatsapp ?? null);
    });
    return () => {
      vivo = false;
    };
  }, [phone]);
  const number = phone === undefined ? fetched : phone;
  return (
    <span className={className} data-testid="usage-contact-us">
      ¿Necesitas algo distinto?{" "}
      {number ? (
        <a
          href={contactWhatsAppUrl(number, MESSAGE)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 font-medium text-brand-text underline-offset-2 hover:underline"
        >
          <MessageCircle className="h-3.5 w-3.5" aria-hidden />
          Escríbenos por WhatsApp
        </a>
      ) : (
        "Escríbenos"
      )}{" "}
      y armamos un plan a tu medida.
    </span>
  );
}
