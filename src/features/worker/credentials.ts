import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { WorkerIdentity } from '@/types';

/**
 * Where the worker keeps its device identity. On Android / iOS it is the
 * system keystore (expo-secure-store); the device token never goes to plain
 * storage, logs or the backend screens. Web has no secure storage: identities
 * live in memory only (mock demonstrations — a web page is never a worker).
 */
export interface CredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createMemoryStore(): CredentialStore {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
  };
}

export function createSecureStore(): CredentialStore {
  return {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
    remove: (key) => SecureStore.deleteItemAsync(key),
  };
}

export const defaultCredentialStore = (): CredentialStore => (Platform.OS === 'web' ? createMemoryStore() : createSecureStore());

const IDENTITY_KEY = 'megabot.worker.identity';
const INSTALLATION_KEY = 'megabot.worker.installation';

function isIdentity(value: unknown): value is WorkerIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return ['deviceId', 'deviceToken', 'deviceName', 'tenantId'].every((key) => typeof v[key] === 'string' && v[key] !== '');
}

export async function loadIdentity(store: CredentialStore): Promise<WorkerIdentity | null> {
  const raw = await store.get(IDENTITY_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isIdentity(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const saveIdentity = (store: CredentialStore, identity: WorkerIdentity) => store.set(IDENTITY_KEY, JSON.stringify(identity));

export const forgetIdentity = (store: CredentialStore) => store.remove(IDENTITY_KEY);

/**
 * Stable id of this installation, sent at pairing (device_identifier). It is
 * not a secret and not an identity — the token is — so a random id is enough.
 */
export async function installationId(store: CredentialStore): Promise<string> {
  const existing = await store.get(INSTALLATION_KEY);
  if (existing && /^[A-Za-z0-9._:-]{4,128}$/.test(existing)) return existing;
  const random = Array.from({ length: 24 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('');
  const id = `inst-${Date.now().toString(36)}-${random}`;
  await store.set(INSTALLATION_KEY, id);
  return id;
}
