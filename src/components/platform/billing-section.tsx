"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BILLING_LABEL,
  DEFAULT_TRIAL_DAYS,
  EXTRA_STORAGE_GB,
  PAYMENT_KINDS,
  PAYMENT_LABEL,
  type BillingKind,
  type BillingState,
  type PaymentKind,
} from "@/lib/billing";
import { formatMxn } from "@/lib/plan-catalog";
import { cn } from "@/lib/utils";
import { api, fecha } from "./api";

/**
 * 048 — Ficha de la organización → «Cobro y prueba»: prueba gratis con fecha
 * de fin, «pagado hasta», días de gracia, registrar un pago o un extra (con
 * su efecto en el acto) y la bitácora de pagos. Sin pasarela: todo a mano.
 */

type Payment = { id: string; kind: PaymentKind; amountMxn: number; months: number | null; quantity: number; note: string | null; paidAt: string };
type Billing = {
  trialEndsAt: string | null;
  paidUntil: string | null;
  graceDays: number;
  note: string | null;
  aiBonusUsd: number;
  state: BillingState;
  isPlatform: boolean;
  prices: Partial<Record<PaymentKind, number>>;
  payments: Payment[];
};

const STATE_PILL: Record<BillingKind, string> = {
  none: "bg-muted text-text-2",
  trial: "bg-info-tint text-info-text",
  trial_ending: "bg-warning-tint text-warning-text",
  trial_expired: "bg-danger-tint text-danger-text",
  paid: "bg-success-tint text-success-text",
  due: "bg-warning-tint text-warning-text",
  grace: "bg-warning-tint text-warning-text",
  overdue: "bg-danger-tint text-danger-text",
};

/** Qué pasa al registrar cada tipo (lo lee el administrador antes de guardar). */
const EFFECT: Record<PaymentKind, (q: number, m: number) => string> = {
  plan: (_q, m) => `Alarga «pagado hasta» ${m === 1 ? "1 mes" : `${m} meses`}.`,
  ai_reset: (q) => (q === 1 ? "Suma otra bolsa de IA completa a este mes." : `Suma ${q} bolsas de IA a este mes.`),
  extra_person: (q) => `El tope de personas sube ${q === 1 ? "1 persona" : `${q} personas`}.`,
  extra_storage: (q) => `El almacenamiento sube ${q * EXTRA_STORAGE_GB} GB.`,
  onboarding: () => "Solo queda en la bitácora.",
  other: () => "Solo queda en la bitácora.",
};

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
/** Fin del día (hora de México ≈ UTC−6) de una fecha AAAA-MM-DD, en ISO. */
const endOfDay = (d: string) => new Date(`${d}T23:59:00-06:00`).toISOString();

function Section({ title, hint, children, testId }: { title: string; hint?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" data-testid={testId}>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-text-3">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function BillingSection({ orgId, disabled }: { orgId: string; disabled: boolean }) {
  const [b, setB] = useState<Billing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trialDate, setTrialDate] = useState("");
  const [paidDate, setPaidDate] = useState("");
  const [grace, setGrace] = useState("5");
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<PaymentKind>("plan");
  const [amount, setAmount] = useState("");
  const [months, setMonths] = useState("1");
  const [qty, setQty] = useState("1");
  const [payNote, setPayNote] = useState("");

  const apply = useCallback((next: Billing) => {
    setB(next);
    setTrialDate(toDateInput(next.trialEndsAt));
    setPaidDate(toDateInput(next.paidUntil));
    setGrace(String(next.graceDays));
    setNote(next.note ?? "");
  }, []);

  useEffect(() => {
    void api<{ billing: Billing }>(`/api/platform/organizations/${orgId}/billing`).then((r) => {
      if (r.data) apply(r.data.billing);
      else setError(r.error);
    });
  }, [orgId, apply]);

  async function put(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    setOk(null);
    const r = await api<{ billing: Billing }>(`/api/platform/organizations/${orgId}/billing`, { method: "PUT", body: JSON.stringify(body) });
    setBusy(false);
    if (r.data) {
      apply(r.data.billing);
      setOk(done);
    } else setError(r.error);
  }

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    const amountMxn = Number(amount || (b?.prices[kind] ?? 0));
    const m = Number(months);
    const q = Number(qty);
    if (!Number.isInteger(amountMxn) || amountMxn < 0) return setError("Escribe el monto en pesos, sin centavos.");
    if (kind === "plan" && (!Number.isInteger(m) || m < 1 || m > 36)) return setError("Los meses van de 1 a 36.");
    if (!Number.isInteger(q) || q < 1 || q > 100) return setError("La cantidad va de 1 a 100.");
    if (!window.confirm(`¿Registrar ${PAYMENT_LABEL[kind]} por ${formatMxn(amountMxn)}? ${EFFECT[kind](q, m)}`)) return;
    setBusy(true);
    const r = await api<{ billing: Billing }>(`/api/platform/organizations/${orgId}/billing/payments`, {
      method: "POST",
      body: JSON.stringify({ kind, amountMxn, quantity: q, ...(kind === "plan" ? { months: m } : {}), note: payNote || null }),
    });
    setBusy(false);
    if (r.data) {
      apply(r.data.billing);
      setAmount("");
      setPayNote("");
      setOk("Pago registrado.");
    } else setError(r.error);
  }

  if (!b) return <p className={cn("text-sm", error ? "text-destructive" : "text-text-2")}>{error ?? "Cargando…"}</p>;
  if (b.isPlatform) return <p className="text-sm text-text-2">La organización de la plataforma no lleva prueba ni cobro.</p>;

  const s = b.state;
  const off = busy || disabled;
  const suggested = b.prices[kind];
  return (
    <div className="space-y-4" data-testid="platform-billing">
      <Section title="Estado del cobro" testId="platform-billing-state">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATE_PILL[s.kind])} data-testid="platform-billing-kind" data-kind={s.kind}>
            {BILLING_LABEL[s.kind]}
          </span>
          {s.until && (
            <span className="text-text-2">
              {s.kind.startsWith("trial") ? "Prueba hasta " : s.kind === "grace" || s.kind === "overdue" ? "Gracia hasta " : "Pagado hasta "}
              {fecha(s.until)}
              {s.daysLeft !== null && s.daysLeft > 0 && ` · faltan ${s.daysLeft} días`}
            </span>
          )}
          {b.aiBonusUsd > 0 && <span className="text-text-2">· IA extra este mes: {b.aiBonusUsd.toFixed(2)} USD</span>}
        </div>
        <p className="text-xs text-text-3">
          {s.restricted
            ? "La IA y las campañas están en pausa y el cliente ve un aviso. La Bandeja sigue recibiendo y enviando mensajes de personas."
            : s.kind === "none"
              ? "Sin prueba ni «pagado hasta»: la empresa opera sin restricciones (como hasta hoy)."
              : "Al terminar la prueba o pasar los días de gracia se pausan la IA y las campañas; los chats nunca se pierden. El cliente ve el aviso 3 días antes."}
        </p>
      </Section>

      <Section title="Prueba gratis" hint="Al terminar, la IA y las campañas se pausan solas hasta que registres un pago." testId="platform-billing-trial">
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="outline" disabled={off} onClick={() => void put({ trialDays: DEFAULT_TRIAL_DAYS }, "Prueba de 14 días desde hoy.")} data-testid="platform-trial-14">
            Dar 14 días desde hoy
          </Button>
          <Button size="sm" variant="outline" disabled={off} onClick={() => void put({ trialDays: 7 }, "Prueba de 7 días desde hoy.")}>
            7 días
          </Button>
          <div className="space-y-1">
            <Label htmlFor={`trial-${orgId}`} className="text-xs text-text-2">
              O termina el
            </Label>
            <div className="flex gap-2">
              <Input id={`trial-${orgId}`} type="date" className="h-8 w-40" value={trialDate} onChange={(e) => setTrialDate(e.target.value)} disabled={off} data-testid="platform-trial-date" />
              <Button size="sm" variant="outline" disabled={off || !trialDate} onClick={() => void put({ trialEndsAt: endOfDay(trialDate) }, "Fecha de la prueba guardada.")}>
                Guardar
              </Button>
            </div>
          </div>
          {b.trialEndsAt && (
            <Button size="sm" variant="ghost" disabled={off} onClick={() => void put({ trialEndsAt: null }, "Prueba quitada.")} data-testid="platform-trial-clear">
              Quitar prueba
            </Button>
          )}
        </div>
      </Section>

      <Section title="Registrar un pago" hint="Mientras no hay pasarela: anótalo al recibir la transferencia. Su efecto se aplica al guardar." testId="platform-billing-pay">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => void pay(e)}>
          <div className="space-y-1">
            <Label htmlFor={`pay-kind-${orgId}`} className="text-xs text-text-2">
              Qué pagó
            </Label>
            <select
              id={`pay-kind-${orgId}`}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as PaymentKind);
                setAmount("");
              }}
              disabled={off}
              data-testid="platform-pay-kind"
            >
              {PAYMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PAYMENT_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`pay-amount-${orgId}`} className="text-xs text-text-2">
              Monto (MXN, IVA incluido)
            </Label>
            <Input
              id={`pay-amount-${orgId}`}
              inputMode="numeric"
              placeholder={suggested !== undefined ? String(suggested) : "0"}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              disabled={off}
              data-testid="platform-pay-amount"
            />
          </div>
          {kind === "plan" ? (
            <div className="space-y-1">
              <Label htmlFor={`pay-months-${orgId}`} className="text-xs text-text-2">
                Meses
              </Label>
              <Input id={`pay-months-${orgId}`} inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} disabled={off} data-testid="platform-pay-months" />
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor={`pay-qty-${orgId}`} className="text-xs text-text-2">
                Cantidad
              </Label>
              <Input id={`pay-qty-${orgId}`} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} disabled={off} data-testid="platform-pay-qty" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor={`pay-note-${orgId}`} className="text-xs text-text-2">
              Nota (opcional)
            </Label>
            <Input id={`pay-note-${orgId}`} maxLength={300} placeholder="Transferencia, folio…" value={payNote} onChange={(e) => setPayNote(e.target.value)} disabled={off} />
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
            <Button size="sm" type="submit" disabled={off} data-testid="platform-pay-submit">
              Registrar pago
            </Button>
            <span className="text-xs text-text-3" data-testid="platform-pay-effect">
              {EFFECT[kind](Number(qty) || 1, Number(months) || 1)}
            </span>
          </div>
        </form>
      </Section>

      <Section title="Ajustes del cobro" testId="platform-billing-settings">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor={`paid-${orgId}`} className="text-xs text-text-2">
              Pagado hasta (corregir a mano)
            </Label>
            <Input id={`paid-${orgId}`} type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} disabled={off} data-testid="platform-paid-date" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`grace-${orgId}`} className="text-xs text-text-2">
              Días de gracia tras vencer
            </Label>
            <Input id={`grace-${orgId}`} inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value)} disabled={off} data-testid="platform-grace" />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`note-${orgId}`} className="text-xs text-text-2">
              Nota interna (solo tú la ves)
            </Label>
            <Input id={`note-${orgId}`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} disabled={off} />
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={off}
          data-testid="platform-billing-save"
          onClick={() => {
            const g = Number(grace);
            if (!Number.isInteger(g) || g < 0 || g > 60) return setError("Los días de gracia van de 0 a 60.");
            void put({ paidUntil: paidDate ? endOfDay(paidDate) : null, graceDays: g, note: note || null }, "Ajustes guardados.");
          }}
        >
          Guardar ajustes
        </Button>
      </Section>

      {(error || ok) && (
        <p className={cn("text-sm", error ? "text-destructive" : "text-success-text")} role={error ? "alert" : "status"} data-testid="platform-billing-msg">
          {error ?? ok}
        </p>
      )}

      <Section title="Pagos registrados" testId="platform-payments">
        {b.payments.length === 0 ? (
          <p className="text-sm text-text-2">Todavía no hay pagos.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {b.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid="platform-payment">
                <span className="w-24 shrink-0 text-text-3">{fecha(p.paidAt)}</span>
                <span className="font-medium">{PAYMENT_LABEL[p.kind]}</span>
                {p.months && <span className="text-text-2">{p.months === 1 ? "1 mes" : `${p.months} meses`}</span>}
                {p.kind !== "plan" && p.quantity > 1 && <span className="text-text-2">×{p.quantity}</span>}
                <span className="ml-auto tabular-nums">{formatMxn(p.amountMxn)}</span>
                {p.note && <span className="w-full text-xs text-text-3">{p.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
