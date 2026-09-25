/**
 * La marca de la casa: Dashfort by Demfort.
 *
 * Vive aquí, sin React, porque la usan dos mundos: los componentes (el logo
 * del panel lateral y del login) y el servidor (el favicon generado que se
 * sirve como texto). Tener el dibujo en un solo sitio es lo que garantiza que
 * la pestaña y la barra lateral enseñen la MISMA burbuja.
 *
 * El logo es una burbuja de chat blanca, de trazo redondeado, sobre un
 * mosaico teal. El teal del mosaico es constante de marca (el del logo
 * original) y NO se recalcula con el acento: es lo que la hace reconocible.
 */

/** El nombre del producto y su firma (la firma va chica y tenue). */
export const BRAND_NAME = "Dashfort";
export const BRAND_BYLINE = "by Demfort";

/** La burbuja, en una rejilla de 24 (trazo redondeado, cola abajo a la izquierda). */
export const BRAND_BUBBLE =
  "M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719";

export const BRAND_BUBBLE_STROKE = 2;

/** El teal del logo, tal cual (muestreado del archivo original). */
export const BRAND_TEAL = "#12999d";
/** Un punto más claro, para el brillo del mosaico. */
export const BRAND_TEAL_LIGHT = "#1fa8ab";

/**
 * ¿Esta instancia se llama como la marca de la casa? Solo entonces se dibuja
 * el logo: una agencia que rebautizó el CRM para su cliente no debe ver la
 * burbuja de otro producto en su barra lateral ni en su pestaña. El nombre por
 * defecto es "Dashfort", así que una instancia sin configurar la ve de inmediato.
 */
export function isHouseName(name: string): boolean {
  return name.trim().toLowerCase() === BRAND_NAME.toLowerCase();
}
