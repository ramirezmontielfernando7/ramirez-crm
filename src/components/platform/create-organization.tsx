"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PLAN_LABEL, PLAN_OPTIONS, type PlanOption } from "@/lib/modules/registry";
import { api } from "./api";
import { OneTimeLink } from "./one-time-link";

/** 039 — Qué trae cada plan, en una línea (la fuente es `MODULE_PROFILES`). */
export const PLAN_HINT: Record<PlanOption, string> = {
  esencial: "Bandeja, CRM, Tareas, Notas, Biblioteca y Resultados; sin IA",
  pro: "+ Agentes y Laboratorio, Agenda, Atribución CAPI, Instagram y Messenger",
  ultra: "+ Campañas masivas y Asistente interno",
  personalizado: "los 13 interruptores a mano",
};

export function CreateOrganization({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  // 039: plan comercial (plantilla de los 13); vacío = los de las variables de entorno.
  const [profile, setProfile] = useState<"" | PlanOption>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const r = await api<{ activationUrl: string; expiresAt: string }>("/api/platform/organizations", {
      method: "POST",
      body: JSON.stringify({ name, ownerName, ownerEmail, ...(profile ? { profile } : {}) }),
    });
    setSaving(false);
    if (!r.ok || !r.data) {
      setError(r.error);
      return;
    }
    setLink({ url: r.data.activationUrl, expiresAt: r.data.expiresAt });
    setName("");
    setOwnerName("");
    setOwnerEmail("");
    setProfile("");
    onCreated();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nueva organización
        </CardTitle>
        <CardDescription>
          Se crea con su primer Propietario. La persona pone su contraseña con un enlace de activación (72 h, un solo uso).
          El registro público sigue cerrado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Nombre del negocio</Label>
            <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner-name">Nombre del Propietario</Label>
            <Input id="owner-name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="owner-email">Correo del Propietario</Label>
            <Input id="owner-email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-profile">Plan al crear</Label>
          <select
            id="org-profile"
            value={profile}
            onChange={(e) => setProfile(e.target.value as typeof profile)}
            className="h-9 rounded-sm border bg-background px-2 text-sm"
            data-testid="platform-create-profile"
          >
            <option value="">Los de las variables de entorno</option>
            {PLAN_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {PLAN_LABEL[p]} — {PLAN_HINT[p]}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-3">
            Solo es la plantilla inicial: después cada uno de los 13 módulos se enciende o apaga aparte en el detalle de la organización.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          disabled={saving || name.trim().length < 2 || !ownerName.trim() || !ownerEmail.includes("@")}
          onClick={() => void submit()}
          data-testid="platform-create-org"
        >
          {saving ? "Creando…" : "Crear organización"}
        </Button>
        {link && <OneTimeLink url={link.url} expiresAt={link.expiresAt} kind="activate" />}
      </CardContent>
    </Card>
  );
}


