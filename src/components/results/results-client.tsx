"use client";

import { useEffect, useState } from "react";
import type {
  AdsBlockDto,
  BotBlockDto,
  HygieneBlockDto,
  SalesBlockDto,
} from "@/lib/analytics";
import { AdsSection } from "./ads-section";
import { BotSection } from "./bot-section";
import { HygieneSection } from "./hygiene-section";
import { defaultRange, RangePicker, type Range } from "./range-picker";
import { SalesSection } from "./sales-section";
import { useViewer } from "@/components/viewer-context";
import { useAssignees } from "@/components/assignment/use-assignees";
import { PageShell } from "@/components/ui/page-shell";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "ventas", label: "Ventas y embudo" },
  { key: "atencion", label: "Atención" },
  { key: "origen", label: "Origen y anuncios" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

type Block<T> = { data: T | null; loading: boolean; error: string | null };

const inicial = <T,>(): Block<T> => ({ data: null, loading: true, error: null });

/**
 * Pide un bloque y lo deja en su estado. Mientras llega, CONSERVA lo anterior
 * (la sección lo atenúa): vaciar en cada cambio de rango haría saltar la
 * pantalla. Una respuesta que llega tarde, de un rango que ya no es el
 * elegido, se descarta con el `AbortSignal`.
 */
async function cargar<T>(
  url: string,
  set: (update: (prev: Block<T>) => Block<T>) => void,
  signal: AbortSignal
): Promise<void> {
  set((prev) => ({ ...prev, loading: true, error: null }));
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch {
    if (signal.aborted) return;
    set(() => ({ data: null, loading: false, error: "No se pudo cargar. Revisa tu conexión." }));
    return;
  }
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (signal.aborted) return;
  if (!res.ok || !body) {
    set(() => ({
      data: null,
      loading: false,
      error: body?.error?.message ?? "No se pudo calcular este bloque.",
    }));
    return;
  }
  set(() => ({ data: body, loading: false, error: null }));
}

/**
 * 019 — Pantalla Resultados.
 *
 * Cada bloque carga por su cuenta: son una veintena de consultas repartidas en
 * cuatro grupos, y en una sola respuesta el más lento retrasaría a los tres
 * rápidos. Así la pantalla pinta en cascada y un bloque roto muestra su propio
 * error sin tumbar el resto.
 */
export function ResultsClient({
  currency,
  agenda,
  today,
  timezone,
}: {
  currency: string;
  agenda: boolean;
  /** Hoy en la zona del negocio (`YYYY-MM-DD`), resuelto en el servidor. */
  today: string;
  timezone: string;
}) {
  const [tab, setTab] = useState<TabKey>("ventas");
  const [range, setRange] = useState<Range>(() => defaultRange(today));
  const [sales, setSales] = useState<Block<SalesBlockDto>>(inicial);
  const [ads, setAds] = useState<Block<AdsBlockDto>>(inicial);
  const [bot, setBot] = useState<Block<BotBlockDto>>(inicial);
  const [hygiene, setHygiene] = useState<Block<HygieneBlockDto>>(inicial);
  // 020: quien ve al equipo elige de quién son los números; el asesor ve los
  // suyos (el servidor lo impone igual).
  const viewer = useViewer();
  const teamView = viewer.can("results.all");
  const team = useAssignees();
  const [person, setPerson] = useState<string>("");
  const who = person ? `&userId=${encodeURIComponent(person)}` : "";

  useEffect(() => {
    const ctl = new AbortController();
    const q = `from=${range.from}&to=${range.to}${who}`;
    void cargar(`/api/analytics/sales?${q}`, setSales, ctl.signal);
    void cargar(`/api/analytics/ads?${q}`, setAds, ctl.signal);
    void cargar(`/api/analytics/bot?${q}`, setBot, ctl.signal);
    return () => ctl.abort();
  }, [range, who]);

  // La higiene describe el AHORA: no depende del rango elegido.
  useEffect(() => {
    const ctl = new AbortController();
    void cargar(`/api/analytics/hygiene?${who.slice(1)}`, setHygiene, ctl.signal);
    return () => ctl.abort();
  }, [who]);

  const filtros = (
    <>
          {teamView && (
            <select
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              aria-label="Resultados de"
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            >
              <option value="">Todos los asesores</option>
              {team.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <RangePicker compact value={range} onChange={setRange} today={today} timezone={timezone} />
    </>
  );

  return (
    <PageShell
      pillar="results"
      variant="fluid"
      tabsLabel="Secciones de Resultados"
      tabsSlot={
        <div role="tablist" aria-label="Secciones de Resultados" className="flex items-center gap-0.5 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === t.key ? "bg-brand-tint text-brand-text" : "text-text-2 hover:bg-accent hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      }
      actions={<div className="hidden items-center gap-2 sm:flex">{filtros}</div>}
    >
      <div tabIndex={0} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 focus-visible:outline-none sm:p-6">
        <div className="flex flex-wrap items-center gap-2 sm:hidden">{filtros}</div>
        {tab === "ventas" && (
          <>
            <SalesSection {...sales} currency={currency} />
            <HygieneSection {...hygiene} currency={currency} />
          </>
        )}
        {tab === "atencion" && <BotSection {...bot} agenda={agenda} />}
        {tab === "origen" && <AdsSection {...ads} />}
      </div>
    </PageShell>
  );
}
