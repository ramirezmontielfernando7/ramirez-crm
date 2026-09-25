"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArchiveRestore,
  Download,
  MessageSquareText,
  Search,
  Send,
  Upload,
  UserPlus,
} from "lucide-react";
import type { ContactDto } from "@/lib/types";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { WA_CONSENT_LABEL, WA_CONSENT_VALUES, type TagDto, type WaConsent } from "@/lib/tags";
import { formatPhone } from "@/lib/utils";
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
import { NavRevealButton } from "@/components/nav-mode";

export function ContactsClient() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactDto[]>([]);
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [stages, setStages] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ContactDto | null>(null);
  const [creando, setCreando] = useState(false);
  const [escribiendo, setEscribiendo] = useState<ContactDto | null>(null);
  // 021: filtros por etiqueta, fuente y consentimiento (los mismos del CSV).
  const [tagFilter, setTagFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [consentFilter, setConsentFilter] = useState<"all" | WaConsent>("all");
  const [allTags, setAllTags] = useState<TagDto[]>([]);
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    return params;
  }, [query, stage, showArchived, tagFilter, sourceFilter, consentFilter]);

  const refetch = useCallback(async () => {
    const res = await fetchJson<{ contacts: ContactDto[] }>(`/api/contacts?${filterParams()}`);
    if (!res.ok) {
      setError(`No se pudo cargar la lista: ${res.error}`);
      return;
    }
    setError(null);
    const data = res.data;
    // A quién llamar primero: alta arriba, sin prioridad al final. El orden lo
    // decide esta lista, no el servidor, porque es una preferencia de trabajo y
    // no un dato del contacto.
    setContacts(
      [...data.contacts].sort(
        (a, b) => priorityRank(a.priority ?? null) - priorityRank(b.priority ?? null)
      )
    );
  }, [filterParams]);

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
    !!query.trim() || stage !== "all" || tagFilter !== "all" || sourceFilter !== "all" || consentFilter !== "all";

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2">
          <NavRevealButton />
          <h2 className="text-[17px] font-bold tracking-tight">Contactos</h2>
          <Button size="sm" onClick={() => setCreando(true)}>
            <UserPlus className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
            Nuevo contacto
          </Button>
          {viewer.can("contacts.import") && (
            <Button size="sm" variant="outline" onClick={() => setImportando(true)}>
              <Upload className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
              Importar
            </Button>
          )}
          {viewer.can("contacts.export") && (
            // Descarga directa: el navegador guarda el CSV que arma el
            // servidor con los MISMOS filtros que se ven en la lista.
            <a href={`/api/contacts/export?${filterParams()}`} download>
              <Button size="sm" variant="outline" type="button">
                <Download className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
                Exportar{filtering ? " filtrados" : ""}
              </Button>
            </a>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-primary"
            />
            Ver archivados
          </label>
          {stages.length > 0 && (
            <select
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              aria-label="Filtrar por etapa del embudo"
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="all">Toda etapa</option>
              {stages.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          {allTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              aria-label="Filtrar por etiqueta"
              className="h-9 max-w-[12rem] rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="all">Toda etiqueta</option>
              {allTags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            aria-label="Filtrar por fuente"
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
          >
            <option value="all">Toda fuente</option>
            {(["anuncio", "organico", "referido", "conocido", "otro", "desconocida"] as const).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            value={consentFilter}
            onChange={(e) => setConsentFilter(e.target.value as "all" | WaConsent)}
            aria-label="Filtrar por consentimiento"
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
          >
            <option value="all">Todo consentimiento</option>
            {WA_CONSENT_VALUES.map((v) => (
              <option key={v} value={v}>
                {WA_CONSENT_LABEL[v]}
              </option>
            ))}
          </select>
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Buscar por nombre o teléfono…"
              aria-label="Buscar contacto"
              defaultValue=""
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-8 sm:w-72"
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {error && (
          <p role="alert" className="mb-3 rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        )}
        {contacts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            {filtering ? (
              <>
                <p className="text-sm font-medium">Sin resultados</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Nadie coincide con
                  {query.trim() ? ` «${query.trim()}»` : ""}
                  {query.trim() && stage !== "all" ? " en" : ""}
                  {stage !== "all" ? ` la etapa «${stage}»` : ""}
                  {tagFilter !== "all" || sourceFilter !== "all" || consentFilter !== "all"
                    ? " con los filtros elegidos"
                    : ""}
                  .
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Sin contactos</p>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Cada persona que escriba a tu WhatsApp quedará registrada aquí
                  automáticamente.
                </p>
              </>
            )}
          </div>
        ) : (
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-3 sm:flex-nowrap sm:gap-x-4 sm:px-4"
              >
                <ContactAvatar name={c.name} seed={c.id} />
                {/* El 60% mínimo es lo que empuja los botones a su propio
                    renglón en el teléfono en vez de exprimir el nombre. */}
                <div className="min-w-[60%] flex-1 sm:min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.name}
                    </span>
                    {c.priority && <PriorityBadge value={c.priority} />}
                    {c.stageName && (
                      <Badge variant="outline">{c.stageName}</Badge>
                    )}
                    {c.archivedAt && (
                      <Badge variant="secondary">Archivado</Badge>
                    )}
                    {/* Solo la fuente que alguien capturó: presentar una
                        deducción como dato la volvería un número inventado en
                        cuanto se cuente por fuente. */}
                    {c.source?.source === "capturada" && (
                      <Badge variant="secondary">
                        {SOURCE_LABELS[c.source.value]}
                      </Badge>
                    )}
                    {c.waConsent === "opt_in" && <Badge variant="success">Acepta mensajes</Badge>}
                    {c.waConsent === "opt_out" && <Badge variant="destructive">No quiere mensajes</Badge>}
                    {(c.tags ?? []).map((t) => (
                      <TagChip key={t.id} tag={t} />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatPhone(c.phone)}
                    {c.notes ? ` · ${c.notes.slice(0, 60)}` : ""}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing(c)}
                  >
                    Editar
                  </Button>
                  {/* A quien nunca escribió hay que abrirle la conversación con
                      una plantilla: es regla de Meta, no del CRM. */}
                  <Button
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
                    variant="ghost"
                    size="icon"
                    aria-label={c.archivedAt ? "Desarchivar" : "Archivar"}
                    onClick={() => void patch(c.id, { archived: !c.archivedAt })}
                  >
                    {c.archivedAt ? (
                      <ArchiveRestore className="h-4 w-4" />
                    ) : (
                      <Archive className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
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
    </div>
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
