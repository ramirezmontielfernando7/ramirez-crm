"use client";

import { useCallback, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, Sparkles, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageShell } from "@/components/ui/page-shell";
import { fetchJson } from "@/lib/fetch-json";
import { formatSize, LIBRARY_FILE_MAX_BYTES, libraryFileProblem } from "@/lib/upload-limits";
import { cn } from "@/lib/utils";

export type UploadLinkView =
  | { kind: "message"; text: string }
  | {
      kind: "link";
      token: string;
      note: string | null;
      tags: string[];
      inChat: boolean;
      rag: boolean;
      groupName: string | null;
      expiresAt: string;
      maxFiles: number;
      /** null = abierto. */
      closedText: string | null;
      uploaded: { id: string; title: string; fileName: string | null }[];
    };

type Item = {
  key: string;
  name: string;
  size: number;
  status: "waiting" | "uploading" | "done" | "error";
  message?: string;
};

const ACCEPT = ".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg,.webp";
const fmt = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

/**
 * 047 — `/subir/<token>`: la persona sube aquí los archivos que le pidió su
 * IA. Uno por uno (cada uno con su resultado), con las etiquetas y los
 * destinos del enlace; «Listo» lo cierra.
 */
export function UploadLinkClient({ view }: { view: UploadLinkView }) {
  return (
    <PageShell title="Subir archivos" icon={Upload} pillar={false}>
      <div className="mx-auto max-w-2xl space-y-5 py-2">
        {view.kind === "message" ? (
          <Card>
            <CardContent className="flex items-start gap-3 pt-6 text-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" aria-hidden />
              <p>{view.text}</p>
            </CardContent>
          </Card>
        ) : (
          <LinkUploader view={view} />
        )}
      </div>
    </PageShell>
  );
}

function LinkUploader({ view }: { view: Extract<UploadLinkView, { kind: "link" }> }) {
  const [items, setItems] = useState<Item[]>([]);
  const [closed, setClosed] = useState<string | null>(view.closedText);
  const [done, setDone] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const queue = useRef(Promise.resolve());
  const count = useRef(view.uploaded.length);

  const patch = (key: string, p: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
        const problem = libraryFileProblem(file.type, file.name, file.size);
        if (problem) {
          setItems((l) => [...l, { key, name: file.name, size: file.size, status: "error", message: problem.message }]);
          continue;
        }
        if (count.current >= view.maxFiles) {
          setItems((l) => [
            ...l,
            { key, name: file.name, size: file.size, status: "error", message: `Este enlace recibe hasta ${view.maxFiles} archivos.` },
          ]);
          continue;
        }
        count.current += 1;
        setItems((l) => [...l, { key, name: file.name, size: file.size, status: "waiting" }]);
        // De uno en uno: cada archivo con su resultado y sin saturar el servidor.
        queue.current = queue.current.then(async () => {
          patch(key, { status: "uploading" });
          const form = new FormData();
          form.set("file", file);
          const res = await fetchJson<{ ragError: string | null }>(
            `/api/ai-connector/upload-links/${view.token}/files`,
            { method: "POST", body: form }
          );
          if (res.ok) {
            patch(key, {
              status: "done",
              message: res.data.ragError ? `Se guardó, pero la IA del CRM no lo pudo leer: ${res.data.ragError}` : undefined,
            });
          } else {
            count.current -= 1;
            patch(key, { status: "error", message: res.error });
            if (res.status === 410) setClosed(res.error);
          }
        });
      }
    },
    [view.maxFiles, view.token]
  );

  const busy = items.some((i) => i.status === "waiting" || i.status === "uploading");
  const okCount = view.uploaded.length + items.filter((i) => i.status === "done").length;

  async function finish() {
    setClosing(true);
    await queue.current;
    await fetchJson(`/api/ai-connector/upload-links/${view.token}/close`, { method: "POST" });
    setClosing(false);
    setDone(true);
  }

  if (done) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="h-10 w-10 text-success-text" aria-hidden />
          <p className="text-base font-semibold">Listo, se subieron {okCount} archivos a la Biblioteca</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Ya puedes volver a tu IA y decirle que terminaste. Ella ve lo que subiste y puede acomodarlo.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-brand-text" aria-hidden />
            Tu IA te pidió subir archivos
          </CardTitle>
          <CardDescription>Se guardan en la Biblioteca con tu nombre, como si los subieras desde ahí.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {view.note && (
            <p className="rounded-md border-l-2 border-brand bg-subtle px-3 py-2 text-foreground">{view.note}</p>
          )}
          <dl className="grid gap-2 sm:grid-cols-[110px_1fr]">
            <dt className="text-text-3">Destino</dt>
            <dd className="flex flex-wrap gap-1.5">
              {view.inChat && <Badge variant="secondary">💬 Envío en chat</Badge>}
              {view.rag && <Badge variant="secondary">🤖 Lectura IA · {view.groupName}</Badge>}
            </dd>
            {view.tags.length > 0 && (
              <>
                <dt className="text-text-3">Etiquetas</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {view.tags.map((t) => (
                    <Badge key={t} variant="outline">{t}</Badge>
                  ))}
                </dd>
              </>
            )}
            <dt className="text-text-3">Vence</dt>
            <dd>
              {fmt.format(new Date(view.expiresAt))} · hasta {view.maxFiles} archivos
            </dd>
          </dl>
        </CardContent>
      </Card>

      {closed ? (
        <Card>
          <CardContent className="flex items-start gap-3 pt-6 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" aria-hidden />
            <p>{closed}</p>
          </CardContent>
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border-strong bg-card px-6 py-10 text-center transition-colors hover:border-brand",
            dragging && "border-brand bg-brand-soft"
          )}
          data-testid="upload-dropzone"
        >
          <Upload className="h-7 w-7 text-brand-text" aria-hidden />
          <span className="text-sm font-semibold">Arrastra aquí tus archivos o elígelos de tu equipo</span>
          <span className="text-xs text-text-3">
            PDF, Word, texto o imagen · hasta {formatSize(LIBRARY_FILE_MAX_BYTES)} cada uno
          </span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </button>
      )}

      {(view.uploaded.length > 0 || items.length > 0) && (
        <Card>
          <CardContent className="pt-4">
            <ul className="divide-y" data-testid="upload-items">
              {view.uploaded.map((u) => (
                <FileRow key={u.id} name={u.fileName ?? u.title} status="done" />
              ))}
              {items.map((i) => (
                <FileRow key={i.key} name={i.name} size={i.size} status={i.status} message={i.message} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {!closed && (
        <div className="flex items-center justify-end gap-3">
          <span className="text-xs text-text-3">{okCount} subidos</span>
          <Button onClick={finish} disabled={busy || closing || okCount === 0}>
            {closing || busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Listo
          </Button>
        </div>
      )}
    </>
  );
}

function FileRow({ name, size, status, message }: { name: string; size?: number; status: Item["status"]; message?: string }) {
  return (
    <li className="flex items-start gap-3 py-2.5">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-text-3" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        {(size !== undefined || message) && (
          <p className={cn("text-xs", status === "error" ? "text-danger-text" : "text-text-3")}>
            {message ?? formatSize(size!)}
          </p>
        )}
      </div>
      <span className="shrink-0 text-xs">
        {status === "done" && <CheckCircle2 className="h-4 w-4 text-success-text" aria-label="Subido" />}
        {status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-brand-text" aria-label="Subiendo" />}
        {status === "waiting" && <span className="text-text-3">En fila</span>}
        {status === "error" && <AlertCircle className="h-4 w-4 text-danger-text" aria-label="No se subió" />}
      </span>
    </li>
  );
}
