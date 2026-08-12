// Implementacao Firestore da idempotencia de webhooks.
// Isolada do modulo puro (idempotency.ts) porque importa firebase-admin, que
// inicializa o SDK no load — nao deve ser puxado por testes unitarios.
import { col } from "@/lib/firebase/admin";
import type { EventClaim } from "./idempotency";

// ALREADY_EXISTS do Firestore (gRPC code 6). O .create() e atomico no servidor:
// so UMA requisicao concorrente consegue criar o doc; as demais recebem este
// erro e sao tratadas como duplicata.
function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: number | string })?.code;
  const msg = String((err as { message?: string })?.message ?? "");
  return code === 6 || code === "already-exists" || /already exists/i.test(msg);
}

export const firestoreEventClaim: EventClaim = {
  async claim(storeId, key) {
    try {
      await col(storeId, "webhook_events")
        .doc(key)
        .create({ at: Date.now(), status: "processing" });
      return true;
    } catch (err) {
      if (isAlreadyExists(err)) return false;
      throw err; // erro real de infra: propaga para retornar 5xx e reentregar
    }
  },
  async release(storeId, key) {
    // Best-effort: se falhar ao liberar, a reentrega ainda cai como duplicata
    // (preferimos nao reenviar do que reenviar em duplicidade).
    await col(storeId, "webhook_events").doc(key).delete().catch(() => {});
  },
};
