import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Grafemas de un texto: un emoji o una letra con acento cuentan como UNO. */
function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

const LETTER_OR_DIGIT = /^[\p{L}\p{N}]/u;

/** Primera letra o número de una palabra (salta símbolos y emojis del inicio). */
function firstUsable(word: string): string {
  return graphemes(word).find((g) => LETTER_OR_DIGIT.test(g)) ?? "";
}

/**
 * Iniciales (máx 2) para el avatar de un contacto, SOLO con letras o números.
 * Corta por grafemas (nunca a la mitad de un emoji) y salta emojis y símbolos:
 * «😀 Marta Ruiz» → «MR», «Fer 🔥» → «F», «👍» o «###» → «» (sin iniciales).
 */
export function contactInitials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map(firstUsable)
    .filter(Boolean);
  if (letters.length === 0) return "";
  const first = letters[0] ?? "";
  const last = letters.length > 1 ? (letters[letters.length - 1] ?? "") : "";
  return (first + last).toLocaleUpperCase();
}

/** Iniciales con «?» de respaldo, para los lugares que siempre pintan algo. */
export function initials(name: string): string {
  return contactInitials(name) || "?";
}

export function formatPhone(phone: string | null | undefined): string {
  // 003: contactos BSUID pueden no tener teléfono.
  return phone ? `+${phone}` : "Sin teléfono";
}
