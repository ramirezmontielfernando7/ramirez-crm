"use client";

import { useEffect, useState } from "react";

/** Un número oficial de la empresa, tal como lo ve la Bandeja (sin secretos). */
export type WhatsAppNumber = {
  id: string;
  label: string | null;
  phone: string | null;
  name: string | null;
  isPrimary: boolean;
  /** Clave de color de la etiqueta (`TAG_COLORS`). */
  color: string;
};

/** Cómo se llama un número en pantalla: su nombre, o el teléfono si no tiene. */
export function numberTitle(n: Pick<WhatsAppNumber, "label" | "phone" | "name" | "id">): string {
  return n.label || n.phone || n.name || n.id;
}

let cache: WhatsAppNumber[] | null = null;
let inflight: Promise<WhatsAppNumber[]> | null = null;

function load(): Promise<WhatsAppNumber[]> {
  inflight ??= fetch("/api/whatsapp-numbers")
    .then((r) => (r.ok ? (r.json() as Promise<{ numbers: WhatsAppNumber[] }>) : { numbers: [] }))
    .then((d) => (cache = d.numbers))
    .catch(() => (cache = []))
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * 0080 — Los números oficiales de la empresa para etiquetar y filtrar los
 * chats. Con menos de dos números devuelve `[]`: no hay nada que distinguir y
 * la Bandeja queda exactamente como antes.
 */
export function useWhatsAppNumbers(): WhatsAppNumber[] {
  const [numbers, setNumbers] = useState<WhatsAppNumber[]>(cache ?? []);
  useEffect(() => {
    let alive = true;
    void load().then((n) => {
      if (alive) setNumbers(n);
    });
    return () => {
      alive = false;
    };
  }, []);
  return numbers.length > 1 ? numbers : [];
}

/** La etiqueta del número de un chat, o null si no aplica (un solo número o sin dato). */
export function numberLabelFor(numbers: readonly WhatsAppNumber[], id: string | null | undefined): string | null {
  if (!id || numbers.length < 2) return null;
  const n = numbers.find((x) => x.id === id);
  return n ? numberTitle(n) : null;
}

/** El color de la etiqueta del número de un chat (clave de `TAG_COLORS`). */
export function numberColorFor(numbers: readonly WhatsAppNumber[], id: string | null | undefined): string | null {
  if (!id || numbers.length < 2) return null;
  return numbers.find((x) => x.id === id)?.color ?? null;
}
