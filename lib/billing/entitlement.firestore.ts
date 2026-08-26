// Ledger anti-reset do trial comercial (Billing V1).
//
// Fonte de verdade: `commercial_entitlements/{storeId}` — coleção TOP-LEVEL,
// fora da subarvore `stores/{storeId}/...`. Isso a torna estruturalmente
// imune a purga dinamica de store/redact (que so enumera/apaga subcolecoes
// de `stores/{storeId}`, mesmo padrao ja usado por `lgpd_store_redactions`).
// Uninstall tambem nunca a toca (so grava status/uninstalledAt no doc raiz).
//
// `storeId` (o id da loja retornado pela Nuvemshop, ja usado como doc id em
// toda a base) e a identidade estavel entre uninstall/reinstall — nunca
// access token, session token, WABA ou qualquer segredo rotacionavel.
//
// O doc raiz de `stores/{storeId}` guarda so uma COPIA rapida
// (trialStartedAt/trialEndsAt) para o caminho quente do dispatch nao precisar
// de uma leitura extra — essa copia pode ser apagada por store/redact (junto
// com plan/quotas, como esperado numa exclusao real) e e sempre RESSINCRONIZADA
// a partir do ledger em qualquer install/reinstall, nunca reinventada.
import { db, storeRef } from "@/lib/firebase/admin";
import { TRIAL_DURATION_MS } from "./policy";

const ENTITLEMENT_COLLECTION = "commercial_entitlements";

export type TrialLedger = {
  trialConsumed: true;
  trialStartedAt: number;
  trialEndsAt: number;
};

function entitlementRef(storeId: string) {
  return db.collection(ENTITLEMENT_COLLECTION).doc(storeId);
}

function parseTrialLedger(value: FirebaseFirestore.DocumentData | undefined): TrialLedger | null {
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

function isTrialTransactionContention(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  return code === 10
    || code === "aborted"
    || code === 4
    || code === "deadline-exceeded"
    || /transaction lock timeout/i.test(message);
}

function contentionBackoff(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 25 * attempt));
}

// Idempotente e atomico: a primeira chamada para uma store cria o ledger
// (trial concedido uma unica vez, para sempre). Qualquer chamada seguinte —
// reinstall, retry, corrida concorrente — so le o que ja existe, sem alterar
// trialStartedAt/trialEndsAt. A copia no doc raiz e sincronizada na MESMA
// transacao, garantindo que os dois documentos nunca divirjam.
export async function ensureTrialStarted(
  storeId: string,
  now: number = Date.now(),
): Promise<TrialLedger> {
  if (!Number.isFinite(now)) throw new Error("invalid_trial_start_time");
  const ref = entitlementRef(storeId);
  // O SDK ja repete ABORTED internamente. O retry externo, curto e limitado,
  // cobre lock timeout do Emulator/servico sem recalcular `now`: uma corrida
  // nunca ganha milissegundos extras de trial por causa das tentativas.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists) {
          const ledger = parseTrialLedger(snap.data());
          // Ledger existente mas invalido nunca pode ser substituido por um
          // novo trial: falha fechada e exige intervencao, preservando o anti-reset.
          if (!ledger) throw new Error("invalid_trial_ledger");
          tx.set(storeRef(storeId), {
            trialStartedAt: ledger.trialStartedAt,
            trialEndsAt: ledger.trialEndsAt,
          }, { merge: true });
          return ledger;
        }

        const ledger: TrialLedger = {
          trialConsumed: true,
          trialStartedAt: now,
          trialEndsAt: now + TRIAL_DURATION_MS,
        };
        tx.create(ref, ledger);
        tx.set(storeRef(storeId), {
          trialStartedAt: ledger.trialStartedAt,
          trialEndsAt: ledger.trialEndsAt,
        }, { merge: true });
        return ledger;
      }, { maxAttempts: 10 });
    } catch (error) {
      if (attempt === 3 || !isTrialTransactionContention(error)) throw error;
      await contentionBackoff(attempt);
    }
  }
  throw new Error("trial_transaction_exhausted");
}

// Leitura sem efeito colateral (nao cria nada) — usada por gates que so
// precisam saber o estado atual, nunca conceder um trial novo por engano.
export async function getTrialLedger(storeId: string): Promise<TrialLedger | null> {
  const snap = await entitlementRef(storeId).get();
  return snap.exists ? parseTrialLedger(snap.data()) : null;
}

// Leitura simples do estado comercial atual da store (usa a copia rapida do
// doc raiz — nao precisa do ledger para gates fora do caminho quente do
// dispatch, que ja le o doc raiz de qualquer forma).
export async function getStoreCommercialInput(storeId: string): Promise<{
  trialEndsAt?: number;
  subscriptionStatus?: "active" | "inactive";
} | null> {
  const snap = await storeRef(storeId).get();
  if (!snap.exists) return null;
  const data = snap.data();
  return {
    trialEndsAt: typeof data?.trialEndsAt === "number" && Number.isFinite(data.trialEndsAt)
      ? data.trialEndsAt
      : undefined,
    subscriptionStatus: data?.subscriptionStatus === "active" || data?.subscriptionStatus === "inactive"
      ? data.subscriptionStatus
      : undefined,
  };
}
