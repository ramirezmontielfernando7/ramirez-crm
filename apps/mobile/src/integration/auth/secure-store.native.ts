import * as SecureStore from "expo-secure-store";
import { AuthFault, type SecretStore } from "./model";
/** Not instantiated or imported by existing providers. Stores ONLY I2-P fixture envelopes. */
export function createDeviceSecretStore(): SecretStore {
  const check = (key: string) => {
    if (!/^dashfort\.i2p\.fixture\.fixture-[\w-]{1,80}$/.test(key))
      throw new AuthFault("blocked");
  };
  const options = {
    keychainService: "dashfort.i2p.fixture",
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  return {
    get: async (key) => {
      check(key);
      return SecureStore.getItemAsync(key, options);
    },
    set: async (key, value) => {
      check(key);
      let v;
      try {
        v = JSON.parse(value);
      } catch {
        throw new AuthFault("invalid");
      }
      if (
        v.environment !== "i2p-memory" ||
        typeof v.credential !== "string" ||
        !/^fixture-cookie-[\w-]+$/.test(v.credential)
      )
        throw new AuthFault("blocked");
      await SecureStore.setItemAsync(key, value, options);
    },
    remove: async (key) => {
      check(key);
      await SecureStore.deleteItemAsync(key, options);
    },
  };
}
