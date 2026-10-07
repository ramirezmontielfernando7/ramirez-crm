"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { call } from "@/components/lab/agents-api";

type KbEntry = { id: string; kind: "qa" | "block"; question: string | null; answer: string | null; content: string | null };

/**
 * 031 (A2) — Conocimiento PROPIO de un agente (`/api/kb?agentId=`). El
 * compartido se maneja en /agent; aquí solo lo que este agente sabe de más.
 * `refreshKey` vuelve a medir el medidor cuando cambia «Usar el conocimiento
 * compartido».
 */
export function AgentKbPanel({ agentId, refreshKey }: { agentId: string; refreshKey: string }) {
  const [entries, setEntries] = useState<KbEntry[]>([]);
  const [chars, setChars] = useState<{ chars: number; warning: boolean } | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const q = encodeURIComponent(agentId);

  const load = useCallback(async () => {
    const [list, size] = await Promise.all([
      call<{ entries: KbEntry[] }>(`/api/kb?agentId=${q}`),
      call<{ chars: number; warning: boolean }>(`/api/kb/size?agentId=${q}`),
    ]);
    if (list.ok) setEntries(list.data.entries);
    if (size.ok) setChars(size.data);
  }, [q]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function add() {
    if (!question.trim() || !answer.trim()) return;
    const r = await call("/api/kb", { method: "POST", json: { kind: "qa", question, answer, agentId } });
    if (!r.ok) return setError(r.message);
    setError(null);
    setQuestion("");
    setAnswer("");
    void load();
  }

  async function remove(id: string) {
    const r = await call(`/api/kb/${id}?agentId=${q}`, { method: "DELETE" });
    if (!r.ok) setError(r.message);
    void load();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Conocimiento propio de este agente</p>
        {chars && (
          <Badge variant={chars.warning ? "warning" : "secondary"}>{chars.chars.toLocaleString("es-MX")} caracteres que lee</Badge>
        )}
      </div>
      <div className="space-y-2">
        <Input placeholder="Pregunta (p. ej. ¿Hacen envíos?)" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <Textarea placeholder="Respuesta" rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <Button size="sm" variant="outline" onClick={() => void add()} disabled={!question.trim() || !answer.trim()}>
          <Plus className="h-4 w-4" /> Agregar
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li key={e.id} className="flex items-start gap-2 rounded-md bg-subtle px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              {e.kind === "qa" ? (
                <>
                  <p className="font-medium">{e.question}</p>
                  <p className="text-muted-foreground">{e.answer}</p>
                </>
              ) : (
                <p className="whitespace-pre-wrap text-muted-foreground">{e.content}</p>
              )}
            </div>
            <Button variant="ghost" size="icon" aria-label="Eliminar entrada" onClick={() => void remove(e.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
        {entries.length === 0 && <li className="text-xs text-muted-foreground">Todavía no tiene conocimiento propio.</li>}
      </ul>
    </div>
  );
}
