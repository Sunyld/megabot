import { useSimulation } from '@/services/mock';

/**
 * Network reachability. Backed by the simulation switch in this phase;
 * swap for `@react-native-community/netinfo` when real networking lands.
 */
export function useConnectivity() {
  const { offline } = useSimulation();
  return { isOnline: !offline };
}
