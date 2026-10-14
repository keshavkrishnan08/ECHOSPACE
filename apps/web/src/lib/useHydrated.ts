import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False during SSR and the hydration render, true afterwards. Use before reading browser-only APIs in render. */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
