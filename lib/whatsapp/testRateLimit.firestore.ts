import { db, col, storeRef } from "@/lib/firebase/admin";
import type { Store } from "@/types";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import { isCommercialAccessGranted } from "@/lib/billing/policy";
import { ensureFreshCommercialAccess } from "@/lib/billing/accessSignal.firestore";
import { decideWhatsappTestAttempt, type WhatsappTestLimitState } from "./testRateLimit";

const LIMIT_DOC_ID = "global";

export type WhatsappTestAttemptClaim =
  | { ok: true }
  | { ok: false; status: 402 | 409 | 429; reason: "commercial_inactive" | "store_inactive" | "cooldown" | "daily_limit" };

// O unico dado persistido e uma janela tenant-scoped de abuso: data, contador
// e timestamp. Destino, mensagem, token e resposta do provider nunca entram no
// Firestore.
//
// O envio de teste e um efeito comercial externo real (custa uma mensagem) e
// NAO faz naturalmente nenhuma chamada Nuvemshop — por isso a guarda aqui
// exige um sinal fresco (ver ensureFreshCommercialAccess), com probe minimo
// se necessario, antes de liberar. O probe fica FORA da transacao Firestore
// (nunca fazer I/O de rede lento dentro de uma transacao).
export async function claimWhatsappTestAttempt(
  storeId: string,
  now: number = Date.now(),
  // Injetavel so para teste (fake HTTP do probe) — nunca chamado com a API
  // real nesta OS.
  fetchImpl: typeof fetch = fetch,
): Promise<WhatsappTestAttemptClaim> {
  const storeSnap = await storeRef(storeId).get();
  const store = storeSnap.data() as Store | undefined;
  if (!store || !isStoreCommerciallyActive(store.status)) {
    return { ok: false, status: 409, reason: "store_inactive" };
  }

  const commercialState = store.accessToken
    ? await ensureFreshCommercialAccess(storeId, store.accessToken, now, fetchImpl)
    : "billing_unknown";
  if (!isCommercialAccessGranted(commercialState)) {
    return { ok: false, status: 402, reason: "commercial_inactive" };
  }

  const ref = col(storeId, "whatsapp_test_limits").doc(LIMIT_DOC_ID);
  return db.runTransaction(async (tx) => {
    const [freshStoreSnap, limitSnap] = await Promise.all([
      tx.get(storeRef(storeId)),
      tx.get(ref),
    ]);
    // Recheca lifecycle dentro da transacao: o probe acima nao e atomico com
    // esta escrita, e a loja pode ter saido de "active" nesse meio-tempo.
    if (!isStoreCommerciallyActive((freshStoreSnap.data() as Store | undefined)?.status)) {
      return { ok: false, status: 409, reason: "store_inactive" };
    }
    const decision = decideWhatsappTestAttempt(
      limitSnap.data() as WhatsappTestLimitState | undefined,
      now,
    );
    if (!decision.ok) return { ok: false, status: 429, reason: decision.reason };
    tx.set(ref, { ...decision.next, updatedAt: now }, { merge: true });
    return { ok: true };
  });
}
