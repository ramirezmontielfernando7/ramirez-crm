import type { LocalPort } from "./local";
// Web deliberately cannot emit system notifications or request browser permission.
export const localPort: LocalPort = {
  permission: async () => "unsupported",
  schedule: async () => {
    throw Error("Avisos locales disponibles solo en la APK Android.");
  },
  cancel: async () => {},
};
export async function observeLocalResponses(
  _tap: (id: unknown) => Promise<unknown>,
) {
  return () => {};
}
