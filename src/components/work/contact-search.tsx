"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { Input } from "@/components/ui/input";

/** 033 — Compartido por Tareas y Notas. */
/** Busca entre los contactos que quien escribe PUEDE ver (la API ya filtra). */
export function ContactSearch({ onPick }: { onPick: (c: { id: string; name: string }) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; phone: string | null }[]>([]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetchJson<{ contacts: { id: string; name: string; phone: string | null }[] }>(
        `/api/contacts?q=${encodeURIComponent(term)}`
      );
      if (res.ok) setResults(res.data.contacts.slice(0, 6));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="relative max-w-xs">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contacto (opcional)…" aria-label="Buscar contacto" />
      {results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border bg-popover p-1 shadow-pop">
          {results.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onPick({ id: c.id, name: c.name });
                  setQ("");
                  setResults([]);
                }}
                className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                {c.name}
                {c.phone && <span className="ml-2 text-xs text-text-3">{c.phone}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
