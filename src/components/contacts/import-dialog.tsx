"use client";

import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { toCsv } from "@/lib/csv";
import { fetchJson } from "@/lib/fetch-json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type RowIssue = { line: number; name: string; phone: string; reason: string };

type Summary = {
  totalRows: number;
  created: number;
  updated: number;
  failed: number;
  emptyRows: number;
  tag: { id: string; name: string };
  failures: RowIssue[];
  warnings: RowIssue[];
  leadsCreated: number;
};

/** Debe coincidir con IMPORT_MAX_BYTES del servidor (se revisa antes de subir). */
const MAX_BYTES = 5 * 1024 * 1024;

const EXAMPLE = toCsv(
  ["name", "phone", "source", "waConsent", "waConsentSource", "tags"],
  [
    ["Ana López", "5215512345678", "referido", "opt_in", "Formulario web", "VIP, Promo marzo"],
    ["Beto Ruiz", "+52 1 33 1234 5678", "", "", "", ""],
  ]
);

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 021 — Importar contactos desde CSV. El resultado dice exactamente qué pasó:
 * creados, actualizados y el detalle de cada fila que no entró (descargable).
 */
export function ImportDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [tagName, setTagName] = useState("");
  const [createLeads, setCreateLeads] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  async function upload() {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB; el máximo es 5 MB. Divídelo en varios.`);
      return;
    }
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    if (tagName.trim()) form.set("tagName", tagName.trim());
    form.set("createLeads", String(createLeads));
    const res = await fetchJson<{ summary: Summary }>("/api/contacts/import", { method: "POST", body: form });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSummary(res.data.summary);
    onImported();
  }

  function downloadIssues() {
    if (!summary) return;
    const rows = [
      ...summary.failures.map((f) => [f.line, f.name, f.phone, "No se importó", f.reason]),
      ...summary.warnings.map((w) => [w.line, w.name, w.phone, "Importado con aviso", w.reason]),
    ].sort((a, b) => Number(a[0]) - Number(b[0]));
    download(
      `errores-importacion-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(["linea", "name", "phone", "resultado", "motivo"], rows)
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Importar contactos"
    >
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border bg-popover p-5 shadow-xl">
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h3 className="font-semibold">Importar contactos (CSV)</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        {!summary ? (
          <div className="space-y-4">
            <div className="rounded-md border bg-subtle p-3 text-xs leading-relaxed text-text-2">
              <p>
                Columnas obligatorias: <b>name</b> y <b>phone</b> (con código de país, ej. 52 para
                México). Opcionales: <b>source</b>, <b>waConsent</b> (opt_in / opt_out /
                desconocido), <b>waConsentSource</b> y <b>tags</b> (separadas por comas). También
                se aceptan en español: nombre, teléfono, fuente, consentimiento, etiquetas.
              </p>
              <p className="mt-2">
                Sin columna de consentimiento, los contactos entran como <b>«Sin confirmar»</b> y no
                recibirán campañas hasta que se marquen como «acepta». Un contacto que ya existe
                conserva su nombre, y si pidió no recibir mensajes, sigue así.
              </p>
              <button
                type="button"
                className="mt-2 inline-flex items-center gap-1 font-medium text-brand-text underline underline-offset-2"
                onClick={() => download("ejemplo-contactos.csv", EXAMPLE)}
              >
                <Download className="h-3.5 w-3.5" /> Descargar ejemplo
              </button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="import-file">Archivo (.csv, máx. 5 MB y 10,000 filas)</Label>
              <Input
                id="import-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError(null);
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="import-tag">Etiqueta para esta base</Label>
              <Input
                id="import-tag"
                value={tagName}
                maxLength={60}
                onChange={(e) => setTagName(e.target.value)}
                placeholder={file ? `Import: ${file.name}` : "Import: nombre-del-archivo.csv"}
              />
              <p className="text-[11px] text-text-3">
                Todos los contactos del archivo la llevarán, para saber después de qué base vinieron.
              </p>
            </div>

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1 accent-primary"
                checked={createLeads}
                onChange={(e) => setCreateLeads(e.target.checked)}
              />
              <span>
                Crear también un lead en el Pipeline por cada contacto nuevo
                <span className="block text-[11px] text-text-3">
                  Apagado: la base queda en Contactos sin llenar el tablero.
                </span>
              </span>
            </label>

            {error && (
              <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-3 py-2 text-sm text-danger-text">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancelar
              </Button>
              <Button disabled={!file || busy} onClick={() => void upload()}>
                <Upload className="mr-1.5 h-4 w-4" />
                {busy ? "Importando…" : "Importar"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4" data-testid="import-summary">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-md border p-3">
                <p className="text-xl font-bold">{summary.created}</p>
                <p className="text-xs text-muted-foreground">creados</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xl font-bold">{summary.updated}</p>
                <p className="text-xs text-muted-foreground">ya existían</p>
              </div>
              <div className="rounded-md border p-3">
                <p className={summary.failed > 0 ? "text-xl font-bold text-danger-text" : "text-xl font-bold"}>
                  {summary.failed}
                </p>
                <p className="text-xs text-muted-foreground">no se importaron</p>
              </div>
            </div>
            <p className="text-sm text-text-2">
              {summary.totalRows} fila(s) leídas
              {summary.emptyRows > 0 ? `, ${summary.emptyRows} vacía(s) ignorada(s)` : ""}. Etiqueta:{" "}
              <b>{summary.tag.name}</b>.
              {summary.leadsCreated > 0 ? ` ${summary.leadsCreated} lead(s) creados en el Pipeline.` : ""}
            </p>

            {(summary.failures.length > 0 || summary.warnings.length > 0) && (
              <div className="space-y-2">
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
                  {summary.failures.slice(0, 50).map((f) => (
                    <li key={`f${f.line}`}>
                      <span className="font-medium">Línea {f.line}</span>
                      {f.name ? ` (${f.name})` : ""}: <span className="text-danger-text">{f.reason}</span>
                    </li>
                  ))}
                  {summary.warnings.slice(0, 20).map((w) => (
                    <li key={`w${w.line}`}>
                      <span className="font-medium">Línea {w.line}</span>
                      {w.name ? ` (${w.name})` : ""}: <span className="text-warning-text">{w.reason}</span>
                    </li>
                  ))}
                </ul>
                <Button variant="outline" size="sm" onClick={downloadIssues}>
                  <Download className="mr-1.5 h-4 w-4" /> Descargar detalle ({summary.failures.length + summary.warnings.length})
                </Button>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={onClose}>Listo</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
