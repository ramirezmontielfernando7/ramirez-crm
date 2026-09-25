import { CAMPAIGN_STATUS_LABEL, type CampaignStatus } from "@/lib/campaigns";
import { Badge } from "@/components/ui/badge";

const VARIANT: Record<CampaignStatus, "secondary" | "warning" | "success" | "destructive"> = {
  draft: "secondary",
  sending: "warning",
  completed: "success",
  failed: "destructive",
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <Badge variant={VARIANT[status]}>{CAMPAIGN_STATUS_LABEL[status]}</Badge>;
}

/** Barra de progreso: enviados (acento) + fallidos (rojo) sobre el total. */
export function CampaignProgress({
  total,
  sent,
  failed,
}: {
  total: number;
  sent: number;
  failed: number;
}) {
  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : "0%");
  return (
    <div
      className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={sent + failed}
      aria-label="Avance de la campaña"
    >
      <div className="h-full bg-brand" style={{ width: pct(sent) }} />
      <div className="h-full bg-destructive" style={{ width: pct(failed) }} />
    </div>
  );
}
