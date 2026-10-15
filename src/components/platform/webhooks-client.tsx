"use client";

import { useEffect, useState } from "react";
import { api, fecha } from "./api";

/**
 * 040 — Plataforma → Webhooks sin ruta: lo que llegó firmado por Meta para
 * un número, WABA o página que ninguna organización tiene conectada (o cuya
 * organización no opera), agrupado por llave. Sirve para diagnosticar «mi
 * número no recibe»: la llave que aparece aquí es la que falta asociar. Solo
 * metadatos: el contenido (cifrado) nunca sale del servidor.
 */

type Group = {
  source: string;
  routeKind: string;
  routeKey: string;
  reason: string;
  fields: string[];
  events: number;
  firstAt: string;
  lastAt: string;
};

const SOURCE_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger" };
const KIND_LABEL: Record<string, string> = {
  phone_number_id: "Número (phone_number_id)",
  waba_id: "Cuenta WABA",
  ig_user_id: "Cuenta de Instagram",
  page_id: "Página de Facebook",
  account_ref: "Cuenta de Zernio",
};
const REASON_LABEL: Record<string, string> = {
  unknown_route: "Ninguna organización lo tiene conectado",
  org_suspended: "Su organización está suspendida",
  org_deleted: "Su organización está borrada",
};

export function WebhooksClient() {
  const [data, setData] = useState<{ groups: Group[]; total: number; retentionDays: number; maxRows: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ groups: Group[]; total: number; retentionDays: number; maxRows: number }>("/api/platform/webhooks").then((r) => {
      if (r.data) setData(r.data);
      else setError(r.error);
    });
  }, []);

  if (!data) return <p className={error ? "text-sm text-destructive" : "text-sm text-text-2"}>{error ?? "Cargando…"}</p>;
  return (
    <div className="space-y-3" data-testid="platform-webhooks">
      <p className="text-xs text-text-3">
        {data.total.toLocaleString("es-MX")} evento(s) guardados · se borran a los {data.retentionDays} días · tope{" "}
        {data.maxRows.toLocaleString("es-MX")}. Solo la llave y cuándo llegó: el contenido no se muestra.
      </p>
      {data.groups.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-text-2" data-testid="platform-webhooks-empty">
          Nada sin ruta: todo lo que llega tiene su organización.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-[11px] font-medium text-text-3">
              <tr>
                <th className="px-3 py-2 font-medium">Fuente</th>
                <th className="px-3 py-2 font-medium">Llave</th>
                <th className="px-3 py-2 font-medium">Motivo</th>
                <th className="px-3 py-2 font-medium">Campos</th>
                <th className="px-3 py-2 text-right font-medium">Eventos</th>
                <th className="px-3 py-2 font-medium">Último</th>
              </tr>
            </thead>
            <tbody className="divide-y" data-testid="platform-webhooks-list">
              {data.groups.map((g) => (
                <tr key={`${g.source}:${g.routeKind}:${g.routeKey}:${g.reason}`}>
                  <td className="px-3 py-2">{SOURCE_LABEL[g.source] ?? g.source}</td>
                  <td className="px-3 py-2">
                    <span className="block text-xs text-text-3">{KIND_LABEL[g.routeKind] ?? g.routeKind}</span>
                    <code className="break-all text-xs">{g.routeKey}</code>
                  </td>
                  <td className="px-3 py-2 text-xs text-text-2">{REASON_LABEL[g.reason] ?? g.reason}</td>
                  <td className="px-3 py-2 text-xs text-text-2">{g.fields.join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{g.events}</td>
                  <td className="px-3 py-2 text-xs text-text-2">{fecha(g.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
