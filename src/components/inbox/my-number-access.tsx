"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, ShieldCheck, Users } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { ACCESS_TEXT } from "@/lib/mi-numero";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";

/**
 * Mi número (046), PR 6 — Las piezas de privacidad de la pestaña «Mi número»:
 * «También habla con…» (solo nombre y fecha), la solicitud que llega para ver
 * un chat mío (el dueño acepta o rechaza) y lo que me compartieron.
 */

export type Overlap = {
  conversationId: string;
  userName: string;
  since: string;
  canRequest: boolean;
  access: "none" | "pending" | "granted" | "rejected";
};
export type IncomingRequest = {
  id: string;
  requesterName: string;
  /** PR 7: «Coordinador» o «Propietario» cuando pide quien supervisa los números. */
  requesterRole: string | null;
  contactName: string;
  conversationId: string;
  requestedAt: string;
};
export type SharedChat = { conversationId: string; ownerName: string; contactName: string };
export type AccessOverview = {
  incoming: IncomingRequest[];
  granted: { id: string; userName: string; contactName: string; conversationId: string; since: string }[];
  views: { userName: string; contactName: string; viewedAt: string }[];
  sharedWithMe: SharedChat[];
};

const day = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });

/** Lo que pasa con el acceso a mis chats y lo que me compartieron (se vuelve a pedir con `reload`). */
export function useAccessOverview() {
  const [overview, setOverview] = useState<AccessOverview | null>(null);
  const reload = useCallback(async () => {
    const res = await fetchJson<AccessOverview>("/api/my-number/access");
    if (res.ok) setOverview(res.data);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { overview, reload };
}

/** Las cápsulas «También habla con…» del encabezado de un chat mío marcado como cliente. */
export function OverlapPills({
  conversationId,
  version,
  onOpenShared,
}: {
  conversationId: string;
  /** Cambia cuando algo pudo cambiar (eventos): se vuelve a pedir. */
  version: number;
  onOpenShared: (conversationId: string) => void;
}) {
  const [overlaps, setOverlaps] = useState<Overlap[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchJson<{ overlaps: Overlap[] }>(`/api/my-number/chats/${conversationId}/overlaps`);
    if (res.ok) setOverlaps(res.data.overlaps);
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load, version]);

  async function ask(target: string) {
    setError(null);
    const res = await fetchJson<null>("/api/my-number/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: conversationId, target }),
    });
    if (!res.ok) setError(res.error);
    await load();
  }

  if (overlaps.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-4 py-2" data-testid="my-number-overlaps">
      {overlaps.map((o) => (
        <span
          key={o.conversationId}
          className="flex items-center gap-2 rounded-full bg-foreground py-1 pl-3 pr-1 text-[12px] text-background"
          data-testid="my-number-overlap"
        >
          <Users className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <span>{ACCESS_TEXT.alsoTalks(o.userName, day.format(new Date(o.since)))}</span>
          {o.access === "granted" ? (
            <button
              type="button"
              onClick={() => onOpenShared(o.conversationId)}
              className="rounded-full bg-background px-2.5 py-1 text-[11.5px] font-semibold text-foreground"
            >
              {ACCESS_TEXT.open}
            </button>
          ) : o.access === "pending" ? (
            <span className="rounded-full px-2.5 py-1 text-[11.5px] opacity-80">{ACCESS_TEXT.asked}</span>
          ) : o.canRequest ? (
            <button
              type="button"
              onClick={() => void ask(o.conversationId)}
              className="rounded-full bg-background px-2.5 py-1 text-[11.5px] font-semibold text-foreground"
              data-testid="my-number-ask-access"
            >
              {ACCESS_TEXT.ask}
            </button>
          ) : (
            <span className="pr-2" />
          )}
        </span>
      ))}
      {error && (
        <span role="alert" className="text-[12px] text-danger-text">
          {error}
        </span>
      )}
    </div>
  );
}

/** Aviso en la lista: alguien pidió ver un chat mío. */
export function PendingRequestsBanner({ requests, onReview }: { requests: IncomingRequest[]; onReview: () => void }) {
  if (requests.length === 0) return null;
  return (
    <div className="flex items-center gap-2 border-b bg-brand-tint px-4 py-2 text-[12.5px] text-brand-text" data-testid="my-number-requests">
      <Eye className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
      <span className="flex-1">{ACCESS_TEXT.pendingBanner(requests.length)}</span>
      <button type="button" onClick={onReview} className="font-semibold underline-offset-2 hover:underline">
        {ACCESS_TEXT.review}
      </button>
    </div>
  );
}

/** La solicitud, una a la vez: el dueño acepta (solo lectura) o rechaza. */
export function AccessRequestDialog({ request, onDone }: { request: IncomingRequest; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(action: "accept" | "reject") {
    setBusy(true);
    const res = await fetchJson<null>(`/api/my-number/access/${request.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onDone();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDone();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onDone}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[560px] space-y-4 rounded-[18px] border bg-card p-6 shadow-panel"
        data-testid="my-number-request-dialog"
      >
        <div className="flex items-center gap-3">
          <ContactAvatar name={request.requesterName} size="md" />
          <h2 id="access-title" className="text-[17px] font-semibold leading-snug">
            {ACCESS_TEXT.requestTitle(request.requesterName, request.contactName)}
          </h2>
        </div>
        <p className="text-[14px] leading-relaxed text-text-2">{ACCESS_TEXT.requestBody(request.requesterName, request.requesterRole)}</p>
        <ul className="space-y-1.5 rounded-xl bg-secondary px-4 py-3 text-[13.5px] leading-snug">
          {ACCESS_TEXT.requestRules.map((r) => (
            <li key={r} className="flex gap-2">
              <ShieldCheck className="mt-[2px] h-3.5 w-3.5 shrink-0 text-brand" strokeWidth={2} aria-hidden />
              {r}
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="text-[12.5px] text-danger-text">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void decide("reject")}>
            {ACCESS_TEXT.reject}
          </Button>
          <Button disabled={busy} onClick={() => void decide("accept")} data-testid="my-number-accept-access">
            {ACCESS_TEXT.accept}
          </Button>
        </div>
        <p className="text-[12px] text-text-3">{ACCESS_TEXT.requestFoot}</p>
      </div>
    </div>
  );
}

/** Los chats que otros me dejaron leer, al final de la lista. */
export function SharedChatsSection({
  chats,
  activeId,
  onSelect,
}: {
  chats: SharedChat[];
  activeId: string | null;
  onSelect: (conversationId: string) => void;
}) {
  if (chats.length === 0) return null;
  return (
    <div>
      <p className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-text-3">{ACCESS_TEXT.sharedTitle}</p>
      {chats.map((c) => (
        <button
          key={c.conversationId}
          type="button"
          onClick={() => onSelect(c.conversationId)}
          className={cn(
            "flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors",
            activeId === c.conversationId ? "bg-brand-tint" : "hover:bg-accent"
          )}
          data-testid="my-number-shared-chat"
        >
          <ContactAvatar name={c.contactName} size="list" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold">{c.contactName}</span>
            <span className="flex items-center gap-1 truncate text-[12px] text-text-3">
              <Eye className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
              {ACCESS_TEXT.sharedRow(c.ownerName)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
