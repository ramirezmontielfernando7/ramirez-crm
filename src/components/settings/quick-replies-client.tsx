"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { fetchJson, jsonInit } from "@/lib/fetch-json";
import { BODY_MAX, normalizeShortcut, SHORTCUT_MAX, type QuickReplyDto } from "@/lib/quick-replies";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

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

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Mensajes que usas seguido (precios, horarios, ubicación, datos para pagar). En cualquier chat, de
        Empresa o de Mi número, tócalos con el botón del rayo o escribe <span className="font-mono">/</span> y
        su atajo: el texto queda en el cuadro para revisarlo y enviarlo. Escribe{" "}
        <span className="font-mono">{"{nombre}"}</span> y se cambia por el nombre del cliente.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Nueva respuesta</CardTitle>
          <CardDescription>El atajo va sin espacios ni acentos. Ej.: precios, horario, cuenta.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
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

      <Card>
        <CardHeader>
          <CardTitle>Respuestas</CardTitle>
          <CardDescription>Las ve y las usa todo el equipo.</CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <p role="alert" className="text-sm text-danger-text">
              {loadError}
            </p>
          ) : replies === null ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : replies.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay respuestas rápidas.</p>
          ) : (
            <ul className="divide-y" data-testid="quick-reply-list">
              {replies.map((r) => (
                <li key={r.id} className="py-3">
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
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-[13px] font-semibold text-brand-text">/{r.shortcut}</p>
                        <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-sm text-text-2">{r.body}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
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
          )}
        </CardContent>
      </Card>
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
