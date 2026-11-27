"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { BrandTile } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveAccentSet, type Branding } from "@/lib/branding";
import { FAVICON_MIMES, MAX_FAVICON_BYTES } from "@/lib/favicon";
import { cn } from "@/lib/utils";

/**
 * Ronda 3 — Ajustes → Apariencia, tarjeta «Marca de la empresa»: logo, nombre
 * y color de acento, lo que ve todo el equipo. Cada cambio se guarda solo (por
 * las mismas rutas de siempre: `/api/settings/branding` y su `/favicon`); la
 * moneda y el color del menú siguen en «Más de la marca».
 */

/** Los seis colores de la maqueta; los tonos derivados y el contraste se calculan solos. */
const BRAND_SWATCHES: readonly { hex: string; label: string }[] = [
  { hex: "#12999d", label: "Teal" },
  { hex: "#1f5fd1", label: "Azul" },
  { hex: "#6d3fc0", label: "Morado" },
  { hex: "#c0261f", label: "Rojo" },
  { hex: "#946200", label: "Ámbar" },
  { hex: "#1f7a3a", label: "Verde" },
];

export function AppearanceBrandCard({ branding }: { branding: Branding }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(branding);
  const [name, setName] = useState(branding.name);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function saveBrand(next: { name?: string; accent?: string }) {
    const body = {
      name: (next.name ?? saved.name).trim(),
      accent: next.accent ?? saved.accent,
      currency: saved.currency,
      sidebar: saved.sidebar,
    };
    if (!body.name) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/settings/branding", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setMsg({ ok: false, text: data?.error?.message ?? "No se pudo guardar la marca." });
      return;
    }
    setSaved((s) => ({ ...s, name: body.name, accent: body.accent }));
    setMsg({ ok: true, text: "Marca guardada." });
    router.refresh();
  }

  async function upload(file: File) {
    setMsg(null);
    if (file.size > MAX_FAVICON_BYTES) {
      setMsg({ ok: false, text: `El logo no puede pasar de ${Math.round(MAX_FAVICON_BYTES / 1024)} KB.` });
      return;
    }
    setBusy(true);
    const res = await fetch("/api/settings/branding/favicon", {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setMsg({ ok: false, text: data?.error?.message ?? "No se pudo subir el logo." });
      return;
    }
    const data = (await res.json()) as { favicon: Branding["favicon"] };
    setSaved((s) => ({ ...s, favicon: data.favicon }));
    setMsg({ ok: true, text: "Logo actualizado." });
    router.refresh();
  }

  const accent = saved.accent.toLowerCase();

  return (
    <section aria-labelledby="ap-brand" className="min-w-0 rounded-card border bg-surface" data-testid="appearance-brand">
      <h3 id="ap-brand" className="border-b px-4 py-3 text-[14px] font-semibold">
        Marca de la empresa
      </h3>
      <div className="space-y-5 p-4">
        <div className="flex items-center gap-3">
          <BrandTile
            branding={{ name: name.trim() || saved.name, accent: saved.accent, favicon: saved.favicon }}
            className="h-14 w-14 shrink-0 rounded-[12px] text-[22px]"
          />
          <div className="min-w-0 space-y-1">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
              <Upload className="h-4 w-4" strokeWidth={1.8} />
              Cambiar logo
            </Button>
            <p className="text-[12px] text-text-3">PNG o SVG cuadrado, mínimo 256 px</p>
          </div>
          <input
            ref={input}
            type="file"
            accept={FAVICON_MIMES.join(",")}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void upload(f);
            }}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ap-brand-name">Nombre que ve tu equipo</Label>
          <Input
            id="ap-brand-name"
            maxLength={30}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name.trim() && name.trim() !== saved.name) void saveBrand({ name });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </div>

        <div className="space-y-2">
          <p id="ap-accent" className="text-sm font-medium">
            Color de acento
          </p>
          <div role="radiogroup" aria-labelledby="ap-accent" className="flex flex-wrap items-center gap-2.5">
            {BRAND_SWATCHES.map((s) => {
              const on = accent === s.hex;
              return (
                <button
                  key={s.hex}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={s.label}
                  title={s.label}
                  disabled={busy}
                  onClick={() => !on && void saveBrand({ accent: s.hex })}
                  className={cn(
                    "h-7 w-7 rounded-full transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on && "ring-2 ring-offset-2 ring-offset-surface"
                  )}
                  style={{ background: resolveAccentSet(s.hex, "light").accent, ...(on ? { ["--tw-ring-color" as string]: resolveAccentSet(s.hex, "light").accent } : {}) }}
                />
              );
            })}
          </div>
        </div>

        {msg && (
          <p role="status" className={cn("text-[13px]", msg.ok ? "text-text-2" : "text-destructive")}>
            {msg.text}
          </p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
          <Link href="/settings/personalization/marca" className="text-brand-text hover:underline">
            Más de la marca: moneda, color del menú e ícono
          </Link>
          <Link href="/settings/personalization/navegacion" className="text-brand-text hover:underline">
            Navegación (menú por rol)
          </Link>
        </div>
      </div>
    </section>
  );
}
