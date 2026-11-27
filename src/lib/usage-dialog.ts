/**
 * «Uso y plan» como ventana (maqueta del 5 nov 2026): un estado mínimo y
 * global para abrirla desde el menú, un aviso o la dirección vieja
 * (`/settings/uso` → `/inbox?uso=1`). Sin dependencias: `useSyncExternalStore`.
 */
type UsageDialogView = "uso" | "planes";

let state: { open: boolean; view: UsageDialogView } = { open: false, view: "uso" };
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export function openUsageDialog(view: UsageDialogView = "uso"): void {
  state = { open: true, view };
  emit();
}

export function closeUsageDialog(): void {
  if (!state.open) return;
  state = { ...state, open: false };
  emit();
}

export function setUsageDialogView(view: UsageDialogView): void {
  state = { ...state, view };
  emit();
}

export function subscribeUsageDialog(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export const getUsageDialogState = () => state;
