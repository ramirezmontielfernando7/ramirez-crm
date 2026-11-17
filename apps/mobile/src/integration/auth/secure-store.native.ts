import * as SecureStore from "expo-secure-store";
import { AuthFault, decodeSession, type SecretStore } from "./model";
import { decodeRevocations } from "./vault";
/** Fixture-only credentials, logout barrier and retry journal. Not mounted in demo. */
export function createDeviceSecretStore(): SecretStore {
  const check = (key: string) => {
    if (
      !/^dashfort\.i2p\.fixture\.fixture-[\w-]{1,80}(?:\.(?:barrier|revocations))?$/.test(
        key,
      )
    )
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
      try {
        if (key.endsWith(".barrier")) {
          if (value !== "blocked-v1") throw new AuthFault("invalid");
        } else if (key.endsWith(".revocations")) decodeRevocations(value);
        else decodeSession(JSON.parse(value), Date.now());
      } catch {
        throw new AuthFault("invalid");
      }
      if (value.length > 128000) throw new AuthFault("invalid");
      await SecureStore.setItemAsync(key, value, options);
    },
    remove: async (key) => {
      check(key);
      await SecureStore.deleteItemAsync(key, options);
    },
  };
}
