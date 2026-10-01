import { createStore } from '@/lib/store';

/**
 * Runtime switches that let the prototype demonstrate every UI state
 * (loading, error, empty, offline) on demand, from Settings → Simulação.
 */
export type SimulationSettings = {
  latency: 'instant' | 'realistic' | 'slow';
  failRequests: boolean;
  offline: boolean;
  emptyData: boolean;
};

export const simulationStore = createStore<SimulationSettings>({
  latency: 'realistic',
  failRequests: false,
  offline: false,
  emptyData: false,
});

export const useSimulation = simulationStore.useStore;

export function setSimulation(patch: Partial<SimulationSettings>) {
  simulationStore.set((prev) => ({ ...prev, ...patch }));
}
