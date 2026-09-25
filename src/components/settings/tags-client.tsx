"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { TAG_COLORS, TAG_NAME_MAX, tagColorClass, type TagColor, type TagDto } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TagChip } from "@/components/tags/tag-chip";

const COLOR_LABEL: Record<TagColor, string> = {
  gris: "Gris",
  azul: "Azul",
  verde: "Verde",
  ambar: "Ámbar",
  rojo: "Rojo",
  morado: "Morado",
};

function ColorPicker({ value, onChange }: { value: TagColor; onChange: (c: TagColor) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color">
      {TAG_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={COLOR_LABEL[c]}
          title={COLOR_LABEL[c]}
          onClick={() => onChange(c)}
          className={cn(
            "h-6 w-6 rounded-full border",
            tagColorClass(c),
            value === c ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
          )}
        />
      ))}
    </div>
  );
}

/** 021 — Configuración → Etiquetas: el catálogo de etiquetas del negocio. */
export function TagsClient() {
  const [tags, setTags] = useState<TagDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("azul");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; color: TagColor } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetchJson<{ tags: TagDto[] }>("/api/contact-tags");
    if (!res.ok) {
      setLoadError(`No se pudieron cargar las etiquetas: ${res.error}`);
      return;
    }
    setLoadError(null);
    setTags(res.data.tags);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function create() {
    setCreating(true);
    setCreateError(null);
    const res = await fetchJson("/api/contact-tags", jsonInit("POST", { name, color }));
    setCreating(false);
    if (!res.ok) {
      setCreateError(res.error);
      return;
    }
    setName("");
    void refetch();
  }

  async function saveEdit() {
    if (!editing) return;
    const res = await fetchJson(
      `/api/contact-tags/${editing.id}`,
      jsonInit("PATCH", { name: editing.name, color: editing.color })
    );
    if (!res.ok) {
      setRowError({ id: editing.id, message: res.error });
      return;
    }
    setEditing(null);
    setRowError(null);
    void refetch();
  }

  async function remove(tag: TagDto) {
    const n = tag.contactCount ?? 0;
    const ok = window.confirm(
      n > 0
        ? `¿Borrar la etiqueta "${tag.name}"? Se quitará de ${n} contacto(s); los contactos NO se borran.`
        : `¿Borrar la etiqueta "${tag.name}"?`
    );
    if (!ok) return;
    const res = await fetchJson(`/api/contact-tags/${tag.id}`, { method: "DELETE" });
    if (!res.ok) {
      setRowError({ id: tag.id, message: `No se borró: ${res.error}` });
      return;
    }
    setRowError(null);
    void refetch();
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Las etiquetas agrupan contactos: para filtrarlos, exportarlos o elegir a quién le llega una
        campaña. Cada importación de CSV crea la suya («Import: archivo.csv») para saber de qué base
        vino cada contacto.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Nueva etiqueta</CardTitle>
          <CardDescription>Ej.: VIP, Clientes 2025, Interesados en promoción.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tag-name">Nombre</Label>
            <Input
              id="tag-name"
              value={name}
              maxLength={TAG_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) void create();
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Color</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          {createError && (
            <p role="alert" className="text-sm text-danger-text">
              {createError}
            </p>
          )}
          <Button disabled={!name.trim() || creating} onClick={() => void create()}>
            {creating ? "Creando…" : "Crear etiqueta"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Etiquetas</CardTitle>
          <CardDescription>
            Borrar una etiqueta la quita de sus contactos; los contactos se quedan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p role="alert" className="text-sm text-danger-text">
              {loadError}
            </p>
          ) : tags === null ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay etiquetas.</p>
          ) : (
            <ul className="divide-y">
              {tags.map((t) => (
                <li key={t.id} className="py-3">
                  {editing?.id === t.id ? (
                    <div className="space-y-2">
                      <Input
                        value={editing.name}
                        maxLength={TAG_NAME_MAX}
                        aria-label="Nuevo nombre"
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      />
                      <ColorPicker value={editing.color} onChange={(c) => setEditing({ ...editing, color: c })} />
                      <div className="flex gap-2">
                        <Button size="sm" disabled={!editing.name.trim()} onClick={() => void saveEdit()}>
                          Guardar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(null);
                            setRowError(null);
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <TagChip tag={t} />
                        <span className="text-xs text-muted-foreground">
                          {t.contactCount ?? 0} contacto(s)
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${t.name}`}
                          onClick={() => setEditing({ id: t.id, name: t.name, color: t.color ?? "gris" })}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Borrar ${t.name}`}
                          onClick={() => void remove(t)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                  {rowError?.id === t.id && (
                    <p role="alert" className="mt-1.5 text-sm text-danger-text">
                      {rowError.message}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
