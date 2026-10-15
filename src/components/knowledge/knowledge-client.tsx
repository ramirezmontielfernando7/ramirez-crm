"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, FileText, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { KnowledgeEntryDto } from "@/lib/knowledge";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useViewer } from "@/components/viewer-context";
import { PageShell } from "@/components/ui/page-shell";
import { formatBytes } from "@/components/inbox/helpers";
import { DestinationBadges, DestinationToggle } from "@/components/library/destinations";
import { KnowledgeEditor } from "./knowledge-editor";

const DATE = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" });

/**
 * 024 — Conocimientos: fichas, catálogos, políticas y respuestas tipo que el
 * equipo envía a los clientes desde la Bandeja. Todos lo ven y buscan;
 * crear, editar y borrar es de Propietario y Coordinador.
 * 040 — Biblioteca unificada: cada tarjeta dice a dónde va su archivo
 * («💬 Envío en chat» y/o «🤖 Lectura IA (RAG)») y quien puede los enciende o
 * apaga desde ahí, sin volver a subirlo.
 */
export function KnowledgeClient() {
  const viewer = useViewer();
  const canManage = viewer.can("knowledge.manage");
  const [entries, setEntries] = useState<KnowledgeEntryDto[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("all");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<KnowledgeEntryDto | "new" | null>(null);
  const [library, setLibrary] = useState<{ chat: boolean; rag: boolean }>({ chat: false, rag: false });
  const [busyId, setBusyId] = useState<string | null>(null);
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
    const res = await fetchJson<{ entries: KnowledgeEntryDto[]; tags: string[]; library: { chat: boolean; rag: boolean } }>(
      `/api/knowledge?${params}`
    );
    setLoaded(true);
    if (!res.ok) {
      setError(`No se pudo cargar Conocimientos: ${res.error}`);
      return;
    }
    setError(null);
    setEntries(res.data.entries);
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
      ? `¿Borrar «${entry.title}» de la Biblioteca? El agente lo seguirá leyendo (Lectura IA); para que deje de leerlo, apágala antes o bórralo en Estudio de IA → Documentos.`
      : `¿Borrar «${entry.title}»? No se puede deshacer.`;
    if (!window.confirm(aviso)) return;
    const res = await fetchJson(`/api/knowledge/${entry.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(`No se borró: ${res.error}`);
      return;
    }
    void refetch();
  }

  const filtering = query.trim() !== "" || tag !== "all";

  return (
    <PageShell
      pillar="pipeline"
      variant="fluid"
      actions={
        canManage ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-4 w-4" strokeWidth={1.8} />
            Nueva entrada
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
              className="h-9 max-w-[12rem] rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="all">Toda etiqueta</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" strokeWidth={1.7} />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por título o contenido…"
              aria-label="Buscar en Conocimientos"
              className="pl-8"
            />
          </div>
        </div>
      </div>

      {notice && (
        <p role="alert" className="mx-4 mt-3 rounded-md border border-warning-soft bg-warning-tint px-3 py-2 text-sm text-warning-text sm:mx-6" data-testid="library-notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mx-4 mt-3 rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text sm:mx-6">
          {error}
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {loaded && entries.length === 0 ? (
          <div className="mx-auto mt-16 max-w-sm text-center">
            <BookOpen className="mx-auto mb-3 h-8 w-8 text-text-3" strokeWidth={1.5} />
            <p className="font-semibold">
              {filtering ? "Nada coincide con la búsqueda" : "Aún no hay conocimientos"}
            </p>
            <p className="mt-1 text-sm text-text-3">
              {filtering
                ? "Prueba con otra palabra o quita el filtro de etiqueta."
                : canManage
                  ? "Sube catálogos, fichas técnicas o políticas, o escribe respuestas tipo. Tu equipo las envía desde cualquier chat."
                  : "Cuando tu equipo agregue material, lo verás aquí y podrás enviarlo desde la Bandeja."}
            </p>
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {entries.map((e) => (
              <li key={e.id} className="flex flex-col rounded-lg border bg-card p-4 shadow-sm" data-testid="knowledge-card" data-title={e.title}>
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
                {e.body && (
                  <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-text-2">{e.body}</p>
                )}
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
              </li>
            ))}
          </ul>
        )}
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
