import { useMutation, useQuery } from '@/lib/query';
import { api } from '@/services';
import type { ID } from '@/types';

import { queryKeys } from './queryKeys';

// ─── Products ────────────────────────────────────────────────────────────────

export function useProducts() {
  return useQuery(queryKeys.products.list(), () => api.products.list());
}

export function useProduct(id: ID) {
  return useQuery(queryKeys.products.detail(id), () => api.products.get(id));
}

export function useSetProductActive() {
  return useMutation(({ id, active }: { id: ID; active: boolean }) => api.products.setActive(id, active), {
    invalidate: [queryKeys.products.all],
  });
}

// ─── Devices ─────────────────────────────────────────────────────────────────

export function useDevices() {
  return useQuery(queryKeys.devices.list(), () => api.devices.list());
}

export function useDevicesSummary() {
  return useQuery(queryKeys.devices.summary(), () => api.devices.summary());
}

export function useDevice(id: ID) {
  return useQuery(queryKeys.devices.detail(id), () => api.devices.get(id));
}

export function useSetDevicePaused() {
  return useMutation(({ id, paused }: { id: ID; paused: boolean }) => api.devices.setPaused(id, paused), {
    invalidate: [queryKeys.devices.all, queryKeys.dashboard.all],
  });
}

export function useTestUssd() {
  return useMutation((id: ID) => api.devices.testUssd(id));
}

// ─── SIMs ────────────────────────────────────────────────────────────────────

export function useSims(deviceId?: ID) {
  return useQuery(queryKeys.sims.list(deviceId), () => api.sims.list({ deviceId }));
}

export function useSim(id: ID) {
  return useQuery(queryKeys.sims.detail(id), () => api.sims.get(id));
}

export function useSetSimPaused() {
  return useMutation(({ id, paused }: { id: ID; paused: boolean }) => api.sims.setPaused(id, paused), {
    invalidate: [queryKeys.sims.all, queryKeys.devices.all],
  });
}
