"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, RefreshCw, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/lab/confirm-dialog";
import { call, formatDate } from "@/components/lab/agents-api";
import type { KbDocumentView } from "@/server/kb-docs/http";

type Listing = {
  documents: KbDocumentView[];
  usage: { documents: number; chunks: number };
  limits: { maxFileBytes: number; maxDocuments: number; maxChunks: number; maxChars: number };
  embeddings: { enabled: boolean; model: string | null };
  accept: string;
};

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

/**
 * 035 — Laboratorio → Documentos: lo que el agente consulta antes de
 * responder (manuales, precios, FAQs, políticas). Lista con estado de
 * indexado (se refresca sola mientras hay documentos en proceso), subir,
 * reindexar y eliminar. El cliente final nunca ve esto.
 */
export function DocumentsClient() {
  const [data, setData] = useState<Listing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toDelete, setToDelete] = useState<KbDocumentView | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await call<Listing>("/api/lab/documents");
    if (r.ok) {
      setData(r.data);
      setLoadError(null);
    } else setLoadError(r.message);
  }, []);

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
  if (!data) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Cargando…</div>;
  }

  const atLimit = data.usage.documents >= data.limits.maxDocuments;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <div className="space-y-1">
          <p className="text-sm">
            Sube manuales, listas de precios, preguntas frecuentes o políticas. Antes de responder, el agente busca aquí lo
            que viene al caso. <span className="text-muted-foreground">Tus clientes nunca ven esta pestaña.</span>
          </p>
          <p className="text-xs text-muted-foreground">
            Formatos: .txt, .md y .pdf con texto (no escaneado), hasta {bytes(data.limits.maxFileBytes)} cada uno. El
            contenido se usa como información, nunca como instrucciones para el agente.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3">
          <div className="text-sm">
            <span className="font-medium" data-testid="kb-docs-usage">
              {data.usage.documents} de {data.limits.maxDocuments} documentos
            </span>
            <span className="text-muted-foreground">
              {" "}
              · {data.usage.chunks.toLocaleString("es-MX")} de {data.limits.maxChunks.toLocaleString("es-MX")} fragmentos
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
            Aún no hay documentos. Mientras no subas ninguno, el agente responde solo con su conocimiento de siempre.
          </div>
        ) : (
          <ul className="divide-y rounded-lg border bg-card" data-testid="kb-docs-list">
            {data.documents.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-doc-id={d.id}>
                <div className="min-w-0 flex-1 basis-56">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{d.title}</span>
                    <Badge variant={badgeVariant(d)} data-testid="kb-doc-status">
                      {d.statusLabel}
                    </Badge>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {d.filename} · {bytes(d.byteSize)} · {formatDate(d.createdAt)}
                    {d.status === "ready" && ` · ${d.chunkCount} fragmento${d.chunkCount === 1 ? "" : "s"}`}
                  </span>
                  {d.errorMessage && d.status === "failed" && (
                    <span className="mt-1 block text-xs text-destructive">{d.errorMessage}</span>
                  )}
                </div>
                <span className="flex flex-wrap gap-1">
                  {(d.status === "failed" || d.statusLabel === "Listo (solo texto)") && (
                    <Button size="sm" variant="ghost" onClick={() => void reindex(d)}>
                      <RefreshCw className="h-3.5 w-3.5" /> Reindexar
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setToDelete(d)}>
                    Eliminar
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

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
