/**
 * Estado en memoria del harness wa-mock (solo dev/test). Vive en globalThis
 * porque Next recarga módulos en dev; una instancia = un proceso, así que el
 * outbox en memoria es suficiente para las aserciones del self-test.
 */

export type OutboxEntry = {
  n: number;
  phoneNumberId: string;
  to: string;
  /**
   * El BSUID, cuando el destinatario iba por `recipient` en vez de `to`.
   *
   * Se expone para que un self-test pueda comprobar EN QUE CAMPO viajo: es la
   * unica diferencia entre el envio que Meta acepta y el que devuelve 131026.
   */
  recipient?: string;
  type: string;
  body: unknown;
  at: string;
  /**
   * Id que se le devolvió al CRM. Lo expone el outbox para que un self-test
   * pueda mandarle un webhook de estado a ESE mensaje sin adivinar el formato.
   */
  waMessageId?: string;
};

export type MockTemplate = {
  id: string;
  /**
   * Campañas v2: de qué WABA es (el listado se filtra por ella, como Meta).
   * Sin ella, la plantilla aparece en todas (compatibilidad).
   */
  wabaId?: string;
  name: string;
  language: string;
  category: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "PAUSED" | "DISABLED";
  body: string;
  /** Componentes tal cual los mandó el CRM: Meta valida aquí los `example`. */
  components?: unknown[];
  qualityScore?: string;
  rejectedReason?: string;
};

/**
 * Campañas v2 — Salud de un número en el "panel de Meta" simulado. Sin
 * entrada, el número está sano (GREEN, TIER_1K, CONNECTED).
 */
export type MockPhoneHealth = {
  quality_rating?: string;
  status?: string;
  name_status?: string;
  throughput?: { level?: string };
  messaging_limit_tier?: string;
  whatsapp_business_manager_messaging_limit?: string;
  /** true = responde error 100 a los campos nuevos (fuerza el respaldo al mínimo). */
  rejectNewFields?: boolean;
};

/**
 * 016 — Un evento de Conversions API que el CRM le mandó al mock. El self-test
 * lo inspecciona para verificar la FORMA del payload: el modo de fallar de ese
 * endpoint es un 200 con `events_received: 0`, donde un campo mal puesto se ve
 * idéntico a uno bien puesto.
 */
export type CapiMockEvent = {
  n: number;
  datasetId: string;
  eventName: string;
  ctwaClid: string | null;
  customData: Record<string, unknown> | null;
  body: unknown;
  at: string;
};

/**
 * La suscripción de la app a una WABA (`{WABA}/subscribed_apps`), con su
 * override de callback si alguien lo configuró. Existe para que el self-test
 * pueda comprobar que guardar la conexión NO borra el override de un cerebro
 * externo: en Meta, un POST sin cuerpo lo elimina, y el mock hace lo mismo.
 */
export type MockWabaSubscription = {
  overrideCallbackUri: string | null;
};

type WaMockState = {
  outbox: OutboxEntry[];
  templates: MockTemplate[];
  capiEvents: CapiMockEvent[];
  /** Por WABA ID. Sin entrada = la app no está suscrita a esa WABA. */
  wabaSubscriptions: Record<string, MockWabaSubscription>;
  /**
   * H25 — Qué números validó cada token (`GET {phone}?fields=…`). El mock no
   * conoce el árbol real de WABAs: un token "posee" en cualquier WABA los
   * números con que se probó, salvo en las WABA que empiezan por
   * `WABA-AJENA`, que no tienen ninguno de ellos.
   */
  phonesByToken: Record<string, string[]>;
  /** Campañas v2: salud por phone_number_id. */
  phoneHealth: Record<string, MockPhoneHealth>;
  /** Campañas v2: sesiones de la subida reanudable (`upload:…`). */
  uploads: Record<string, { length: number; type: string; received?: number }>;
  counter: number;
};

const globalForMock = globalThis as unknown as { __waMockState?: WaMockState };

function freshState(): WaMockState {
  return {
    outbox: [],
    templates: [],
    capiEvents: [],
    wabaSubscriptions: {},
    phonesByToken: {},
    phoneHealth: {},
    uploads: {},
    counter: 0,
  };
}

export function getWaMockState(): WaMockState {
  if (!globalForMock.__waMockState) {
    globalForMock.__waMockState = freshState();
  }
  return globalForMock.__waMockState;
}

export function resetWaMockState(): void {
  // El contador NO vuelve a cero: los wamid ya emitidos viven en la BD
  // (UNIQUE) y Meta jamás repite uno. Vaciar el outbox a mitad de un
  // self-test no puede hacer que el siguiente envío choque con uno anterior.
  const counter = globalForMock.__waMockState?.counter ?? 0;
  globalForMock.__waMockState = { ...freshState(), counter };
}

export function nextN(): number {
  return ++getWaMockState().counter;
}

/**
 * Sello único por arranque del proceso. Sin él, el contador del mock reinicia
 * al reiniciar `pnpm dev` y vuelve a emitir `wamid.mock.out.1`, que choca con
 * el UNIQUE de `wa_message_id` en la BD de una corrida anterior (500 al
 * enviar). No es un fallo del producto: la idempotencia hace su trabajo.
 */
const boot = Math.random().toString(36).slice(2, 8);

export function nextOutboundWamid(): string {
  return `wamid.mock.out.${boot}.${nextN()}`;
}

/**
 * Lo mismo para los ids de plantilla: Meta jamás los repite, y `syncTemplates`
 * empareja primero por id. Con `tplmock_1` otra vez tras reiniciar, el sync
 * actualizaba la plantilla VIEJA de la corrida anterior y la nueva se quedaba
 * en `pending` (visto en el E2E de dos organizaciones).
 */
export function nextTemplateId(): string {
  return `tplmock_${boot}_${nextN()}`;
}
