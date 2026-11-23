import type { PushPort } from "../integration/remote-push";

export const pushPort: PushPort = {
  available: false,
  permission: async () => false,
  token: async () => {
    throw new Error("Push Android no disponible.");
  },
  onToken: () => () => {},
  onTap: () => () => {},
  resetTaps: async () => {},
};
