"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Trash2, Upload, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/lab/confirm-dialog";
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

type ExclusiveDoc = {
  id: string;
  title: string;
  filename: string;
  status: "pending" | "processing" | "ready" | "failed";
  statusLabel: string;
  errorMessage: string | null;
};

/**
 * 037 (PR 3) — Documentos que solo lee este agente, sea cual sea su
 * selección. NO son parte del borrador: aplican al momento (como el
 * conocimiento propio del agente) y el aviso lo dice.
 */
export function AgentExclusiveDocs({ agentId }: { agentId: string }) {
  const [docs, setDocs] = useState<ExclusiveDoc[] | null>(null);
  const [accept, setAccept] = useState(".txt,.md,.pdf");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<ExclusiveDoc | null>(null);
  const q = encodeURIComponent(agentId);

  const load = useCallback(async () => {
    const r = await call<{ documents: ExclusiveDoc[]; accept: string }>(`/api/lab/documents?agentId=${q}`);
    if (r.ok) {
      setDocs(r.data.documents);
      setAccept(r.data.accept);
    } else setError(r.message);
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  const inProgress = docs?.some((d) => d.status === "pending" || d.status === "processing") ?? false;
  useEffect(() => {
    if (!inProgress) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [inProgress, load]);

  async function upload(file: File) {
    setError(null);
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("agentId", agentId);
    const r = await call("/api/lab/documents", { method: "POST", body: form });
    setUploading(false);
    if (!r.ok) setError(r.message);
    void load();
  }

  async function remove(d: ExclusiveDoc) {
    const r = await call(`/api/lab/documents/${d.id}`, { method: "DELETE" });
    setToDelete(null);
    if (!r.ok) setError(r.message);
    void load();
  }

  return (
    <div className="space-y-2 border-t pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Solo de este agente</p>
        <label className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer", uploading && "pointer-events-none opacity-50")}>
          <Upload className="h-3.5 w-3.5" /> {uploading ? "Subiendo…" : "Subir"}
          <input
            type="file"
            accept={accept}
            className="sr-only"
            data-testid="agent-exclusive-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Los lee solo este agente, sin importar los grupos elegidos. Se aplican al momento, sin publicar.</p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {docs && docs.length > 0 && (
        <ul className="divide-y rounded-md border" data-testid="agent-exclusive-list">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm" data-doc-id={d.id}>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{d.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {d.statusLabel}
                  {d.status === "failed" && d.errorMessage ? ` · ${d.errorMessage}` : ""}
                </span>
              </span>
              <button
                type="button"
                aria-label={`Eliminar ${d.title}`}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setToDelete(d)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {toDelete && (
        <ConfirmDialog
          title={`¿Eliminar «${toDelete.title}»?`}
          confirmLabel="Eliminar"
          destructive
          onConfirm={() => void remove(toDelete)}
          onCancel={() => setToDelete(null)}
        >
          <p>Este agente deja de consultarlo desde el siguiente mensaje. No se puede deshacer.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/**
 * 037 (PR 3, D3) — En el diálogo de archivar: qué hacer con los documentos
 * exclusivos del agente. Solo aparece si tiene alguno.
 */
export function ArchiveExclusiveDocsChoice({
  agentId,
  value,
  onChange,
}: {
  agentId: string;
  value: "delete" | "general";
  onChange: (v: "delete" | "general") => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    void call<{ documents: unknown[] }>(`/api/lab/documents?agentId=${encodeURIComponent(agentId)}`).then((r) => setCount(r.ok ? r.data.documents.length : 0));
  }, [agentId]);
  if (!count) return null;
  return (
    <fieldset className="space-y-2" data-testid="archive-exclusive-docs">
      <legend className="mb-1 text-foreground">
        Tiene {count === 1 ? "1 documento exclusivo" : `${count} documentos exclusivos`}.
      </legend>
      <label className="flex cursor-pointer items-start gap-2 text-foreground">
        <input type="radio" name="archive-exclusive" className="mt-1 accent-[var(--accent)]" checked={value === "delete"} onChange={() => onChange("delete")} />
        <span>Eliminar sus documentos exclusivos</span>
      </label>
      <label className="flex cursor-pointer items-start gap-2 text-foreground">
        <input type="radio" name="archive-exclusive" className="mt-1 accent-[var(--accent)]" checked={value === "general"} onChange={() => onChange("general")} />
        <span>
          Conservarlos pasándolos a General
          <span className="block text-xs text-muted-foreground">Los podrá leer cualquier agente que use «Todos los documentos de la empresa».</span>
        </span>
      </label>
    </fieldset>
  );
}
