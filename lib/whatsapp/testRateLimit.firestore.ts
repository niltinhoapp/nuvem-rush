import { db, col, storeRef } from "@/lib/firebase/admin";
import type { Store } from "@/types";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";
import { isCommercialAccessGranted, resolveStoreCommercialState } from "@/lib/billing/policy";
import { decideWhatsappTestAttempt, type WhatsappTestLimitState } from "./testRateLimit";

const LIMIT_DOC_ID = "global";

export type WhatsappTestAttemptClaim =
  | { ok: true }
  | { ok: false; status: 402 | 409 | 429; reason: "commercial_inactive" | "store_inactive" | "cooldown" | "daily_limit" };

// O unico dado persistido e uma janela tenant-scoped de abuso: data, contador
// e timestamp. Destino, mensagem, token e resposta do provider nunca entram no
// Firestore.
export async function claimWhatsappTestAttempt(
  storeId: string,
  now: number = Date.now(),
): Promise<WhatsappTestAttemptClaim> {
  const ref = col(storeId, "whatsapp_test_limits").doc(LIMIT_DOC_ID);
  return db.runTransaction(async (tx) => {
    const [storeSnap, limitSnap] = await Promise.all([
      tx.get(storeRef(storeId)),
      tx.get(ref),
    ]);
    const store = storeSnap.data() as Store | undefined;
    if (!store || !isStoreCommerciallyActive(store.status)) {
      return { ok: false, status: 409, reason: "store_inactive" };
    }
    if (!isCommercialAccessGranted(resolveStoreCommercialState(store, now))) {
      return { ok: false, status: 402, reason: "commercial_inactive" };
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
