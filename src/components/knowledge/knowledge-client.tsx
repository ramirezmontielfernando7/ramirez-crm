"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, FileText, Folder, FolderOpen, LayoutGrid, List, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { KnowledgeEntryDto } from "@/lib/knowledge";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useViewer } from "@/components/viewer-context";
import { PageShell } from "@/components/ui/page-shell";
import { formatBytes } from "@/components/inbox/helpers";
import { DestinationBadges, DestinationToggle } from "@/components/library/destinations";
import { KnowledgeEditor } from "./knowledge-editor";
import { EmptyState } from "@/components/ui/empty-state";

const DATE = new Intl.DateTimeFormat("es-MX", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * 024 — Conocimientos: fichas, catálogos, políticas y respuestas tipo que el
 * equipo envía a los clientes desde la Bandeja. Todos lo ven y buscan;
 * crear, editar y borrar es de Propietario y Coordinador.
 * 040 — Biblioteca unificada: cada tarjeta dice a dónde va su archivo
 * («💬 Envío en chat» y/o «🤖 Lectura IA (RAG)») y quien puede los enciende o
 * apaga desde ahí, sin volver a subirlo.
 */
/** La pestaña «Para que lea la IA» solo existe si la instancia tiene Documentos (`KB_DOCS`). */
const SIN_DOCUMENTOS = ["/lab/documentos"] as const;

export function KnowledgeClient({ documents = true }: { documents?: boolean } = {}) {
  const viewer = useViewer();
  const canManage = viewer.can("knowledge.manage");
  const [entries, setEntries] = useState<KnowledgeEntryDto[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("all");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<KnowledgeEntryDto | "new" | null>(null);
  const [library, setLibrary] = useState<{ chat: boolean; rag: boolean }>({
    chat: false,
    rag: false,
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dest, setDest] = useState<"chat" | "rag" | null>(null);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lo tecleado antes de hidratar no se pierde (mismo rescate que Contactos).
  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed) setQuery(typed);
  }, []);

  const refetch = useCallback(async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (tag !== "all") params.set("tag", tag);
    // 040: la pantalla de la Biblioteca (quien administra ve también lo que solo lee la IA).
    params.set("scope", "library");
    const res = await fetchJson<{
      entries: KnowledgeEntryDto[];
      tags: string[];
      library: { chat: boolean; rag: boolean };
    }>(`/api/knowledge?${params}`);
    setLoaded(true);
    if (!res.ok) {
      setError(`No se pudo cargar Conocimientos: ${res.error}`);
      return;
    }
    setError(null);
    setEntries(res.data.entries);
    if (tag === "all" && !query.trim()) {
      const c: Record<string, number> = {};
      for (const e of res.data.entries) for (const t of e.tags) c[t] = (c[t] ?? 0) + 1;
      setCounts(c);
      setTotal(res.data.entries.length);
    }
    setTags(res.data.tags);
    setLibrary(res.data.library);
  }, [query, tag]);

  /** 040 — Enciende o apaga un destino de la entrada (sin volver a subir el archivo). */
  async function setDestination(entry: KnowledgeEntryDto, change: { chat?: boolean; rag?: boolean }) {
    setBusyId(entry.id);
    setNotice(null);
    const res = await fetchJson<{ entry: KnowledgeEntryDto }>(`/api/knowledge/${entry.id}/destinations`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(change),
    });
    setBusyId(null);
    if (!res.ok) {
      setNotice(res.error);
      return;
    }
    setEntries((list) => list.map((x) => (x.id === entry.id ? res.data.entry : x)));
  }

  useEffect(() => {
    const t = setTimeout(() => void refetch(), 200);
    return () => clearTimeout(t);
  }, [refetch]);

  async function remove(entry: KnowledgeEntryDto) {
    const aviso = entry.rag
      ? `¿Borrar «${entry.title}» de la Biblioteca? El agente lo seguirá leyendo (Lectura IA); para que deje de leerlo, apágala antes o bórralo en Biblioteca → Para que lea la IA.`
      : `¿Borrar «${entry.title}»? No se puede deshacer.`;
    if (!window.confirm(aviso)) return;
    const res = await fetchJson(`/api/knowledge/${entry.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setError(`No se borró: ${res.error}`);
      return;
    }
    void refetch();
  }

  const filtering = query.trim() !== "" || tag !== "all" || dest !== null;
  const shown = entries.filter((e) => (dest === "chat" ? e.showInChat : dest === "rag" ? e.rag !== null : true));

  return (
    <PageShell
      pillar="knowledge"
      variant="fluid"
      hideSections={documents ? undefined : SIN_DOCUMENTOS}
      actions={
        canManage ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-4 w-4" strokeWidth={1.8} />
            Subir archivo
          </Button>
        ) : undefined
      }
    >
      {/* 039: la búsqueda y el filtro, en su fila bajo las pestañas del pilar. */}
      <div className="border-b px-4 py-2.5 sm:px-6">
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
          {tags.length > 0 && (
            <select
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              aria-label="Filtrar por etiqueta"
              className="h-9 max-w-[12rem] rounded-md border border-input bg-card px-2 text-sm md:hidden"
            >
              <option value="all">Toda etiqueta</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <div className="relative w-full sm:w-72 sm:order-first">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
              strokeWidth={1.7}
            />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por título o contenido…"
              aria-label="Buscar en Conocimientos"
              className="pl-8"
            />
          </div>
          {library.chat && library.rag && (
            <div className="flex items-center gap-1.5">
              {(
                [
                  ["chat", "💬 Envío en chat"],
                  ["rag", "🤖 Lectura IA"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={dest === k}
                  onClick={() => setDest((d) => (d === k ? null : k))}
                  className={
                    "h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors " +
                    (dest === k ? "border-brand bg-brand-tint text-brand-text" : "text-text-2 hover:bg-accent")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="ml-auto inline-flex rounded-md border bg-subtle p-0.5" role="group" aria-label="Vista">
            {(
              [
                ["grid", "Cuadrícula", LayoutGrid],
                ["list", "Lista", List],
              ] as const
            ).map(([k, label, Icon]) => (
              <button
                key={k}
                type="button"
                aria-pressed={view === k}
                onClick={() => setView(k)}
                className={
                  "flex h-7 items-center gap-1.5 rounded px-2.5 text-[12.5px] font-medium " +
                  (view === k ? "bg-background text-foreground shadow-sm" : "text-text-2")
                }
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {notice && (
        <p
          role="alert"
          className="mx-4 mt-3 rounded-md border border-warning-soft bg-warning-tint px-3 py-2 text-sm text-warning-text sm:mx-6"
          data-testid="library-notice"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mx-4 mt-3 rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text sm:mx-6"
        >
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <aside
          className="hidden w-56 shrink-0 overflow-y-auto border-r px-3 py-4 md:block"
          aria-label="Carpetas de la Biblioteca"
        >
          <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wide text-text-3">Carpetas</p>
          {["all", ...tags].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTag(t)}
              aria-pressed={tag === t}
              className={
                "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors " +
                (tag === t ? "bg-brand-tint font-medium text-brand-text" : "text-text-2 hover:bg-accent")
              }
            >
              {tag === t ? (
                <FolderOpen className="h-4 w-4 shrink-0" strokeWidth={1.7} />
              ) : (
                <Folder className="h-4 w-4 shrink-0" strokeWidth={1.7} />
              )}
              <span className="min-w-0 flex-1 truncate">{t === "all" ? "Todo" : t}</span>
              <span className="text-xs text-text-3">{t === "all" ? total : (counts[t] ?? "")}</span>
            </button>
          ))}
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loaded && error && shown.length === 0 ? (
            <EmptyState
              className="mt-4"
              icon={BookOpen}
              title="No pudimos cargar tus conocimientos"
              description="Tu material sigue guardado. Revisa tu conexión e inténtalo de nuevo."
              action={<Button variant="outline" onClick={() => void refetch()}>Reintentar</Button>}
            />
          ) : loaded && shown.length === 0 ? (
            <EmptyState
              className="mt-4"
              icon={BookOpen}
              title={filtering ? "Nada coincide con la búsqueda" : "Aún no hay conocimientos"}
              description={
                filtering
                  ? "Prueba con otra palabra o quita el filtro de etiqueta."
                  : canManage
                    ? "Sube catálogos, fichas técnicas o políticas, o escribe respuestas tipo. Tu equipo las envía desde cualquier chat."
                    : "Cuando tu equipo agregue material, lo verás aquí y podrás enviarlo desde la Bandeja."
              }
            />
          ) : (
            <ul className={view === "list" ? "flex flex-col gap-2" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-3"}>
              {shown.map((e) => (
                <li
                  key={e.id}
                  className={
                    "flex overflow-hidden rounded-xl border bg-card " +
                    (view === "list" ? "flex-row items-stretch" : "flex-col")
                  }
                  data-testid="knowledge-card"
                  data-title={e.title}
                >
                  <div
                    className={
                      "flex items-center justify-center bg-muted/60 " + (view === "list" ? "w-24 shrink-0" : "h-28")
                    }
                  >
                    {e.file?.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={e.file.url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <FileText className="h-9 w-9 text-text-3" strokeWidth={1.4} />
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 break-words font-semibold leading-snug">{e.title}</h3>
                      {canManage && (
                        <div className="-mr-1.5 -mt-1 flex shrink-0">
                          <button
                            onClick={() => setEditing(e)}
                            aria-label={`Editar ${e.title}`}
                            className="rounded p-1.5 text-text-3 hover:bg-secondary hover:text-foreground"
                          >
                            <Pencil className="h-4 w-4" strokeWidth={1.7} />
                          </button>
                          <button
                            onClick={() => void remove(e)}
                            aria-label={`Borrar ${e.title}`}
                            className="rounded p-1.5 text-text-3 hover:bg-danger-tint hover:text-danger-text"
                          >
                            <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                          </button>
                        </div>
                      )}
                    </div>
                    {e.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {e.tags.map((t) => (
                          <button
                            key={t}
                            onClick={() => setTag(t)}
                            className="rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-semibold text-brand-text"
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                    {e.body && <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-text-2">{e.body}</p>}
                    {e.file && (
                      <a
                        href={e.file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 flex items-center gap-2.5 rounded-md border bg-subtle p-2 hover:border-brand"
                      >
                        {e.file.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={e.file.url} alt="" className="h-10 w-10 rounded object-cover" />
                        ) : (
                          <FileText className="h-8 w-8 shrink-0 text-brand" strokeWidth={1.5} />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{e.file.name}</span>
                          <span className="block text-xs text-text-3">{formatBytes(e.file.size)}</span>
                        </span>
                      </a>
                    )}
                    <DestinationBadges chat={e.showInChat} rag={e.rag !== null} className="mt-3" />
                    {canManage && (library.chat || library.rag) && (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 border-t pt-2">
                        {library.chat && (
                          <DestinationToggle
                            destination="chat"
                            name={e.title}
                            checked={e.showInChat}
                            disabled={busyId === e.id || (e.showInChat && !e.rag)}
                            hint={e.showInChat && !e.rag ? "Es su único destino" : null}
                            onChange={(next) => void setDestination(e, { chat: next })}
                          />
                        )}
                        {library.rag && (
                          <DestinationToggle
                            destination="rag"
                            name={e.title}
                            checked={e.rag !== null}
                            disabled={busyId === e.id || (e.rag !== null && !e.showInChat)}
                            hint={e.rag !== null && !e.showInChat ? "Es su único destino" : null}
                            onChange={(next) => void setDestination(e, { rag: next })}
                          />
                        )}
                      </div>
                    )}
                    <p className="mt-auto pt-3 font-mono text-[10.5px] tracking-[0.04em] text-text-3">
                      Actualizado {DATE.format(new Date(e.updatedAt))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {editing && (
        <KnowledgeEditor
          entry={editing === "new" ? null : editing}
          canTrainAgent={library.rag}
          onClose={() => setEditing(null)}
          onSaved={(warning) => {
            setEditing(null);
            setNotice(warning ?? null);
            void refetch();
          }}
        />
      )}
    </PageShell>
  );
}
