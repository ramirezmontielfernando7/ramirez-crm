"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { call } from "@/components/lab/agents-api";
import { GENERAL_GROUP_KEY, groupKey, type DocSources } from "@/lib/kb-docs";
import { cn } from "@/lib/utils";

type Group = { id: string | null; name: string; documents: number };

/**
 * 037 (PR 2) — De qué documentos lee este agente: «Todos los documentos de la
 * empresa» (por defecto) o «Solo estos grupos». Es parte del borrador: se
 * aplica al publicar, como el resto del formulario. La vista previa ya usa
 * lo que hay aquí aunque no esté guardado.
 */
export function AgentDocSources({ value, onChange }: { value: DocSources; onChange: (next: DocSources) => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void call<{ groups: Group[] }>("/api/lab/document-groups").then((r) => {
      if (r.ok) setGroups(r.data.groups);
      else setError(r.message);
    });
  }, []);

  const selected = value.mode === "groups" ? value.groupIds : [];
  const known = new Set((groups ?? []).map((g) => groupKey(g.id)));
  const stale = groups ? selected.filter((id) => !known.has(id)) : [];

  function setGroups_(ids: string[]) {
    onChange({ mode: "groups", groupIds: [...new Set(ids)].sort() });
  }
  function toggle(id: string) {
    setGroups_(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  return (
    <div className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="sr-only">De qué documentos lee este agente</legend>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="agent-doc-sources"
            className="mt-1 accent-[var(--accent)]"
            checked={value.mode === "all"}
            onChange={() => onChange({ mode: "all" })}
          />
          <span>
            Todos los documentos de la empresa
            <span className="block text-xs text-muted-foreground">De todos los grupos. Es lo que hace un agente sin configurar.</span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="agent-doc-sources"
            className="mt-1 accent-[var(--accent)]"
            checked={value.mode === "groups"}
            onChange={() => setGroups_(selected)}
          />
          <span>
            Solo estos grupos
            <span className="block text-xs text-muted-foreground">Elige uno o varios.</span>
          </span>
        </label>
      </fieldset>

      {value.mode === "groups" && (
        <div className="space-y-2 pl-6">
          {error && <p className="text-xs text-destructive">{error}</p>}
          {!groups && !error && <p className="text-xs text-muted-foreground">Cargando grupos…</p>}
          {groups && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Grupos de documentos">
              {groups.map((g) => {
                const id = groupKey(g.id);
                const on = selected.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(id)}
                    className={cn(
                      "inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                      on ? "border-brand bg-brand-tint text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {on && <Check className="h-3 w-3 shrink-0" strokeWidth={2.2} aria-hidden />}
                    <span className="truncate">{g.name}</span>
                    <span className="text-muted-foreground">{g.documents}</span>
                  </button>
                );
              })}
              {stale.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setGroups_(selected.filter((x) => x !== id))}
                  title="Este grupo se eliminó. Quítalo de la selección."
                  className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground"
                >
                  Grupo eliminado <X className="h-3 w-3" aria-hidden />
                </button>
              ))}
            </div>
          )}
          {groups && selected.filter((id) => known.has(id) || id === GENERAL_GROUP_KEY).length === 0 && (
            <p className="text-xs text-muted-foreground" data-testid="agent-doc-sources-empty">
              Sin grupos elegidos, este agente no lee documentos de la empresa.
            </p>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Se aplica al publicar.{" "}
        <Link href="/lab/documentos" className="font-medium text-brand-ink hover:underline">
          Administrar documentos y grupos
        </Link>
      </p>
    </div>
  );
}
