// Máquina de estados do carrinho/checkout (PURA — sem window/document/DOM/React).
// Roda no Web Worker (storefront) e nos testes. NÃO tem autoridade: apenas emite
// SINAIS ao backend. Toda decisão (loja dona, timeout, COMPLETED, terminal) é
// SERVER-SIDE (ver lib/storefront/signalDoc.ts).
//
// Fases locais: ACTIVE -> CHECKOUT_STARTED -> COMPLETED (terminal local só para
// reduzir ruído; a verdade é do servidor).

export type CartPhase = "ACTIVE" | "CHECKOUT_STARTED" | "COMPLETED";

// Eventos LISTENABLE oficiais do NubeSDK (v0.5.0) usados pelo módulo.
// (page:loaded / cart:view / order:update NÃO são listenable — não usar.)
export type NubeCartEvent =
  | "cart:update"
  | "checkout:ready"
  | "customer:update"
  | "shipping:update"
  | "payment:update"
  | "checkout:success";

// Fase que o SINAL carrega. ACTIVITY renova atividade server-side; COMPLETED é
// apenas HINT (o servidor confirma via API/webhook, nunca confia no browser).
export type SignalPhase = "ACTIVITY" | "CHECKOUT_STARTED" | "COMPLETED";

export interface CartMachine {
  phase: CartPhase | null;
  hasContact: boolean;
  lastActivityAt: number; // relógio do cliente — só telemetria; servidor ignora
}

// Sinal MÍNIMO (LGPD): sem PII. `storeId`/`storeDomain` são derivados do NubeSDK
// State (store.id / store.domain) mas continuam UNTRUSTED no backend (a autoridade
// é a Origin + a API oficial). `clientAt` é só telemetria; o backend usa o próprio
// relógio (receivedAt).
export interface CartSignal {
  storeId: string;
  cartId: string;
  phase: SignalPhase;
  clientAt: number;
  storeDomain?: string;
}

export interface ReduceCtx {
  storeId: string;
  cartId: string;
  hasItems: boolean;
  hasContact: boolean;
  now: number;
  storeDomain?: string;
}

export interface ReduceResult {
  state: CartMachine;
  signal?: CartSignal;
}

export function initCartMachine(): CartMachine {
  return { phase: null, hasContact: false, lastActivityAt: 0 };
}

export function reduceCart(state: CartMachine, event: NubeCartEvent, ctx: ReduceCtx): ReduceResult {
  // Terminal local: uma vez COMPLETED, para de emitir (o servidor já decide).
  if (state.phase === "COMPLETED") return { state };

  const activity: CartMachine = { ...state, lastActivityAt: ctx.now };
  const sig = (phase: SignalPhase): CartSignal => ({
    storeId: ctx.storeId, // derivado de store.id; UNTRUSTED no backend
    cartId: ctx.cartId,
    phase,
    clientAt: ctx.now,
    storeDomain: ctx.storeDomain, // derivado de store.domain; UNTRUSTED
  });

  switch (event) {
    // Compra concluída -> HINT COMPLETED (o servidor confirma via API/webhook;
    // nunca encerra só porque o browser disse).
    case "checkout:success":
      return { state: { ...activity, phase: "COMPLETED" }, signal: sig("COMPLETED") };

    // Checkout iniciado -> CHECKOUT_STARTED na 1ª vez; repetição vira ACTIVITY
    // (renova atividade server-side — bloqueador 5).
    case "checkout:ready": {
      const firstTime = state.phase !== "CHECKOUT_STARTED";
      const next: CartMachine = { ...activity, phase: "CHECKOUT_STARTED", hasContact: ctx.hasContact || state.hasContact };
      return { state: next, signal: firstTime ? sig("CHECKOUT_STARTED") : sig("ACTIVITY") };
    }

    // Frete/pagamento atualizados durante o checkout -> forte intenção; renova
    // atividade (ACTIVITY) e garante reachedCheckout se ainda não marcado.
    case "shipping:update":
    case "payment:update":
      return {
        state: { ...activity, phase: activity.phase === "CHECKOUT_STARTED" ? "CHECKOUT_STARTED" : activity.phase },
        signal: sig("ACTIVITY"),
      };

    // Atividade do carrinho -> renova atividade (ACTIVITY). NÃO é abandono.
    case "cart:update":
      return {
        state: { ...activity, phase: activity.phase ?? (ctx.hasItems ? "ACTIVE" : activity.phase) },
        signal: ctx.hasItems ? sig("ACTIVITY") : undefined,
      };

    // Contato identificado -> renova atividade se já no checkout; sem mensagem.
    case "customer:update":
      return {
        state: { ...activity, hasContact: true },
        signal: state.phase === "CHECKOUT_STARTED" ? sig("ACTIVITY") : undefined,
      };

    default:
      return { state: activity };
  }
}
