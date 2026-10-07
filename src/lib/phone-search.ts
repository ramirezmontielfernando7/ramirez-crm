/**
 * «Número no registrado» en la búsqueda de la Bandeja: ¿lo tecleado parece un
 * teléfono? y, si sí, a qué número de WhatsApp equivale. Puro (sin servidor):
 * lo usan la tarjeta del navegador y las rutas, para que ambos lados
 * normalicen IGUAL.
 */

import { normalizeMx } from "@/lib/meta/mx";

/** Lada que se asume cuando el número viene sin código de país (México). */
export const DEFAULT_COUNTRY_CODE = "52";

/** Mínimo de dígitos para tratar la búsqueda como un teléfono completo. */
export const MIN_PHONE_DIGITS = 7;

/** Solo dígitos y los adornos con que la gente escribe un teléfono. */
const PHONE_SHAPE = /^[\d\s\-().+]+$/;

/**
 * «Parece teléfono»: al menos 7 dígitos, ignorando espacios, guiones,
 * paréntesis y «+». Si hay letras ("Juan 5512345") NO lo es: es un nombre.
 */
export function looksLikePhone(query: string): boolean {
  const q = query.trim();
  if (!q || !PHONE_SHAPE.test(q)) return false;
  return q.replace(/\D/g, "").length >= MIN_PHONE_DIGITS;
}

export type TypedPhone = {
  /** Identidad de WhatsApp (521→52 ya aplicado), solo dígitos. */
  phone: string;
  /** ¿Es un número que se puede registrar? */
  valid: boolean;
  /** Por qué no, en español sencillo. */
  problem: string | null;
};

/**
 * Del texto tecleado al número que usa el proyecto.
 *
 * - Con «+» o «00» al inicio, el país ya viene escrito y se respeta.
 * - Con 10 dígitos se asume México (+52).
 * - Los de México con y sin el «1» (521…/52…) quedan en la forma de 12
 *   dígitos con `normalizeMx`, la MISMA función de la ingesta: así no se
 *   parten en dos fichas.
 */
export function normalizeTypedPhone(input: string): TypedPhone {
  const raw = input.trim();
  let digits = raw.replace(/\D/g, "");
  const explicitCountry = raw.startsWith("+") || digits.startsWith("00");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!explicitCountry && digits.length === 10) {
    digits = DEFAULT_COUNTRY_CODE + digits;
  }
  const phone = normalizeMx(digits);

  if (phone.length < MIN_PHONE_DIGITS) {
    return { phone, valid: false, problem: "El número es muy corto" };
  }
  if (phone.length > 15) {
    return { phone, valid: false, problem: "El número es muy largo" };
  }
  if (phone.startsWith(DEFAULT_COUNTRY_CODE) && phone.length !== 12) {
    return {
      phone,
      valid: false,
      problem: "Un número de México lleva 10 dígitos después del +52",
    };
  }
  if (!phone.startsWith(DEFAULT_COUNTRY_CODE) && phone.length < 10) {
    return {
      phone,
      valid: false,
      problem: "Falta la lada: escribe el número completo (10 dígitos para México)",
    };
  }
  return { phone, valid: true, problem: null };
}

/** El número como se lee en pantalla: «+52 55 1234 5678» para México. */
export function prettyPhone(phone: string): string {
  if (phone.startsWith(DEFAULT_COUNTRY_CODE) && phone.length === 12) {
    const n = phone.slice(2);
    return `+52 ${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}`;
  }
  return `+${phone}`;
}

/**
 * Nombre para mostrar: el del contacto o, si está vacío, su teléfono. Nunca
 * queda en blanco ni dice «undefined» (un contacto puede registrarse sin
 * nombre).
 */
export function contactLabel(contact: {
  name?: string | null;
  phone?: string | null;
}): string {
  const name = contact.name?.trim();
  // Un contacto sin nombre guarda su teléfono como nombre (dígitos a secas).
  if (name) return /^\d{7,15}$/.test(name) ? `+${name}` : name;
  return contact.phone ? `+${contact.phone}` : "Sin nombre";
}
