"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { campaignBlockers } from "@/lib/onboarding";
import { useOnboarding } from "./use-onboarding";

/**
 * Auditoría UX 2026-11 (paquete A, maqueta A3) — antes de la primera campaña,
 * lo que falta dicho en una línea con su botón, en vez de descubrirlo a mitad
 * del asistente.
 */
export function CampaignBlockersBanner() {
  const { state } = useOnboarding();
  if (!state) return null;
  const blockers = campaignBlockers(state);
  if (blockers.length === 0) return null;
  const items = blockers.map((b, i) =>
    b === "whatsapp" ? `${i + 1}) conectar tu WhatsApp` : `${i + 1}) una plantilla aprobada por Meta`,
  );
  const first = blockers[0];
  const href = first === "whatsapp" ? "/settings/whatsapp" : "/campaigns/templates";
  const cta = first === "whatsapp" ? "Conectar WhatsApp" : "Crear plantilla";
  const canAct = first === "template" || state.canManage;
  return (
    <div
      role="status"
      data-campaign-blockers
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-warning-tint px-4 py-3 text-[13.5px] text-warning-text"
    >
      <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0 flex-1">
        <strong className="font-semibold">
          Antes de tu primera campaña te {blockers.length === 1 ? "falta 1 cosa" : `faltan ${blockers.length} cosas`}:
        </strong>{" "}
        {items.join(" · ")}
      </span>
      {canAct && (
        <Link
          href={href}
          className="inline-flex h-8 shrink-0 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:opacity-90"
        >
          {cta}
        </Link>
      )}
    </div>
  );
}
