// Maquina de estados do carrinho/checkout (PURA — sem window/document/DOM/React).
// Usada pelo modulo NubeSDK (storefront) e pelos testes. NAO decide abandono:
// abandono e determinado SERVER-SIDE apos inatividade (ver lib/storefront/cartSignal.ts).
//
// Fases (client-side): ACTIVE -> CHECKOUT_STARTED -> COMPLETED.
// ABANDONED nunca e definido no cliente.

export type CartPhase = "ACTIVE" | "CHECKOUT_STARTED" | "COMPLETED";

// Eventos oficiais do NubeSDK que o modulo escuta (grafia confirmada na doc).
export type NubeCartEvent =
  | "page:loaded"
  | "cart:update"
  | "cart:view"
  | "checkout:ready"
  | "customer:update"
  | "checkout:success"
  | "order:update";

// Fase que o SINAL carrega ao backend (mínimo). Nunca ABANDONED (é server-side).
export type SignalPhase = "CHECKOUT_STARTED" | "COMPLETED";

export interface CartMachine {
  phase: CartPhase | null;
  hasContact: boolean;
  lastActivityAt: number;
}

// Sinal MÍNIMO enviado ao backend (LGPD): sem e-mail/telefone/nome/endereço.
export interface CartSignal {
  storeId: string;
  cartId: string;
  phase: SignalPhase;
  at: number;
}

export interface ReduceCtx {
  storeId: string;
  cartId: string;
  hasItems: boolean;
  hasContact: boolean;
  now: number;
}

export interface ReduceResult {
  state: CartMachine;
  signal?: CartSignal; // presente só quando há algo a comunicar ao backend
}

export function initCartMachine(): CartMachine {
  return { phase: null, hasContact: false, lastActivityAt: 0 };
}

// Timeout de inatividade para o backend considerar ABANDONO (30 min). Só é
// aplicado SERVER-SIDE: o worker morre ao fechar a aba, então quem arma o
// tempo é o backend (ver app/api/cron/cart-signals).
export const CART_ABANDON_TIMEOUT_MS = 30 * 60_000;

// Decisão SERVER-SIDE: um checkout iniciado, não concluído, sem atividade há
// mais que o timeout, é candidato a recuperação. COMPLETED nunca é candidato.
export function isAbandonedCandidate(
  phase: SignalPhase | "COMPLETED" | null,
  lastEventAt: number,
  now: number,
  completed: boolean,
  timeoutMs: number = CART_ABANDON_TIMEOUT_MS,
): boolean {
  if (completed || phase === "COMPLETED") return false;
  if (phase !== "CHECKOUT_STARTED") return false;
  return now - lastEventAt >= timeoutMs;
}

// Reduz um evento do NubeSDK ao próximo estado + (opcional) sinal ao backend.
export function reduceCart(
  state: CartMachine,
  event: NubeCartEvent,
  ctx: ReduceCtx,
): ReduceResult {
  // Terminal: uma vez COMPLETED, nada reabilita recuperação (nunca vira ABANDONED).
  if (state.phase === "COMPLETED") return { state };

  const activity: CartMachine = { ...state, lastActivityAt: ctx.now };

  switch (event) {
    // Compra concluída -> COMPLETED + sinal (backend cancela recuperação).
    case "checkout:success":
    case "order:update":
      return {
        state: { ...activity, phase: "COMPLETED" },
        signal: { storeId: ctx.storeId, cartId: ctx.cartId, phase: "COMPLETED", at: ctx.now },
      };

    // Checkout iniciado -> CHECKOUT_STARTED. Emite sinal SÓ na 1ª transição
    // (idempotente: checkout:ready repetido não reenvia).
    case "checkout:ready": {
      const next: CartMachine = {
        ...activity,
        phase: "CHECKOUT_STARTED",
        hasContact: ctx.hasContact || activity.hasContact,
      };
      const firstTime = state.phase !== "CHECKOUT_STARTED";
      return firstTime
        ? { state: next, signal: { storeId: ctx.storeId, cartId: ctx.cartId, phase: "CHECKOUT_STARTED", at: ctx.now } }
        : { state: next };
    }

    // Contato identificado -> só atualiza sinal local; NÃO dispara mensagem.
    case "customer:update":
      return { state: { ...activity, hasContact: true } };

    // Atividade do carrinho -> NÃO é abandono, NÃO emite sinal.
    case "cart:update":
    case "cart:view":
      return {
        state: { ...activity, phase: activity.phase ?? (ctx.hasItems ? "ACTIVE" : activity.phase) },
      };

    // Carregamento de página / demais -> só marca atividade.
    case "page:loaded":
    default:
      return { state: activity };
  }
}
