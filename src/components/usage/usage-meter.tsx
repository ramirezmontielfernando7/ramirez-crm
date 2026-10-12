"use client";

import { cn } from "@/lib/utils";
import type { Meter, MeterTone } from "@/lib/usage";

/**
 * 036 — Un medidor fino: el texto («1.2 M / 5 M tokens») y una barra que se
 * pone ámbar desde 80 % y roja al 100 %. Lo usan Plataforma → Organizaciones
 * (PR 4) y «Uso y plan» del Propietario (PR 6).
 */

const FILL: Record<MeterTone, string> = {
  normal: "bg-brand",
  warning: "bg-warning",
  danger: "bg-destructive",
};

export function UsageMeter({
  meter,
  label,
  testId,
  showLabel = "mobile",
}: {
  meter: Meter;
  label: string;
  testId?: string;
  /** La etiqueta visible: solo en el celular (la lista tiene encabezados) o nunca. */
  showLabel?: "mobile" | "never";
}) {
  const pct = meter.ratio === null ? null : Math.min(100, Math.round(meter.ratio * 100));
  return (
    <div className="min-w-0" title={meter.detail} data-testid={testId} data-tone={meter.tone}>
      {showLabel === "mobile" && <span className="block text-[11px] text-text-3 sm:hidden">{label}</span>}
      <span
        className={cn(
          "block truncate text-xs tabular-nums",
          meter.tone === "danger" ? "text-danger-text" : meter.tone === "warning" ? "text-warning-text" : "text-text-2"
        )}
      >
        {meter.text}
      </span>
      {pct !== null && (
        <div
          className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className={cn("h-full rounded-full", FILL[meter.tone])} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

