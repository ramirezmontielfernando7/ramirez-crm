"use client";

import { useCallback, useEffect, useState } from "react";
import type { OnboardingState } from "@/lib/onboarding";

/**
 * Auditoría UX 2026-11 (paquete A) — el estado de «Primeros pasos» y de la
 * conexión de WhatsApp. Varias piezas de la Bandeja lo leen a la vez (la guía,
 * la lista vacía, el aviso sobre el chat): una sola petición compartida, y
 * `refresh()` la vuelve a pedir para todas.
 */
let shared: Promise<OnboardingState | null> | null = null;
const listeners = new Set<(s: OnboardingState | null) => void>();

function load(force = false): Promise<OnboardingState | null> {
  if (!shared || force) {
    shared = fetch("/api/onboarding", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<OnboardingState>) : null))
      .catch(() => null);
    void shared.then((s) => listeners.forEach((l) => l(s)));
  }
  return shared;
}

export function refreshOnboarding(): void {
  void load(true);
}

export function useOnboarding(): {
  state: OnboardingState | null;
  refresh: () => void;
  hide: () => Promise<void>;
} {
  const [state, setState] = useState<OnboardingState | null>(null);

  useEffect(() => {
    let alive = true;
    const l = (s: OnboardingState | null) => {
      if (alive) setState(s);
    };
    listeners.add(l);
    void load().then(l);
    return () => {
      alive = false;
      listeners.delete(l);
    };
  }, []);

  const hide = useCallback(async () => {
    setState((s) => (s ? { ...s, hidden: true } : s));
    await fetch("/api/onboarding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hidden: true }),
    }).catch(() => null);
    refreshOnboarding();
  }, []);

  return { state, refresh: refreshOnboarding, hide };
}
