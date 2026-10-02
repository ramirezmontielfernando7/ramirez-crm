"use client";

import { Download } from "lucide-react";
import { toCsv } from "@/lib/csv";
import {
  CONSENT_ANSWER_LABEL,
  CONSENT_ANSWERS,
  CONSENT_QUESTION,
  OPT_OUT_TREATMENT_LABEL,
  OPT_OUT_TREATMENTS,
  optOutCsvRows,
  type ConsentAnswer,
  type ImportConsentResult,
  type OptOutPreview,
  type OptOutTreatment,
} from "@/lib/import-consent";
import { WA_CONSENT_LABEL } from "@/lib/tags";
import { Button } from "@/components/ui/button";

/**
 * Consentimiento al importar — las piezas que comparten Contactos → Importar
 * y Campañas → Audiencias: la pregunta obligatoria, el tratamiento de quien
 * ya pidió no recibir mensajes y el resumen de cómo quedó cada estado.
 */

export function ConsentQuestion({
  value,
  onChange,
  disabled,
}: {
  value: ConsentAnswer | null;
  onChange: (v: ConsentAnswer) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="space-y-1.5 rounded-md border p-3" data-testid="consent-question">
      <legend className="px-1 text-sm font-medium">
        {CONSENT_QUESTION} <span className="text-danger-text">*</span>
      </legend>
      {CONSENT_ANSWERS.map((a) => (
        <label key={a} className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="consent-answer"
            className="mt-1 accent-primary"
            data-testid={`consent-${a}`}
            checked={value === a}
            disabled={disabled}
            onChange={() => onChange(a)}
          />
          <span>
            {CONSENT_ANSWER_LABEL[a]}
            <span className="block text-[11px] text-text-3">
              {a === "yes"
                ? "Quedan como «Acepta mensajes» (origen: declarado al importar) y podrán recibir campañas."
                : "Quedan como «Sin confirmar»: no recibirán campañas hasta que se confirme."}
            </span>
          </span>
        </label>
      ))}
      <p className="text-[11px] text-text-3">
        Si tu archivo trae una columna de consentimiento, el valor de cada fila manda sobre esta respuesta.
      </p>
    </fieldset>
  );
}

function downloadCsv(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Los contactos del archivo que ya tienen «No quiere mensajes»: cuántos,
 * tabla descargable y qué hacer con todos. Sin `contacts.consent_override`
 * solo existe "Respetar".
 */
export function OptOutPanel({
  preview,
  value,
  onChange,
  canOverride,
  disabled,
}: {
  preview: OptOutPreview;
  value: OptOutTreatment | null;
  onChange: (v: OptOutTreatment) => void;
  canOverride: boolean;
  disabled?: boolean;
}) {
  if (preview.count === 0) return null;
  const options = canOverride ? OPT_OUT_TREATMENTS : (["respect"] as const);
  function download() {
    const { header, rows } = optOutCsvRows(preview.rows);
    downloadCsv(`contactos-con-baja-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(header, rows));
  }
  return (
    <div className="space-y-2 rounded-md border border-warning-soft bg-warning-tint p-3" data-testid="opt-out-panel">
      <p className="text-sm">
        <b data-testid="opt-out-count">{preview.count.toLocaleString("es-MX")}</b> contacto(s) del archivo ya pidieron
        no recibir mensajes.
      </p>
      <div className="max-h-40 overflow-auto rounded border bg-card">
        <table className="w-full text-left text-xs">
          <thead className="bg-subtle">
            <tr>
              <th className="px-2 py-1 font-medium">Nombre</th>
              <th className="px-2 py-1 font-medium">Teléfono</th>
              <th className="px-2 py-1 font-medium">Baja desde</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.slice(0, 20).map((r) => (
              <tr key={r.line} className="border-t">
                <td className="px-2 py-1">{r.name}</td>
                <td className="px-2 py-1">{r.phone}</td>
                <td className="px-2 py-1">{r.since ? new Date(r.since).toLocaleDateString("es-MX") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={download} data-testid="opt-out-download">
        <Download className="mr-1.5 h-4 w-4" /> Descargar lista ({preview.rows.length})
      </Button>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">
          ¿Qué hacemos con ellos? <span className="text-danger-text">*</span>
        </legend>
        {options.map((t) => (
          <label key={t} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="opt-out-treatment"
              className="mt-1 accent-primary"
              data-testid={`opt-out-${t}`}
              checked={value === t}
              disabled={disabled}
              onChange={() => onChange(t)}
            />
            <span>{OPT_OUT_TREATMENT_LABEL[t]}</span>
          </label>
        ))}
        {value === "opt_in" && (
          <p className="text-[11px] text-warning-text">
            Escribirle a quien pidió la baja va contra las reglas de WhatsApp: si lo reporta, baja la calidad del
            número y las campañas se pausan solas.
          </p>
        )}
        {!canOverride && (
          <p className="text-[11px] text-text-3">Solo el Propietario o un Coordinador pueden cambiar una baja.</p>
        )}
      </fieldset>
    </div>
  );
}

/** "Así quedaron": cuántos en cada estado tras importar. */
export function ConsentResultLine({ consent }: { consent: ImportConsentResult }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="consent-result">
      <li>
        <b>{consent.optIn.toLocaleString("es-MX")}</b> {WA_CONSENT_LABEL.opt_in.toLowerCase()}
      </li>
      <li>
        <b>{consent.optOut.toLocaleString("es-MX")}</b> {WA_CONSENT_LABEL.opt_out.toLowerCase()}
      </li>
      <li>
        <b>{consent.unknown.toLocaleString("es-MX")}</b> {WA_CONSENT_LABEL.desconocido.toLowerCase()}
      </li>
      {consent.reactivated > 0 && <li>{consent.reactivated} baja(s) reactivada(s)</li>}
      {consent.toUnknown > 0 && <li>{consent.toUnknown} baja(s) pasada(s) a sin confirmar</li>}
    </ul>
  );
}
