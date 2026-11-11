"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Search, Trash2, Zap } from "lucide-react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { BODY_MAX, normalizeShortcut, SHORTCUT_MAX, type QuickReplyDto } from "@/lib/quick-replies";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SettingsHeader } from "@/components/settings/settings-header";
import { EmptyState } from "@/components/ui/empty-state";

type Draft = { shortcut: string; body: string };
const EMPTY: Draft = { shortcut: "", body: "" };

/**
 * Ajustes → Operación CRM → Respuestas rápidas: los mensajes que el equipo
 * manda desde el chat (Empresa y Mi número) con el rayo o escribiendo `/atajo`.
 */
export function QuickRepliesClient() {
  const [replies, setReplies] = useState<QuickReplyDto[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<(Draft & { id: string }) | null>(null);

  const refetch = useCallback(async () => {
    const res = await fetchJson<{ replies: QuickReplyDto[] }>("/api/quick-replies");
    if (!res.ok) {
      setLoadError(`No se pudieron cargar las respuestas: ${res.error}`);
      return;
    }
    setLoadError(null);
    setReplies(res.data.replies);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function create() {
    setCreating(true);
    setError(null);
    const res = await fetchJson("/api/quick-replies", jsonInit("POST", draft));
    setCreating(false);
    if (!res.ok) return setError(res.error);
    setDraft(EMPTY);
    setShowNew(false);
    void refetch();
  }

  async function saveEdit() {
    if (!editing) return;
    const res = await fetchJson(`/api/quick-replies/${editing.id}`, jsonInit("PATCH", { shortcut: editing.shortcut, body: editing.body }));
    if (!res.ok) return setError(res.error);
    setError(null);
    setEditing(null);
    void refetch();
  }

  async function remove(r: QuickReplyDto) {
    if (!window.confirm(`¿Borrar la respuesta /${r.shortcut}?`)) return;
    const res = await fetchJson(`/api/quick-replies/${r.id}`, { method: "DELETE" });
    if (!res.ok) return setError(res.error);
    setError(null);
    void refetch();
  }

  const ready = (d: Draft) => d.shortcut.length > 0 && d.body.trim().length > 0;

  const q = query.trim().toLowerCase().replace(/^\//, "");
  const shown = (replies ?? []).filter((r) => !q || r.shortcut.includes(q) || r.body.toLowerCase().includes(q));

  return (
    <div className="space-y-5">
      <SettingsHeader
        title="Respuestas rápidas"
        description={
          <>
            Textos que tu equipo usa seguido. Se usan con <span className="font-mono">/</span> o con el rayo en la caja
            de escribir; <span className="font-mono">{"{nombre}"}</span> se cambia por el nombre del cliente.
          </>
        }
        actions={
          <Button onClick={() => setShowNew((v) => !v)} data-testid="quick-reply-new">
            <Plus className="mr-1.5 h-4 w-4" />
            Nueva respuesta
          </Button>
        }
      />

      {showNew && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-xs text-text-3">El atajo va sin espacios ni acentos. Ej.: precios, horario, cuenta.</p>
            <ReplyFields idPrefix="qr-new" value={draft} onChange={setDraft} />
            {error && !editing && (
              <p role="alert" className="text-sm text-danger-text">
                {error}
              </p>
            )}
            <Button disabled={!ready(draft) || creating} onClick={() => void create()} data-testid="quick-reply-create">
              {creating ? "Guardando…" : "Guardar respuesta"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar atajo o texto"
          aria-label="Buscar atajo o texto"
          className="pl-9"
        />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        {loadError ? (
          <p role="alert" className="p-4 text-sm text-danger-text">
            {loadError}
          </p>
        ) : replies === null ? (
          <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
        ) : shown.length === 0 ? (
          <EmptyState
            compact
            icon={Zap}
            title={replies.length === 0 ? "Aún no hay respuestas rápidas" : "Ninguna respuesta coincide"}
            description={replies.length === 0 ? "Crea la primera con «Nueva respuesta»: precios, horario, datos de pago…" : "Prueba con otra palabra."}
          />
        ) : (
          <>
            <div className="grid grid-cols-[8rem_1fr_5rem] gap-3 border-b bg-muted/30 px-4 py-2.5 text-xs font-medium text-text-3 sm:grid-cols-[10rem_1fr_6rem]">
              <span>Atajo</span>
              <span>Texto</span>
              <span />
            </div>
            <ul className="divide-y" data-testid="quick-reply-list">
              {shown.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  {editing?.id === r.id ? (
                    <div className="space-y-2">
                      <ReplyFields idPrefix={`qr-${r.id}`} value={editing} onChange={(d) => setEditing({ ...editing, ...d })} />
                      {error && (
                        <p role="alert" className="text-sm text-danger-text">
                          {error}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" disabled={!ready(editing)} onClick={() => void saveEdit()}>
                          Guardar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditing(null);
                            setError(null);
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-[8rem_1fr_5rem] items-start gap-3 sm:grid-cols-[10rem_1fr_6rem]">
                      <p className="truncate font-mono text-[13px] font-semibold">/{r.shortcut}</p>
                      <p className="line-clamp-2 whitespace-pre-line text-sm text-text-2">{r.body}</p>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar /${r.shortcut}`}
                          onClick={() => {
                            setError(null);
                            setEditing({ id: r.id, shortcut: r.shortcut, body: r.body });
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Borrar /${r.shortcut}`} onClick={() => void remove(r)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function ReplyFields({ idPrefix, value, onChange }: { idPrefix: string; value: Draft; onChange: (d: Draft) => void }) {
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-shortcut`}>Atajo</Label>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-sm text-text-3">/</span>
          <Input
            id={`${idPrefix}-shortcut`}
            value={value.shortcut}
            maxLength={SHORTCUT_MAX}
            placeholder="precios"
            onChange={(e) => onChange({ ...value, shortcut: normalizeShortcut(e.target.value) })}
            className="max-w-xs font-mono"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-body`}>Mensaje</Label>
        <Textarea
          id={`${idPrefix}-body`}
          value={value.body}
          maxLength={BODY_MAX}
          rows={4}
          placeholder="Hola {nombre}, te comparto nuestros precios…"
          onChange={(e) => onChange({ ...value, body: e.target.value })}
        />
      </div>
    </>
  );
}
