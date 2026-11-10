import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
export interface StoragePort {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
// Web is a QA target only. Demo session metadata uses sessionStorage there; no credentials are stored.
export const sessionStorage: StoragePort = {
  async get(key) {
    return Platform.OS === "web"
      ? globalThis.sessionStorage.getItem(key)
      : SecureStore.getItemAsync(key);
  },
  async set(key, value) {
    if (Platform.OS === "web") globalThis.sessionStorage.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
  async remove(key) {
    if (Platform.OS === "web") globalThis.sessionStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  },
};
export const preferencesStorage: StoragePort = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
};
