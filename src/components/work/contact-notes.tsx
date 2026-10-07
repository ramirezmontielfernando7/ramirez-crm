"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { NOTE_BODY_MAX, NOTE_VISIBILITY_HINT, type NoteDto } from "@/lib/work";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NoteCard } from "./notes-client";

/**
 * 033, PR 2 — «Notas de trabajo» en el panel del contacto (Bandeja): las
 * notas del equipo ligadas a este contacto y «Nueva nota», que la crea ya
 * ligada a este chat. Distintas de las notas de la línea de tiempo (022), que
 * no cambian. Internas: nunca se envían al cliente, tampoco en chats de
 * prueba (no hay ningún camino de aquí a WhatsApp).
 */
export function ContactNotes({ contactId, conversationId }: { contactId: string; conversationId: string }) {
  const [notes, setNotes] = useState<NoteDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchJson<{ notes: NoteDto[] }>(`/api/work/notes?contactId=${encodeURIComponent(contactId)}`);
    if (res.ok) {
      setNotes(res.data.notes);
      setError(null);
    } else setError(res.error);
  }, [contactId]);

  useEffect(() => {
    setNotes(null);
    setWriting(false);
    setText("");
    void load();
  }, [load]);

  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    const res = await fetchJson<{ note: NoteDto }>("/api/work/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: text, conversationId }),
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setText("");
    setWriting(false);
    setNotes((prev) => [res.data.note, ...(prev ?? [])]);
  }

  return (
    <section className="border-b px-4 py-3" aria-label="Notas de trabajo">
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">Notas de trabajo{notes && notes.length > 0 ? ` · ${notes.length}` : ""}</span>
        {!writing && (
          <Button size="sm" variant="outline" onClick={() => setWriting(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" strokeWidth={2} />
            Nueva nota
          </Button>
        )}
      </div>

      {writing && (
        <div className="mt-2 space-y-2">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={NOTE_BODY_MAX}
            placeholder="Escribe una nota para el equipo…"
            aria-label="Nueva nota de trabajo"
            rows={3}
            autoFocus
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setWriting(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving || !text.trim()}>
              {saving ? "Guardando…" : "Guardar nota"}
            </Button>
          </div>
        </div>
      )}

      {/* Quién la ve, en sencillo (pedido del dueño). */}
      <p className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug text-text-2" role="note">
        <Users className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        {NOTE_VISIBILITY_HINT}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-[12px] text-danger-text">
          {error}
        </p>
      )}

      {notes && notes.length > 0 && (
        <ul className="mt-2.5 space-y-2">
          {notes.map((n) => (
            <li key={n.id}>
              <Link href={`/trabajo/notas?nota=${encodeURIComponent(n.id)}`} aria-label={`Abrir nota: ${n.title || n.body.slice(0, 40)}`}>
                <NoteCard note={n} compact />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
