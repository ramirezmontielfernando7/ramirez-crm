"use client";

import { useState } from "react";
import { Copy, KeyRound, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, fecha, type Member } from "./api";

/** Un enlace que se ve UNA vez: con botón de copiar y el aviso de qué es. */
export function OneTimeLink({ url, expiresAt, kind }: { url: string; expiresAt: string; kind: "activate" | "reset" }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-sm" data-testid="platform-one-time-link">
      <p className="flex items-center gap-1.5 font-semibold">
        <ShieldAlert className="h-4 w-4" />
        {kind === "activate" ? "Enlace de activación" : "Enlace para poner contraseña"} — se muestra UNA sola vez
      </p>
      <code className="block break-all rounded bg-background px-2 py-1.5 text-xs" data-testid="platform-link-url">
        {url}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(url).then(() => setCopied(true));
          }}
        >
          <Copy className="h-3.5 w-3.5" /> {copied ? "Copiado" : "Copiar"}
        </Button>
        <span className="text-xs text-text-2">Caduca: {fecha(expiresAt)}. De un solo uso.</span>
      </div>
      <p className="text-xs text-text-2">
        Entrégalo solo a esa persona, por un canal de confianza. Quien tenga el enlace puede poner la contraseña: no lo
        uses tú ni lo compartas en un grupo.
      </p>
    </div>
  );
}


/** Restablecer la contraseña de una persona: pide la del administrador primero. */
export function ResetLink({ member, onDone }: { member: Member; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const r = await api<{ url: string; expiresAt: string }>(`/api/platform/users/${member.userId}/link`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    setPassword("");
    if (!r.ok || !r.data) {
      setError(r.error);
      onDone();
      return;
    }
    setLink(r.data);
    onDone();
  }

  if (link) return <OneTimeLink url={link.url} expiresAt={link.expiresAt} kind="reset" />;
  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="platform-reset-form">
      <p className="text-sm">
        Enlace de un solo uso (2 h) para que <b>{member.name}</b> ponga su propia contraseña. Tú nunca la ves. Confirma
        con <b>tu</b> contraseña de administrador:
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="password"
          autoComplete="current-password"
          className="max-w-xs"
          placeholder="Tu contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="platform-reauth-password"
        />
        <Button size="sm" disabled={busy || !password} onClick={() => void submit()} data-testid="platform-reset-submit">
          {busy ? "Verificando…" : "Generar enlace"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive" data-testid="platform-reset-error">{error}</p>}
    </div>
  );
}



/** El botón que abre `ResetLink` (para no repetir el ícono). */
export function ResetLinkButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} aria-expanded={open} data-testid="platform-reset-open">
      <KeyRound className="h-3.5 w-3.5" /> Enlace para contraseña
    </Button>
  );
}
