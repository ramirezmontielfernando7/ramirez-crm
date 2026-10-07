"use client";

import { useEffect, useState } from "react";
import { MessageCircle, Phone, UserPlus, X } from "lucide-react";
import { normalizeTypedPhone, prettyPhone } from "@/lib/phone-search";
import { useViewer } from "@/components/viewer-context";
import { useAssignees } from "@/components/assignment/use-assignees";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TemplateSender } from "./template-sender";

type Mode = "register" | "send";
type Registered = { id: string; name: string; phone: string | null };
type Stage = { id: string; name: string; kind: string };

async function postJson<T>(url: string, body: unknown): Promise<{ data?: T; error?: string }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { error: "No se pudo conectar. Revisa tu internet e intenta de nuevo" };
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!res.ok) return { error: json?.error?.message ?? "No se pudo completar la acción" };
  return { data: json as T };
}

/**
 * Lo que sale cuando la búsqueda de la Bandeja no encuentra nada y lo
 * tecleado parece un teléfono: tres caminos para empezar a hablar con ese
 * número. Toda la lógica (alta, consentimiento, plantilla) vive en el servidor
 * (`/api/inbox/new-number/*`); aquí solo se pide y se muestra.
 */
export function UnregisteredNumberCard({
  query,
  onOpenChat,
}: {
  query: string;
  /** Abre ese chat en el hilo (y refresca la lista). */
  onOpenChat: (conversationId: string) => void;
}) {
  const typed = normalizeTypedPhone(query);
  const [mode, setMode] = useState<Mode | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<Registered | null>(null);

  async function openChat() {
    if (opening) return;
    setOpening(true);
    setError(null);
    const r = await postJson<{ conversationId: string }>("/api/inbox/new-number/open", {
      phone: query,
    });
    setOpening(false);
    if (r.error || !r.data) {
      setError(r.error ?? "No se pudo abrir el chat");
      return;
    }
    onOpenChat(r.data.conversationId);
  }

  return (
    <div className="p-4">
      <div className="rounded-2xl border bg-card p-4 text-center shadow-sm">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand-veil text-brand">
          <Phone className="h-5 w-5" strokeWidth={1.7} />
        </div>
        <p className="text-[15px] font-semibold leading-tight">Este número no está registrado</p>
        <p className="mt-1 text-sm text-text-2">{prettyPhone(typed.phone)}</p>
        {!typed.valid && <p className="mt-1 text-[11.5px] text-danger-text">{typed.problem}</p>}

        {registered ? (
          <div className="mt-3 rounded-xl bg-subtle p-3 text-left text-sm">
            <p className="font-medium">Contacto registrado</p>
            <p className="text-text-2">
              {registered.name} · {prettyPhone(registered.phone ?? typed.phone)}
            </p>
          </div>
        ) : null}

        <div className="mt-3 flex flex-col gap-2">
          {!registered && (
            <Button
              variant="outline"
              disabled={!typed.valid}
              onClick={() => setMode("register")}
            >
              <UserPlus className="h-4 w-4" strokeWidth={1.7} />
              Registrar contacto
            </Button>
          )}
          <Button variant="outline" disabled={!typed.valid || opening} onClick={() => void openChat()}>
            <MessageCircle className="h-4 w-4" strokeWidth={1.7} />
            {opening ? "Abriendo…" : "Abrir chat"}
          </Button>
          <Button disabled={!typed.valid} onClick={() => setMode("send")}>
            Enviar mensaje
          </Button>
        </div>
        {error && <p className="mt-2 text-[12px] text-danger-text">{error}</p>}
      </div>

      {mode === "register" && (
        <RegisterDialog
          phoneInput={query}
          onClose={() => setMode(null)}
          onDone={(contact, existed, conversationId) => {
            setMode(null);
            if (existed && conversationId) onOpenChat(conversationId);
            else setRegistered(contact);
          }}
        />
      )}
      {mode === "send" && (
        <SendDialog
          phoneInput={query}
          onClose={() => setMode(null)}
          onSent={(conversationId) => {
            setMode(null);
            onOpenChat(conversationId);
          }}
        />
      )}
    </div>
  );
}

/** Hoja corta: abajo en el celular, al centro en pantallas grandes. */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border bg-popover p-5 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-[16px] font-semibold">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full p-1 text-text-3 hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RegisterDialog({
  phoneInput,
  onClose,
  onDone,
}: {
  phoneInput: string;
  onClose: () => void;
  onDone: (contact: Registered, existed: boolean, conversationId: string | null) => void;
}) {
  const viewer = useViewer();
  const assignees = useAssignees();
  const [phone, setPhone] = useState(phoneInput);
  const [name, setName] = useState("");
  const [stages, setStages] = useState<Stage[]>([]);
  const [stageId, setStageId] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = normalizeTypedPhone(phone);

  useEffect(() => {
    let alive = true;
    void fetch("/api/pipeline/stages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stages: Stage[] } | null) => {
        if (alive && d) setStages(d.stages.filter((s) => s.kind === "open"));
      })
      .catch(() => null);
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    if (busy || !typed.valid) return;
    setBusy(true);
    setError(null);
    const r = await postJson<{ contact: Registered; created: boolean }>(
      "/api/inbox/new-number/register",
      {
        phone,
        name: name.trim() || undefined,
        stageId: stageId || undefined,
        assignToUserId: assignTo || undefined,
      }
    );
    if (r.error || !r.data) {
      setBusy(false);
      setError(r.error ?? "No se pudo registrar");
      return;
    }
    // Ya existía: no se duplica, se abre su chat.
    if (!r.data.created) {
      const o = await postJson<{ conversationId: string }>("/api/inbox/new-number/open", { phone });
      setBusy(false);
      onDone(r.data.contact, true, o.data?.conversationId ?? null);
      return;
    }
    setBusy(false);
    onDone(r.data.contact, false, null);
  }

  return (
    <Sheet title="Registrar contacto" onClose={onClose}>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="nn-phone">Teléfono</Label>
          <Input
            id="nn-phone"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <p className={`text-[12px] ${typed.valid ? "text-text-2" : "text-danger-text"}`}>
            {typed.valid ? `Se guardará como ${prettyPhone(typed.phone)}` : typed.problem}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nn-name">Nombre (opcional)</Label>
          <Input
            id="nn-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Si lo dejas vacío, se muestra el teléfono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nn-stage">Etapa</Label>
          <select
            id="nn-stage"
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
          >
            <option value="">Primera etapa</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {viewer.can("assignment.manage") && (
          <div className="space-y-1.5">
            <Label htmlFor="nn-assign">Asignar a (opcional)</Label>
            <select
              id="nn-assign"
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="">Sin asignar</option>
              {assignees.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && <p className="text-xs text-danger-text">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={!typed.valid || busy} onClick={() => void save()}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function SendDialog({
  phoneInput,
  onClose,
  onSent,
}: {
  phoneInput: string;
  onClose: () => void;
  onSent: (conversationId: string) => void;
}) {
  const typed = normalizeTypedPhone(phoneInput);
  const [consent, setConsent] = useState<"yes" | "unknown" | null>(null);

  return (
    <Sheet title="Enviar mensaje" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-text-2">Para {prettyPhone(typed.phone)}</p>
        <p className="rounded-xl bg-warning-tint p-3 text-[13px] text-warning-text">
          WhatsApp solo permite escribir primero con una plantilla aprobada, y solo a personas que
          aceptaron recibir mensajes de tu negocio.
        </p>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">¿Esta persona aceptó recibir mensajes?</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="nn-consent"
              checked={consent === "yes"}
              onChange={() => setConsent("yes")}
            />
            Sí, aceptó
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="nn-consent"
              checked={consent === "unknown"}
              onChange={() => setConsent("unknown")}
            />
            No lo sé
          </label>
        </fieldset>

        {consent === "unknown" && (
          <p className="text-[13px] text-text-2">
            Sin confirmar que aceptó, no se puede enviar. Puedes registrar el contacto y escribirle
            cuando lo confirmes.
          </p>
        )}
        {consent === "yes" && (
          <TemplateSender
            sendUrl="/api/inbox/new-number/send"
            extraBody={{ phone: phoneInput, consentAnswer: "yes" }}
            sendLabel="Enviar plantilla"
            onSent={(result) => {
              const id = result?.conversationId;
              if (typeof id === "string") onSent(id);
            }}
          />
        )}
        <div className="flex justify-end pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
