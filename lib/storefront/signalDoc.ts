// Autoridade SERVER-SIDE do sinal de carrinho (PURO/testável).
// Corrige: identidade store-scoped (sem colisão de cartId entre lojas),
// COMPLETED confiável, terminal que não regride, timestamp do servidor,
// renovação de atividade e LEASE (terminal só após enrollment concluir).

export type SignalStatus = "pending" | "processing" | "terminal";
export type SignalPhaseIn = "ACTIVITY" | "CHECKOUT_STARTED" | "COMPLETED";

export interface SignalDoc {
  storeId: string; // loja REIVINDICADA (untrusted até a API confirmar)
  cartId: string; // cartId ORIGINAL (o doc id é o hash — ver cartKeyHash)
  receivedAt: number;
  lastActivityAt: number; // servidor — autoridade do timeout
  reachedCheckout: boolean;
  clientCompleted: boolean; // HINT do browser — nunca encerra sozinho
  status: SignalStatus;
  leaseAt?: number; // quando entrou em "processing"
  leaseId?: string; // FENCING: só quem detém este lease pode finalizar/liberar
  terminalReason?: string;
}

export interface IncomingSignal {
  storeId: string;
  cartId: string;
  phase: SignalPhaseIn;
  receivedAt: number; // relógio do SERVIDOR
}

// Aplica um sinal ao doc. ATÔMICO no caller (transação). Terminal NUNCA regride;
// processing preserva o status; atividade usa o relógio do servidor.
export function reduceSignalDoc(existing: SignalDoc | null, incoming: IncomingSignal): SignalDoc {
  if (existing && existing.status === "terminal") return existing; // não regride

  const base: SignalDoc =
    existing ?? {
      storeId: incoming.storeId,
      cartId: incoming.cartId,
      receivedAt: incoming.receivedAt,
      lastActivityAt: incoming.receivedAt,
      reachedCheckout: false,
      clientCompleted: false,
      status: "pending",
    };

  return {
    ...base,
    lastActivityAt: incoming.receivedAt, // servidor renova atividade
    reachedCheckout: base.reachedCheckout || incoming.phase === "CHECKOUT_STARTED",
    clientCompleted: base.clientCompleted || incoming.phase === "COMPLETED",
    status: base.status, // preserva pending/processing; terminal já retornou acima
  };
}

export const CART_ABANDON_TIMEOUT_MS = 30 * 60_000;
// Lease de processamento: o cron tem maxDuration 60s, então 5 min é seguro para
// considerar um "processing" preso (worker morto) como recuperável.
export const SIGNAL_LEASE_MS = 5 * 60_000;

// Candidato a abandono (só dados do servidor). COMPLETED do browser não impede.
export function isAbandonedServer(
  doc: Pick<SignalDoc, "status" | "reachedCheckout" | "lastActivityAt">,
  now: number,
  timeoutMs: number = CART_ABANDON_TIMEOUT_MS,
): boolean {
  if (doc.status === "terminal") return false;
  if (!doc.reachedCheckout) return false;
  return now - doc.lastActivityAt >= timeoutMs;
}

// Um sinal pode ser reivindicado se está "pending" OU "processing" com lease
// vencido (worker anterior morreu). "terminal" nunca.
export function canClaimSignal(
  status: SignalStatus,
  leaseAt: number | undefined,
  now: number,
  leaseMs: number = SIGNAL_LEASE_MS,
): boolean {
  if (status === "pending") return true;
  if (status === "processing") return leaseAt === undefined || now - leaseAt >= leaseMs;
  return false; // terminal
}

// Bloqueador 1: a loja DONA é a que a API oficial confirma possuir o checkout id.
export function storeOwnsCheckout(storeCheckoutIds: ReadonlySet<string>, cartId: string): boolean {
  return storeCheckoutIds.has(cartId);
}

// FENCING (bloqueador 1): só finaliza/libera quem detém o lease vigente. Se o
// lease expirou e outro worker assumiu (leaseId diferente) ou já é terminal, o
// worker antigo é rejeitado (no-op).
export function canFinalizeSignal(
  doc: Pick<SignalDoc, "status" | "leaseId">,
  myLeaseId: string,
): boolean {
  return doc.status === "processing" && doc.leaseId === myLeaseId;
}
