import { useSyncExternalStore } from 'react';

/**
 * Minimal external store (usable from React and from plain modules such as
 * services). Keeps global client state out of component trees.
 */
export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();

  const get = () => state;

  const set = (next: T | ((prev: T) => T)) => {
    state = typeof next === 'function' ? (next as (prev: T) => T)(state) : next;
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  function useStore(): T {
    return useSyncExternalStore(subscribe, get, get);
  }

  return { get, set, subscribe, useStore };
}
