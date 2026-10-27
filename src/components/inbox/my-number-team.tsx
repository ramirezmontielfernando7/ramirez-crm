"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, ChevronDown, Eye, Lock } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { ACCESS_TEXT, TEAM_TEXT } from "@/lib/mi-numero";
import { cn } from "@/lib/utils";
import { ContactAvatar } from "@/components/avatar";
import { formatTime, previewText } from "./helpers";

/**
 * Mi número (046), PR 7 — Lo que ve en la pestaña quien supervisa los números
 * del equipo (Propietario y Coordinador): los chats de los números de la
 * empresa, en solo lectura, y los chats de cliente de números personales que
 * su dueño deja pedir.
 */

export type TeamChat = {
  id: string;
  contactName: string;
  phone: string | null;
  preview: string | null;
  lastMessageAt: string | null;
  clientMarkedAt: string | null;
};
export type CompanyNumber = { numberId: string; ownerName: string; label: string | null; chats: TeamChat[] };
export type Requestable = {
  conversationId: string;
  ownerName: string;
  contactName: string;
  since: string;
  access: "none" | "pending" | "granted" | "rejected";
};
export type TeamNumbers = { companyNumbers: CompanyNumber[]; requestable: Requestable[] };

const day = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });

export function useTeamNumbers(enabled: boolean) {
  const [team, setTeam] = useState<TeamNumbers | null>(null);
  const reload = useCallback(async () => {
    if (!enabled) return;
    const res = await fetchJson<TeamNumbers>("/api/my-number/team");
    if (res.ok) setTeam(res.data);
  }, [enabled]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { team, reload };
}

/** El chat de un número de la empresa (con quién lo lleva), si está en la lista. */
export function findCompanyChat(team: TeamNumbers | null, id: string | null) {
  if (!team || !id) return null;
  for (const n of team.companyNumbers) {
    const chat = n.chats.find((c) => c.id === id);
    if (chat) return { chat, number: n };
  }
  return null;
}

export function CompanyNumbersSection({
  numbers,
  activeId,
  onSelect,
}: {
  numbers: CompanyNumber[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {numbers.map((n) => (
        <div key={n.numberId} data-testid="team-company-number">
          <p className="flex items-center gap-1.5 px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-text-3">
            <Building2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            <span className="truncate">{TEAM_TEXT.companyTitle(n.ownerName, n.label)}</span>
          </p>
          {n.chats.length === 0 && <p className="px-4 py-2 text-[12.5px] text-text-3">{TEAM_TEXT.companyEmpty}</p>}
          {n.chats.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              aria-current={activeId === c.id ? "true" : undefined}
              data-testid="team-company-chat"
              className={cn(
                "flex w-full items-center gap-3 border-b px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                activeId === c.id ? "bg-brand-tint" : "hover:bg-accent"
              )}
            >
              <ContactAvatar name={c.contactName} size="list" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13.5px] font-semibold">{c.contactName}</span>
                  <span className="shrink-0 text-[11px] text-text-3">{formatTime(c.lastMessageAt)}</span>
                </span>
                <span className="mt-0.5 flex items-center justify-between gap-2">
                  <span className="truncate text-[12.5px] text-text-2">{previewText(c.preview)}</span>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-text-3">
                    <Eye className="h-3 w-3" strokeWidth={2} aria-hidden />
                    {TEAM_TEXT.companyRow(n.ownerName)}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

/** Pedir ver un chat de cliente de un número personal (plegable: puede ser larga). */
export function RequestableSection({
  chats,
  onOpenShared,
  onChanged,
}: {
  chats: Requestable[];
  onOpenShared: (id: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (chats.length === 0) return null;

  async function ask(id: string) {
    setError(null);
    setBusy(id);
    const res = await fetchJson<null>(`/api/my-number/team/${id}/access`, { method: "POST" });
    setBusy(null);
    if (!res.ok) setError(res.error);
    onChanged();
  }

  return (
    <div data-testid="team-requestable">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-4 pb-1 pt-4 text-left text-[11px] font-semibold uppercase tracking-wide text-text-3 hover:text-foreground"
      >
        <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
        <span className="flex-1 truncate">
          {TEAM_TEXT.requestTitle} ({chats.length})
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <>
          <p className="px-4 pb-2 text-[12px] leading-snug text-text-3">{TEAM_TEXT.requestHelp}</p>
          {error && (
            <p role="alert" className="px-4 pb-2 text-[12px] text-danger-text">
              {error}
            </p>
          )}
          {chats.map((c) => (
            <div key={c.conversationId} className="flex items-center gap-3 border-b px-4 py-3" data-testid="team-requestable-chat">
              <ContactAvatar name={c.contactName} size="list" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold">{c.contactName}</span>
                <span className="block truncate text-[12px] text-text-3">{TEAM_TEXT.requestRow(c.ownerName, day.format(new Date(c.since)))}</span>
              </span>
              {c.access === "granted" ? (
                <button
                  type="button"
                  onClick={() => onOpenShared(c.conversationId)}
                  className="shrink-0 rounded-full bg-foreground px-3 py-1 text-[11.5px] font-semibold text-background"
                >
                  {ACCESS_TEXT.open}
                </button>
              ) : c.access === "pending" ? (
                <span className="shrink-0 text-[11.5px] text-text-3">{ACCESS_TEXT.asked}</span>
              ) : (
                <button
                  type="button"
                  disabled={busy === c.conversationId}
                  onClick={() => void ask(c.conversationId)}
                  className="shrink-0 rounded-full border px-3 py-1 text-[11.5px] font-semibold hover:bg-accent disabled:opacity-50"
                  data-testid="team-ask-access"
                >
                  {c.access === "rejected" ? `${ACCESS_TEXT.rejected} · ${ACCESS_TEXT.ask}` : ACCESS_TEXT.ask}
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
