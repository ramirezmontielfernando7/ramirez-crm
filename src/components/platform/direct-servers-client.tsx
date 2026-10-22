"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "./api";

/**
 * Conexión directa (PR 2) — Plataforma → servidores del dispositivo vinculado:
 * alta con su llave (que no se vuelve a mostrar: solo sus últimos 4), prueba,
 * capacidad y estado. Cada empresa se asigna desde su ficha.
 */

export type DirectServer = {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyLast4: string;
  maxInstances: number;
  status: "active" | "full" | "disabled";
  notes: string | null;
  used: number;
};

const STATUS_LABEL = { active: "Activo", full: "Lleno", disabled: "Desactivado" } as const;

export function DirectServersClient() {
  const [servers, setServers] = useState<DirectServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ name: "", baseUrl: "", apiKey: "", maxInstances: "25" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ servers: DirectServer[] }>("/api/platform/direct-servers");
    if (r.data) setServers(r.data.servers);
    else setError(r.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await api("/api/platform/direct-servers", {
      method: "POST",
      body: JSON.stringify({
        name: form.name,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        maxInstances: Number(form.maxInstances) || 25,
      }),
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setForm({ name: "", baseUrl: "", apiKey: "", maxInstances: "25" });
    await load();
  }

  async function test(id: string) {
    setMessage((m) => ({ ...m, [id]: "Probando…" }));
    const r = await api<{ ok: boolean; instances?: number; error?: string }>(`/api/platform/direct-servers/${id}/test`, { method: "POST" });
    const text = r.data?.ok ? `Responde (${r.data.instances} instancia(s))` : (r.data?.error ?? r.error ?? "Error");
    setMessage((m) => ({ ...m, [id]: text }));
  }

  async function setStatus(id: string, status: DirectServer["status"]) {
    const r = await api(`/api/platform/direct-servers/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    if (!r.ok) setError(r.error);
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("¿Borrar este servidor?")) return;
    const r = await api(`/api/platform/direct-servers/${id}`, { method: "DELETE" });
    if (!r.ok) setError(r.error);
    await load();
  }

  return (
    <div className="space-y-4" data-testid="platform-direct-servers">
      <p className="text-xs text-text-3">
        Solo tú ves esto. Las empresas nunca ven la dirección ni la llave: Dashfort crea y administra la instancia de cada una.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!servers ? (
        <p className="text-sm text-text-2">Cargando…</p>
      ) : servers.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-text-2">Aún no hay servidores.</div>
      ) : (
        <div className="overflow-x-auto rounded-md border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-[11px] font-medium text-text-3">
              <tr>
                <th className="px-3 py-2 font-medium">Nombre</th>
                <th className="px-3 py-2 font-medium">Dirección</th>
                <th className="px-3 py-2 font-medium">Llave</th>
                <th className="px-3 py-2 text-right font-medium">Empresas</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y" data-testid="platform-direct-servers-list">
              {servers.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2">
                    <code className="break-all text-xs">{s.baseUrl}</code>
                  </td>
                  <td className="px-3 py-2 text-xs">…{s.apiKeyLast4}</td>
                  <td className="px-3 py-2 text-right">
                    {s.used} / {s.maxInstances}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      className="rounded border bg-background px-1 py-0.5 text-xs"
                      value={s.status}
                      aria-label={`Estado de ${s.name}`}
                      onChange={(e) => void setStatus(s.id, e.target.value as DirectServer["status"])}
                    >
                      {Object.entries(STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="space-x-2 whitespace-nowrap px-3 py-2 text-right">
                    {message[s.id] && <span className="text-xs text-text-3">{message[s.id]}</span>}
                    <Button size="sm" variant="outline" onClick={() => void test(s.id)}>
                      Probar
                    </Button>
                    <Button size="sm" variant="outline" disabled={s.used > 0} onClick={() => void remove(s.id)}>
                      Borrar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={add} className="space-y-2 rounded-lg border bg-card p-4" data-testid="platform-direct-server-form">
        <h2 className="text-sm font-semibold">Registrar servidor</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input placeholder="https://evolution.midominio.com" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} required />
          <Input type="password" autoComplete="off" placeholder="Llave maestra del servidor" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} required />
          <Input type="number" min={1} max={1000} placeholder="Empresas que aguanta" value={form.maxInstances} onChange={(e) => setForm({ ...form, maxInstances: e.target.value })} />
        </div>
        <Button size="sm" type="submit" disabled={busy}>
          Registrar
        </Button>
      </form>
    </div>
  );
}
