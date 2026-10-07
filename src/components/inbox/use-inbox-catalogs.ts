"use client";

import { useCallback, useEffect, useState } from "react";
import type { StageDto } from "@/lib/types";
import type { TagDto } from "@/lib/tags";

/**
 * 034 — Lo que los menús de las cápsulas necesitan y NO viaja en cada fila:
 * las etapas del pipeline y el catálogo de etiquetas de la organización. Se
 * piden UNA vez para toda la lista (no por fila) con las rutas de siempre.
 */
export function useInboxCatalogs() {
  const [stages, setStages] = useState<StageDto[]>([]);
  const [tags, setTags] = useState<TagDto[]>([]);

  useEffect(() => {
    let alive = true;
    void fetch("/api/pipeline/stages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stages: StageDto[] } | null) => {
        if (alive && d) setStages([...d.stages].sort((a, b) => a.position - b.position));
      })
      .catch(() => null);
    void fetch("/api/contact-tags")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { tags: TagDto[] } | null) => {
        if (alive && d) setTags(d.tags);
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, []);

  const addTag = useCallback(
    (tag: TagDto) => setTags((prev) => (prev.some((t) => t.id === tag.id) ? prev : [...prev, tag].sort((a, b) => a.name.localeCompare(b.name, "es")))),
    []
  );

  return { stages, tags, addTag };
}
