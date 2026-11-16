import { AuthFault, type SecretStore } from "./model";
/** Web/test default. No insecure storage fallback for a future real credential. */
export function createDeviceSecretStore(): SecretStore {
  return {
    get: async () => {
      throw new AuthFault("unsupported");
    },
    set: async () => {
      throw new AuthFault("unsupported");
    },
    remove: async () => {
      throw new AuthFault("unsupported");
    },
  };
}
