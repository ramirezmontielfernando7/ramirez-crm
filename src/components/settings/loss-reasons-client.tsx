"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Archive, Pencil, RotateCcw } from "lucide-react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import type { LossReasonDto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const LABEL_MAX = 60;

/** Ajustes → Operación CRM → Motivos de pérdida: lo que se elige al marcar un trato como perdido. */
export function LossReasonsClient() {
  const [reasons, setReasons] = useState<LossReasonDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetchJson<{ reasons: LossReasonDto[] }>("/api/pipeline/loss-reasons");
    if (!res.ok) {
      setLoadError(`No se pudieron cargar los motivos: ${res.error}`);
      return;
    }
    setLoadError(null);
    setReasons(res.data.reasons);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function patch(id: string, body: { label?: string; active?: boolean; position?: number }) {
    const res = await fetchJson(`/api/pipeline/loss-reasons/${id}`, jsonInit("PATCH", body));
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    setError(null);
    return true;
  }

  async function create() {
    setCreating(true);
    setError(null);
    const res = await fetchJson("/api/pipeline/loss-reasons", jsonInit("POST", { label }));
    setCreating(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLabel("");
    void refetch();
  }

  async function saveEdit() {
    if (!editing) return;
    if (await patch(editing.id, { label: editing.label })) {
      setEditing(null);
      void refetch();
    }
  }

  async function move(list: LossReasonDto[], index: number, delta: -1 | 1) {
    const a = list[index];
    const b = list[index + delta];
    if (!a || !b) return;
    // Posiciones consecutivas de los activos, con los dos intercambiados.
    const order = list.map((r) => r.id);
    order[index] = b.id;
    order[index + delta] = a.id;
    for (const [i, id] of order.entries()) {
      if (!(await patch(id, { position: i }))) break;
    }
    void refetch();
  }

  const active = (reasons ?? []).filter((r) => r.active);
  const archived = (reasons ?? []).filter((r) => !r.active);

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Son las opciones que aparecen al marcar un trato como perdido y las que cuenta la gráfica de
        pérdidas. Si cambias un nombre, también cambia en el historial; si quitas un motivo, los tratos
        que ya lo usaban lo conservan.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Nuevo motivo</CardTitle>
          <CardDescription>Ej.: Compró en otra ciudad, Esperará a fin de año.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="loss-label">Nombre</Label>
            <Input
              id="loss-label"
              value={label}
              maxLength={LABEL_MAX}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && label.trim()) void create();
              }}
            />
          </div>
          <Button disabled={!label.trim() || creating} onClick={() => void create()}>
            {creating ? "Creando…" : "Crear motivo"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Motivos</CardTitle>
          <CardDescription>El orden de aquí es el del diálogo. «Otro» no se puede quitar.</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <p role="alert" className="mb-3 text-sm text-danger-text">
              {error}
            </p>
          )}
          {loadError ? (
            <p role="alert" className="text-sm text-danger-text">
              {loadError}
            </p>
          ) : reasons === null ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : (
            <ul className="divide-y">
              {active.map((r, i) => (
                <li key={r.id} className="py-3">
                  {editing?.id === r.id ? (
                    <div className="space-y-2">
                      <Input
                        value={editing.label}
                        maxLength={LABEL_MAX}
                        aria-label="Nuevo nombre"
                        onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" disabled={!editing.label.trim()} onClick={() => void saveEdit()}>
                          Guardar
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm">{r.label}</span>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Subir ${r.label}`}
                          disabled={i === 0}
                          onClick={() => void move(active, i, -1)}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Bajar ${r.label}`}
                          disabled={i === active.length - 1}
                          onClick={() => void move(active, i, 1)}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${r.label}`}
                          onClick={() => setEditing({ id: r.id, label: r.label })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {r.key !== "otro" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Quitar ${r.label}`}
                            onClick={() => void patch(r.id, { active: false }).then(() => refetch())}
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {archived.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Quitados</CardTitle>
            <CardDescription>Ya no se ofrecen, pero los tratos que los tienen los conservan.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {archived.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0 truncate text-sm text-muted-foreground">{r.label}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void patch(r.id, { active: true }).then(() => refetch())}
                  >
                    <RotateCcw className="mr-1 h-4 w-4" />
                    Recuperar
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
