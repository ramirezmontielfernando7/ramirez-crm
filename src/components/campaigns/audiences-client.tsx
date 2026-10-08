"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, Trash2, Upload, Users } from "lucide-react";
import {
  AUDIENCE_ACCEPT,
  AUDIENCE_MAX_MB,
  IMPORT_COLUMN_LABEL,
  type AudienceDto,
  type AudiencePreviewDto,
  type ImportColumn,
} from "@/lib/audiences";
import { fetchJson } from "@/lib/fetch-json";
import type { ConsentAnswer, ImportConsentResult, OptOutTreatment } from "@/lib/import-consent";
import { ConsentQuestion, ConsentResultLine, OptOutPanel } from "@/components/import-consent";
import { ImportTagPicker, extraTagFormFields, type ExtraTagChoice } from "@/components/tags/import-tag-picker";
import { useViewer } from "@/components/viewer-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampaignsTabs } from "./campaigns-tabs";

/** Los campos que se pueden asignar en "¿qué es cada columna?". */
const MAPPABLE: ImportColumn[] = ["name", "phone", "email", "tags"];

type ImportResult = {
  audience: AudienceDto;
  summary: {
    created: number;
    updated: number;
    failed: number;
    warnings: { reason: string }[];
    consent: ImportConsentResult;
    extraTag?: { id: string; name: string } | null;
  };
};

/**
 * Campañas v2 — Audiencias: subir una base .xlsx o .csv, decir qué es cada
 * columna si no se reconoce, revisar las filas (inválidas en rojo), declarar
 * si aceptaron mensajes (antes de la vista previa), decidir qué pasa con
 * quien ya pidió no recibir e importarla. La base queda guardada para
 * usarla como público de una campaña.
 */
export function AudiencesClient() {
  const [audiences, setAudiences] = useState<AudienceDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetchJson<{ audiences: AudienceDto[] }>("/api/campaigns/audiences");
    if (!res.ok) {
      setListError(`No se pudieron cargar las audiencias: ${res.error}`);
      return;
    }
    setListError(null);
    setAudiences(res.data.audiences);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function remove(a: AudienceDto) {
    if (!window.confirm(`¿Borrar la base «${a.name}»? Los contactos y su etiqueta se quedan.`)) return;
    const res = await fetchJson(`/api/campaigns/audiences/${a.id}`, { method: "DELETE" });
    if (!res.ok) {
      setListError(`No se pudo borrar: ${res.error}`);
      return;
    }
    void refetch();
  }

  return (
    <div className="flex h-full flex-col">
      <CampaignsTabs
        actions={
          !uploading && (
            <Button size="sm" onClick={() => setUploading(true)} data-testid="audience-new">
              <Upload className="mr-1.5 h-4 w-4" strokeWidth={1.8} />
              Subir base
            </Button>
          )
        }
      />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-4xl space-y-4">
          {uploading && (
            <UploadFlow
              onCancel={() => setUploading(false)}
              onImported={() => {
                void refetch();
              }}
            />
          )}
          {listError && (
            <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
              {listError}
            </p>
          )}
          {audiences === null ? (
            !listError && <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : audiences.length === 0 && !uploading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <Users className="h-8 w-8 text-text-3" strokeWidth={1.5} />
              <p className="text-sm font-medium">Sin bases todavía</p>
              <p className="max-w-sm text-xs text-muted-foreground">
                Sube tu lista de clientes en Excel (.xlsx) o CSV con las columnas nombre, numero, correo y etiquetas.
              </p>
              <SampleLinks />
            </div>
          ) : (
            <ul className="space-y-2" data-testid="audience-list">
              {audiences.map((a) => (
                <li key={a.id} className="rounded-lg border bg-card px-4 py-3" data-testid="audience-row">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                        <FileSpreadsheet className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.6} />
                        {a.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.fileName} · {new Date(a.createdAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}
                        {a.tag ? ` · etiqueta «${a.tag.name}»` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/campaigns/new?audience=${a.id}`}>
                        <Button size="sm" variant="outline">Crear campaña</Button>
                      </Link>
                      {a.failuresCount > 0 && (
                        <a href={`/api/campaigns/audiences/${a.id}/failures`} download>
                          <Button size="sm" variant="ghost" type="button">
                            <Download className="mr-1 h-4 w-4" /> Filas con error
                          </Button>
                        </a>
                      )}
                      <Button size="sm" variant="ghost" aria-label={`Borrar ${a.name}`} onClick={() => void remove(a)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 text-xs">
                    <b>{a.consent.optIn.toLocaleString("es-MX")}</b> pueden recibir campañas
                    {a.consent.optOut > 0 && ` · ${a.consent.optOut} pidieron no recibir`}
                    {a.consent.unknown > 0 && ` · ${a.consent.unknown} sin consentimiento`}
                    {a.counts.invalid + a.counts.duplicate > 0 &&
                      ` · ${a.counts.invalid} inválidas y ${a.counts.duplicate} duplicadas en el archivo`}
                  </p>
                  {a.columns.length > 0 && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Columnas para variables: {a.columns.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function SampleLinks() {
  return (
    <p className="text-xs text-muted-foreground">
      Archivo de ejemplo:{" "}
      <a className="font-medium text-brand-text underline underline-offset-2" href="/api/campaigns/audiences/sample?format=xlsx" download>
        .xlsx
      </a>{" "}
      ·{" "}
      <a className="font-medium text-brand-text underline underline-offset-2" href="/api/campaigns/audiences/sample?format=csv" download>
        .csv
      </a>
    </p>
  );
}

export function UploadFlow({
  onCancel,
  onImported,
  compact = false,
}: {
  onCancel: () => void;
  onImported: (audience: AudienceDto) => void;
  /** Dentro del asistente: sin los botones de "crear campaña" del resultado. */
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<AudiencePreviewDto | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportColumn, number>>>({});
  const [editingColumns, setEditingColumns] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [answer, setAnswer] = useState<ConsentAnswer | null>(null);
  const [treatment, setTreatment] = useState<OptOutTreatment | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [extraTag, setExtraTag] = useState<ExtraTagChoice>(null);
  const viewer = useViewer();
  const canOverride = viewer.can("contacts.consent_override");
  const canCreateTag = viewer.can("tags.manage");

  async function runPreview(f: File, m?: Partial<Record<ImportColumn, number>>) {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", f);
    if (m) form.set("mapping", JSON.stringify(m));
    const res = await fetchJson<{ preview: AudiencePreviewDto }>("/api/campaigns/audiences/preview", {
      method: "POST",
      body: form,
    });
    setBusy(false);
    if (!res.ok) {
      setPreview(null);
      setError(res.error);
      return;
    }
    setPreview(res.data.preview);
    setTreatment(null);
    setMapping(res.data.preview.mapping);
    if (res.data.preview.missing.length > 0) setEditingColumns(true);
  }

  function pick(f: File | null) {
    setResult(null);
    setFile(f);
    setPreview(null);
    setEditingColumns(false);
    setError(null);
    if (!f) return;
    if (f.size > AUDIENCE_MAX_MB * 1024 * 1024) {
      setError(`El archivo pesa más de ${AUDIENCE_MAX_MB} MB: divídelo en varios`);
      return;
    }
    setName(f.name.replace(/\.(xlsx|csv|txt)$/i, ""));
    // La vista previa llega DESPUÉS de responder la pregunta de consentimiento.
    if (answer) void runPreview(f);
  }

  function answerConsent(a: ConsentAnswer) {
    const first = answer === null;
    setAnswer(a);
    if (first && file && !preview && !error) void runPreview(file);
  }

  const needsTreatment = (preview?.optOut.count ?? 0) > 0;
  const canImport =
    !!file &&
    !!preview &&
    !!answer &&
    preview.missing.length === 0 &&
    (preview.summary?.valid ?? 0) > 0 &&
    (!needsTreatment || !!treatment) &&
    (extraTag?.kind !== "new" || extraTag.name.trim() !== "") &&
    !busy;

  async function doImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("mapping", JSON.stringify(mapping));
    form.set("name", name);
    if (answer) form.set("consentAnswer", answer);
    form.set("optOutTreatment", treatment ?? "respect");
    for (const [k, v] of Object.entries(extraTagFormFields(extraTag))) form.set(k, v);
    const res = await fetchJson<ImportResult>("/api/campaigns/audiences", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data);
    onImported(res.data.audience);
  }

  if (result) {
    const c = result.audience.counts;
    return (
      <Card data-testid="audience-result">
        <CardHeader>
          <CardTitle>Base importada: {result.audience.name}</CardTitle>
          <CardDescription>
            Quedó guardada y todos sus contactos tienen la etiqueta «{result.audience.tag?.name}»
            {result.summary.extraTag ? ` y «${result.summary.extraTag.name}»` : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Creados" value={c.created} />
            <Stat label="Actualizados" value={c.updated} />
            <Stat label="Inválidos" value={c.invalid} tone={c.invalid ? "danger" : undefined} />
            <Stat label="Duplicados" value={c.duplicate} tone={c.duplicate ? "warning" : undefined} />
          </ul>
          <ConsentResultLine consent={result.summary.consent} />
          {result.summary.warnings.length > 0 && (
            <p className="text-xs text-muted-foreground">{result.summary.warnings.length} fila(s) con salvedad (p. ej. correo inválido ignorado).</p>
          )}
          <div className="flex flex-wrap gap-2">
            {!compact && (
              <Link href={`/campaigns/new?audience=${result.audience.id}`}>
                <Button size="sm">Crear campaña con esta base</Button>
              </Link>
            )}
            {result.audience.failuresCount > 0 && (
              <a href={`/api/campaigns/audiences/${result.audience.id}/failures`} download>
                <Button size="sm" variant="outline" type="button">
                  <Download className="mr-1 h-4 w-4" /> Descargar filas con error
                </Button>
              </a>
            )}
            {!compact && (
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cerrar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="audience-upload">
      <CardHeader>
        <CardTitle>Subir una base</CardTitle>
        <CardDescription>
          Excel (.xlsx) o CSV, hasta {AUDIENCE_MAX_MB} MB. Columnas: nombre, numero (con código de país), correo y
          etiquetas. Sin fórmulas ni macros: se lee el valor de cada celda.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept={AUDIENCE_ACCEPT}
            className="sr-only"
            data-testid="audience-file"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()} disabled={busy}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
            {file ? "Elegir otro archivo" : "Elegir archivo"}
          </Button>
          {file && <span className="text-sm">{file.name}</span>}
          <SampleLinks />
        </div>

        {file && <ConsentQuestion value={answer} onChange={answerConsent} disabled={busy} />}

        {busy && <p className="text-sm text-muted-foreground">Leyendo el archivo…</p>}
        {error && (
          <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
            {error}
          </p>
        )}

        {preview && (editingColumns || preview.missing.length > 0) && (
          <div className="space-y-2 rounded-md border bg-subtle p-3" data-testid="audience-mapping">
            <p className="text-sm font-medium">¿Qué es cada columna?</p>
            {preview.missing.length > 0 && (
              <p className="text-xs text-muted-foreground">
                No reconocimos {preview.missing.map((m) => IMPORT_COLUMN_LABEL[m].toLowerCase()).join(" ni ")}: elige la columna de tu archivo.
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {MAPPABLE.map((field) => (
                <label key={field} className="flex items-center gap-2 text-sm">
                  <span className="w-40 shrink-0">
                    {IMPORT_COLUMN_LABEL[field]}
                    {(field === "name" || field === "phone") && <span className="text-danger-text"> *</span>}
                  </span>
                  <select
                    data-testid={`map-${field}`}
                    value={mapping[field] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? undefined : Number(e.target.value);
                      const next = { ...mapping };
                      // Una columna no puede ser dos campos: se suelta de donde estaba.
                      for (const k of Object.keys(next) as ImportColumn[]) if (next[k] === v) delete next[k];
                      if (v === undefined) delete next[field];
                      else next[field] = v;
                      setMapping(next);
                    }}
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-sm"
                  >
                    <option value="">— Ninguna —</option>
                    {preview.header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Columna ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <Button size="sm" disabled={busy || mapping.name === undefined || mapping.phone === undefined} onClick={() => file && void runPreview(file, mapping)}>
              Aplicar columnas
            </Button>
          </div>
        )}

        {preview?.summary && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ul className="flex flex-wrap gap-3 text-sm" data-testid="audience-summary">
                <li><b>{preview.summary.valid}</b> válidas</li>
                <li className={preview.summary.invalid ? "text-danger-text" : ""}><b>{preview.summary.invalid}</b> inválidas</li>
                <li className={preview.summary.duplicate ? "text-warning-text" : ""}><b>{preview.summary.duplicate}</b> duplicadas</li>
                {preview.summary.empty > 0 && <li>{preview.summary.empty} vacías</li>}
              </ul>
              {!editingColumns && (
                <Button size="sm" variant="ghost" onClick={() => setEditingColumns(true)}>
                  Cambiar columnas
                </Button>
              )}
            </div>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-xs" data-testid="audience-preview-table">
                <thead className="bg-subtle">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">Línea</th>
                    {preview.header.map((h, i) => {
                      const field = (Object.entries(preview.mapping) as [ImportColumn, number][]).find(([, idx]) => idx === i)?.[0];
                      return (
                        <th key={i} className="px-2 py-1.5 font-medium">
                          {h || `Columna ${i + 1}`}
                          {field && <span className="block font-normal text-muted-foreground">→ {IMPORT_COLUMN_LABEL[field]}</span>}
                        </th>
                      );
                    })}
                    <th className="px-2 py-1.5 font-medium">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((r) => (
                    <tr
                      key={r.line}
                      data-invalid={r.error ? "true" : undefined}
                      className={r.error ? "bg-danger-tint text-danger-text" : "border-t"}
                    >
                      <td className="px-2 py-1">{r.line}</td>
                      {r.cells.map((c, i) => (
                        <td key={i} className="max-w-[12rem] truncate px-2 py-1">
                          {c}
                        </td>
                      ))}
                      <td className="px-2 py-1">{r.error ?? r.warning ?? "OK"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.extraColumns.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Columnas que podrás usar como variables: {preview.extraColumns.join(", ")}
              </p>
            )}

            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="aud-name">Nombre de la base</Label>
                <Input id="aud-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </div>
              <ImportTagPicker value={extraTag} onChange={setExtraTag} canCreate={canCreateTag} disabled={busy} />
              {preview.optOut.count > 0 && (
                <OptOutPanel
                  preview={preview.optOut}
                  value={treatment}
                  onChange={setTreatment}
                  canOverride={canOverride}
                  disabled={busy}
                />
              )}
              <div className="flex flex-wrap gap-2">
                <Button disabled={!canImport} onClick={() => void doImport()} data-testid="audience-import">
                  {busy ? "Importando…" : `Importar ${preview.summary.valid} contacto(s)`}
                </Button>
                <Button variant="ghost" onClick={onCancel} disabled={busy}>
                  Cancelar
                </Button>
              </div>
            </div>
          </>
        )}
        {!preview && !busy && (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warning" }) {
  return (
    <li className="rounded-md border bg-subtle px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-semibold ${tone === "danger" ? "text-danger-text" : tone === "warning" ? "text-warning-text" : ""}`}>
        {value.toLocaleString("es-MX")}
      </p>
    </li>
  );
}
