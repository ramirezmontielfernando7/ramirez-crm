"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import {
  KNOWLEDGE_ACCEPT,
  KNOWLEDGE_BODY_MAX,
  KNOWLEDGE_TITLE_MAX,
  type KnowledgeEntryDto,
} from "@/lib/knowledge";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes } from "@/components/inbox/helpers";
import { Switch } from "@/components/ui/switch";
import { DESTINATION_LABEL } from "@/lib/knowledge";

type Group = { id: string | null; name: string };

/**
 * 024 — Crear o editar una entrada: título, texto, etiquetas y archivo.
 * 040 — Al crear, con Documentos del agente y `agent.manage`: «Entrenar
 * también al Agente de IA con este documento (RAG)» y su grupo.
 */
export function KnowledgeEditor({
  entry,
  canTrainAgent = false,
  onClose,
  onSaved,
}: {
  entry: KnowledgeEntryDto | null;
  canTrainAgent?: boolean;
  onClose: () => void;
  /** `warning`: la entrada se guardó pero la IA no la pudo leer (motivo). */
  onSaved: (warning?: string) => void;
}) {
  const [title, setTitle] = useState(entry?.title ?? "");
  const [body, setBody] = useState(entry?.body ?? "");
  const [tags, setTags] = useState(entry?.tags.join(", ") ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const offerRag = canTrainAgent && !entry;
  const [rag, setRag] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState("general");

  useEffect(() => {
    if (!offerRag) return;
    let vivo = true;
    void fetchJson<{ groups: Group[] }>("/api/lab/document-groups").then((r) => {
      if (vivo && r.ok) setGroups(r.data.groups);
    });
    return () => {
      vivo = false;
    };
  }, [offerRag]);

  const currentFile = !removeFile && !file ? entry?.file ?? null : null;
  const hasContent = body.trim().length > 0 || file !== null || currentFile !== null;
  const ready = title.trim().length > 0 && hasContent && !saving;

  async function save() {
    setSaving(true);
    setError(null);
    const form = new FormData();
    form.set("title", title.trim());
    form.set("body", body.trim());
    form.set("tags", tags);
    if (file) form.set("file", file);
    else if (removeFile) form.set("removeFile", "true");
    if (offerRag && rag) {
      form.set("rag", "true");
      form.set("ragGroupId", groupId);
    }
    const res = await fetchJson<{ ragError?: { message: string } | string | null }>(entry ? `/api/knowledge/${entry.id}` : "/api/knowledge", {
      method: entry ? "PATCH" : "POST",
      body: form,
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const ragError = res.data.ragError;
    onSaved(
      ragError
        ? `Se guardó en la Biblioteca, pero el agente no lo pudo leer: ${typeof ragError === "string" ? ragError : ragError.message}`
        : undefined
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={entry ? "Editar entrada" : "Nueva entrada"}
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold">{entry ? "Editar entrada" : "Nueva entrada"}</h3>
        <p className="mb-4 text-xs text-text-3">
          Escribe una respuesta tipo, sube un archivo (PDF, imagen, Word o texto) o ambos. Desde
          cualquier chat se envía como mensaje o como archivo.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="kn-title">Título</label>
            <Input
              id="kn-title"
              value={title}
              maxLength={KNOWLEDGE_TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Política de envíos"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="kn-body">Contenido</label>
            <Textarea
              id="kn-body"
              rows={6}
              value={body}
              maxLength={KNOWLEDGE_BODY_MAX}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Enviamos a todo México en 2 a 4 días hábiles…"
            />
            <p className="text-[11px] text-text-3">
              Es el texto que se manda como mensaje; con un archivo, va como su pie si cabe (1024 caracteres).
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="kn-tags">Etiquetas (opcional)</label>
            <Input
              id="kn-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="envíos, políticas"
            />
            <p className="text-[11px] text-text-3">Sepáralas con comas.</p>
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">Archivo (opcional)</span>
            <input
              ref={fileRef}
              type="file"
              accept={KNOWLEDGE_ACCEPT}
              aria-label="Archivo de la entrada"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setRemoveFile(false);
              }}
            />
            {file || currentFile ? (
              <div className="flex items-center gap-2.5 rounded-md border bg-subtle p-2.5">
                <FileText className="h-7 w-7 shrink-0 text-brand" strokeWidth={1.5} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file?.name ?? currentFile?.name}</p>
                  <p className="text-xs text-text-3">{formatBytes(file?.size ?? currentFile?.size ?? 0)}</p>
                </div>
                <button
                  onClick={() => {
                    if (file) setFile(null);
                    else setRemoveFile(true);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  aria-label="Quitar archivo"
                  className="rounded p-1 text-text-3 hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" strokeWidth={1.7} />
                </button>
              </div>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-1 h-4 w-4" strokeWidth={1.8} />
                Subir archivo
              </Button>
            )}
          </div>
          {offerRag && (
            <div className="space-y-2 rounded-md border bg-subtle p-2.5" data-testid="knowledge-rag-option">
              <label className="flex items-start gap-2 text-sm">
                <Switch
                  size="sm"
                  checked={rag}
                  label="Entrenar también al Agente de IA con este documento (RAG)"
                  onCheckedChange={setRag}
                />
                <span>
                  Entrenar también al Agente de IA con este documento (RAG)
                  <span className="block text-[11px] text-text-3">
                    {DESTINATION_LABEL.rag}: lee el texto del .pdf, .txt o .md (o el contenido escrito). Cuenta contra
                    tus límites de documentos.
                  </span>
                </span>
              </label>
              {rag && groups.length > 1 && (
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  aria-label="Grupo de documentos"
                  className="h-8 rounded-sm border bg-background px-2 text-sm"
                  data-testid="knowledge-rag-group"
                >
                  {groups.map((g) => (
                    <option key={g.id ?? "general"} value={g.id ?? "general"}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>
        )}
        {!hasContent && title.trim() && (
          <p className="mt-3 text-xs text-text-3">Agrega un contenido de texto o un archivo.</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" disabled={!ready} onClick={() => void save()}>
            {saving ? "Guardando…" : entry ? "Guardar cambios" : "Crear entrada"}
          </Button>
        </div>
      </div>
    </div>
  );
}
