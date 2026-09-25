"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import {
  WA_CONSENT_LABEL,
  WA_CONSENT_VALUES,
  type TagDto,
  type WaConsent,
} from "@/lib/tags";
import type { ContactDto } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useViewer } from "@/components/viewer-context";
import { TagChip } from "./tag-chip";

const CONSENT_BADGE: Record<WaConsent, "success" | "destructive" | "secondary"> = {
  opt_in: "success",
  opt_out: "destructive",
  desconocido: "secondary",
};

/**
 * 021 — Etiquetas y consentimiento de WhatsApp de UN contacto.
 *
 * Autónoma (carga y guarda por su cuenta) para vivir igual en el panel de la
 * Bandeja y en el diálogo de edición de Contactos. Todo error se muestra:
 * nada de "se guardó" cuando no se guardó.
 */
export function ContactTagsCard({
  contactId,
  refreshKey = 0,
  onChanged,
  bare = false,
  consentFirst = false,
}: {
  contactId: string;
  refreshKey?: number;
  /** Tras guardar algo (la lista de Contactos refresca sus chips). */
  onChanged?: () => void;
  /** Sin borde/padding de sección (para meterla en un diálogo). */
  bare?: boolean;
  /** 022 — "Mensajes masivos" antes que "Etiquetas" (panel de la Bandeja). */
  consentFirst?: boolean;
}) {
  const viewer = useViewer();
  const [tags, setTags] = useState<TagDto[]>([]);
  const [allTags, setAllTags] = useState<TagDto[]>([]);
  const [consent, setConsent] = useState<WaConsent>("desconocido");
  const [consentSource, setConsentSource] = useState("");
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [detail, list] = await Promise.all([
      fetchJson<{ contact: ContactDto }>(`/api/contacts/${contactId}`),
      fetchJson<{ tags: TagDto[] }>("/api/contact-tags"),
    ]);
    if (!detail.ok) {
      setError(`No se pudieron cargar las etiquetas: ${detail.error}`);
      return;
    }
    if (!list.ok) {
      setError(`No se pudo cargar la lista de etiquetas: ${list.error}`);
    } else {
      setAllTags(list.data.tags);
    }
    setTags(detail.data.contact.tags ?? []);
    setConsent(detail.data.contact.waConsent ?? "desconocido");
    setConsentSource(detail.data.contact.waConsentSource ?? "");
    setConsentAt(detail.data.contact.waConsentAt ?? null);
    setLoaded(true);
  }, [contactId]);

  useEffect(() => {
    setLoaded(false);
    setError(null);
    void load();
  }, [load, refreshKey]);

  async function saveTags(next: TagDto[]) {
    setBusy(true);
    setError(null);
    const prev = tags;
    setTags(next); // optimista; se revierte si falla
    const res = await fetchJson<{ tags: TagDto[] }>(
      `/api/contacts/${contactId}/tags`,
      jsonInit("PUT", { tagIds: next.map((t) => t.id) })
    );
    setBusy(false);
    if (!res.ok) {
      setTags(prev);
      setError(`No se guardaron las etiquetas: ${res.error}`);
      return;
    }
    setTags(res.data.tags);
    onChanged?.();
  }

  async function saveConsent(value: WaConsent) {
    if (value === "opt_in" && !draftSource.trim()) {
      setError("Para marcar que acepta mensajes, anota de dónde salió ese consentimiento");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetchJson<{ contact: ContactDto }>(
      `/api/contacts/${contactId}`,
      jsonInit("PATCH", {
        waConsent: value,
        waConsentSource: draftSource.trim() || undefined,
      })
    );
    setBusy(false);
    if (!res.ok) {
      setError(`No se guardó el consentimiento: ${res.error}`);
      return;
    }
    setConsent(res.data.contact.waConsent ?? value);
    setConsentSource(res.data.contact.waConsentSource ?? "");
    setConsentAt(res.data.contact.waConsentAt ?? null);
    setDraftSource("");
    onChanged?.();
  }

  const available = allTags.filter((t) => !tags.some((x) => x.id === t.id));

  const tagsBlock = (
    <div>
      <p className="kicker mb-2">Etiquetas</p>
      {!loaded && !error ? (
        <p className="text-xs text-text-3">Cargando…</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.length === 0 && <span className="text-xs text-text-3">Sin etiquetas</span>}
          {tags.map((t) => (
            <TagChip
              key={t.id}
              tag={t}
              onRemove={busy ? undefined : () => void saveTags(tags.filter((x) => x.id !== t.id))}
            />
          ))}
          {available.length > 0 && (
            <select
              value=""
              disabled={busy}
              aria-label="Agregar etiqueta"
              onChange={(e) => {
                const tag = available.find((t) => t.id === e.target.value);
                if (tag) void saveTags([...tags, tag]);
              }}
              className="h-7 rounded-md border border-input bg-card px-1.5 text-xs"
            >
              <option value="">+ Agregar…</option>
              {available.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {loaded && allTags.length === 0 && (
        <p className="mt-1.5 text-[11px] text-text-3">
          Aún no hay etiquetas.
          {viewer.can("tags.manage") && (
            <Link href="/settings/tags" className="ml-1 font-medium text-brand-text underline underline-offset-2">
              Crear en Configuración →
            </Link>
          )}
        </p>
      )}
    </div>
  );

  const consentBlock = (
    <div>
      <p className="kicker mb-2">Mensajes masivos (WhatsApp)</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={CONSENT_BADGE[consent]}>{WA_CONSENT_LABEL[consent]}</Badge>
        {consentSource && <span className="text-[11px] text-text-3">· {consentSource}</span>}
      </div>
      {consentAt && (
        <p className="mt-1 text-[11px] text-text-3">
          Actualizado el {new Date(consentAt).toLocaleDateString("es-MX", { dateStyle: "medium" })}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-text-3">
        Solo los contactos que aceptan mensajes reciben campañas.
      </p>
      {loaded && (
        <div className="mt-2 space-y-2">
          <Input
            value={draftSource}
            disabled={busy}
            onChange={(e) => setDraftSource(e.target.value)}
            placeholder="¿De dónde? Ej.: formulario web, lo pidió por WhatsApp"
            aria-label="Origen del consentimiento"
            className="h-8 text-xs"
            maxLength={200}
          />
          <div className="flex flex-wrap gap-1.5">
            {WA_CONSENT_VALUES.filter((v) => v !== consent).map((v) => (
              <Button
                key={v}
                size="sm"
                variant={v === "opt_out" ? "outline" : "secondary"}
                disabled={busy}
                onClick={() => void saveConsent(v)}
              >
                {v === "opt_in" ? "Marcar: acepta" : v === "opt_out" ? "Marcar: no quiere" : "Marcar: sin confirmar"}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <section className={bare ? "space-y-4" : "space-y-4 border-b p-4"}>
      {consentFirst ? consentBlock : tagsBlock}
      {consentFirst ? tagsBlock : consentBlock}

      {error && (
        <p role="alert" className="rounded-md border border-danger-soft bg-danger-tint px-2.5 py-2 text-xs text-danger-text">
          {error}
        </p>
      )}
    </section>
  );
}
