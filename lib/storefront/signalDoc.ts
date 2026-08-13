// Autoridade SERVER-SIDE do sinal de carrinho (PURO/testável). Corrige os
// bloqueadores da auditoria: identidade da loja, COMPLETED confiável, terminal
// que não regride, timestamp do servidor, renovação de atividade.

export type SignalStatus = "pending" | "terminal";
export type SignalPhaseIn = "ACTIVITY" | "CHECKOUT_STARTED" | "COMPLETED";

export interface SignalDoc {
  cartId: string;
  receivedAt: number; // 1º recebimento (servidor)
  lastActivityAt: number; // renovado a cada atividade (servidor) — autoridade do timeout
  reachedCheckout: boolean; // só inscreve se o checkout foi iniciado
  clientCompleted: boolean; // HINT do browser — NUNCA encerra sozinho (bloqueador 2)
  status: SignalStatus; // "terminal" só é setado SERVER-SIDE
  terminalReason?: string;
  claimedStoreId?: string; // TELEMETRIA — nunca usado para rotear (bloqueador 1)
}

export interface IncomingSignal {
  cartId: string;
  phase: SignalPhaseIn;
  receivedAt: number; // relógio do SERVIDOR (bloqueador 4)
  storeId?: string; // telemetria
}

// Aplica um sinal ao doc existente. ATÔMICO no caller (transação). Regras:
// - status "terminal" NUNCA regride (bloqueador 3);
// - lastActivityAt usa SEMPRE o relógio do servidor (bloqueador 4/5);
// - COMPLETED do browser só marca um HINT, não encerra (bloqueador 2).
export function reduceSignalDoc(existing: SignalDoc | null, incoming: IncomingSignal): SignalDoc {
  if (existing && existing.status === "terminal") return existing; // não regride

  const base: SignalDoc =
    existing ?? {
      cartId: incoming.cartId,
      receivedAt: incoming.receivedAt,
      lastActivityAt: incoming.receivedAt,
      reachedCheckout: false,
      clientCompleted: false,
      status: "pending",
      claimedStoreId: incoming.storeId,
    };

  return {
    ...base,
    lastActivityAt: incoming.receivedAt, // servidor renova atividade
    reachedCheckout: base.reachedCheckout || incoming.phase === "CHECKOUT_STARTED",
    clientCompleted: base.clientCompleted || incoming.phase === "COMPLETED",
    status: "pending",
  };
}

export const CART_ABANDON_TIMEOUT_MS = 30 * 60_000;

// Candidato a abandono, decidido SÓ com dados do servidor. COMPLETED do browser
// (clientCompleted) NÃO impede — o encerramento real vem da API/webhook.
export function isAbandonedServer(
  doc: SignalDoc,
  now: number,
  timeoutMs: number = CART_ABANDON_TIMEOUT_MS,
): boolean {
  if (doc.status === "terminal") return false;
  if (!doc.reachedCheckout) return false;
  return now - doc.lastActivityAt >= timeoutMs;
}

// Bloqueador 1: a loja DONA do checkout é aquela cuja API oficial retorna o id.
// O storeId do cliente nunca seleciona a loja.
export function storeOwnsCheckout(storeCheckoutIds: ReadonlySet<string>, cartId: string): boolean {
  return storeCheckoutIds.has(cartId);
}
