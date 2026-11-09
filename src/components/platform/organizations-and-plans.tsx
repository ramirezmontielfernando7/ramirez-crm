"use client";

import { useState } from "react";
import { OrganizationsClient } from "./organizations-client";
import { PlanCatalogCard } from "./plan-catalog-client";
import { cn } from "@/lib/utils";

/** Organizaciones y planes: dos sub-pestañas (maqueta 38/41), «Organizaciones» con su conteo. */
export function OrganizationsAndPlans() {
  const [view, setView] = useState<"orgs" | "plans">("orgs");
  const [count, setCount] = useState<number | null>(null);
  const tab = (id: "orgs" | "plans", label: string, extra?: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={view === id}
      onClick={() => setView(id)}
      data-testid={`platform-subtab-${id}`}
      className={cn("inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium", view === id ? "bg-card text-foreground shadow-sm" : "text-text-2 hover:text-foreground")}
    >
      {label}
      {extra}
    </button>
  );
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Organizaciones y planes" className="inline-flex gap-1 rounded-lg bg-muted p-1">
        {tab("orgs", "Organizaciones", count !== null && <span className="rounded-full bg-brand px-1.5 text-[11px] leading-4 text-white">{count}</span>)}
        {tab("plans", "Planes y precios")}
      </div>
      <div hidden={view !== "orgs"}>
        <OrganizationsClient onCount={setCount} />
      </div>
      {view === "plans" && <PlanCatalogCard />}
    </div>
  );
}
