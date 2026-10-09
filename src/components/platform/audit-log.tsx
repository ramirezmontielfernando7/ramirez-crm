"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, fecha, type AuditEntry } from "./api";

const ACTION_LABEL: Record<string, string> = {
  "organization.created": "creó la organización",
  "organization.suspended": "suspendió la organización",
  "organization.reactivated": "reactivó la organización",
  "organization.deleted": "borró la organización (30 días de gracia)",
  "organization.restored": "restauró la organización",
  "organization.purged": "purgó la organización",
  "organization.modules_changed": "cambió los módulos de la organización",
  "organization.limits_changed": "cambió el plan o los topes de la organización",
  "link.activation_created": "generó un enlace de activación",
  "link.reset_created": "generó un enlace de restablecimiento",
  "link.used": "se usó un enlace de contraseña",
  "reauth.failed": "contraseña de administrador incorrecta",
  "reauth.locked": "bloqueo temporal por intentos fallidos",
  "admin.added": "agregó un administrador de plataforma",
  "admin.removed": "quitó un administrador de plataforma",
};

/** Fase 3, PR 2 — Bitácora de plataforma: quién hizo qué, sobre qué organización, cuándo y desde qué IP. */
export function AuditLog() {
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    void api<{ entries: AuditEntry[] }>("/api/platform/audit").then((a) => setAudit(a.data?.entries ?? []));
  }, []);

  return (
    <Card className="max-w-5xl">
      <CardHeader>
        <CardTitle>Bitácora de plataforma</CardTitle>
        <CardDescription>Quién hizo qué, sobre qué organización, cuándo y desde qué IP.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm" data-testid="platform-audit">
          {audit === null && <li className="text-text-2">Cargando…</li>}
          {audit?.length === 0 && <li className="text-text-2">Sin registros todavía.</li>}
          {audit?.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2 break-words">
              <span className="text-text-2">{fecha(e.at)}</span>
              <span className="font-medium">{e.actorEmail ?? "—"}</span>
              <span>{ACTION_LABEL[e.action] ?? e.action}</span>
              {e.targetOrgName && <span>· {e.targetOrgName}</span>}
              {e.targetUserEmail && <span className="text-text-2">· {e.targetUserEmail}</span>}
              {e.ip && <span className="text-text-3">· {e.ip}</span>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
