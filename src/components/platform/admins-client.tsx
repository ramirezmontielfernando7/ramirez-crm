"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, fecha } from "./api";
import { AuditLog } from "./audit-log";

/**
 * 040 — Plataforma → Administradores y auditoría: quién administra la
 * plataforma (solo lectura: darlos o quitarlos es del operador con
 * `scripts/platform-admin.mjs`, en el servidor) y la bitácora.
 */
type Admin = { userId: string; email: string; name: string; createdAt: string; createdBy: string | null; lockedUntil: string | null };

export function AdminsClient() {
  const [admins, setAdmins] = useState<Admin[] | null>(null);

  useEffect(() => {
    void api<{ admins: Admin[] }>("/api/platform/admins").then((r) => setAdmins(r.data?.admins ?? []));
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Administradores de plataforma</CardTitle>
          <CardDescription>
            Se dan y se quitan desde el servidor con <code>scripts/platform-admin.mjs</code> (en la imagen:{" "}
            <code>/app/ops/</code>). Solo miembros de la organización de la plataforma.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {admins === null ? (
            <p className="text-sm text-text-2">Cargando…</p>
          ) : (
            <ul className="divide-y rounded-md border" data-testid="platform-admins">
              {admins.map((a) => (
                <li key={a.userId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span className="font-medium">{a.name}</span>
                  <span className="break-all text-text-2">{a.email}</span>
                  <span className="text-xs text-text-3">desde {fecha(a.createdAt)}</span>
                  {a.lockedUntil && (
                    <span className="rounded-sm bg-warning-tint px-1.5 text-xs text-warning-text">Bloqueado hasta {fecha(a.lockedUntil)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <AuditLog />
    </div>
  );
}
