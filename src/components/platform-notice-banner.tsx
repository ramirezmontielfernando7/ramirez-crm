"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Megaphone, MessageCircle } from "lucide-react";
import { fetchJson } from "@/lib/fetch-json";
import { contactWhatsAppUrl } from "@/lib/plan-catalog";
import { cn } from "@/lib/utils";

type Notices = {
  broadcast: { id: string; message: string; level: "info" | "warning" } | null;
  billing: { kind: string; text: string; restricted: boolean; contactWhatsapp: string | null } | null;
};

const REFRESH_MS = 5 * 60_000;
const HIDDEN_KEY = "dashfort.notices.hidden";

/** Lo que la persona cerró en ESTE navegador (aviso por id; cobro por día). Puede fallar: entonces no se recuerda. */
function readHidden(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-20) : [];
  } catch {
    return [];
  }
}
function hide(key: string): void {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...readHidden(), key].slice(-20)));
  } catch {
    /* sin almacenamiento: solo se oculta hasta recargar */
  }
}
const today = () => new Date().toISOString().slice(0, 10);

/**
 * 048 — La franja de avisos de la plataforma, arriba de todo:
 *
 * - El aviso a todos los clientes (mantenimiento o novedades). Se puede
 *   cerrar; vuelve solo si se publica otro.
 * - La prueba gratis o el pago de esta organización. Si la IA y las campañas
 *   ya están en pausa, no se cierra: el equipo tiene que saber por qué la IA
 *   no contesta. Si solo está por vencer, se cierra por hoy.
 */
export function PlatformNoticeBanner() {
  const [notices, setNotices] = useState<Notices | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);

  const load = useCallback(async () => {
    const res = await fetchJson<Notices>("/api/notices");
    if (res.ok) setNotices(res.data);
  }, []);

  useEffect(() => {
    setHidden(readHidden());
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (!notices) return null;
  const bc = notices.broadcast && !hidden.includes(`bc:${notices.broadcast.id}`) ? notices.broadcast : null;
  const billKey = notices.billing ? `bill:${notices.billing.kind}:${today()}` : "";
  const bill = notices.billing && (notices.billing.restricted || !hidden.includes(billKey)) ? notices.billing : null;
  if (!bc && !bill) return null;

  const close = (key: string) => {
    hide(key);
    setHidden((h) => [...h, key]);
  };

  return (
    <>
      {bc && (
        <div
          role="status"
          data-testid="platform-broadcast-banner"
          className={cn(
            "flex shrink-0 items-start gap-2 border-b px-4 py-2 text-sm",
            bc.level === "warning" ? "border-warning-soft bg-warning-tint text-warning-text" : "border-info-soft bg-info-tint text-info-text"
          )}
        >
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1 break-words">{bc.message}</p>
          <button
            type="button"
            className="shrink-0 rounded px-2 py-0.5 text-xs font-medium underline-offset-2 hover:underline"
            onClick={() => close(`bc:${bc.id}`)}
            data-testid="platform-broadcast-close"
          >
            Entendido
          </button>
        </div>
      )}
      {bill && (
        <div
          role={bill.restricted ? "alert" : "status"}
          data-testid="billing-notice-banner"
          data-kind={bill.kind}
          className={cn(
            "flex shrink-0 items-start gap-2 border-b px-4 py-2 text-sm",
            bill.restricted ? "border-danger-soft bg-danger-tint text-danger-text" : "border-warning-soft bg-warning-tint text-warning-text"
          )}
        >
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{bill.text}</p>
          {bill.contactWhatsapp && (
            <a
              href={contactWhatsAppUrl(bill.contactWhatsapp, "Hola, quiero continuar con mi plan de Dashfort.")}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-medium underline underline-offset-2"
              data-testid="billing-notice-contact"
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden />
              Escríbenos
            </a>
          )}
          {!bill.restricted && (
            <button
              type="button"
              className="shrink-0 rounded px-2 py-0.5 text-xs font-medium underline-offset-2 hover:underline"
              onClick={() => close(billKey)}
              data-testid="billing-notice-close"
            >
              Entendido
            </button>
          )}
        </div>
      )}
    </>
  );
}
