"use client";

import { useState } from "react";
import { MessageCircle, Phone, UserPlus } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { MY_CHATS_TEXT } from "@/lib/mi-numero";
import { normalizeTypedPhone, prettyPhone } from "@/lib/phone-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Mi número — Lo que sale cuando lo tecleado parece un teléfono y ninguno de
 * mis chats lo tiene: abrir el chat (nace privado) o registrar el contacto con
 * su nombre. Como en Empresa, pero sin plantillas: es mi WhatsApp, escribo directo.
 */
export function NumberNewChatCard({ query, onOpened }: { query: string; onOpened: (conversationId: string) => void }) {
  const typed = normalizeTypedPhone(query);
  const [registering, setRegistering] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(withName?: string) {
    if (busy || !typed.valid) return;
    setBusy(true);
    setError(null);
    const res = await fetchJson<{ conversationId: string }>("/api/my-number/chats/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: query, ...(withName?.trim() ? { name: withName.trim() } : {}) }),
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onOpened(res.data.conversationId);
  }

  return (
    <div className="p-4" data-testid="my-number-new-chat">
      <div className="rounded-2xl border bg-card p-4 text-center shadow-sm">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand-veil text-brand">
          <Phone className="h-5 w-5" strokeWidth={1.7} />
        </div>
        <p className="text-[15px] font-semibold leading-tight">{MY_CHATS_TEXT.newTitle}</p>
        <p className="mt-1 text-sm text-text-2">{prettyPhone(typed.phone)}</p>
        {!typed.valid && <p className="mt-1 text-[11.5px] text-danger-text">{typed.problem}</p>}
        {registering ? (
          <div className="mt-3 space-y-2 text-left">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del contacto"
              aria-label="Nombre del contacto"
              onKeyDown={(e) => e.key === "Enter" && void open(name)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRegistering(false)}>
                Cancelar
              </Button>
              <Button size="sm" disabled={!typed.valid || busy} onClick={() => void open(name)}>
                {busy ? "Guardando…" : "Guardar y abrir chat"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <Button disabled={!typed.valid || busy} onClick={() => void open()}>
              <MessageCircle className="h-4 w-4" strokeWidth={1.7} />
              {busy ? "Abriendo…" : MY_CHATS_TEXT.newOpen}
            </Button>
            <Button variant="outline" disabled={!typed.valid} onClick={() => setRegistering(true)}>
              <UserPlus className="h-4 w-4" strokeWidth={1.7} />
              {MY_CHATS_TEXT.newRegister}
            </Button>
          </div>
        )}
        {error && <p className="mt-2 text-[12px] text-danger-text">{error}</p>}
        <p className="mt-3 text-[11.5px] leading-snug text-text-3">{MY_CHATS_TEXT.newHelp}</p>
      </div>
    </div>
  );
}
