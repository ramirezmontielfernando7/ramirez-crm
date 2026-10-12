"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionTabs, type SectionTab } from "@/components/ui/section-tabs";
import { FloatingMenu, MenuItem, type MenuAnchor } from "@/components/inbox/floating-menu";
import { ConfirmDialog } from "@/components/lab/confirm-dialog";
import { call, formatDate } from "@/components/lab/agents-api";
import { GENERAL_GROUP_KEY, GROUP_NAME_MAX, groupIdFromKey, groupKey } from "@/lib/kb-docs";
import type { KbDocumentView } from "@/server/kb-docs/http";
import type { KbGroupSummary } from "@/server/kb-docs/store";

type Listing = {
  documents: KbDocumentView[];
  usage: { documents: number; chunks: number; exclusive: number };
  limits: { maxFileBytes: number; maxDocuments: number; maxChunks: number; maxChars: number };
  embeddings: { enabled: boolean; model: string | null };
  accept: string;
};

type Groups = { groups: KbGroupSummary[]; maxGroups: number };

const POLL_MS = 2000;

function bytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function badgeVariant(d: KbDocumentView): "success" | "warning" | "secondary" | "destructive" {
  if (d.status === "failed") return "destructive";
  if (d.status === "ready") return d.statusLabel === "Listo" ? "success" : "warning";
  return "secondary";
}

const hrefOf = (id: string | null) => (id ? `/lab/documentos/${id}` : "/lab/documentos");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * 035 — Laboratorio → Documentos: lo que el agente consulta antes de
 * responder (manuales, precios, FAQs, políticas). Lista con estado de
 * indexado (se refresca sola mientras hay documentos en proceso), subir,
 * reindexar y eliminar. El cliente final nunca ve esto.
 *
 * 037 — Organizada por GRUPOS (subpestañas que son rutas: General en
 * `/lab/documentos`, cada grupo en `/lab/documentos/[id]`). Crear, renombrar
 * y eliminar grupos (moviendo sus documentos a General o borrándolos), y
 * mover un documento de grupo.
 */
export function DocumentsClient({ groupKey: activeKey = GENERAL_GROUP_KEY }: { groupKey?: string }) {
  const router = useRouter();
  const activeId = groupIdFromKey(activeKey);
  const [data, setData] = useState<Listing | null>(null);
  const [groups, setGroups] = useState<Groups | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<KbDocumentView | null>(null);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState<{ mode: "create" } | { mode: "rename"; group: KbGroupSummary } | null>(null);
  const [removingGroup, setRemovingGroup] = useState<KbGroupSummary | null>(null);
  const [groupMenu, setGroupMenu] = useState<MenuAnchor | null>(null);
  const [docMenu, setDocMenu] = useState<{ doc: KbDocumentView; anchor: MenuAnchor } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const groupMenuBtn = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const [docs, list] = await Promise.all([
      call<Listing>(`/api/lab/documents?group=${encodeURIComponent(activeKey)}`),
      call<Groups>("/api/lab/document-groups"),
    ]);
    if (docs.ok && list.ok) {
      setData(docs.data);
      setGroups(list.data);
      setLoadError(null);
    } else setLoadError(!docs.ok ? docs.message : !list.ok ? list.message : null);
  }, [activeKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const inProgress = data?.documents.some((d) => d.status === "pending" || d.status === "processing") ?? false;
  useEffect(() => {
    if (!inProgress) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [inProgress, load]);

  async function upload(file: File) {
    setError(null);
    setNotice(null);
    if (data && file.size > data.limits.maxFileBytes) {
      setError(`El archivo pasa del máximo de ${bytes(data.limits.maxFileBytes)}.`);
      return;
    }
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("groupId", activeKey);
    const r = await call<{ document: KbDocumentView }>("/api/lab/documents", { method: "POST", body: form });
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (!r.ok) return setError(r.message);
    setNotice(`«${r.data.document.title}» se subió. Se está indexando; en unos segundos el agente ya lo consulta.`);
    void load();
  }

  async function reindex(d: KbDocumentView) {
    setError(null);
    const r = await call(`/api/lab/documents/${d.id}/reindex`, { method: "POST" });
    if (!r.ok) setError(r.message);
    void load();
  }

  async function move(d: KbDocumentView, to: KbGroupSummary) {
    setError(null);
    setNotice(null);
    const r = await call(`/api/lab/documents/${d.id}`, { method: "PATCH", json: { groupId: groupKey(to.id) } });
    if (!r.ok) return setError(r.message);
    setNotice(`«${d.title}» pasó a ${to.name}.`);
    void load();
  }

  async function remove() {
    if (!toDelete) return;
    setBusy(true);
    const r = await call(`/api/lab/documents/${toDelete.id}`, { method: "DELETE" });
    setBusy(false);
    setToDelete(null);
    if (!r.ok) setError(r.message);
    void load();
  }

  if (loadError) return <p className="p-6 text-sm text-destructive">{loadError}</p>;
  if (!data || !groups) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Cargando…</div>;
  }

  const active = groups.groups.find((g) => g.id === activeId) ?? null;
  const atLimit = data.usage.documents >= data.limits.maxDocuments;
  const atGroupLimit = groups.groups.length - 1 >= groups.maxGroups;
  const tabs: SectionTab[] = groups.groups.map((g) => ({ href: hrefOf(g.id), label: g.name }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Subpestañas de grupos + «Grupo» (se desplazan solas en móvil) */}
      <div className="flex items-end gap-1 border-b px-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <SectionTabs tabs={tabs} label="Grupos de documentos" />
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="mb-1 shrink-0"
          onClick={() => setNaming({ mode: "create" })}
          disabled={atGroupLimit}
          title={atGroupLimit ? `Llegaste al máximo de ${groups.maxGroups} grupos` : "Crear un grupo"}
        >
          <Plus className="h-4 w-4" /> Grupo
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!active ? (
          <div className="mx-auto max-w-3xl p-4 text-sm sm:p-6">
            <p className="text-muted-foreground">Ese grupo ya no existe.</p>
            <Button className="mt-3" variant="outline" onClick={() => router.push("/lab/documentos")}>
              Ir a General
            </Button>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <h3 className="truncate text-[15px] font-semibold text-foreground" data-testid="kb-group-title">
                  {active.name}
                </h3>
                <p className="text-sm">
                  Sube manuales, listas de precios, preguntas frecuentes o políticas. Antes de responder, el agente busca
                  aquí lo que viene al caso. <span className="text-muted-foreground">Tus clientes nunca ven esta pestaña.</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Formatos: .txt, .md y .pdf con texto (no escaneado), hasta {bytes(data.limits.maxFileBytes)} cada uno. El
                  contenido se usa como información, nunca como instrucciones para el agente.
                </p>
              </div>
              {active.id && (
                <button
                  ref={groupMenuBtn}
                  type="button"
                  aria-label={`Opciones del grupo ${active.name}`}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  onClick={(e) => setGroupMenu({ kind: "rect", rect: e.currentTarget.getBoundingClientRect() })}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3">
              <div className="text-sm">
                <span className="font-medium" data-testid="kb-docs-usage">
                  {data.usage.documents} de {data.limits.maxDocuments} documentos
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {data.usage.chunks.toLocaleString("es-MX")} de {data.limits.maxChunks.toLocaleString("es-MX")} fragmentos
                  {data.usage.exclusive > 0 && (
                    <span data-testid="kb-docs-exclusive"> · {plural(data.usage.exclusive, "exclusivo de un agente", "exclusivos de agentes")}</span>
                  )}
                </span>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {data.embeddings.enabled
                    ? "Búsqueda por significado y por texto."
                    : "Búsqueda por texto (el servicio de embeddings no está configurado)."}
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept={data.accept}
                className="hidden"
                data-testid="kb-docs-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                }}
              />
              <Button
                onClick={() => fileRef.current?.click()}
                disabled={uploading || atLimit}
                title={atLimit ? "Llegaste al máximo de documentos" : undefined}
              >
                <Upload className="h-4 w-4" /> {uploading ? "Subiendo…" : "Subir documento"}
              </Button>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="text-sm text-muted-foreground">
                {notice}
              </p>
            )}

            {data.documents.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                <FileText className="mx-auto mb-2 h-6 w-6" strokeWidth={1.5} />
                {active.id
                  ? `Aún no hay documentos en ${active.name}.`
                  : data.usage.documents === 0
                    ? "Aún no hay documentos. Mientras no subas ninguno, el agente responde solo con su conocimiento de siempre."
                    : "Aún no hay documentos en General."}
              </div>
            ) : (
              <ul className="divide-y rounded-lg border bg-card" data-testid="kb-docs-list">
                {data.documents.map((d) => (
                  <li key={d.id} className="flex items-center gap-x-3 px-4 py-3" data-doc-id={d.id}>
                    <div className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{d.title}</span>
                        <Badge variant={badgeVariant(d)} data-testid="kb-doc-status">
                          {d.statusLabel}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {d.filename} · {bytes(d.byteSize)} · {formatDate(d.createdAt)}
                        {d.status === "ready" && ` · ${plural(d.chunkCount, "fragmento", "fragmentos")}`}
                      </span>
                      {d.errorMessage && d.status === "failed" && (
                        <span className="mt-1 block text-xs text-destructive">{d.errorMessage}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label={`Opciones de ${d.title}`}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      onClick={(e) => setDocMenu({ doc: d, anchor: { kind: "rect", rect: e.currentTarget.getBoundingClientRect() } })}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {groupMenu && active?.id && (
        <FloatingMenu anchor={groupMenu} onClose={() => setGroupMenu(null)} label={`Opciones del grupo ${active.name}`} triggerRef={groupMenuBtn}>
          <MenuItem
            onSelect={() => {
              setGroupMenu(null);
              setNaming({ mode: "rename", group: active });
            }}
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} /> Renombrar
          </MenuItem>
          <MenuItem
            danger
            onSelect={() => {
              setGroupMenu(null);
              setRemovingGroup(active);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} /> Eliminar grupo
          </MenuItem>
        </FloatingMenu>
      )}

      {docMenu && (
        <FloatingMenu anchor={docMenu.anchor} onClose={() => setDocMenu(null)} label={`Opciones de ${docMenu.doc.title}`}>
          {groups.groups.length > 1 && (
            <>
              <p className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Mover a</p>
              {groups.groups.map((g) => {
                const here = g.id === activeId;
                return (
                  <MenuItem
                    key={g.id ?? GENERAL_GROUP_KEY}
                    disabled={here}
                    onSelect={() => {
                      const d = docMenu.doc;
                      setDocMenu(null);
                      void move(d, g);
                    }}
                  >
                    {here ? <Check className="h-3.5 w-3.5" strokeWidth={1.8} /> : <span className="w-3.5" />}
                    <span className="truncate">{g.name}</span>
                  </MenuItem>
                );
              })}
              <div className="my-1 border-t" />
            </>
          )}
          {(docMenu.doc.status === "failed" || docMenu.doc.statusLabel === "Listo (solo texto)") && (
            <MenuItem
              onSelect={() => {
                const d = docMenu.doc;
                setDocMenu(null);
                void reindex(d);
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} /> Reindexar
            </MenuItem>
          )}
          <MenuItem
            danger
            onSelect={() => {
              setToDelete(docMenu.doc);
              setDocMenu(null);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} /> Eliminar
          </MenuItem>
        </FloatingMenu>
      )}

      {naming && (
        <GroupNameDialog
          initial={naming.mode === "rename" ? naming.group.name : ""}
          title={naming.mode === "rename" ? "Renombrar grupo" : "Nuevo grupo"}
          confirmLabel={naming.mode === "rename" ? "Guardar" : "Crear"}
          onCancel={() => setNaming(null)}
          onSubmit={async (name) => {
            const r =
              naming.mode === "rename"
                ? await call<{ group: { id: string } }>(`/api/lab/document-groups/${naming.group.id}`, { method: "PATCH", json: { name } })
                : await call<{ group: { id: string } }>("/api/lab/document-groups", { method: "POST", json: { name } });
            if (!r.ok) return r.message;
            setNaming(null);
            if (naming.mode === "create") router.push(hrefOf(r.data.group.id));
            else void load();
            return null;
          }}
        />
      )}

      {removingGroup && (
        <DeleteGroupDialog
          group={removingGroup}
          onCancel={() => setRemovingGroup(null)}
          onDone={() => {
            setRemovingGroup(null);
            router.push("/lab/documentos");
          }}
        />
      )}

      {toDelete && (
        <ConfirmDialog
          title={`¿Eliminar «${toDelete.title}»?`}
          confirmLabel="Eliminar"
          destructive
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setToDelete(null)}
        >
          <p>El agente deja de consultarlo desde el siguiente mensaje. No se puede deshacer: tendrías que volver a subirlo.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/** 037 — Crear o renombrar un grupo: un solo campo. */
function GroupNameDialog({
  title,
  initial,
  confirmLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: string;
  confirmLabel: string;
  /** Devuelve el error en palabras, o `null` si salió bien. */
  onSubmit: (name: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const err = await onSubmit(name.trim());
    setBusy(false);
    setError(err);
  }
  return (
    <ConfirmDialog title={title} confirmLabel={confirmLabel} busy={busy} onConfirm={() => void submit()} onCancel={onCancel}>
      <label htmlFor="kb-group-name" className="sr-only">
        Nombre del grupo
      </label>
      <Input
        id="kb-group-name"
        autoFocus
        maxLength={GROUP_NAME_MAX}
        placeholder="Ventas, Administración, Dirección…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </ConfirmDialog>
  );
}

/**
 * 037 (D2) — Eliminar un grupo. Con documentos: «Mover sus documentos a
 * General» (por defecto) o «Eliminar también sus documentos», y en el segundo
 * caso una confirmación más (es lo único irreversible).
 */
function DeleteGroupDialog({
  group,
  onCancel,
  onDone,
}: {
  group: KbGroupSummary;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<"move" | "delete">("move");
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = group.documents;
  const docs = plural(n, "documento", "documentos");

  async function run() {
    if (mode === "delete" && n > 0 && step === "choose") return setStep("confirm");
    setBusy(true);
    const r = await call<{ documents: number }>(`/api/lab/document-groups/${group.id}?documents=${mode}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onDone();
  }

  if (step === "confirm") {
    return (
      <ConfirmDialog
        title={`¿Borrar para siempre ${n === 1 ? "su documento" : `sus ${n} documentos`}?`}
        confirmLabel={`Sí, borrar ${docs}`}
        destructive
        busy={busy}
        onConfirm={() => void run()}
        onCancel={() => setStep("choose")}
        cancelLabel="Volver"
      >
        <p>Esto no se puede deshacer: los agentes dejan de consultarlos y tendrías que volver a subirlos.</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      title={`¿Eliminar el grupo «${group.name}»?`}
      confirmLabel={n > 0 && mode === "delete" ? "Continuar" : "Eliminar grupo"}
      destructive
      busy={busy}
      onConfirm={() => void run()}
      onCancel={onCancel}
    >
      {n === 0 ? (
        <p>El grupo está vacío.</p>
      ) : (
        <>
          <p>Tiene {docs}.</p>
          <fieldset className="space-y-2">
            <legend className="sr-only">Qué hacer con sus documentos</legend>
            <label className="flex cursor-pointer items-start gap-2 text-foreground">
              <input type="radio" name="kb-group-delete" className="mt-1 accent-[var(--accent)]" checked={mode === "move"} onChange={() => setMode("move")} />
              <span>
                Mover sus documentos a General
                <span className="block text-xs text-muted-foreground">Los siguen leyendo los agentes que usan todos los documentos de la empresa.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-foreground">
              <input type="radio" name="kb-group-delete" className="mt-1 accent-[var(--accent)]" checked={mode === "delete"} onChange={() => setMode("delete")} />
              <span>
                Eliminar también sus documentos
                <span className="block text-xs text-muted-foreground">No se puede deshacer.</span>
              </span>
            </label>
          </fieldset>
        </>
      )}
      {(group.agents ?? 0) > 0 && (
        <p className="text-foreground" data-testid="kb-group-delete-agents">
          {(group.agents ?? 0) === 1
            ? "1 agente elige este grupo en «Solo estos grupos»: al eliminarlo, deja de leer sus documentos."
            : `${group.agents} agentes eligen este grupo en «Solo estos grupos»: al eliminarlo, dejan de leer sus documentos.`}
        </p>
      )}
      {error && <p role="alert" className="text-destructive">{error}</p>}
    </ConfirmDialog>
  );
}
