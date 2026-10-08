"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { cn } from "@/lib/utils";
import { TAG_COLORS, TAG_NAME_MAX, tagColorClass, type TagColor, type TagDto } from "@/lib/tags";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Lo elegido: una etiqueta existente, una por crear, o nada. */
export type ExtraTagChoice =
  | { kind: "existing"; id: string }
  | { kind: "new"; name: string; color: TagColor | null }
  | null;

const NEW = "__new__";

/** Los campos del formulario de la importación para esa elección. */
export function extraTagFormFields(choice: ExtraTagChoice): Record<string, string> {
  if (!choice) return {};
  if (choice.kind === "existing") return { extraTagId: choice.id };
  return { extraTagName: choice.name, ...(choice.color ? { extraTagColor: choice.color } : {}) };
}

/**
 * Etiqueta opcional para todos los contactos de la base: una existente o una
 * nueva ahí mismo (solo con `tags.manage`). Independiente del nombre de la base.
 */
export function ImportTagPicker({
  value,
  onChange,
  canCreate,
  disabled,
}: {
  value: ExtraTagChoice;
  onChange: (v: ExtraTagChoice) => void;
  canCreate: boolean;
  disabled?: boolean;
}) {
  const [tags, setTags] = useState<TagDto[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchJson<{ tags: TagDto[] }>("/api/contact-tags").then((res) => {
      if (alive && res.ok) setTags(res.data.tags);
    });
    return () => {
      alive = false;
    };
  }, []);

  const selectValue = creating ? NEW : value?.kind === "existing" ? value.id : "";

  function pick(v: string) {
    if (v === NEW) {
      setCreating(true);
      onChange({ kind: "new", name: "", color: null });
    } else {
      setCreating(false);
      onChange(v ? { kind: "existing", id: v } : null);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="aud-extra-tag">Etiqueta para todos los contactos de esta base (opcional)</Label>
      <select
        id="aud-extra-tag"
        data-testid="audience-extra-tag"
        value={selectValue}
        disabled={disabled}
        onChange={(e) => pick(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
      >
        <option value="">Ninguna</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
        {canCreate && <option value={NEW}>＋ Crear etiqueta nueva…</option>}
      </select>
      {creating && value?.kind === "new" && (
        <div className="space-y-2 rounded-md border p-2">
          <Input
            data-testid="audience-extra-tag-name"
            aria-label="Nombre de la etiqueta nueva"
            placeholder="Ej. Referido"
            value={value.name}
            maxLength={TAG_NAME_MAX}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Color de la etiqueta">
            {TAG_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={value.color === c}
                disabled={disabled}
                onClick={() => onChange({ ...value, color: value.color === c ? null : c })}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  tagColorClass(c),
                  value.color === c && "ring-2 ring-brand"
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Se suma a la etiqueta automática de la base y a las de la columna «etiquetas». Vacío = como siempre.
      </p>
    </div>
  );
}
