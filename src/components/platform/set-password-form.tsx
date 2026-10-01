"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Fase 3, PR 2 — La persona pone SU contraseña con un enlace de un solo uso
 * (activación o restablecimiento). Nadie más la ve.
 */
export function SetPasswordForm({ token, kind }: { token: string; kind: "activar" | "restablecer" }) {
  const [info, setInfo] = useState<{ name: string; email: string } | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/account-link/${encodeURIComponent(token)}`);
      const json = (await res.json().catch(() => null)) as { name?: string; email?: string; error?: { message?: string } } | null;
      if (!res.ok) setInvalid(json?.error?.message ?? "El enlace no es válido.");
      else setInfo({ name: json?.name ?? "", email: json?.email ?? "" });
    })();
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Las dos contraseñas no coinciden.");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/account-link/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setSaving(false);
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!res.ok) {
      setError(json?.error?.message ?? "No se pudo guardar la contraseña.");
      return;
    }
    setDone(true);
  }

  const title = kind === "activar" ? "Activa tu cuenta" : "Pon tu nueva contraseña";
  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {invalid && (
          <p className="text-sm text-destructive" data-testid="set-password-invalid">
            {invalid}
          </p>
        )}
        {done && (
          <div className="space-y-3" data-testid="set-password-done">
            <p className="text-sm">Listo: tu contraseña quedó guardada. Ya puedes entrar.</p>
            <Link href="/login" className="block text-center text-sm font-semibold text-brand-text underline">
              Iniciar sesión
            </Link>
          </div>
        )}
        {info && !done && (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm text-text-2">
              {info.name} · {info.email}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">Contraseña (mínimo 8 caracteres)</Label>
              <Input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Repítela</Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? "Guardando…" : "Guardar contraseña"}
            </Button>
            <p className="text-xs text-text-3">El enlace es de un solo uso. Al guardar se cierran las sesiones abiertas de tu cuenta.</p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
