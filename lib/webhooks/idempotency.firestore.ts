// Implementacao Firestore da idempotencia de webhooks.
// Isolada do modulo puro (idempotency.ts) porque importa firebase-admin, que
// inicializa o SDK no load — nao deve ser puxado por testes unitarios.
import { db, col, storeRef } from "@/lib/firebase/admin";
import type { EventClaim } from "./idempotency";
import { isStoreCommerciallyActive } from "@/lib/lifecycle/status";

export const firestoreEventClaim: EventClaim = {
  async claim(storeId, key) {
    const ref = col(storeId, "webhook_events").doc(key);
    return db.runTransaction(async (tx) => {
      const [store, event] = await Promise.all([
        tx.get(storeRef(storeId)),
        tx.get(ref),
      ]);
      if (!isStoreCommerciallyActive(store.data()?.status) || event.exists) return false;
      tx.create(ref, { at: Date.now(), status: "processing" });
      return true;
    });
  },
  async release(storeId, key) {
    // Best-effort: se falhar ao liberar, a reentrega ainda cai como duplicata
    // (preferimos nao reenviar do que reenviar em duplicidade).
    await col(storeId, "webhook_events").doc(key).delete().catch(() => {});
  },
};
