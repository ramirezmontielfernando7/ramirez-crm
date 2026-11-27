/** El recorrido guiado: estado mínimo y global (mismo patrón que «Uso y plan»). */
let state = { open: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function openTour(): void {
  state = { open: true };
  emit();
}
export function closeTour(): void {
  if (!state.open) return;
  state = { open: false };
  emit();
}
export function subscribeTour(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getTourState = () => state;
