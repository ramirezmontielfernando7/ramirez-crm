"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { History, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { actionLabel, DEFAULT_ASSISTANT_NAME, HIGHLIGHT_ACTIONS, OUTCOME_LABEL } from "@/lib/ai-connector";
import { fetchJson } from "@/lib/fetch-json";

type Action = {
  id: string;
  at: string;
  tool: string;
  outcome: "ok" | "denied" | "limited" | "error";
  summary: string | null;
  person: string | null;
  assistantName: string | null;
  connectionName: string | null;
  contactId: string | null;
  contactName: string | null;
};
type Page = { actions: Action[]; nextBefore: string | null };

const fmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

/**
 * 047 PR 5 — «Qué hizo tu IA»: cada herramienta que usó una IA conectada,
 * sin el texto de los mensajes. `team` muestra además quién era la persona.
 */
export function ActionsLog({ url, title, description, team = false }: { url: string; title: string; description: string; team?: boolean }) {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (before: string | null) => {
      setBusy(true);
      const res = await fetchJson<Page>(before ? `${url}?before=${encodeURIComponent(before)}` : url);
      setBusy(false);
      if (!res.ok) return setError(res.error);
      setError(null);
      setActions((prev) => (before && prev ? [...prev, ...res.data.actions] : res.data.actions));
      setNextBefore(res.data.nextBefore);
    },
    [url]
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4 text-brand-text" aria-hidden />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {actions === null ? (
          <p className="text-sm text-muted-foreground">{error ?? "Cargando…"}</p>
        ) : actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay nada que mostrar.</p>
        ) : (
          <>
            <ul className="divide-y" data-testid="ai-actions">
              {actions.map((a) => {
                const problem = OUTCOME_LABEL[a.outcome];
                const highlight = a.outcome === "ok" ? HIGHLIGHT_ACTIONS[a.tool] : undefined;
                return (
                  <li key={a.id} className="flex items-start justify-between gap-4 py-2.5">
                    <div className="min-w-0 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-x-1.5 text-sm">
                        <span className="font-medium">{actionLabel(a.tool)}</span>
                        {a.contactName &&
                          (a.contactId ? (
                            <Link href={`/inbox?contact=${encodeURIComponent(a.contactId)}`} className="text-brand-text hover:underline">
                              · {a.contactName}
                            </Link>
                          ) : (
                            <span className="text-text-2">· {a.contactName}</span>
                          ))}
                        {highlight && (
                          <Badge variant="warning" className="px-2 py-0 text-[11px]">
                            {highlight}
                          </Badge>
                        )}
                        {problem && (
                          <Badge variant={a.outcome === "limited" ? "warning" : "secondary"} className="px-2 py-0 text-[11px]">
                            {problem}
                          </Badge>
                        )}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-text-3">
                        {team && a.person && <span className="text-text-2">{a.person}</span>}
                        <span className="inline-flex items-center gap-0.5 font-medium text-info-text">
                          <Sparkles className="h-3 w-3" strokeWidth={1.7} aria-hidden />
                          {a.assistantName ?? DEFAULT_ASSISTANT_NAME}
                        </span>
                        {a.connectionName && <span>· {a.connectionName}</span>}
                        {a.summary && <span>· {a.summary}</span>}
                      </p>
                    </div>
                    <time className="shrink-0 text-xs text-text-3" dateTime={a.at}>
                      {fmt.format(new Date(a.at))}
                    </time>
                  </li>
                );
              })}
            </ul>
            {nextBefore && (
              <Button variant="ghost" size="sm" className="mt-2" disabled={busy} onClick={() => void load(nextBefore)}>
                {busy ? "Cargando…" : "Ver más"}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
