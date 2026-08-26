// Fallback LOCAL de trial (Billing V1 — Nuvemshop nativo).
//
// Isto NAO e mais a fonte de verdade — a fonte de verdade e o Billing da
// Nuvemshop (ver nuvemshopBillingClient.ts + sync.firestore.ts). Este
// registro so e criado quando a Nuvemshop CONFIRMA que a loja nunca teve
// assinatura para o nosso servico (GET subscriptions -> 404), como uma
// concessao de cortesia dos dias gratis enquanto a Nuvemshop nao tem
// nenhuma assinatura para consultar (ex.: instalacao muito recente, ou a
// prova mesmo de que essa e uma relacao nova).
//
// `commercial_trial_fallback/{storeId}` continua sendo uma coleçao TOP-LEVEL
// (fora de stores/{storeId}/...), estruturalmente imune a purga de
// store/redact. Isso e deliberado: apagar este registro nao e o ponto de
// controle anti-abuso (esse papel agora e da Nuvemshop); mante-lo assim so
// evita que uma purga acidental force uma nova concessao de cortesia para
// uma loja que a Nuvemshop mesmo ainda nao conhece.
import { db } from "@/lib/firebase/admin";
import { TRIAL_DURATION_MS } from "./policy";

const FALLBACK_COLLECTION = "commercial_trial_fallback";

export type TrialFallbackLedger = {
  trialConsumed: true;
  trialStartedAt: number;
  trialEndsAt: number;
};

function fallbackRef(storeId: string) {
  return db.collection(FALLBACK_COLLECTION).doc(storeId);
}

function parseFallbackLedger(value: FirebaseFirestore.DocumentData | undefined): TrialFallbackLedger | null {
  if (
    value?.trialConsumed !== true
    || typeof value.trialStartedAt !== "number"
    || !Number.isFinite(value.trialStartedAt)
    || typeof value.trialEndsAt !== "number"
    || !Number.isFinite(value.trialEndsAt)
    || value.trialEndsAt - value.trialStartedAt !== TRIAL_DURATION_MS
  ) return null;
  return {
    trialConsumed: true,
    trialStartedAt: value.trialStartedAt,
    trialEndsAt: value.trialEndsAt,
  };
}

function isTransactionContention(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  return code === 10 || code === "aborted" || code === 4 || code === "deadline-exceeded"
    || /transaction lock timeout/i.test(message);
}

function contentionBackoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25 * attempt));
}

// Idempotente e atomico: so a primeira chamada para uma store cria o
// registro. Chamadas seguintes (reinstall, retry, corrida concorrente) so
// leem o que ja existe. So deve ser chamado depois de confirmar
// billing.kind === "not_found" — nunca por mera ausencia de cache local.
export async function ensureTrialFallbackStarted(
  storeId: string,
  now: number = Date.now(),
): Promise<TrialFallbackLedger> {
  if (!Number.isFinite(now)) throw new Error("invalid_trial_start_time");
  const ref = fallbackRef(storeId);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const ledger = parseFallbackLedger(snap.data());
          if (!ledger) throw new Error("invalid_trial_fallback_ledger");
          return ledger;
        }
        const ledger: TrialFallbackLedger = {
          trialConsumed: true,
          trialStartedAt: now,
          trialEndsAt: now + TRIAL_DURATION_MS,
        };
        tx.create(ref, ledger);
        return ledger;
      }, { maxAttempts: 10 });
    } catch (error) {
      if (attempt === 3 || !isTransactionContention(error)) throw error;
      await contentionBackoff(attempt);
    }
  }
  throw new Error("trial_fallback_transaction_exhausted");
}

export async function getTrialFallbackLedger(storeId: string): Promise<TrialFallbackLedger | null> {
  const snap = await fallbackRef(storeId).get();
  return snap.exists ? parseFallbackLedger(snap.data()) : null;
}
