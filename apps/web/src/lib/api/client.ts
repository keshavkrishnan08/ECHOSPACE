"use client";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "../store/settings";

export interface ApiHealth {
  status: string;
  version: string;
  capabilities: Record<string, boolean | string>;
  database: string;
  objectStore: string;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = useSettings.getState().apiBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: init?.signal ?? AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return (await res.json()) as T;
}

/** Health of the optional Python control plane. The UI works without it (browser engine + local storage). */
export function useApiHealth() {
  const base = useSettings((s) => s.apiBaseUrl);
  return useQuery({
    queryKey: ["api-health", base],
    queryFn: () => apiFetch<ApiHealth>("/api/health", { signal: AbortSignal.timeout(2500) }),
    retry: false,
    refetchInterval: 15000,
    staleTime: 10000,
  });
}
