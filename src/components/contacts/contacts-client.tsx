"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Download,
  MessageSquareText,
  Plus,
  Search,
  SearchX,
  Send,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type { ContactDto } from "@/lib/types";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { WA_CONSENT_LABEL, WA_CONSENT_VALUES, type TagDto, type WaConsent } from "@/lib/tags";
import { cn, initials, phoneCompact } from "@/lib/utils";
import { dayShort } from "@/lib/relative-day";
import { assignContacts, useAssignees } from "@/components/assignment/use-assignees";
import { stageDot } from "@/lib/tags";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SOURCE_LABELS } from "@/server/contact-source";
import { priorityRank } from "@/server/leads/priority";
import { PriorityBadge } from "@/components/pipeline/priority-picker";
import { useViewer } from "@/components/viewer-context";
import { TagChip } from "@/components/tags/tag-chip";
import { ContactTagsCard } from "@/components/tags/contact-tags-card";
import { ImportDialog } from "./import-dialog";
import { NewContactDialog } from "./new-contact-dialog";
import { StartConversation } from "./start-conversation";
import { PageShell } from "@/components/ui/page-shell";
import { EmptyState } from "@/components/ui/empty-state";

const PAGE_SIZE = 50;

export function ContactsClient() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [stages, setStages] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [creando, setCreando] = useState(false);
  const [escribiendo, setEscribiendo] = useState<ContactDto | null>(null);
  // 021: filtros por etiqueta, fuente y consentimiento (los mismos del CSV).
  const [tagFilter, setTagFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [consentFilter, setConsentFilter] = useState<"all" | WaConsent>("all");
  /** Ronda 3: filtro por asesor (`none` = sin asignar). */
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const assignees = useAssignees();
  const [allTags, setAllTags] = useState<TagDto[]>([]);
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Paginación real del servidor (antes se veían solo los primeros 200). */
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const viewer = useViewer();
  const inputRef = useRef<HTMLInputElement>(null);

  // Mismo rescate que en la Bandeja: lo tecleado antes de que hidrate el JS
  // se perdía en silencio. Ver conversation-list.tsx.
  useEffect(() => {
    const typed = inputRef.current?.value ?? "";
    if (typed) setQuery(typed);
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pipeline/stages").catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as { stages: { name: string }[] };
      setStages(data.stages.map((s) => s.name));
    })();
  }, []);

  const loadTags = useCallback(async () => {
    const res = await fetchJson<{ tags: TagDto[] }>("/api/contact-tags");
    if (res.ok) setAllTags(res.data.tags);
    else setError(`No se pudieron cargar las etiquetas: ${res.error}`);
  }, []);

  useEffect(() => {
    void loadTags();
  }, [loadTags]);

  /** Los filtros activos como query string: la lista y el CSV usan los mismos. */
  const filterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (stage !== "all") params.set("stage", stage);
    if (showArchived) params.set("archived", "true");
    if (tagFilter !== "all") params.set("tag", tagFilter);
    if (sourceFilter !== "all") params.set("source", sourceFilter);
    if (consentFilter !== "all") params.set("consent", consentFilter);
    if (assigneeFilter !== "all") params.set("assignee", assigneeFilter);
    return params;
  }, [query, stage, showArchived, tagFilter, sourceFilter, consentFilter, assigneeFilter]);

  // Al cambiar un filtro se vuelve a la primera página.
  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [filterParams]);

  const refetch = useCallback(async () => {
    const params = filterParams();
    params.set("page", String(page));
    params.set("pageSize", String(PAGE_SIZE));
    const res = await fetchJson<{ contacts: ContactDto[]; total?: number }>(`/api/contacts?${params}`);
    if (!res.ok) {
      setError(`No se pudo cargar la lista: ${res.error}`);
      return;
    }
    setError(null);
    const data = res.data;
    setTotal(data.total ?? data.contacts.length);
    // A quién llamar primero: alta arriba, sin prioridad al final. El orden lo
    // decide esta lista, no el servidor, porque es una preferencia de trabajo y
    // no un dato del contacto.
    setContacts(
      [...data.contacts].sort(
        (a, b) => priorityRank(a.priority ?? null) - priorityRank(b.priority ?? null)
      )
    );
  }, [filterParams, page]);

  useEffect(() => {
    const t = setTimeout(() => void refetch(), 250);
    return () => clearTimeout(t);
  }, [refetch]);

  async function patch(id: string, body: Record<string, unknown>): Promise<boolean> {
    const res = await fetchJson(`/api/contacts/${id}`, jsonInit("PATCH", body));
    if (!res.ok) {
      setError(`No se guardó el cambio: ${res.error}`);
      return false;
    }
    void refetch();
    return true;
  }

  const filtering =
    !!query.trim() ||
    stage !== "all" ||
    tagFilter !== "all" ||
    sourceFilter !== "all" ||
    consentFilter !== "all" ||
    assigneeFilter !== "all";
  const seesTeam = viewer.can("scope.all");
  const canAssign = viewer.can("assignment.manage");

  return (
    <PageShell
      pillar="pipeline"
      variant="fluid"
      actions={
        <>
          {viewer.can("contacts.import") && (
            <Button size="sm" variant="outline" onClick={() => setImportando(true)}>
              <Upload className="h-4 w-4 sm:mr-1.5" strokeWidth={1.8} />
              <span className="hidden sm:inline">Importar</span>
              <span className="sr-only sm:hidden">Importar</span>
            </Button>
          )}
          {viewer.can("contacts.export") && (
            // Descarga directa: el navegador guarda el CSV que arma el
            // servidor con los MISMOS filtros que se ven en la lista.
            <a href={`/api/contacts/export?${filterParams()}`} download className="inline-flex">
              <Button size="sm" variant="outline" type="button" title={filtering ? "Exporta solo los filtrados" : undefined}>
                <Download className="h-4 w-4 sm:mr-1.5" strokeWidth={1.8} />
                <span className="hidden sm:inline">Exportar</span>
                <span className="sr-only sm:hidden">Exportar{filtering ? " filtrados" : ""}</span>
              </Button>
            </a>
          )}
          <Button size="sm" onClick={() => setCreando(true)}>
            <Plus className="h-4 w-4 sm:mr-1" strokeWidth={2} />
            <span className="hidden sm:inline">Nuevo contacto</span>
            <span className="sr-only sm:hidden">Nuevo contacto</span>
          </Button>
        </>
      }
    >
      {/* Ronda 3: buscador + filtros en cápsulas (cada una es un <select>
          nativo encima de la cápsula: teclado y teléfono funcionan solos). */}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-1 pt-3 sm:px-6">
        <div data-pm="search" className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder="Buscar nombre o teléfono"
            aria-label="Buscar contacto"
            defaultValue=""
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-full pl-8 text-sm"
          />
        </div>
        <div data-pm="filters-group" className="flex flex-wrap items-center gap-1.5">
          {stages.length > 0 && (
            <FilterChip
              label="Etapa"
              ariaLabel="Filtrar por etapa del embudo"
              value={stage}
              onChange={setStage}
              options={stages.map((s) => ({ value: s, label: s }))}
            />
          )}
          {allTags.length > 0 && (
            <FilterChip
              label="Etiqueta"
              ariaLabel="Filtrar por etiqueta"
              value={tagFilter}
              onChange={setTagFilter}
              options={allTags.map((t) => ({ value: t.id, label: t.name }))}
            />
          )}
          {seesTeam && canAssign && assignees.length > 0 && (
            <FilterChip
              label="Asesor"
              ariaLabel="Filtrar por asesor"
              value={assigneeFilter}
              onChange={setAssigneeFilter}
              options={[
                ...assignees.map((m) => ({ value: m.userId, label: m.name })),
                { value: "none", label: "Sin asignar" },
              ]}
            />
          )}
          <FilterChip
            label="Consentimiento"
            ariaLabel="Filtrar por consentimiento"
            value={consentFilter}
            onChange={(v) => setConsentFilter(v as "all" | WaConsent)}
            options={WA_CONSENT_VALUES.map((v) => ({ value: v, label: WA_CONSENT_LABEL[v] }))}
          />
          <FilterChip
            label="Fuente"
            ariaLabel="Filtrar por fuente"
            value={sourceFilter}
            onChange={setSourceFilter}
            options={(["anuncio", "organico", "referido", "conocido", "otro", "desconocida"] as const).map((s) => ({
              value: s,
              label: SOURCE_LABELS[s],
            }))}
          />
          <button
            type="button"
            aria-pressed={showArchived}
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12.5px]",
              showArchived
                ? "border-brand-soft bg-brand-tint font-medium text-brand-text"
                : "border-dashed border-border-strong text-text-2 hover:bg-accent"
            )}
          >
            {showArchived ? "Con archivados" : "+ Archivados"}
          </button>
        </div>
        <span data-pm="total" className="ml-auto text-[12.5px] tabular-nums text-text-3">
          {total.toLocaleString("es-MX")} {total === 1 ? "contacto" : "contactos"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2 sm:px-6">
        {error && (
          <p role="alert" className="mb-3 rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        )}
        {contacts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            {filtering ? (
              <EmptyState
                icon={SearchX}
                title="Sin resultados"
                description={<>
                  Nadie coincide con
                  {query.trim() ? ` «${query.trim()}»` : ""}
                  {query.trim() && stage !== "all" ? " en" : ""}
                  {stage !== "all" ? ` la etapa «${stage}»` : ""}
                  {tagFilter !== "all" || sourceFilter !== "all" || consentFilter !== "all"
                    ? " con los filtros elegidos"
                    : ""}
                  .
                </>}
              />
            ) : (
              <EmptyState
                icon={Users}
                title="Sin contactos"
                description="Cada persona que escriba a tu WhatsApp quedará registrada aquí automáticamente."
              />
            )}
          </div>
        ) : (
          <>
          {selected.size > 0 && (
            <div
              data-pm="bulk-bar"
              className="mb-3 flex flex-wrap items-center gap-3 rounded-lg bg-brand-tint px-4 py-2.5 text-sm"
            >
              <span className="font-semibold text-brand-text">
                {selected.size} {selected.size === 1 ? "seleccionado" : "seleccionados"}
              </span>
              {canAssign && assignees.length > 0 && (
                <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-accent">
                  <UserRound className="h-4 w-4" /> Asignar
                  <select
                    aria-label="Asignar a"
                    value=""
                    onChange={async (e) => {
                      const v = e.target.value;
                      if (!v) return;
                      const err = await assignContacts([...selected], v === "none" ? null : v);
                      if (err) setError(`No se pudo asignar: ${err}`);
                      setSelected(new Set());
                      void refetch();
                    }}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  >
                    <option value="">Asignar a…</option>
                    {assignees.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                    <option value="none">Sin asignar</option>
                  </select>
                </label>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const ids = [...selected];
                  await Promise.all(ids.map((id) => patch(id, { archived: true })));
                  setSelected(new Set());
                }}
              >
                <Archive className="h-4 w-4" /> Archivar
              </Button>
              <button
                type="button"
                className="ml-auto text-[13px] font-medium text-brand-text hover:underline"
                onClick={() => setSelected(new Set())}
              >
                Quitar selección
              </button>
            </div>
          )}
          <div role="table" aria-label="Contactos" className="overflow-hidden rounded-lg border bg-card">
            <div
              role="row"
              className="hidden items-center gap-3 border-b bg-subtle px-4 py-2.5 text-[12px] font-medium text-text-3 md:grid md:grid-cols-[24px_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)_56px_minmax(0,1fr)_minmax(0,0.9fr)_120px]"
            >
              <input
                type="checkbox"
                aria-label="Seleccionar todos"
                checked={contacts.length > 0 && selected.size === contacts.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(contacts.map((c) => c.id)) : new Set())}
              />
              <span>Nombre</span>
              <span>Teléfono</span>
              <span>Etapa</span>
              <span>Etiquetas</span>
              <span>Asesor</span>
              <span>Consentimiento</span>
              <span>Último mensaje</span>
              <span className="w-[120px]" />
            </div>
            {contacts.map((c) => {
              const dot = stageDot(null, c.stageName);
              const tags = c.tags ?? [];
              return (
                <div
                  key={c.id}
                  role="row"
                  data-pm="row"
                  data-selected={selected.has(c.id) ? "" : undefined}
                  className="group flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 last:border-b-0 data-[selected]:bg-brand-tint md:grid md:grid-cols-[24px_minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.4fr)_56px_minmax(0,1fr)_minmax(0,0.9fr)_120px]"
                >
                  <input
                    type="checkbox"
                    aria-label={`Seleccionar a ${c.name}`}
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <div className="flex min-w-0 flex-1 items-center gap-2.5 md:flex-none">
                    <ContactAvatar name={c.name} seed={c.id} />
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{c.name}</span>
                      {c.archivedAt && <Badge variant="secondary">Archivado</Badge>}
                    </div>
                    {c.priority && <PriorityBadge value={c.priority} />}
                  </div>
                  <span className="w-full text-[13px] tabular-nums md:w-auto">{phoneCompact(c.phone)}</span>
                  <span className="min-w-0">
                    {c.stageName && (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-subtle px-2 py-0.5 text-[12px]">
                        <span className={cn("h-2 w-2 rounded-full", dot.className)} style={dot.style} aria-hidden />
                        {c.stageName}
                      </span>
                    )}
                  </span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1">
                    {tags[0] && <TagChip tag={tags[0]} />}
                    {tags.length > 1 && <span className="text-[12px] text-text-3">+{tags.length - 1}</span>}
                  </span>
                  <span data-pm="assignee" className="hidden md:block">
                    {c.assignee ? (
                      <span
                        title={c.assignee.name}
                        aria-label={`Asesor: ${c.assignee.name}`}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-[10px] font-bold text-brand-text"
                      >
                        {initials(c.assignee.name)}
                      </span>
                    ) : (
                      <span title="Sin asignar" className="text-[12px] text-text-3">
                        —
                      </span>
                    )}
                  </span>
                  <span className="min-w-0">
                    {c.waConsent === "opt_in" && <Badge variant="success">Opt-in</Badge>}
                    {c.waConsent === "opt_out" && <Badge variant="destructive">Baja</Badge>}
                    {c.waConsent !== "opt_in" && c.waConsent !== "opt_out" && (
                      <Badge variant="secondary">Sin respuesta</Badge>
                    )}
                  </span>
                  <span data-pm="last-message" className="text-[12.5px] text-text-3">
                    {dayShort(c.lastMessageAt)}
                  </span>
                  {/* Las acciones de la fila aparecen al pasar el ratón (como en
                      la maqueta, la tabla queda limpia); en el teléfono, siempre. */}
                  <div className="ml-auto flex shrink-0 items-center gap-0.5 md:opacity-0 md:transition-opacity md:focus-within:opacity-100 md:group-hover:opacity-100">
                    <Button data-pm="row-secondary" variant="ghost" size="sm" className="px-2" onClick={() => setEditing(c)}>
                      Editar
                    </Button>
                    {/* A quien nunca escribió hay que abrirle la conversación con
                        una plantilla: es regla de Meta, no del CRM. */}
                    <Button
                      data-pm="row-secondary"
                      variant="ghost"
                      size="icon"
                      aria-label="Escribir primero"
                      title="Escribir primero (con plantilla)"
                      onClick={() => setEscribiendo(c)}
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                    <Link href={`/inbox?contact=${c.id}`}>
                      <Button variant="ghost" size="icon" aria-label="Abrir conversación">
                        <MessageSquareText className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Button
                      data-pm="row-secondary"
                      variant="ghost"
                      size="icon"
                      aria-label={c.archivedAt ? "Desarchivar" : "Archivar"}
                      onClick={() => void patch(c.id, { archived: !c.archivedAt })}
                    >
                      {c.archivedAt ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )}
        {total > 0 && (
          <nav
            aria-label="Páginas de contactos"
            className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-text-3"
          >
            <span className="tabular-nums">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} de{" "}
              {total.toLocaleString("es-MX")}
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                aria-label="Anterior"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7"
                aria-label="Siguiente"
                disabled={page * PAGE_SIZE >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </nav>
        )}
      </div>

      {editing && (
        <EditDialog
          contact={editing}
          onClose={() => setEditing(null)}
          onSave={async (patchBody) => {
            if (await patch(editing.id, patchBody)) setEditing(null);
          }}
          onTagsChanged={() => {
            void refetch();
            void loadTags();
          }}
        />
      )}

      {importando && (
        <ImportDialog
          onClose={() => setImportando(false)}
          onImported={() => {
            void refetch();
            void loadTags();
          }}
        />
      )}

      {escribiendo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Escribir primero"
        >
          <div className="w-full max-w-md rounded-lg border bg-popover p-4 shadow-pop">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-semibold">
                Escribir a {escribiendo.name}
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setEscribiendo(null)}>
                Cerrar
              </Button>
            </div>
            <StartConversation
              contactId={escribiendo.id}
              onStarted={() => {
                const contactId = escribiendo.id;
                setEscribiendo(null);
                // La Bandeja resuelve por CONTACTO (`?contact=`), no por
                // conversación: con `?conversation=` no seleccionaría nada.
                router.push(`/inbox?contact=${contactId}`);
              }}
            />
          </div>
        </div>
      )}

      {creando && (
        <NewContactDialog
          onClose={() => setCreando(false)}
          onCreated={() => {
            setCreando(false);
            void refetch();
          }}
          onOpenExisting={(contactId) => {
            setCreando(false);
            router.push(`/inbox?contact=${contactId}`);
          }}
        />
      )}
    </PageShell>
  );
}

/**
 * Cápsula de filtro (ronda 3): «+ Etapa» apagada; «Etapa: Nuevo ×» puesta.
 * El <select> nativo va encima, invisible: da teclado, lector de pantalla y
 * el selector del teléfono sin un menú propio.
 */
function FilterChip({
  label,
  ariaLabel,
  value,
  onChange,
  options,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const active = value !== "all";
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <span
      data-pm="filter-chip"
      data-active={active ? "" : undefined}
      className={cn(
        "relative inline-flex h-7 max-w-[16rem] items-center gap-1 rounded-full border text-[12.5px]",
        active
          ? "border-brand-soft bg-brand-tint pl-2.5 pr-1 font-medium text-brand-text"
          : "border-dashed border-border-strong px-2.5 text-text-2 hover:bg-accent"
      )}
    >
      <span className="truncate">{active ? `${label}: ${current}` : `+ ${label}`}</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("absolute inset-0 cursor-pointer opacity-0", active && "right-6")}
      >
        <option value="all">Todas</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {active && (
        <button
          type="button"
          aria-label={`Quitar filtro ${label}`}
          onClick={() => onChange("all")}
          className="relative z-10 rounded-full p-0.5 hover:bg-brand-soft"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

function EditDialog({
  contact,
  onClose,
  onSave,
  onTagsChanged,
}: {
  contact: ContactDto;
  onClose: () => void;
  onSave: (patch: { name: string; notes: string }) => Promise<void>;
  /** 021: etiquetas y consentimiento se guardan al momento, aparte. */
  onTagsChanged: () => void;
}) {
  const [name, setName] = useState(contact.name);
  const [notes, setNotes] = useState(contact.notes ?? "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 font-semibold">Editar contacto</h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-name">
              Nombre
            </label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="edit-notes">
              Notas
            </label>
            <Textarea
              id="edit-notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="border-t pt-3">
            <ContactTagsCard contactId={contact.id} bare onChanged={onTagsChanged} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => void onSave({ name: name.trim(), notes })}
          >
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
