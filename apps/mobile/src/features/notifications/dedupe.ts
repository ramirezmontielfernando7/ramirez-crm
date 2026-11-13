export const MAX_LEDGER = 2048,
  MAX_GROUPS = 128;
export function remember(
  items: readonly string[],
  key: string,
): readonly string[] {
  return [...items.filter((x) => x !== key), key].slice(-MAX_LEDGER);
}
